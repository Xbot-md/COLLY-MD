import type { BotContext } from '../types.js';
import { resolveJid } from '../lib/lidUtils.js';
import {
    initPremiumTables,
    setPremium, extendPremium, delPremium,
    checkPremiumUser, isPremiumUser, listPremiumUsers,
    addPremiumCmd, delPremiumCmd, listPremiumCmds,
    setPremiumLink, delPremiumLink, getPremiumLink,
    isLinkMember, isPermanent, getSocialLinks,
} from '../lib/premiumDb.js';

let _tablesReady = false;
async function ensureTables() {
    if (_tablesReady) return;
    await initPremiumTables();
    _tablesReady = true;
}

// ── Target resolution: mention → reply → plain number in args ────────────────
async function resolveTarget(
    sock: any,
    message: any,
    args: string[],
): Promise<{ jid: string; remaining: string[] } | null> {
    const ctx      = message.message?.extendedTextMessage?.contextInfo;
    const mentioned = ctx?.mentionedJid?.[0];
    const quoted    = ctx?.participant || ctx?.remoteJid;

    let jid: string | null = null;
    let remaining           = [...args];

    if (mentioned) {
        jid       = await resolveJid(sock, mentioned);
        remaining = args.filter(a => !a.startsWith('@'));
    } else if (quoted) {
        jid = await resolveJid(sock, quoted);
    } else {
        const numIdx = args.findIndex(a => /^\+?\d{7,15}$/.test(a));
        if (numIdx !== -1) {
            const raw = args[numIdx].replace(/\D/g, '');
            jid       = `${raw}@s.whatsapp.net`;
            remaining = args.filter((_, i) => i !== numIdx);
        }
    }

    if (!jid) return null;
    return { jid, remaining };
}

function fmtDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    return parts.join(' ') || '< 1m';
}

function fmtDate(ts: number): string {
    return new Date(ts).toUTCString().replace(' GMT', ' UTC');
}

/** "12 May 2026, 8:30 PM" */
function fmtNiceDate(ts: number): string {
    return new Date(ts).toLocaleString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
    }).replace(',', ',');
}

/** Whole days remaining, minimum 1 */
function daysLeft(expiresAt: number): number {
    return Math.max(1, Math.ceil((expiresAt - Date.now()) / 86400000));
}

function numOf(jid: string) { return jid.split('@')[0].split(':')[0]; }

// ════════════════════════════════════════════════════════════════════════════
// COMMANDS
// ════════════════════════════════════════════════════════════════════════════

const setpremium = {
    command:   'setpremium',
    aliases:   ['grantpremium'],
    category:  'premium',
    ownerOnly: true,
    description: 'Give a user premium for X days',
    usage: '.setpremium @user/number <days> [reason]',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        await ensureTables();
        const { chatId, channelInfo, senderId } = context;

        const res = await resolveTarget(sock, message, args);
        if (!res) {
            return sock.sendMessage(chatId, {
                text: `❌ *Usage:* .setpremium @user/number <days> [reason]\n\n_Example: .setpremium @user 30 VIP member_`,
                ...channelInfo
            }, { quoted: message });
        }

        const { jid, remaining } = res;
        const daysArg = remaining.find(a => /^\d+$/.test(a));
        if (!daysArg) {
            return sock.sendMessage(chatId, {
                text: `❌ Specify number of days.\n_Example: .setpremium @user 30 reason_`,
                ...channelInfo
            }, { quoted: message });
        }
        const days    = parseInt(daysArg);
        const reason  = remaining.filter(a => a !== daysArg).join(' ').trim() || 'No reason';

        await setPremium(jid, days, senderId, reason);
        const exp = Date.now() + days * 86400000;

        await sock.sendMessage(chatId, {
            text:
`╔═══════════════════════╗
║  💎 *PREMIUM GRANTED*
╚═══════════════════════╝

👤 User: @${numOf(jid)}
📅 Duration: *${days} day${days !== 1 ? 's' : ''}*
⏳ Expires: *${fmtDate(exp)}*
📝 Reason: _${reason}_

✅ Premium access activated.`,
            mentions: [jid], ...channelInfo
        }, { quoted: message });
    },
};

const delpremium = {
    command:   'delpremium',
    aliases:   ['revokepremium', 'removepremium'],
    category:  'premium',
    ownerOnly: true,
    description: 'Remove a user\'s premium',
    usage: '.delpremium @user/number [reason]',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        await ensureTables();
        const { chatId, channelInfo } = context;

        const res = await resolveTarget(sock, message, args);
        if (!res) {
            return sock.sendMessage(chatId, {
                text: `❌ *Usage:* .delpremium @user/number [reason]`,
                ...channelInfo
            }, { quoted: message });
        }

        const { jid, remaining } = res;
        const reason = remaining.join(' ').trim() || 'No reason';
        const removed = await delPremium(jid);

        if (!removed) {
            return sock.sendMessage(chatId, {
                text: `⚠️ @${numOf(jid)} doesn't have premium.`,
                mentions: [jid], ...channelInfo
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            text:
`╔═══════════════════════╗
║  🚫 *PREMIUM REMOVED*
╚═══════════════════════╝

👤 User: @${numOf(jid)}
📝 Reason: _${reason}_

❌ Premium access revoked.`,
            mentions: [jid], ...channelInfo
        }, { quoted: message });
    },
};

const extendpremium = {
    command:   'extendpremium',
    aliases:   ['addpremium'],
    category:  'premium',
    ownerOnly: true,
    description: 'Add days to existing premium without resetting it',
    usage: '.extendpremium @user/number <days> [reason]',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        await ensureTables();
        const { chatId, channelInfo, senderId } = context;

        const res = await resolveTarget(sock, message, args);
        if (!res) {
            return sock.sendMessage(chatId, {
                text: `❌ *Usage:* .extendpremium @user/number <days> [reason]`,
                ...channelInfo
            }, { quoted: message });
        }

        const { jid, remaining } = res;
        const daysArg = remaining.find(a => /^\d+$/.test(a));
        if (!daysArg) {
            return sock.sendMessage(chatId, {
                text: `❌ Specify number of days.\n_Example: .extendpremium @user 15 Extended for loyalty_`,
                ...channelInfo
            }, { quoted: message });
        }
        const days   = parseInt(daysArg);
        const reason = remaining.filter(a => a !== daysArg).join(' ').trim() || 'Extended';

        const ok = await extendPremium(jid, days, senderId, reason);
        if (ok === 'permanent') {
            return sock.sendMessage(chatId, {
                text: `♾️ @${numOf(jid)} has *Permanent Premium* — no need to extend.`,
                mentions: [jid], ...channelInfo
            }, { quoted: message });
        }
        if (!ok) {
            return sock.sendMessage(chatId, {
                text: `⚠️ @${numOf(jid)} doesn't have premium yet.\n_Use .setpremium to grant it first._`,
                mentions: [jid], ...channelInfo
            }, { quoted: message });
        }

        const updated = await checkPremiumUser(jid);

        await sock.sendMessage(chatId, {
            text:
`╔════════════════════════╗
║  ⏫ *PREMIUM EXTENDED*
╚════════════════════════╝

👤 User: @${numOf(jid)}
➕ Added: *+${days} day${days !== 1 ? 's' : ''}*
⏳ New expiry: *${updated ? fmtDate(updated.expires_at) : 'Unknown'}*
📝 Reason: _${reason}_`,
            mentions: [jid], ...channelInfo
        }, { quoted: message });
    },
};

const checkpremium = {
    command:   'checkpremium',
    aliases:   ['premiumcheck', 'pccheck'],
    category:  'premium',
    ownerOnly: true,
    description: 'Check someone\'s premium status',
    usage: '.checkpremium @user/number',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        await ensureTables();
        const { chatId, channelInfo } = context;

        const res = await resolveTarget(sock, message, args);
        if (!res) {
            return sock.sendMessage(chatId, {
                text: `❌ *Usage:* .checkpremium @user/number`,
                ...channelInfo
            }, { quoted: message });
        }

        const { jid }   = res;
        const p         = await checkPremiumUser(jid);
        const linkPrem  = !p && await isLinkMember(sock, jid);
        const now       = Date.now();

        if (!p && !linkPrem) {
            return sock.sendMessage(chatId, {
                text: `📋 @${numOf(jid)} — *No premium*\n\nNot a premium user and not in the premium-linked group.`,
                mentions: [jid], ...channelInfo
            }, { quoted: message });
        }

        if (linkPrem) {
            return sock.sendMessage(chatId, {
                text:
`╔══════════════════════╗
║  💎 *PREMIUM STATUS*
╚══════════════════════╝

👤 User: @${numOf(jid)}
📌 Source: *Group Link*
✅ Status: *Active (via linked group)*`,
                mentions: [jid], ...channelInfo
            }, { quoted: message });
        }

        const perm   = isPermanent(p!.expires_at);
        const active = perm || p!.expires_at > now;
        const days   = active && !perm ? daysLeft(p!.expires_at) : 0;

        await sock.sendMessage(chatId, {
            text:
`╭───❰ *💎 PREMIUM STATUS* ❱───╮

*👤 User:* @${numOf(jid)}
*📊 Status:* ${active ? 'Active' : 'Expired'}
*👑 Plan:* ${perm ? 'Permanent Premium' : 'Timed Premium'}
*⏰ Expires:* ${perm ? 'Never' : active ? fmtNiceDate(p!.expires_at) : `Expired (${fmtNiceDate(p!.expires_at)})`}
*📅 Days Left:* ${perm ? '∞' : active ? `${days} day${days !== 1 ? 's' : ''}` : '0'}
*📝 Reason:* _${p!.reason || 'None'}_
*🗓️ Granted:* ${fmtNiceDate(p!.granted_at)}

${active
    ? (perm
        ? '✅ *Premium benefits will not expire*'
        : '✅ *Premium benefits are active*')
    : '❌ *Premium has expired*'}

╰────────────────────────────╯`,
            mentions: [jid], ...channelInfo
        }, { quoted: message });
    },
};

const premium = {
    command:   'premium',
    aliases:   ['mypremium', 'myprem'],
    category:  'premium',
    description: 'Check your own premium status',
    usage: '.premium',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        await ensureTables();
        const { chatId, channelInfo, senderId } = context;
        const mention  = `@${numOf(senderId)}`;

        const p        = await checkPremiumUser(senderId);
        const isActive = !!p && (isPermanent(p.expires_at) || p.expires_at > Date.now());
        const linkPrem = !isActive && await isLinkMember(sock, senderId);

        // ── Case 1 & 2: has manual premium ───────────────────────────────────
        if (isActive && p) {
            if (isPermanent(p.expires_at)) {
                return sock.sendMessage(chatId, {
                    text:
`╭───❰ *💎 PREMIUM STATUS* ❱───╮

*👤 User:* ${mention}
*📊 Status:* Active
*👑 Plan:* Permanent Premium
*⏰ Expires:* Never
*📅 Days Left:* ∞

✅ *Your premium benefits will not expire*
Enjoy your premium benefits!

You might be removed from premium if you leave/unfollow our official links without notice.

╰────────────────────────────╯`,
                    mentions: [senderId], ...channelInfo
                }, { quoted: message });
            }

            const days = daysLeft(p.expires_at);
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *💎 PREMIUM STATUS* ❱───╮

*👤 User:* ${mention}
*📊 Status:* Active
*👑 Plan:* Timed Premium
*⏰ Expires:* ${fmtNiceDate(p.expires_at)}
*📅 Days Left:* ${days} day${days !== 1 ? 's' : ''}

✅ *Your premium benefits are active*
Enjoy your premium benefits!

You might be removed from premium if your time expires or if you leave/unfollow our official links without notice.

╰────────────────────────────╯`,
                mentions: [senderId], ...channelInfo
            }, { quoted: message });
        }

        // ── Case: link-group member ───────────────────────────────────────────
        if (linkPrem) {
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *💎 PREMIUM STATUS* ❱───╮

*👤 User:* ${mention}
*📊 Status:* Active
*👑 Plan:* Group Member Premium
*⏰ Expires:* While in linked group

✅ *Your premium is active via group membership*
Enjoy your premium benefits!

╰────────────────────────────╯`,
                mentions: [senderId], ...channelInfo
            }, { quoted: message });
        }

        // ── Case 3: Not premium ───────────────────────────────────────────────
        const socialRows = await getSocialLinks();
        const LABEL: Record<string, string> = {
            whatsapp: 'WhatsApp Group', telegram: 'Telegram',
            facebook: 'Facebook',       instagram: 'Instagram',
            youtube:  'YouTube',        website:  'Website',
        };
        const linkLines = socialRows.map(l => `├ ${LABEL[l.platform] || l.platform}: ${l.url}`);
        if (linkLines.length) linkLines[linkLines.length - 1] = linkLines[linkLines.length - 1].replace('├', '└');
        const linkBlock = linkLines.length ? `┌\n${linkLines.join('\n')}` : `└ Use *.owner* to contact the owner directly.`;

        return sock.sendMessage(chatId, {
            text:
`╭───❰ *🔐 PREMIUM LOCKED* ❱───╮

*👤 User:* ${mention}
*📊 Status:* Inactive

❌ *You are not a premium member*

*Want Premium?*
Unlock exclusive commands and features!

*Here is a guide on how to get premium:*

*➊ SUPPORT US*
Join / Follow / Subscribe / Click any one:
${linkBlock}

*➋ CONTACT OWNER*
Use *.owner* to get the owner's number.

*➌ SEND PROOF*
Screenshot your join/follow and send it to the owner for activation.

*⚠️ WARNING:* Leaving/unfollowing after activation will disconnect your premium without notice.

╰────────────────────────────╯`,
            mentions: [senderId], ...channelInfo
        }, { quoted: message });
    },
};

const listpremiumusers = {
    command:   'listpremiumusers',
    aliases:   ['premiumlist', 'plist'],
    category:  'premium',
    ownerOnly: true,
    description: 'List all active premium users',
    usage: '.listpremiumusers',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        await ensureTables();
        const { chatId, channelInfo } = context;

        const users = await listPremiumUsers();
        if (!users.length) {
            return sock.sendMessage(chatId, {
                text: `💎 *Premium Users*\n\n_No active premium users._`,
                ...channelInfo
            }, { quoted: message });
        }

        const now  = Date.now();
        const rows = users.map((u, i) => {
            const perm = isPermanent(u.expires_at);
            const info = perm
                ? `♾️ Permanent`
                : `${daysLeft(u.expires_at)} day${daysLeft(u.expires_at) !== 1 ? 's' : ''} left`;
            return `${i + 1}. @${numOf(u.user_id)} — ${info}\n   _${u.reason || 'No reason'}_`;
        });
        const mentions = users.map(u => u.user_id);

        await sock.sendMessage(chatId, {
            text:
`╔══════════════════════╗
║  💎 *PREMIUM USERS*   (${users.length})
╚══════════════════════╝

${rows.join('\n\n')}`,
            mentions, ...channelInfo
        }, { quoted: message });
    },
};

const setpremiumlink = {
    command:   'setpremiumlink',
    aliases:   ['premiumlink'],
    category:  'premium',
    ownerOnly: true,
    description: 'Set group/channel link that auto-grants premium to members',
    usage: '.setpremiumlink <invite_link_or_group_jid>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        await ensureTables();
        const { chatId, channelInfo, senderId } = context;

        const input = args.join('').trim();
        if (!input) {
            return sock.sendMessage(chatId, {
                text: `❌ *Usage:* .setpremiumlink <WhatsApp group invite link or group JID>`,
                ...channelInfo
            }, { quoted: message });
        }

        let groupJid = '';
        const linkMatch = input.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);

        if (input.endsWith('@g.us')) {
            groupJid = input;
        } else if (linkMatch) {
            try {
                const code = linkMatch[1];
                const info = await sock.groupInfoFromCode(code);
                groupJid   = info?.id || '';
            } catch {
                groupJid = '';
            }
        }

        await setPremiumLink(input, groupJid, senderId);

        const resolved = groupJid
            ? `\n✅ Group resolved: \`${groupJid}\``
            : `\n⚠️ Could not resolve group JID — bot may not be in that group. Membership checks require the bot to be inside the group.`;

        await sock.sendMessage(chatId, {
            text:
`╔══════════════════════════╗
║  🔗 *PREMIUM LINK SET*
╚══════════════════════════╝

🔗 Link: ${input}${resolved}

Members of this group now automatically get premium access.`,
            ...channelInfo
        }, { quoted: message });
    },
};

const delpremiumlink = {
    command:   'delpremiumlink',
    aliases:   ['removepremiumlink'],
    category:  'premium',
    ownerOnly: true,
    description: 'Remove the premium group link',
    usage: '.delpremiumlink',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        await ensureTables();
        const { chatId, channelInfo } = context;

        const removed = await delPremiumLink();
        await sock.sendMessage(chatId, {
            text: removed
                ? `✅ *Premium link removed.*\n\nGroup members will no longer get automatic premium access.`
                : `⚠️ No premium link was set.`,
            ...channelInfo
        }, { quoted: message });
    },
};

const addpremiumcmd = {
    command:   'addpremiumcmd',
    aliases:   ['lockcommand'],
    category:  'premium',
    ownerOnly: true,
    description: 'Lock a command behind premium',
    usage: '.addpremiumcmd <command>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        await ensureTables();
        const { chatId, channelInfo } = context;

        const cmd = args[0]?.replace(/^\./, '').trim().toLowerCase();
        if (!cmd) {
            return sock.sendMessage(chatId, {
                text: `❌ *Usage:* .addpremiumcmd <command>\n_Example: .addpremiumcmd sticker_`,
                ...channelInfo
            }, { quoted: message });
        }

        await addPremiumCmd(cmd);
        await sock.sendMessage(chatId, {
            text: `💎 *Command locked:* \`.${cmd}\`\n\nOnly premium users can now use this command.`,
            ...channelInfo
        }, { quoted: message });
    },
};

const delpremiumcmd = {
    command:   'delpremiumcmd',
    aliases:   ['unlockcommand'],
    category:  'premium',
    ownerOnly: true,
    description: 'Make a premium command free for everyone',
    usage: '.delpremiumcmd <command>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        await ensureTables();
        const { chatId, channelInfo } = context;

        const cmd = args[0]?.replace(/^\./, '').trim().toLowerCase();
        if (!cmd) {
            return sock.sendMessage(chatId, {
                text: `❌ *Usage:* .delpremiumcmd <command>`,
                ...channelInfo
            }, { quoted: message });
        }

        const removed = await delPremiumCmd(cmd);
        await sock.sendMessage(chatId, {
            text: removed
                ? `🔓 *Command unlocked:* \`.${cmd}\`\n\nEveryone can now use this command.`
                : `⚠️ \`.${cmd}\` wasn't locked as a premium command.`,
            ...channelInfo
        }, { quoted: message });
    },
};

const listpremiumcmd = {
    command:   'listpremiumcmd',
    aliases:   ['premiumcmds', 'pclist'],
    category:  'premium',
    description: 'List all premium-locked commands',
    usage: '.listpremiumcmd',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        await ensureTables();
        const { chatId, channelInfo } = context;

        const cmds = await listPremiumCmds();
        if (!cmds.length) {
            return sock.sendMessage(chatId, {
                text: `💎 *Premium Commands*\n\n_No commands are currently locked._`,
                ...channelInfo
            }, { quoted: message });
        }

        const link = await getPremiumLink();

        await sock.sendMessage(chatId, {
            text:
`╔══════════════════════════╗
║  💎 *PREMIUM COMMANDS*   (${cmds.length})
╚══════════════════════════╝

${cmds.map(c => `• \`.${c}\``).join('\n')}

${link ? `🔗 *Premium Link:* ${link.link_url}` : '📌 No premium link set'}`,
            ...channelInfo
        }, { quoted: message });
    },
};

export default [
    setpremium,
    delpremium,
    extendpremium,
    checkpremium,
    premium,
    listpremiumusers,
    setpremiumlink,
    delpremiumlink,
    addpremiumcmd,
    delpremiumcmd,
    listpremiumcmd,
];
