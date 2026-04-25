import type { BotContext } from '../types.js';
import { getDb } from '../lib/turso.js';

function numOf(jid: string) { return jid.split('@')[0].split(':')[0]; }

function parseThreshold(args: string[]): { value: number; unit: string; ms: number } | null {
    const num = parseInt(args[0]);
    const unit = (args[1] || 'days').toLowerCase();
    if (isNaN(num) || num < 1) return null;
    const ms = unit.startsWith('h') ? num * 3600_000 : num * 86400_000;
    const label = unit.startsWith('h') ? (num === 1 ? 'hour' : 'hours') : (num === 1 ? 'day' : 'days');
    return { value: num, unit: label, ms };
}

const listghost = {
    command: 'listghost',
    aliases: ['ghosts', 'inactive'],
    category: 'group',
    description: 'List members who haven\'t sent a message within a given period',
    usage: '.listghost <number> [hours|days] — e.g. .listghost 7 days',
    groupOnly: true,
    adminOnly: true,

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const threshold = parseThreshold(args);
        if (!threshold) {
            return sock.sendMessage(chatId, {
                text: '❌ Usage: `.listghost <number> [hours|days]`\nExample: `.listghost 7 days` or `.listghost 12 hours`',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);

        try {
            const meta = await sock.groupMetadata(chatId);
            const allMembers: string[] = meta.participants.map((p: any) => p.id);
            const adminIds: Set<string> = new Set(
                meta.participants.filter((p: any) => p.admin).map((p: any) => p.id)
            );

            const db = getDb();
            const cutoff = Date.now() - threshold.ms;

            const res = await db.execute({
                sql: `SELECT user_id, last_seen, msg_count FROM msg_activity WHERE group_id = ?`,
                args: [chatId],
            });

            const activityMap = new Map<string, { last_seen: number; msg_count: number }>();
            for (const row of res.rows as any[]) {
                activityMap.set(row.user_id, { last_seen: Number(row.last_seen), msg_count: Number(row.msg_count) });
            }

            // FIXED: only flag members who have an activity record AND it's older than cutoff.
            // Members with NO record at all are "unknown" — bot hasn't seen them message yet,
            // so we can't claim they're ghosts (used to dump everyone in big groups).
            const ghosts: string[] = [];
            const unknown: string[] = [];
            for (const jid of allMembers) {
                if (adminIds.has(jid)) continue;
                const activity = activityMap.get(jid);
                if (!activity) { unknown.push(jid); continue; }
                if (activity.last_seen < cutoff) ghosts.push(jid);
            }
            const trackedNonAdmins = allMembers.length - adminIds.size - unknown.length;

            if (!ghosts.length) {
                return sock.sendMessage(chatId, {
                    text: `✅ *No ghosts found!*\nEvery member has been active in the last *${threshold.value} ${threshold.unit}*.`,
                    ...channelInfo
                }, { quoted: message });
            }

            const tags = ghosts.map(j => `@${numOf(j)}`).join('\n');
            await sock.sendMessage(chatId, {
                text:
`╭───❰ *👻 GHOST LIST* ❱───╮

*⏱️ Inactive for:* ${threshold.value} ${threshold.unit}
*👥 Total ghosts:* ${ghosts.length}/${trackedNonAdmins} tracked members
*👁️ Untracked:* ${unknown.length} (bot hasn't seen them yet)
*🏛️ Group size:* ${allMembers.length} total / ${adminIds.size} admins

${tags}

_Use .kickinactive ${args.join(' ')} to remove them_

╰────────────────────────────╯`,
                mentions: ghosts,
                ...channelInfo
            }, { quoted: message });

        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

const kickinactive = {
    command: 'kickinactive',
    aliases: ['kickghosts', 'removeinactive'],
    category: 'group',
    description: 'Remove inactive members (excludes admins & members who joined in the last 24h)',
    usage: '.kickinactive <number> [hours|days]',
    groupOnly: true,
    adminOnly: true,

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, isBotAdmin } = context;

        if (!isBotAdmin) {
            return sock.sendMessage(chatId, {
                text: '❌ *Bot must be an admin* to kick members.',
                ...channelInfo
            }, { quoted: message });
        }

        const threshold = parseThreshold(args);
        if (!threshold) {
            return sock.sendMessage(chatId, {
                text: '❌ Usage: `.kickinactive <number> [hours|days]`\nExample: `.kickinactive 7 days`',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);

        try {
            const meta = await sock.groupMetadata(chatId);
            const allMembers: string[] = meta.participants.map((p: any) => p.id);
            const adminIds: Set<string> = new Set(
                meta.participants.filter((p: any) => p.admin).map((p: any) => p.id)
            );

            const db = getDb();
            const cutoff = Date.now() - threshold.ms;
            const recentJoinCutoff = Date.now() - 86400_000;

            const res = await db.execute({
                sql: `SELECT user_id, last_seen, msg_count FROM msg_activity WHERE group_id = ?`,
                args: [chatId],
            });

            const activityMap = new Map<string, { last_seen: number; msg_count: number }>();
            for (const row of res.rows as any[]) {
                activityMap.set(row.user_id, { last_seen: Number(row.last_seen), msg_count: Number(row.msg_count) });
            }

            const toKick: string[] = [];
            for (const jid of allMembers) {
                if (adminIds.has(jid)) continue;
                const activity = activityMap.get(jid);
                if (activity && activity.last_seen > recentJoinCutoff) continue;
                if (!activity || activity.last_seen < cutoff) {
                    toKick.push(jid);
                }
            }

            if (!toKick.length) {
                return sock.sendMessage(chatId, {
                    text: `✅ *No inactive members to kick!*\nAll non-admin members have been active in the last *${threshold.value} ${threshold.unit}*.`,
                    ...channelInfo
                }, { quoted: message });
            }

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *🚫 KICKING INACTIVE* ❱───╮

*⏱️ Inactive for:* ${threshold.value} ${threshold.unit}
*👤 Removing:* ${toKick.length} member${toKick.length !== 1 ? 's' : ''}
*🛡️ Skipping:* Admins + members who joined < 24h ago

_Processing..._

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });

            let kicked = 0;
            for (let i = 0; i < toKick.length; i += 10) {
                try {
                    await sock.groupParticipantsUpdate(chatId, toKick.slice(i, i + 10), 'remove');
                    kicked += Math.min(10, toKick.length - i);
                } catch {}
                if (i + 10 < toKick.length) await new Promise(r => setTimeout(r, 800));
            }

            await sock.sendMessage(chatId, {
                text: `✅ *Done!* Kicked *${kicked}* inactive member${kicked !== 1 ? 's' : ''}.`,
                ...channelInfo
            }, { quoted: message });

        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

const peaktimes = {
    command: 'peaktimes',
    aliases: ['grouppeak', 'activehours', 'heatmap'],
    category: 'group',
    description: 'Show when the group is most active throughout the day',
    usage: '.peaktimes',
    groupOnly: true,

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        await sock.sendPresenceUpdate('composing', chatId);

        try {
            const db = getDb();
            const res = await db.execute({
                sql: `SELECT hour_of_day, msg_count FROM msg_hourly WHERE group_id = ? ORDER BY hour_of_day ASC`,
                args: [chatId],
            });

            if (!res.rows.length) {
                return sock.sendMessage(chatId, {
                    text: '❌ *No activity data yet.*\nSend more messages in the group first.',
                    ...channelInfo
                }, { quoted: message });
            }

            const hourMap = new Map<number, number>();
            for (const row of res.rows as any[]) {
                hourMap.set(Number(row.hour_of_day), Number(row.msg_count));
            }

            const maxCount = Math.max(...hourMap.values());
            const totalMsgs = Array.from(hourMap.values()).reduce((a, b) => a + b, 0);

            let chart = '';
            for (let h = 0; h < 24; h++) {
                const count = hourMap.get(h) || 0;
                const barLen = maxCount > 0 ? Math.round((count / maxCount) * 10) : 0;
                const bar = '█'.repeat(barLen) + '░'.repeat(10 - barLen);
                const label = `${String(h).padStart(2, '0')}:00`;
                const pct = totalMsgs > 0 ? ((count / totalMsgs) * 100).toFixed(1) : '0.0';
                chart += `${label} [${bar}] ${pct}%\n`;
            }

            const peakHour = [...hourMap.entries()].sort((a, b) => b[1] - a[1])[0];
            const peakLabel = `${String(peakHour[0]).padStart(2, '0')}:00 – ${String(peakHour[0] + 1).padStart(2, '0')}:00`;

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *📊 GROUP PEAK TIMES* ❱───╮

*🏆 Most Active:* ${peakLabel}
*💬 Total messages tracked:* ${totalMsgs}

*📈 Hourly Breakdown:*
\`\`\`
${chart}\`\`\`

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });

        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

const listactive = {
    command: 'listactive',
    aliases: ['activetoday', 'whoactive'],
    category: 'group',
    description: 'Show members active within timeframe. Usage: .listactive [number] [hours|days]',
    usage: '.listactive 24 hours',
    groupOnly: true,

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        await sock.sendPresenceUpdate('composing', chatId);

        const threshold = parseThreshold(args) || { value: 24, unit: 'hours', ms: 86400_000 };

        try {
            const db = getDb();
            const since = Date.now() - threshold.ms;

            const res = await db.execute({
                sql: `SELECT user_id, msg_count FROM msg_activity WHERE group_id = ? AND last_seen >= ? ORDER BY msg_count DESC`,
                args: [chatId, since],
            });

            if (!res.rows.length) {
                return sock.sendMessage(chatId, {
                    text: `❌ *No active members found in the last ${threshold.value} ${threshold.unit}.*\nThis data needs time to accumulate.`,
                    ...channelInfo
                }, { quoted: message });
            }

            const rows = res.rows as any[];
            const mentions = rows.map(r => r.user_id);
            const list = rows.map((r, i) =>
                `*${i + 1}.* @${numOf(r.user_id)} — ${r.msg_count} msg${r.msg_count !== 1 ? 's' : ''}`
            ).join('\n');

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *✅ ACTIVE MEMBERS* ❱───╮

*⏱️ Last ${threshold.value} ${threshold.unit}*
*👥 Active:* ${rows.length} member${rows.length !== 1 ? 's' : ''}

${list}

╰────────────────────────────╯`,
                mentions,
                ...channelInfo
            }, { quoted: message });

        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

export default [listghost, kickinactive, peaktimes, listactive];
