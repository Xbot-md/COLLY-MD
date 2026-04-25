import type { BotContext } from '../types.js';
import { getDb } from '../lib/turso.js';

// ── Pickup lines (built-in list) ──────────────────────────────────────────────
const PICKUP_LINES = [
    'Are you a magician? Because whenever I look at you, everyone else disappears.',
    'Do you have a map? I keep getting lost in your eyes.',
    'Are you a parking ticket? Because you\'ve got "fine" written all over you.',
    'Is your name Google? Because you have everything I\'ve been searching for.',
    'Do you believe in love at first sight — or should I walk by again?',
    'Are you a bank loan? Because you have my interest.',
    'If you were a vegetable, you\'d be a cute-cumber.',
    'Do you have a Band-Aid? I just scraped my knee falling for you.',
    'Are you made of copper and tellurium? Because you\'re CuTe.',
    'I must be a snowflake because I\'ve fallen for you.',
    'Are you a campfire? Because you\'re hot and I want s\'more.',
    'Do you like Star Wars? Because Yoda one for me.',
    'Are you a time traveler? Because I see you in my future.',
    'If beauty were time, you\'d be an eternity.',
    'Are you an alien? Because you just abducted my heart.',
    'Do you have a mirror in your pocket? Because I can see myself in your pants. Just kidding, I see a future in you.',
    'Are you a Wi-Fi signal? Because I\'m feeling a connection.',
    'You must be made of stars because you light up every room you enter.',
    'Is your name Bluetooth? Because I feel paired to you.',
    'If you were a cat, you\'d purr-fect.',
    'Are you a keyboard? Because you\'re just my type.',
    'Is your name Netflix? Because I could watch you for hours.',
    'You\'re like a fine wine — you get better with every second I look at you.',
    'Do you play soccer? Because you\'ve been running through my mind all day.',
    'Are you a shooting star? Because I\'ve been wishing for you.',
];

// ── Confess: anonymous in-group posting ──────────────────────────────────────
async function getConfessSettings(groupId: string): Promise<boolean> {
    const c   = getDb();
    const res = await c.execute({ sql: `SELECT enabled FROM confessions_settings WHERE group_id=?`, args: [groupId] });
    return res.rows.length > 0 && !!res.rows[0].enabled;
}

async function setConfessSettings(groupId: string, enabled: boolean, setBy: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO confessions_settings (group_id, enabled, set_by, set_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(group_id) DO UPDATE SET enabled=excluded.enabled, set_by=excluded.set_by, set_at=excluded.set_at`,
        args: [groupId, enabled ? 1 : 0, setBy, Date.now()],
    });
}

// ── Commands ──────────────────────────────────────────────────────────────────

const advice = {
    command: 'advice',
    aliases: ['randomadvice', 'lifetip'],
    category: 'fun',
    description: 'Fetch a random piece of life advice',
    usage: '.advice',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        try {
            const res  = await fetch('https://api.adviceslip.com/advice', { signal: AbortSignal.timeout(10000) });
            const data = await res.json() as any;
            const slip = data?.slip?.advice || 'Keep going. Every step counts.';
            await sock.sendMessage(chatId, {
                text:
`╭───❰ *💡 RANDOM ADVICE* ❱───╮

_"${slip}"_

— Wisdom Bot

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch {
            await sock.sendMessage(chatId, {
                text: '❌ Could not fetch advice right now. Try again later.',
                ...channelInfo
            }, { quoted: message });
        }
    },
};

const line = {
    command: 'line',
    aliases: ['pickupline', 'flirt'],
    category: 'fun',
    description: 'Get a random pick-up line',
    usage: '.line',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const picked = PICKUP_LINES[Math.floor(Math.random() * PICKUP_LINES.length)];
        await sock.sendMessage(chatId, {
            text:
`╭───❰ *💘 PICK-UP LINE* ❱───╮

_"${picked}"_

Use wisely 😏

╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });
    },
};

const confess = {
    command: 'confess',
    aliases: ['anon', 'anonymous'],
    category: 'fun',
    description: 'Send an anonymous message to the group',
    usage: '.confess <message> | .confess on/off (admin)',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId, isGroup, isBotAdmin, isSenderAdmin } = context;

        const sub = args[0]?.toLowerCase();

        // ── Admin: toggle confessions ────────────────────────────────────────
        if ((sub === 'on' || sub === 'off') && isGroup) {
            if (!isSenderAdmin) {
                return sock.sendMessage(chatId, {
                    text: '❌ Only admins can enable/disable confessions.',
                    ...channelInfo
                }, { quoted: message });
            }
            const enable = sub === 'on';
            await setConfessSettings(chatId, enable, senderId);
            return sock.sendMessage(chatId, {
                text: enable
                    ? `✅ *Confessions enabled!*\nMembers can now send anonymous messages using *.confess <message>* in this group.`
                    : `❌ *Confessions disabled.*`,
                ...channelInfo
            }, { quoted: message });
        }

        // ── Send anonymous confession in group ───────────────────────────────
        if (isGroup) {
            const enabled = await getConfessSettings(chatId);
            if (!enabled) {
                return sock.sendMessage(chatId, {
                    text: '❌ Confessions are not enabled in this group.\n_Admins can enable with .confess on_',
                    ...channelInfo
                }, { quoted: message });
            }
            const text = args.join(' ').trim();
            if (!text) {
                return sock.sendMessage(chatId, { text: '❌ Usage: .confess <your message>', ...channelInfo }, { quoted: message });
            }

            // Delete original message (if bot is admin)
            if (isBotAdmin) {
                try {
                    await sock.sendMessage(chatId, { delete: { remoteJid: chatId, fromMe: false, id: message.key.id, participant: senderId } });
                } catch {}
            }

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *🕵️ ANONYMOUS CONFESSION* ❱───╮

_"${text}"_

╰────────────────────────────╯`,
                ...channelInfo
            });
            return;
        }

        // ── DM fallback ──────────────────────────────────────────────────────
        await sock.sendMessage(chatId, {
            text:
`*🕵️ Confessions Setup*

Use *.confess <message>* inside a group that has confessions enabled.

Admins can enable with *.confess on* inside a group.`,
            ...channelInfo
        }, { quoted: message });
    },
};

export default [advice, line, confess];
