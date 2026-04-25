import type { BotContext } from '../types.js';
import { addGroupMute, getGroupMute, removeGroupMute } from '../lib/turso2.js';
import { cleanJid } from '../lib/isOwner.js';
// resolveJid no longer needed — universal target resolver handles JID normalization

function parseMuteArgs(args: string[]): { amount: number; durationMs: number; isHour: boolean; isMin: boolean; reason: string } {
    const numIdx = args.findIndex(a => /^\d+$/.test(a));
    const amount  = numIdx >= 0 ? Number(args[numIdx]) : 0;
    const unitArg = numIdx >= 0 ? (args[numIdx + 1] || '') : '';
    const isHour  = /^h(ou?r?s?)?$/i.test(unitArg);
    const isMin   = /^m(in(ute)?s?)?$/i.test(unitArg);
    const durationMs = amount > 0 ? (isHour ? amount * 3600_000 : amount * 60_000) : 0;
    const reasonStart = numIdx >= 0 ? (isHour || isMin ? numIdx + 2 : numIdx + 1) : 0;
    const reason = args.slice(reasonStart).join(' ').trim() || 'Admin order';
    return { amount, durationMs, isHour, isMin, reason };
}

export default [
    // ─── .mute ───────────────────────────────────────────────────────────────
    {
        command: 'mute',
        aliases: ['silence', 'admute'],
        category: 'admin',
        description: 'Mute a user — messages auto-deleted for the set duration',
        usage: '.mute @user <amount> [min|hour] [reason]',
        groupOnly: true,
        adminOnly: true,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const { resolveTarget } = await import('../lib/targetResolver.js');
            const r = await resolveTarget(sock, message, args);
            const target = r.jid;

            if (!target) {
                return sock.sendMessage(chatId, {
                    text: `❌ Usage: .mute <@user|reply|phone> <amount> [min|hour] [reason]\n_Example: .mute @user 30 min Spamming_`,
                    ...channelInfo
                }, { quoted: message });
            }

            const { amount, durationMs, isHour, isMin, reason } = parseMuteArgs(r.args);

            if (amount <= 0) {
                return sock.sendMessage(chatId, {
                    text: `❌ Please specify a duration.\n_Example: .mute @user 30 min Spamming_`,
                    ...channelInfo
                }, { quoted: message });
            }

            const mutedUntil = Date.now() + durationMs;
            await addGroupMute(target, chatId, senderId, mutedUntil, reason);

            const durationLabel = isHour
                ? `${amount} hour${amount !== 1 ? 's' : ''}`
                : `${amount} minute${amount !== 1 ? 's' : ''}`;
            const expiresLabel = new Date(mutedUntil).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

            const allMembers: string[] = [];
            try { const m = await sock.groupMetadata(chatId); m.participants.forEach((p: any) => allMembers.push(p.id)); } catch {}

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🔇 *MUTE ORDER*
╽  ─────────────────────────────
╽  ❏ *Subject:*   @${cleanJid(target)}
╽  ❏ *Muted by:*  ${message.pushName || cleanJid(senderId)}
╽  ❏ *Duration:*  ${durationLabel}
╽  ❏ *Expires:*   ${expiresLabel}
╽  ❏ *Reason:*    ${reason}
╽
╽  ⚠️ Messages will be auto-deleted
╽  until the mute expires.
╽
╽  _🔖 Colly novels | 👨‍💻 DavidXTech_
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [target, ...allMembers],
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── .unmute ─────────────────────────────────────────────────────────────
    {
        command: 'unmute',
        aliases: ['unsilence', 'adunmute'],
        category: 'admin',
        description: 'Lift a mute from a user',
        usage: '.unmute @user',
        groupOnly: true,
        adminOnly: true,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const { resolveTarget } = await import('../lib/targetResolver.js');
            const r = await resolveTarget(sock, message, args);
            const target = r.jid;

            if (!target) {
                return sock.sendMessage(chatId, {
                    text: `❌ Usage: .unmute <@user|reply|phone>`,
                    ...channelInfo
                }, { quoted: message });
            }

            const entry = await getGroupMute(target, chatId);
            if (!entry) {
                return sock.sendMessage(chatId, {
                    text: `⚠️ @${cleanJid(target)} is not currently muted.`,
                    mentions: [target],
                    ...channelInfo
                }, { quoted: message });
            }

            await removeGroupMute(target, chatId);

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🔊 *MUTE LIFTED*
╽
╽  ❏ *User:*   @${cleanJid(target)}
╽  ❏ *Reason:* ${entry.reason}
╽
╽  ✅ User may now speak freely.
╽
╽  _🔖 Colly novels | 👨‍💻 DavidXTech_
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [target],
                ...channelInfo
            }, { quoted: message });
        }
    }
];
