import type { BotContext } from '../types.js';
import { getDb } from '../lib/turso.js';

// ── In-memory join tracker ─────────────────────────────────────────────────────
const raidTracker = new Map<string, { jids: string[]; timestamps: number[] }>();

// ── DB helpers ─────────────────────────────────────────────────────────────────
interface RaidSettings {
    enabled:   boolean;
    threshold: number;
    windowSec: number;
    action:    string;
}

async function getSettings(groupId: string): Promise<RaidSettings | null> {
    const c   = getDb();
    const res = await c.execute({ sql: `SELECT * FROM antiraid_settings WHERE group_id=?`, args: [groupId] });
    if (!res.rows.length) return null;
    const r = res.rows[0] as any;
    return {
        enabled:   !!r.enabled,
        threshold: Number(r.threshold),
        windowSec: Number(r.window_sec),
        action:    r.action as string,
    };
}

async function saveSettings(groupId: string, s: RaidSettings): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO antiraid_settings (group_id, enabled, threshold, window_sec, action)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(group_id) DO UPDATE SET
                enabled=excluded.enabled, threshold=excluded.threshold,
                window_sec=excluded.window_sec, action=excluded.action`,
        args: [groupId, s.enabled ? 1 : 0, s.threshold, s.windowSec, s.action],
    });
}

const DEFAULT: RaidSettings = { enabled: false, threshold: 5, windowSec: 30, action: 'kick+lock' };

// ── Called by messageHandler on each 'add' event ──────────────────────────────
export async function handleJoinForRaid(sock: any, groupId: string, newJids: string[]): Promise<void> {
    try {
        const settings = await getSettings(groupId);
        if (!settings?.enabled) return;

        const now     = Date.now();
        const windowMs = settings.windowSec * 1000;

        if (!raidTracker.has(groupId)) raidTracker.set(groupId, { jids: [], timestamps: [] });
        const entry = raidTracker.get(groupId)!;

        // Prune entries outside the window
        while (entry.timestamps.length && now - entry.timestamps[0] > windowMs) {
            entry.timestamps.shift();
            entry.jids.shift();
        }

        // Record new joiners
        for (const jid of newJids) {
            entry.jids.push(jid);
            entry.timestamps.push(now);
        }

        if (entry.jids.length < settings.threshold) return;

        // ── RAID DETECTED ─────────────────────────────────────────────────────
        const raidJids = [...entry.jids];
        entry.jids      = [];
        entry.timestamps = [];

        const num = raidJids.length;
        await sock.sendMessage(groupId, {
            text:
`🚨 *RAID DETECTED!*

${num} user${num !== 1 ? 's' : ''} joined within *${settings.windowSec}s* — possible coordinated raid.
🛡️ Action: *${settings.action.toUpperCase()}*`,
        });

        if (settings.action === 'lock' || settings.action === 'kick+lock') {
            try { await sock.groupSettingUpdate(groupId, 'announcement'); } catch {}
        }

        if (settings.action === 'kick' || settings.action === 'kick+lock') {
            try {
                const meta      = await sock.groupMetadata(groupId);
                const adminJids = meta.participants.filter((p: any) => p.admin).map((p: any) => p.id);
                const toKick    = raidJids.filter(j => !adminJids.includes(j));
                if (toKick.length) {
                    // Kick in chunks of 10
                    for (let i = 0; i < toKick.length; i += 10) {
                        await sock.groupParticipantsUpdate(groupId, toKick.slice(i, i + 10), 'remove');
                        if (i + 10 < toKick.length) await new Promise(r => setTimeout(r, 600));
                    }
                }
            } catch {}
        }

        await sock.sendMessage(groupId, {
            text: `✅ *Raid response complete.* ${raidJids.length} joiner${raidJids.length !== 1 ? 's' : ''} handled.`,
        });

    } catch (e: any) {
        console.error('[ANTIRAID]', e.message);
    }
}

// ── Command ────────────────────────────────────────────────────────────────────
export default {
    command:   'antiraid',
    aliases:   ['araid', 'raidprotect'],
    category:  'admin',
    groupOnly: true,
    adminOnly: true,
    description: 'Protect group from coordinated mass-join raids',
    usage: '.antiraid on/off | .antiraid set <threshold> <seconds> | .antiraid action <kick|lock|kick+lock>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, isBotAdmin } = context;
        const sub = args[0]?.toLowerCase();
        const settings = await getSettings(chatId) ?? { ...DEFAULT };

        if (!sub || sub === 'status') {
            return sock.sendMessage(chatId, {
                text:
`🛡️ *ANTI-RAID STATUS*

*Status:* ${settings.enabled ? '✅ Enabled' : '❌ Disabled'}
*Threshold:* ${settings.threshold} joins in ${settings.windowSec}s
*Action:* ${settings.action.toUpperCase()}
*Bot is admin:* ${isBotAdmin ? '✅ Yes' : '❌ No (required for kick/lock)'}

*Commands:*
• \`.antiraid on/off\`
• \`.antiraid set 5 30\` — trigger after 5 joins in 30s
• \`.antiraid action kick|lock|kick+lock\``,
                ...channelInfo
            }, { quoted: message });
        }

        if (sub === 'on') {
            settings.enabled = true;
            await saveSettings(chatId, settings);
            return sock.sendMessage(chatId, {
                text: `✅ *Anti-raid enabled!*\nThreshold: ${settings.threshold} joins in ${settings.windowSec}s → *${settings.action.toUpperCase()}*`,
                ...channelInfo
            }, { quoted: message });
        }

        if (sub === 'off') {
            settings.enabled = false;
            await saveSettings(chatId, settings);
            return sock.sendMessage(chatId, { text: '❌ *Anti-raid disabled.*', ...channelInfo }, { quoted: message });
        }

        if (sub === 'set') {
            const th = parseInt(args[1]);
            const ws = parseInt(args[2]);
            if (isNaN(th) || isNaN(ws) || th < 2 || ws < 5) {
                return sock.sendMessage(chatId, {
                    text: '❌ Usage: `.antiraid set <threshold> <seconds>`\nExample: `.antiraid set 5 30`\n_(min threshold: 2, min window: 5s)_',
                    ...channelInfo
                }, { quoted: message });
            }
            settings.threshold = th;
            settings.windowSec  = ws;
            await saveSettings(chatId, settings);
            return sock.sendMessage(chatId, {
                text: `✅ Threshold updated: *${th} joins* in *${ws}s*`,
                ...channelInfo
            }, { quoted: message });
        }

        if (sub === 'action') {
            const act = args[1]?.toLowerCase();
            if (!['kick', 'lock', 'kick+lock'].includes(act)) {
                return sock.sendMessage(chatId, {
                    text: '❌ Choose: `kick`, `lock`, or `kick+lock`',
                    ...channelInfo
                }, { quoted: message });
            }
            settings.action = act;
            await saveSettings(chatId, settings);
            return sock.sendMessage(chatId, {
                text: `✅ Action set to: *${act.toUpperCase()}*`,
                ...channelInfo
            }, { quoted: message });
        }

        return sock.sendMessage(chatId, {
            text: '❌ Unknown subcommand. Use `.antiraid` to see options.',
            ...channelInfo
        }, { quoted: message });
    },

    handleJoinForRaid,
};
