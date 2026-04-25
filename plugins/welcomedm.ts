import type { BotContext } from '../types.js';
import { getDb } from '../lib/turso.js';
import { isWelcomeOn, getWelcome } from '../lib/index.js';

function numOf(jid: string) { return jid.split('@')[0].split(':')[0]; }

const pendingJoiners = new Map<string, { jids: string[]; timer: ReturnType<typeof setTimeout> }>();

async function isWelcomeDmOn(groupId: string): Promise<boolean> {
    try {
        const db = getDb();
        const res = await db.execute({
            sql: `SELECT value FROM bot_settings WHERE key=?`,
            args: [`welcomedm_${groupId}`],
        });
        return res.rows.length > 0 && res.rows[0].value === '1';
    } catch { return false; }
}

async function setWelcomeDm(groupId: string, enabled: boolean): Promise<void> {
    const db = getDb();
    await db.execute({
        sql: `INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        args: [`welcomedm_${groupId}`, enabled ? '1' : '0'],
    });
}

export async function handleBatchJoinEvent(sock: any, groupId: string, participants: string[]): Promise<boolean> {
    const batchOn = await isWelcomeDmOn(groupId);
    if (!batchOn) return false;

    const welcomeOn = await isWelcomeOn(groupId);
    if (!welcomeOn) return false;

    if (!pendingJoiners.has(groupId)) {
        pendingJoiners.set(groupId, { jids: [], timer: null as any });
    }
    const entry = pendingJoiners.get(groupId)!;
    const newJids = Array.isArray(participants) ? participants.map(p => typeof p === 'string' ? p : (p as any).id || p) : [participants];
    entry.jids.push(...newJids);

    if (entry.timer) clearTimeout(entry.timer);

    entry.timer = setTimeout(async () => {
        const snapshot = [...entry.jids];
        entry.jids = [];
        pendingJoiners.delete(groupId);

        try {
            const meta = await sock.groupMetadata(groupId);
            const groupName = meta.subject;
            const groupDesc = meta.desc || 'No description available';
            const memberCount = meta.participants.length;

            const customMessage = await getWelcome(groupId);
            const mentions: string[] = snapshot;

            let welcomeText = '';
            const tags = snapshot.map(j => `@${numOf(j)}`).join(', ');

            if (customMessage) {
                welcomeText = customMessage
                    .replace(/{user}/g, tags)
                    .replace(/{group}/g, groupName)
                    .replace(/{description}/g, groupDesc);
            } else {
                welcomeText =
`╭╼━≪•𝙽𝙴𝚆 𝙼𝙴𝙼𝙱𝙴𝚁${snapshot.length > 1 ? 'S' : ''}•≫━╾╮
┃𝚆𝙴𝙻𝙲𝙾𝙼𝙴: ${tags} 👋
┃Members: #${memberCount}
╰━━━━━━━━━━━━━━━━━━━╯

${tags} Welcome to *${groupName}*! 🎉

*Group Description:*
${groupDesc}

> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ COLLY MD*`;
            }

            await sock.sendMessage(groupId, { text: welcomeText, mentions });
        } catch (e: any) {
            console.error('[WELCOMEDM] Batch error:', e.message);
        }
    }, 3 * 60 * 1000);

    return true;
}

const welcomedm = {
    command: 'welcomedm',
    aliases: ['batchjoin', 'joinbatch'],
    category: 'admin',
    description: 'Enable batch welcome — groups multiple joiners together instead of spamming one by one',
    usage: '.welcomedm on/off',
    groupOnly: true,
    adminOnly: true,

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const sub = args[0]?.toLowerCase();

        if (sub === 'on') {
            await setWelcomeDm(chatId, true);
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *📨 WELCOME DM MODE* ❱───╮

✅ *Batch Welcome Enabled!*

New joiners will be buffered for *3 minutes*.
If multiple people join, they'll all be welcomed *together* in one message instead of spam.

_Make sure .welcome is also enabled!_

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }

        if (sub === 'off') {
            await setWelcomeDm(chatId, false);
            return sock.sendMessage(chatId, {
                text: '❌ *Batch Welcome disabled.* Members will now be welcomed individually.',
                ...channelInfo
            }, { quoted: message });
        }

        const isOn = await isWelcomeDmOn(chatId);
        return sock.sendMessage(chatId, {
            text:
`╭───❰ *📨 WELCOME DM* ❱───╮

*Status:* ${isOn ? '✅ Enabled' : '❌ Disabled'}

*Usage:*
• \`.welcomedm on\` — Enable batch welcome
• \`.welcomedm off\` — Disable

*How it works:*
When enabled, the bot waits 3 minutes after someone joins. If multiple people join in that window, they are all welcomed together in one message.

╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });
    },
};

export default [welcomedm];
