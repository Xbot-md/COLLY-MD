import type { BotContext } from '../types.js';
import { getWallet } from '../lib/turso.js';
import {
    getCreditFreeze, freezeCredit, unfreezeCredit,
    banAdminCmd, unbanAdminCmd, isAdminCmdBanned,
} from '../lib/turso2.js';
import isAdmin from '../lib/isAdmin.js';
import isOwnerOrSudo from '../lib/isOwner.js';
import config from '../config.js';

function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }
function fmt(n: number) { return n.toLocaleString(); }
function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

const FREEZE_CMDS = ['creditfreeze', 'creditunfreeze'];

export default [
    // ─── .creditfreeze @user [amount] [reason] ──────────────────────────────
    {
        command: 'creditfreeze',
        aliases: ['cfreeze', 'freeze'],
        category: 'economy',
        description: 'Freeze a citizen\'s credit (admin only). Applies 5% recovery tax.',
        usage: '.creditfreeze @user <amount> <reason>',
        groupOnly: true,
        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

            // ── Auth: admin/sudo/owner only ──────────────────────────────────
            const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
            const isTrusted = await isOwnerOrSudo(senderId);
            if (!isSenderAdmin && !isTrusted) {
                return sock.sendMessage(chatId, {
                    text: `❌ *Credit Freeze* requires group admin privileges.`,
                    ...channelInfo
                }, { quoted: message });
            }

            // ── Auth: check if this admin is banned from creditfreeze ────────
            if (!isTrusted) {
                for (const cmd of FREEZE_CMDS) {
                    if (await isAdminCmdBanned(senderId, chatId, cmd)) {
                        return sock.sendMessage(chatId, {
                            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🚫 *COMMAND REVOKED*
╽
╽  You have been barred from issuing
╽  credit freeze orders in this group.
╽
╽  ❏ *Command:* ${prefix}creditfreeze
╽  ❏ *Authority:* Suspended by Owner/Sudo
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                            ...channelInfo
                        }, { quoted: message });
                    }
                }
            }

            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) {
                return sock.sendMessage(chatId, {
                    text: `❌ Usage: *${prefix}creditfreeze @user <amount> <reason>*`,
                    ...channelInfo
                }, { quoted: message });
            }
            if (target === senderId) {
                return sock.sendMessage(chatId, { text: `❌ You cannot freeze your own account.`, ...channelInfo }, { quoted: message });
            }

            // ── Parse amount and reason ──────────────────────────────────────
            const nonMentionArgs = args.filter(a => !a.startsWith('@'));
            const rawAmount = parseInt((nonMentionArgs[0] || '').replace(/[^0-9]/g, ''), 10);
            if (isNaN(rawAmount) || rawAmount <= 0) {
                return sock.sendMessage(chatId, {
                    text: `❌ Provide a valid debt amount.\nUsage: *${prefix}creditfreeze @user <amount> <reason>*`,
                    ...channelInfo
                }, { quoted: message });
            }
            const reason = nonMentionArgs.slice(1).join(' ').trim() || 'Unpaid debt';
            const tax    = Math.ceil(rawAmount * 0.05);
            const total  = rawAmount + tax;

            // ── Check already frozen ─────────────────────────────────────────
            const existing = await getCreditFreeze(target, chatId);
            if (existing) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ⚠️ *ALREADY FROZEN*
╽
╽  @${cleanJid(target)} already has an
╽  active credit freeze in this group.
╽
╽  ❏ *Existing Debt:* $${fmt(existing.amount + existing.tax)}
╽  ❏ *Reason:* ${existing.reason}
╽
╽  Use *${prefix}creditunfreeze @user* to lift first.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }

            await freezeCredit(target, chatId, rawAmount, tax, reason, senderId);

            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🚫 *CREDIT FREEZE ESCALATED*
╽
╽  ❏ *Subject:* @${cleanJid(target)}
╽  ❏ *Date Enacted:* ${today}
╽  ❏ *Status:* Accounts Locked
╽
╽  ⚖️ *Financial Penalties:*
╽  A *5% Recovery Tax* has been added to
╽  your total debt for legal processing.
╽
╽  ❏ *Principal:* $${fmt(rawAmount)}
╽  ❏ *Recovery Tax (5%):* $${fmt(tax)}
╽  💰 *Total Due:* $${fmt(total)}
╽
╽  🔓 *Repayment Protocol:*
╽  Withdrawals and transfers are disabled.
╽  You may still *${prefix}work* to earn funds,
╽  but all income is subject to garnishment 💸
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷

_📌 Reason: "${reason}"_
_🔖 Colly novels | 👨‍💻 DavidXTech_`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── .creditunfreeze @user ───────────────────────────────────────────────
    {
        command: 'creditunfreeze',
        aliases: ['cunfreeze', 'unfreeze'],
        category: 'economy',
        description: 'Lift a credit freeze on a user (admin/sudo/owner only)',
        usage: '.creditunfreeze @user',
        groupOnly: true,
        async handler(sock: any, message: any, _args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];

            // ── Auth ─────────────────────────────────────────────────────────
            const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
            const isTrusted = await isOwnerOrSudo(senderId);
            if (!isSenderAdmin && !isTrusted) {
                return sock.sendMessage(chatId, {
                    text: `❌ *Credit Unfreeze* requires group admin privileges.`,
                    ...channelInfo
                }, { quoted: message });
            }

            if (!isTrusted) {
                for (const cmd of FREEZE_CMDS) {
                    if (await isAdminCmdBanned(senderId, chatId, cmd)) {
                        return sock.sendMessage(chatId, {
                            text: `🚫 You are barred from issuing freeze/unfreeze orders in this group.`,
                            ...channelInfo
                        }, { quoted: message });
                    }
                }
            }

            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) {
                return sock.sendMessage(chatId, {
                    text: `❌ Usage: *${prefix}creditunfreeze @user*`,
                    ...channelInfo
                }, { quoted: message });
            }

            const freeze = await getCreditFreeze(target, chatId);
            if (!freeze) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ✅ *NO ACTIVE FREEZE*
╽
╽  @${cleanJid(target)} has no credit freeze
╽  in this group.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }

            await unfreezeCredit(target, chatId);

            const today = fmtDate(Date.now());
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🔓 *CREDIT FREEZE LIFTED*
╽
╽  ❏ *Subject:* @${cleanJid(target)}
╽  ❏ *Date Lifted:* ${today}
╽  ❏ *Status:* Accounts Restored
╽
╽  All financial restrictions have been
╽  removed. Withdrawals and transfers
╽  are now enabled.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── .adminbancmd @admin [command] ──────────────────────────────────────
    {
        command: 'adminbancmd',
        aliases: ['bancmd', 'revokeadmincmd'],
        category: 'admin',
        description: 'Ban an admin from using a specific command (owner/sudo only)',
        usage: '.adminbancmd @admin <command>',
        groupOnly: true,
        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];

            // ── Only owner/sudo can run this ──────────────────────────────────
            const isTrusted = await isOwnerOrSudo(senderId);
            if (!isTrusted) {
                return sock.sendMessage(chatId, {
                    text: `🔐 *${prefix}adminbancmd* is restricted to bot owners and sudo users.`,
                    ...channelInfo
                }, { quoted: message });
            }

            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const cmd    = args.filter(a => !a.startsWith('@'))[0];
            if (!target || !cmd) {
                return sock.sendMessage(chatId, {
                    text: `❌ Usage: *${prefix}adminbancmd @admin <command>*\nExample: *${prefix}adminbancmd @admin creditfreeze*`,
                    ...channelInfo
                }, { quoted: message });
            }

            const cleanCmd = cmd.toLowerCase().replace(/^\./, '');

            // ── Lift ban if already banned (toggle) ───────────────────────────
            const alreadyBanned = await isAdminCmdBanned(target, chatId, cleanCmd);
            if (alreadyBanned) {
                await unbanAdminCmd(target, chatId, cleanCmd);
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ✅ *CMD RESTRICTION LIFTED*
╽
╽  ❏ *Admin:* @${cleanJid(target)}
╽  ❏ *Command:* ${prefix}${cleanCmd}
╽  ❏ *Status:* Restored
╽
╽  This admin can now use *${prefix}${cleanCmd}* again.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }

            await banAdminCmd(target, chatId, cleanCmd, senderId);

            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🚫 *ADMIN CMD REVOKED*
╽
╽  ❏ *Admin:* @${cleanJid(target)}
╽  ❏ *Command:* ${prefix}${cleanCmd}
╽  ❏ *Revoked By:* @${cleanJid(senderId)}
╽  ❏ *Status:* Permanently Barred
╽
╽  This admin can no longer execute
╽  *${prefix}${cleanCmd}* in this group.
╽  Use *${prefix}adminbancmd @admin ${cleanCmd}* again to restore.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [target, senderId], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── .checkfreeze [@user] ────────────────────────────────────────────────
    {
        command: 'checkfreeze',
        aliases: ['freezestatus', 'myfreeze'],
        category: 'economy',
        description: 'Check if a user has an active credit freeze',
        usage: '.checkfreeze [@user]',
        groupOnly: true,
        async handler(sock: any, message: any, _args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || senderId;
            const freeze = await getCreditFreeze(target, chatId);

            if (!freeze) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ✅ *CREDIT STATUS: CLEAR*
╽
╽  ❏ *Account:* @${cleanJid(target)}
╽  No active credit freeze on record.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }

            const total = freeze.amount + freeze.tax;
            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🚫 *CREDIT STATUS: FROZEN*
╽
╽  ❏ *Account:* @${cleanJid(target)}
╽  ❏ *Debt:* $${fmt(freeze.amount)}
╽  ❏ *Tax:* $${fmt(freeze.tax)}
╽  💰 *Total Due:* $${fmt(total)}
╽  ❏ *Reason:* ${freeze.reason}
╽  ❏ *Since:* ${fmtDate(freeze.issuedAt)}
╽
╽  🔓 Repay via *.work* (auto-garnished)
╽  or contact an admin to unfreeze.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },
];
