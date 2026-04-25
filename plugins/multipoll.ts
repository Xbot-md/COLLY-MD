import type { BotContext } from '../types.js';
import { getDb } from '../lib/turso.js';
import { randomUUID } from 'crypto';

function numOf(jid: string) { return jid.split('@')[0].split(':')[0]; }

interface PollData {
    poll_id: string;
    group_id: string;
    question: string;
    options: string[];
    votes: Record<string, string>;
    creator: string;
    created_at: number;
    closed: boolean;
}

async function createPoll(groupId: string, creator: string, question: string, options: string[]): Promise<string> {
    const db = getDb();
    const id = randomUUID();
    await db.execute({
        sql: `INSERT INTO multipoll_data (poll_id, group_id, question, options, votes, creator, created_at, closed) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        args: [id, groupId, question, JSON.stringify(options), '{}', creator, Date.now()],
    });
    return id;
}

async function getPoll(pollId: string): Promise<PollData | null> {
    const db = getDb();
    const res = await db.execute({ sql: `SELECT * FROM multipoll_data WHERE poll_id=?`, args: [pollId] });
    if (!res.rows.length) return null;
    const r = res.rows[0] as any;
    return {
        poll_id: r.poll_id,
        group_id: r.group_id,
        question: r.question,
        options: JSON.parse(r.options),
        votes: JSON.parse(r.votes),
        creator: r.creator,
        created_at: Number(r.created_at),
        closed: !!r.closed,
    };
}

async function getGroupActivePoll(groupId: string): Promise<PollData | null> {
    const db = getDb();
    const res = await db.execute({
        sql: `SELECT * FROM multipoll_data WHERE group_id=? AND closed=0 ORDER BY created_at DESC LIMIT 1`,
        args: [groupId],
    });
    if (!res.rows.length) return null;
    const r = res.rows[0] as any;
    return {
        poll_id: r.poll_id,
        group_id: r.group_id,
        question: r.question,
        options: JSON.parse(r.options),
        votes: JSON.parse(r.votes),
        creator: r.creator,
        created_at: Number(r.created_at),
        closed: !!r.closed,
    };
}

async function voteOnPoll(pollId: string, userId: string, option: string): Promise<{ ok: boolean; msg: string }> {
    const poll = await getPoll(pollId);
    if (!poll) return { ok: false, msg: 'Poll not found.' };
    if (poll.closed) return { ok: false, msg: 'Poll is already closed.' };
    const idx = parseInt(option) - 1;
    if (isNaN(idx) || idx < 0 || idx >= poll.options.length) {
        return { ok: false, msg: `Invalid option. Choose 1–${poll.options.length}.` };
    }
    if (poll.votes[userId] !== undefined) return { ok: false, msg: 'You already voted!' };
    poll.votes[userId] = String(idx);
    const db = getDb();
    await db.execute({ sql: `UPDATE multipoll_data SET votes=? WHERE poll_id=?`, args: [JSON.stringify(poll.votes), pollId] });
    return { ok: true, msg: `✅ Voted for option *${idx + 1}*: ${poll.options[idx]}` };
}

async function closePoll(pollId: string): Promise<PollData | null> {
    const db = getDb();
    await db.execute({ sql: `UPDATE multipoll_data SET closed=1 WHERE poll_id=?`, args: [pollId] });
    return getPoll(pollId);
}

function buildResults(poll: PollData): string {
    const tally: number[] = poll.options.map(() => 0);
    for (const choice of Object.values(poll.votes)) {
        const i = parseInt(choice);
        if (i >= 0 && i < tally.length) tally[i]++;
    }
    const total = tally.reduce((a, b) => a + b, 0);
    const maxVotes = Math.max(...tally);
    return poll.options.map((opt, i) => {
        const v = tally[i];
        const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
        const bar = total > 0 && maxVotes > 0 ? '█'.repeat(Math.round((v / maxVotes) * 8)) + '░'.repeat(8 - Math.round((v / maxVotes) * 8)) : '░░░░░░░░';
        const win = v === maxVotes && maxVotes > 0 ? ' 🏆' : '';
        return `*${i + 1}.* ${opt}${win}\n   [${bar}] ${v} vote${v !== 1 ? 's' : ''} (${pct}%)`;
    }).join('\n\n');
}

const activePollMsg = new Map<string, string>();

export default {
    command: 'multipoll',
    aliases: ['poll', 'vote'],
    category: 'group',
    description: 'Create advanced polls with up to 10 options',
    usage: '.multipoll <question> | opt1 | opt2 | opt3 ...',
    groupOnly: true,

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId, isSenderAdmin, isBotAdmin } = context;

        const sub = args[0]?.toLowerCase();

        if (sub === 'vote') {
            const option = args[1];
            const poll = await getGroupActivePoll(chatId);
            if (!poll) {
                return sock.sendMessage(chatId, { text: '❌ No active poll found. Start one with `.multipoll <question> | opt1 | opt2`', ...channelInfo }, { quoted: message });
            }
            const { ok, msg } = await voteOnPoll(poll.poll_id, senderId, option);
            return sock.sendMessage(chatId, { text: ok ? msg : `❌ ${msg}`, ...channelInfo }, { quoted: message });
        }

        if (sub === 'results') {
            const poll = await getGroupActivePoll(chatId);
            if (!poll) {
                return sock.sendMessage(chatId, { text: '❌ No active poll.', ...channelInfo }, { quoted: message });
            }
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *📊 LIVE RESULTS* ❱───╮

*❓ ${poll.question}*

${buildResults(poll)}

*👥 Total votes:* ${Object.keys(poll.votes).length}
_Poll is still open_

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }

        if (sub === 'close' || sub === 'end') {
            const poll = await getGroupActivePoll(chatId);
            if (!poll) {
                return sock.sendMessage(chatId, { text: '❌ No active poll to close.', ...channelInfo }, { quoted: message });
            }
            if (!isSenderAdmin && poll.creator !== senderId) {
                return sock.sendMessage(chatId, { text: '❌ Only the poll creator or group admins can close the poll.', ...channelInfo }, { quoted: message });
            }
            const closed = await closePoll(poll.poll_id);
            if (!closed) return;

            return sock.sendMessage(chatId, {
                text:
`╭───❰ *📊 POLL CLOSED* ❱───╮

*❓ ${closed.question}*

${buildResults(closed)}

*👥 Total votes:* ${Object.keys(closed.votes).length}
*🔒 Status:* Closed

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }

        const fullText = args.join(' ');
        const parts = fullText.split('|').map(s => s.trim()).filter(Boolean);
        if (parts.length < 3) {
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *📊 MULTIPOLL HELP* ❱───╮

*Usage:*
\`.multipoll <question> | option1 | option2 | ...\`

*Example:*
\`.multipoll Fav color? | Red | Blue | Green\`

*Commands:*
• \`.multipoll vote <number>\` — Cast your vote
• \`.multipoll results\` — See live results
• \`.multipoll close\` — End the poll

*Limits:* 2–10 options per poll

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }

        const question = parts[0];
        const options = parts.slice(1, 11);

        if (options.length < 2) {
            return sock.sendMessage(chatId, { text: '❌ Provide at least 2 options separated by `|`', ...channelInfo }, { quoted: message });
        }

        const existing = await getGroupActivePoll(chatId);
        if (existing) {
            return sock.sendMessage(chatId, {
                text: `❌ There's already an active poll!\nClose it first with \`.multipoll close\``,
                ...channelInfo
            }, { quoted: message });
        }

        const pollId = await createPoll(chatId, senderId, question, options);

        const optList = options.map((o, i) => `*${i + 1}.* ${o}`).join('\n');
        await sock.sendMessage(chatId, {
            text:
`╭───❰ *📊 NEW POLL* ❱───╮

*❓ ${question}*

${optList}

*How to vote:*
\`.multipoll vote <number>\`

*Other commands:*
• \`.multipoll results\` — Live results
• \`.multipoll close\` — End poll

╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });
    },
};
