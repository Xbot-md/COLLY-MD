import type { BotContext } from '../types.js';
import config from '../config.js';
import commandHandler from '../lib/commandHandler.js';
import isOwnerOrSudo from '../lib/isOwner.js';
import path from 'path';
import fs from 'fs';

function formatTime() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: config.timeZone || 'UTC'
    } as any);
}

const CAT_META: Record<string, { icon: string; label: string }> = {
    general:   { icon: '🌐', label: '𝐆𝐄𝐍𝐄𝐑𝐀𝐋 𝐒𝐄𝐑𝐕𝐈𝐂𝐄𝐒' },
    ai:        { icon: '🧠', label: '𝐀𝐈 𝐈𝐍𝐓𝐄𝐋𝐋𝐈𝐆𝐄𝐍𝐂𝐄' },
    admin:     { icon: '🛡️', label: '𝐀𝐃𝐌𝐈𝐍 𝐂𝐎𝐍𝐓𝐑𝐎𝐋' },
    group:     { icon: '👥', label: '𝐆𝐑𝐎𝐔𝐏 𝐍𝐄𝐓𝐖𝐎𝐑𝐊' },
    download:  { icon: '📥', label: '𝐌𝐄𝐃𝐈𝐀 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃' },
    utility:   { icon: '⚙️', label: '𝐔𝐓𝐈𝐋𝐈𝐓𝐘 𝐒𝐘𝐒𝐓𝐄𝐌' },
    menu:      { icon: '📋', label: '𝐒𝐄𝐋𝐄𝐂𝐓𝐈𝐎𝐍 𝐌𝐄𝐍𝐔' },
    tools:     { icon: '🛠️', label: '𝐏𝐑𝐄𝐂𝐈𝐒𝐈𝐎𝐍 𝐓𝐎𝐎𝐋𝐒' },
    images:    { icon: '🖼️', label: '𝐈𝐌𝐀𝐆𝐄 𝐆𝐀𝐋𝐋𝐄𝐑𝐘' },
    games:     { icon: '🎭', label: '𝐆𝐀𝐌𝐄𝐒 & 𝐅𝐔𝐍' },
    fun:       { icon: '🎭', label: '𝐆𝐀𝐌𝐄𝐒 & 𝐅𝐔𝐍' },
    economy:   { icon: '💰', label: '𝐄𝐂𝐎𝐍𝐎𝐌𝐘' },
    court:     { icon: '⚖️', label: '𝐂𝐎𝐔𝐑𝐓 𝐒𝐘𝐒𝐓𝐄𝐌' },
    search:    { icon: '🔍', label: '𝐒𝐄𝐀𝐑𝐂𝐇 & 𝐒𝐓𝐀𝐋𝐊' },
    stalk:     { icon: '🔍', label: '𝐒𝐄𝐀𝐑𝐂𝐇 & 𝐒𝐓𝐀𝐋𝐊' },
    info:      { icon: '🔍', label: '𝐒𝐄𝐀𝐑𝐂𝐇 & 𝐒𝐓𝐀𝐋𝐊' },
    quotes:    { icon: '💬', label: '𝐐𝐔𝐎𝐓𝐄𝐒 & 𝐖𝐎𝐑𝐃𝐒' },
    music:     { icon: '🎵', label: '𝐌𝐔𝐒𝐈𝐂 & 𝐀𝐔𝐃𝐈𝐎' },
    upload:    { icon: '☁️', label: '𝐂𝐋𝐎𝐔𝐃 𝐔𝐏𝐋𝐎𝐀𝐃' },
    stickers:  { icon: '🎨', label: '𝐒𝐓𝐈𝐂𝐊𝐄𝐑𝐒' },
    nsfw:      { icon: '🔞', label: '𝐍𝐒𝐅𝐖' },
    anime:     { icon: '🎌', label: '𝐀𝐍𝐈𝐌𝐄' },
    misc:      { icon: '📦', label: '𝐌𝐈𝐒𝐂' },
    business:  { icon: '🏢', label: '𝐁𝐔𝐒𝐈𝐍𝐄𝐒𝐒 𝐒𝐈𝐌' },
};

function twoCol(cmds: string[], prefix: string, pad = 18): string {
    let out = '';
    for (let i = 0; i < cmds.length; i += 2) {
        const a = `${prefix}${cmds[i]}`;
        const b = cmds[i + 1] ? `${prefix}${cmds[i + 1]}` : '';
        const padded = a.padEnd(pad);
        out += `╽ ❏ ${padded}${b ? `❏ ${b}` : ''}\n`;
    }
    return out;
}

// ── Hardcoded economy menu (exact layout the owner specified) ─────────────────
function renderEconomyMenu(prefix: string): string {
    const p = prefix;
    const eco = [
        'registeredid', 'buycard',
        'bankcard',     'viewid',
        'renewid',      'money',
        'bankbal',      'networth',
        'daily',        'weekly',
        'monthly',      'work',
        'oddjob',       'grind',
        'crime',        'rob',
        'deposit',      'withdraw',
        'pay',          'give',
        'shop',         'inventory',
        'buyitem',      'assets',
        'buyasset',     'upgrade',
        'gamble',       'slots',
        'blackjack',    'lottery',
        'loan',         'repay',
        'vault',        'profile',
    ];
    let t = `┍─〔 💰 𝐄𝐂𝐎𝐍𝐎𝐌𝐘 〕»»\n`;
    t += twoCol(eco, p, 20);
    t += `┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n`;
    t += `\n💡 *Use ${p}help <command> for details on any command.*`;
    return t;
}

// ── Hardcoded court menu ───────────────────────────────────────────────────────
function renderCourtMenu(prefix: string): string {
    const p = prefix;
    const court = [
        'sue',          'plead',
        'evidence',     'verdict',
        'case',         'cases',
        'setrule',      'rules',
        'delrule',      'propose',
        'proposals',    'vote',
        'blacklist',    'unblacklist',
        'registeredid', 'viewid',
        'renewid',      'idcheck',
        'marry',        'divorce',
        'family',       'adopt',
        'labor',        'dare',
        'mute',         'unmute',
        'criminal',     'pardon',
        'citizenship',  'revoke',
        'courtvault',   'distribute',
    ];
    let t = `┍─〔 ⚖️ 𝐂𝐎𝐔𝐑𝐓 𝐒𝐘𝐒𝐓𝐄𝐌 〕»»\n`;
    t += twoCol(court, p, 20);
    t += `┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n`;
    t += `\n⚖️ _All court commands require a registered citizen ID._\n`;
    t += `💡 *Use ${p}help <command> for details on any command.*`;
    return t;
}

// ── Generic auto-generated category menu ─────────────────────────────────────
function renderCategoryMenu(cat: string, cmds: string[], prefix: string): string {
    const meta = CAT_META[cat] || { icon: '📦', label: cat.toUpperCase() };
    let t = `┍─〔 ${meta.icon} ${meta.label} 〕»»\n`;
    t += twoCol(cmds, prefix);
    t += `┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n`;
    t += `\n💡 *Use ${prefix}help <command> for details on any command.*`;
    return t;
}

function renderNewMenu(info: { bot: string; prefix: string; total: number; version: string; time: string }, categories: Map<string, string[]>, prefix: string): string {
    let t = '';
    t += `◢◤━━━━━━━━━━━━━━━━━━━━━━◥◣\n`;
    t += `     █▀▀ █▀█ █   █   █▄█\n`;
    t += `     █▄▄ █▄█ █▄▄ █▄▄  █ \n`;
    t += `     W H A T S A P P   B O T\n`;
    t += `  ◥◣━━━━━━━━━━━━━━━━━━━━━━◢◤\n\n`;

    t += `┌─〔 🖥️ 𝐒𝐘𝐒𝐓𝐄𝐌  𝐃𝐀𝐒𝐇𝐁𝐎𝐀𝐑𝐃 〕─────────────┈⊷\n`;
    t += `┆  ❏ Bot     : ${info.bot} ${info.version}\n`;
    t += `┆  ❏ Prefix  : [ ${info.prefix} ]\n`;
    t += `┆  ❏ Plugins : ${info.total} Active\n`;
    t += `┆  ❏ Time    : ${info.time}\n`;
    t += `┆  ❏ Status  : Operational ✅\n`;
    t += `└──────────────────────────────────────┈⊷\n`;
    t += ` 💡 𝗨𝘀𝗲 ${prefix}𝗵𝗲𝗹𝗽 <𝗰𝗼𝗺𝗺𝗮𝗻𝗱> 𝗳𝗼𝗿 𝗶𝗻𝗳𝗼.\n\n`;

    const seen = new Set<string>();
    for (const [cat, cmds] of categories) {
        if (!cmds.length) continue;
        if (cat === 'owner') continue;
        const meta = CAT_META[cat] || { icon: '📦', label: cat.toUpperCase() };
        const labelKey = meta.label;
        if (seen.has(labelKey)) continue;
        seen.add(labelKey);

        // Economy and Court: show teaser only
        if (cat === 'economy') {
            t += `┍─〔 💰 𝐄𝐂𝐎𝐍𝐎𝐌𝐘 〕»»\n`;
            t += twoCol(cmds.slice(0, 6), prefix);
            t += `╽ _...and many more commands_\n`;
            t += `╽ 💡 Use *${prefix}menu economy* for the full list\n`;
            t += `┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n\n`;
            continue;
        }
        if (cat === 'court') {
            t += `┍─〔 ⚖️ 𝐂𝐎𝐔𝐑𝐓 𝐒𝐘𝐒𝐓𝐄𝐌 〕»»\n`;
            t += twoCol(cmds.slice(0, 6), prefix);
            t += `╽ _...and many more commands_\n`;
            t += `╽ 💡 Use *${prefix}menu court* for the full list\n`;
            t += `┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n\n`;
            continue;
        }

        t += `┍─〔 ${meta.icon} ${meta.label} 〕»»\n`;
        t += twoCol(cmds, prefix);
        t += `┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n\n`;
    }

    t += `┌──────────────────────────────────────┈⊷\n`;
    t += `│ ◈ Powered by *DavidXTech* | *Colly novels* 🔖\n`;
    t += `│ ◈ All Rights Reserved © 2026\n`;
    t += `└──────────────────────────────────────┈⊷`;
    return t;
}

function renderControlPanel(prefix: string): string {
    const p = prefix;
    let t = '';
    t += `┍─〔 🔐 𝐂𝐎𝐍𝐓𝐑𝐎𝐋 𝐏𝐀𝐍𝐄𝐋 〕»»  \n`;
    t += `╽ _Trigger: ${p}menu owner_\n`;
    t += `╽ _Access: Owner + Sudo only_  \n`;
    t += `╽  \n`;

    t += `╽ *Appearance & Core*  \n`;
    t += `╽ ❏ ${p}setbotname      ❏ ${p}setbotpp  \n`;
    t += `╽ ❏ ${p}setbotstatus    ❏ ${p}setprefix  \n`;
    t += `╽ ❏ ${p}settheme        ❏ ${p}setlang  \n`;
    t += `╽ ❏ ${p}settimezone     ❏ ${p}setweather  \n`;
    t += `╽ ❏ ${p}setbio          ❏ ${p}setpp  \n`;
    t += `╽  \n`;

    t += `╽ *Permissions & Access*  \n`;
    t += `╽ ❏ ${p}setowner        ❏ ${p}setadmin  \n`;
    t += `╽ ❏ ${p}setmoderate     ❏ ${p}sudo  \n`;
    t += `╽ ❏ ${p}mode            ❏ ${p}setwarnlimit  \n`;
    t += `╽ ❏ ${p}pmblocker       ❏ ${p}stealth  \n`;
    t += `╽  \n`;

    t += `╽ *Premium System*  \n`;
    t += `╽ ❏ ${p}setpremium      ❏ ${p}delpremium  \n`;
    t += `╽ ❏ ${p}setpremiumlink  ❏ ${p}addpremiumcmd  \n`;
    t += `╽ ❏ ${p}delpremiumcmd   ❏ ${p}listrent  \n`;
    t += `╽ ❏ ${p}rentbot         ❏ ${p}stoprent  \n`;
    t += `╽  \n`;

    t += `╽ *Command Control*  \n`;
    t += `╽ ❏ ${p}bancmd          ❏ ${p}unbancmd  \n`;
    t += `╽ ❏ ${p}setcmd          ❏ ${p}delcmd  \n`;
    t += `╽ ❏ ${p}listcmd         ❏ ${p}cmdreact  \n`;
    t += `╽  \n`;

    t += `╽ *Auto Features*  \n`;
    t += `╽ ❏ ${p}anticall        ❏ ${p}antidelete  \n`;
    t += `╽ ❏ ${p}autoreact       ❏ ${p}autoread  \n`;
    t += `╽ ❏ ${p}autoreply       ❏ ${p}autostatus  \n`;
    t += `╽ ❏ ${p}autotyping  \n`;
    t += `╽  \n`;

    t += `╽ *Plugin & Reply System*  \n`;
    t += `╽ ❏ ${p}addplugin       ❏ ${p}delplugin  \n`;
    t += `╽ ❏ ${p}addreply        ❏ ${p}delreply  \n`;
    t += `╽ ❏ ${p}listreplies  \n`;
    t += `╽  \n`;

    t += `╽ *Broadcast & Chat*  \n`;
    t += `╽ ❏ ${p}broadcast       ❏ ${p}broadcastdm  \n`;
    t += `╽ ❏ ${p}mention         ❏ ${p}archivechat  \n`;
    t += `╽ ❏ ${p}pinchat         ❏ ${p}star  \n`;
    t += `╽ ❏ ${p}clear           ❏ ${p}clearchat  \n`;
    t += `╽ ❏ ${p}clearsession    ❏ ${p}cleartmp  \n`;
    t += `╽  \n`;

    t += `╽ *User Data Control*  \n`;
    t += `╽ ❏ ${p}addcoins        ❏ ${p}removecoins  \n`;
    t += `╽ ❏ ${p}setlevel        ❏ ${p}resetlevel  \n`;
    t += `╽ ❏ ${p}addxp           ❏ ${p}delxp  \n`;
    t += `╽ ❏ ${p}resetuser  \n`;
    t += `╽  \n`;

    t += `╽ *System & Files*  \n`;
    t += `╽ ❏ ${p}getfile         ❏ ${p}inspect  \n`;
    t += `╽ ❏ ${p}gitinfo         ❏ ${p}gitpull  \n`;
    t += `╽ ❏ ${p}update          ❏ ${p}reload  \n`;
    t += `╽ ❏ ${p}sysinfo         ❏ ${p}maintenance  \n`;
    t += `╽  \n`;

    t += `╽ *Group Management*  \n`;
    t += `╽ ❏ ${p}joingroup       ❏ ${p}gcleave  \n`;
    t += `╽ ❏ ${p}manage  \n`;
    t += `╽  \n`;

    t += `╽ *System Reset*  \n`;
    t += `╽ ❏ ${p}resetbot  \n`;
    t += `┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`;
    return t;
}

export default {
    command: 'menu',
    aliases: ['help', 'commands', 'h', 'list'],
    category: 'general',
    description: 'Show all commands or a specific category',
    usage: '.menu | .menu economy | .menu court | .menu owner | .menu <command>',

    async handler(sock: any, message: any, args: any, context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const prefix = config.prefixes[0];
        const imagePath = path.join(process.cwd(), 'assets/thumb.png');

        const argStr = (args as string[]).join(' ').toLowerCase().trim();

        async function send(text: string) {
            if (fs.existsSync(imagePath)) {
                return (sock as any).sendMessage(chatId, { image: fs.readFileSync(imagePath), caption: text, ...channelInfo }, { quoted: message });
            }
            return (sock as any).sendMessage(chatId, { text, ...channelInfo } as any, { quoted: message });
        }

        // ── Owner / Control Panel ─────────────────────────────────────────
        if (argStr === 'control panel' || argStr === 'control' || argStr === 'owner') {
            const allowed = await isOwnerOrSudo(senderId, sock, chatId);
            if (!allowed) {
                return (sock as any).sendMessage(chatId, {
                    text: `🔐 *Access Denied*\n\nThe Owner Panel is restricted to Owner and Sudo users only.`,
                    ...channelInfo
                }, { quoted: message });
            }
            return send(renderControlPanel(prefix));
        }

        // ── Economy category ──────────────────────────────────────────────
        if (argStr === 'economy' || argStr === 'eco') {
            return send(renderEconomyMenu(prefix));
        }

        // ── Court category ────────────────────────────────────────────────
        if (argStr === 'court') {
            return send(renderCourtMenu(prefix));
        }

        // ── Any other known category ──────────────────────────────────────
        if (argStr && commandHandler.categories.has(argStr)) {
            const cmds = commandHandler.categories.get(argStr) || [];
            if (argStr === 'owner') {
                const allowed = await isOwnerOrSudo(senderId, sock, chatId);
                if (!allowed) {
                    return (sock as any).sendMessage(chatId, {
                        text: `🔐 *Access Denied*\n\nOwner commands are restricted.`,
                        ...channelInfo
                    }, { quoted: message });
                }
            }
            return send(renderCategoryMenu(argStr, cmds, prefix));
        }

        // ── Single command info ───────────────────────────────────────────
        if (args.length) {
            const searchTerm = (args[0] as string).toLowerCase();
            let cmd = commandHandler.commands.get(searchTerm);
            if (!cmd && commandHandler.aliases.has(searchTerm)) {
                const mainCommand = commandHandler.aliases.get(searchTerm);
                cmd = commandHandler.commands.get(mainCommand);
            }
            if (!cmd) {
                return (sock as any).sendMessage(chatId, {
                    text: `❌ Command *"${args[0]}"* not found.\n\nUse ${prefix}menu to see all commands.`,
                    ...channelInfo
                }, { quoted: message });
            }
            const text =
`┌─〔 📌 𝐂𝐎𝐌𝐌𝐀𝐍𝐃 𝐈𝐍𝐅𝐎 〕────────────┈⊷
┆  ⚡ *Command:* ${prefix}${cmd.command}
┆  📝 *Desc:* ${cmd.description || 'No description'}
┆  📖 *Usage:* ${cmd.usage || `${prefix}${cmd.command}`}
┆  🏷️ *Category:* ${cmd.category || 'misc'}
┆  🔖 *Aliases:* ${cmd.aliases?.length ? cmd.aliases.map((a: string) => prefix + a).join(', ') : 'None'}
└──────────────────────────────────────┈⊷`;
            return send(text);
        }

        // ── Full main menu ────────────────────────────────────────────────
        const text = renderNewMenu({
            bot: config.botName,
            prefix: config.prefixes.join(' '),
            total: commandHandler.commands.size,
            version: config.version || 'v6.0.0',
            time: formatTime()
        }, commandHandler.categories, prefix);

        return send(text);
    }
};
