import type { BotContext } from '../types.js';
import {
    getCourtId, suspendCourtId, getIdSuspension, liftIdSuspension
} from '../lib/turso2.js';
import { resolveJid } from '../lib/lidUtils.js';
import isOwnerOrSudo from '../lib/isOwner.js';

function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }
function fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtCountdown(ms: number): string {
    const diff = ms - Date.now();
    if (diff <= 0) return 'expired';
    const days = Math.floor(diff / 86400000);
    const hrs  = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return `${days}d ${hrs}h`;
    const mins = Math.floor((diff % 3600000) / 60000);
    return `${hrs}h ${mins}m`;
}

export default [

    // ── .suspend id @user [days] [reason] ────────────────────────────────────
    {
        command: 'suspend',
        aliases: ['suspendid', 'freezeid'],
        category: 'court',
        description: 'Suspend a user\'s citizen ID (judge/admin/sudo/owner only)',
        usage: '.suspend id @user <days> [reason]',
        groupOnly: true,

        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId, isSenderAdmin, senderIsOwnerOrSudo } = context;

            const sub = (args[0] || '').toLowerCase();
            if (sub !== 'id') {
                return sock.sendMessage(chatId, {
                    text:
`╭─── *SUSPEND COMMAND* ───╮
│
│ *.suspend id @user <days>* [reason]
│ Suspends a citizen ID for 1–30 days.
│
│ *.unsuspend @user*
│ Lifts an active suspension early.
│
╰─────────────────────────╯`,
                    ...channelInfo
                }, { quoted: message });
            }

            if (!message.key.fromMe && !senderIsOwnerOrSudo && !isSenderAdmin) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ❌ *ACCESS DENIED*
╽
╽  ❏ *Status:* Unauthorized
╽  ℹ️ Only judges, group admins, sudo
╽  users, and owners may suspend IDs.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    ...channelInfo
                }, { quoted: message });
            }

            let target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
                      || message.message?.extendedTextMessage?.contextInfo?.participant;
            if (!target) {
                return sock.sendMessage(chatId, {
                    text: `❌ Please mention the user to suspend.\n\nUsage: *.suspend id @user <days>* [reason]`,
                    ...channelInfo
                }, { quoted: message });
            }
            target = await resolveJid(sock, target);

            if (target === senderId && !message.key.fromMe) {
                return sock.sendMessage(chatId, {
                    text: `❌ You cannot suspend your own ID.`,
                    ...channelInfo
                }, { quoted: message });
            }

            const targetIsAuthority = await isOwnerOrSudo(target, sock, chatId);
            if (targetIsAuthority && !message.key.fromMe) {
                return sock.sendMessage(chatId, {
                    text: `❌ You cannot suspend an owner or sudo user's ID.`,
                    ...channelInfo
                }, { quoted: message });
            }

            const numericArgs = args.slice(1).filter(a => /^\d+$/.test(a));
            const days = Math.min(30, Math.max(1, parseInt(numericArgs[0] || '1', 10)));
            const reason = args.slice(1).filter(a => !/^\d+$/.test(a) && !a.startsWith('@')).join(' ').trim();

            const idRecord = await getCourtId(target);
            if (!idRecord) {
                return sock.sendMessage(chatId, {
                    text: `❌ @${cleanJid(target)} does not have a registered citizen ID.`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }

            const issuerName = message.pushName || cleanJid(senderId);
            await suspendCourtId(target, chatId, senderId, issuerName, days, reason);
            const until = Date.now() + days * 24 * 60 * 60 * 1000;

            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🚫 *ID SUSPENDED*
╽
╽  ❏ *Citizen:* @${cleanJid(target)}
╽  ❏ *Name:* ${idRecord.legalName}
╽  ❏ *Suspended by:* ${issuerName}
╽  ❏ *Duration:* ${days} day${days !== 1 ? 's' : ''}
╽  ❏ *Expires:* ${fmtDate(until)}${reason ? `\n╽  ❏ *Reason:* ${reason}` : ''}
╽
╽  ⚠️ All ID-gated privileges are frozen
╽  until the suspension expires.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ── .unsuspend @user ──────────────────────────────────────────────────────
    {
        command: 'unsuspend',
        aliases: ['liftid', 'unsuspendid', 'restoreid'],
        category: 'court',
        description: 'Lift an active ID suspension early',
        usage: '.unsuspend @user',
        groupOnly: true,

        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId, isSenderAdmin, senderIsOwnerOrSudo } = context;

            if (!message.key.fromMe && !senderIsOwnerOrSudo && !isSenderAdmin) {
                return sock.sendMessage(chatId, {
                    text: `❌ Only judges, admins, sudo, or owners can lift suspensions.`,
                    ...channelInfo
                }, { quoted: message });
            }

            let target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
                      || message.message?.extendedTextMessage?.contextInfo?.participant;
            if (!target) {
                return sock.sendMessage(chatId, {
                    text: `❌ Please mention the user.\n\nUsage: *.unsuspend @user*`,
                    ...channelInfo
                }, { quoted: message });
            }
            target = await resolveJid(sock, target);

            const suspension = await getIdSuspension(target, chatId);
            if (!suspension) {
                return sock.sendMessage(chatId, {
                    text: `ℹ️ @${cleanJid(target)} does not have an active suspension.`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }

            await liftIdSuspension(target, chatId);
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ✅ *SUSPENSION LIFTED*
╽
╽  ❏ *Citizen:* @${cleanJid(target)}
╽  ❏ *Lifted by:* ${message.pushName || cleanJid(senderId)}
╽
╽  @${cleanJid(target)}'s ID privileges have been
╽  fully restored.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ── .checksuspend @user ───────────────────────────────────────────────────
    {
        command: 'checksuspend',
        aliases: ['suspendstatus', 'idstatus'],
        category: 'court',
        description: 'Check the suspension status of a user\'s ID',
        usage: '.checksuspend @user',
        groupOnly: true,

        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;

            let target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
                      || message.message?.extendedTextMessage?.contextInfo?.participant
                      || senderId;
            target = await resolveJid(sock, target);

            const suspension = await getIdSuspension(target, chatId);
            if (!suspension) {
                return sock.sendMessage(chatId, {
                    text: `✅ @${cleanJid(target)}'s citizen ID is *active* — no active suspension.`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }

            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🚫 *ID SUSPENSION STATUS*
╽
╽  ❏ *Citizen:* @${cleanJid(target)}
╽  ❏ *Suspended by:* ${suspension.suspendedByName}
╽  ❏ *Expires:* ${fmtDate(suspension.suspendedUntil)}
╽  ❏ *Remaining:* ${fmtCountdown(suspension.suspendedUntil)}${suspension.reason ? `\n╽  ❏ *Reason:* ${suspension.reason}` : ''}
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    }

];
