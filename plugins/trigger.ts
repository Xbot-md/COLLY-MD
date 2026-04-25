import type { BotContext } from '../types.js';
import { getDb } from '../lib/turso.js';

interface TriggerRule {
    id: number;
    group_id: string;
    trigger: string;
    response: string;
    set_by: string;
}

async function getRules(groupId: string): Promise<TriggerRule[]> {
    const db = getDb();
    const res = await db.execute({
        sql: `SELECT id, group_id, trigger, response, set_by FROM trigger_rules WHERE group_id=? ORDER BY id DESC`,
        args: [groupId],
    });
    return res.rows as any[];
}

async function addRule(groupId: string, trigger: string, response: string, setBy: string): Promise<void> {
    const db = getDb();
    await db.execute({
        sql: `INSERT INTO trigger_rules (group_id, trigger, response, set_by, set_at) VALUES (?, ?, ?, ?, ?)`,
        args: [groupId, trigger.toLowerCase(), response, setBy, Date.now()],
    });
}

async function deleteRule(id: number, groupId: string): Promise<boolean> {
    const db = getDb();
    const res = await db.execute({
        sql: `DELETE FROM trigger_rules WHERE id=? AND group_id=?`,
        args: [id, groupId],
    });
    return (res.rowsAffected ?? 0) > 0;
}

async function clearRules(groupId: string): Promise<void> {
    const db = getDb();
    await db.execute({ sql: `DELETE FROM trigger_rules WHERE group_id=?`, args: [groupId] });
}

export async function checkTriggers(sock: any, chatId: string, message: any, text: string): Promise<boolean> {
    if (!text || text.length > 500) return false;
    try {
        const rules = await getRules(chatId);
        if (!rules.length) return false;
        const lower = text.toLowerCase().trim();
        for (const rule of rules) {
            if (lower === rule.trigger || lower.includes(rule.trigger)) {
                await sock.sendMessage(chatId, { text: rule.response }, { quoted: message });
                return true;
            }
        }
    } catch {}
    return false;
}

export default {
    command: 'trigger',
    aliases: ['keyword', 'triggeradd'],
    category: 'admin',
    description: 'Set custom keyword auto-responders for the group',
    usage: '.trigger add <word> | <reply> | .trigger list | .trigger del <id> | .trigger clear',
    groupOnly: true,
    adminOnly: true,

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;

        const sub = args[0]?.toLowerCase();

        if (sub === 'add') {
            const rest = args.slice(1).join(' ');
            const split = rest.split('|');
            if (split.length < 2) {
                return sock.sendMessage(chatId, {
                    text: '❌ Usage: `.trigger add <keyword> | <response>`\nExample: `.trigger add hello | Hey there! 👋`',
                    ...channelInfo
                }, { quoted: message });
            }
            const trigger = split[0].trim();
            const response = split.slice(1).join('|').trim();
            if (!trigger || !response) {
                return sock.sendMessage(chatId, { text: '❌ Both keyword and response are required.', ...channelInfo }, { quoted: message });
            }
            const existing = await getRules(chatId);
            if (existing.length >= 30) {
                return sock.sendMessage(chatId, { text: '❌ Maximum of 30 trigger rules per group.', ...channelInfo }, { quoted: message });
            }
            await addRule(chatId, trigger, response, senderId);
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *⚡ TRIGGER ADDED* ❱───╮

*🔑 Keyword:* ${trigger}
*💬 Response:* ${response}

_Bot will now auto-reply when someone says that keyword_

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }

        if (sub === 'list') {
            const rules = await getRules(chatId);
            if (!rules.length) {
                return sock.sendMessage(chatId, {
                    text: '❌ *No trigger rules set yet.*\nUse `.trigger add <keyword> | <response>` to add one.',
                    ...channelInfo
                }, { quoted: message });
            }
            const list = rules.map(r => `*[${r.id}]* \`${r.trigger}\` → _${r.response.slice(0, 40)}${r.response.length > 40 ? '...' : ''}_`).join('\n');
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *⚡ TRIGGER RULES* ❱───╮

${list}

_Use .trigger del <id> to remove a rule_

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }

        if (sub === 'del' || sub === 'delete' || sub === 'remove') {
            const id = parseInt(args[1]);
            if (isNaN(id)) {
                return sock.sendMessage(chatId, { text: '❌ Usage: `.trigger del <id>`', ...channelInfo }, { quoted: message });
            }
            const deleted = await deleteRule(id, chatId);
            return sock.sendMessage(chatId, {
                text: deleted ? `✅ Trigger rule *#${id}* deleted.` : `❌ Rule #${id} not found.`,
                ...channelInfo
            }, { quoted: message });
        }

        if (sub === 'clear') {
            await clearRules(chatId);
            return sock.sendMessage(chatId, {
                text: '✅ *All trigger rules cleared.*',
                ...channelInfo
            }, { quoted: message });
        }

        return sock.sendMessage(chatId, {
            text:
`╭───❰ *⚡ TRIGGER HELP* ❱───╮

*Commands:*
• \`.trigger add <word> | <reply>\`
• \`.trigger list\`
• \`.trigger del <id>\`
• \`.trigger clear\`

*Example:*
\`.trigger add goodnight | 🌙 Sweet dreams!\`

*Note:* Keyword matching is case-insensitive and checks if the message contains the keyword.

╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });
    },
};
