import type { BotContext } from '../types.js';
import config from '../config.js';
import CommandHandler from '../lib/commandHandler.js';
import fs from 'fs';
import path from 'path';

const BOT_START = Date.now();

// ── Category display config ────────────────────────────────────────────────────
const CAT_META: Record<string, { label: string; emoji: string; order: number }> = {
    fun:        { label: '𝗙𝗨𝗡 & 𝗚𝗔𝗠𝗘𝗦',   emoji: '🎮', order: 1 },
    games:      { label: '𝗚𝗔𝗠𝗘𝗦',          emoji: '🕹️', order: 2 },
    ai:         { label: '𝗔𝗜 𝗟𝗔𝗕',         emoji: '🤖', order: 3 },
    download:   { label: '𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥',    emoji: '📥', order: 4 },
    group:      { label: '𝗚𝗥𝗢𝗨𝗣 𝗔𝗗𝗠𝗜𝗡',   emoji: '🛡️', order: 5 },
    admin:      { label: '𝗔𝗗𝗠𝗜𝗡',          emoji: '⚔️', order: 6 },
    tools:      { label: '𝗧𝗢𝗢𝗟𝗦 & 𝗨𝗧𝗜𝗟𝗦', emoji: '⚙️', order: 7 },
    utility:    { label: '𝗨𝗧𝗜𝗟𝗜𝗧𝗬',        emoji: '🔧', order: 8 },
    business:   { label: '𝗕𝗨𝗦𝗜𝗡𝗘𝗦𝗦 𝗦𝗜𝗠',  emoji: '💼', order: 9 },
    search:     { label: '𝗦𝗘𝗔𝗥𝗖𝗛',         emoji: '🔍', order: 10 },
    music:      { label: '𝗠𝗨𝗦𝗜𝗖',          emoji: '🎵', order: 11 },
    economy:    { label: '𝗘𝗖𝗢𝗡𝗢𝗠𝗬',        emoji: '💰', order: 12 },
    court:      { label: '𝗖𝗢𝗨𝗥𝗧',          emoji: '⚖️', order: 13 },
    nsfw:       { label: '𝗡𝗦𝗙𝗪',           emoji: '🔞', order: 14 },
    stickers:   { label: '𝗦𝗧𝗜𝗖𝗞𝗘𝗥𝗦',       emoji: '🎭', order: 15 },
    images:     { label: '𝗜𝗠𝗔𝗚𝗘𝗦',         emoji: '🖼️', order: 16 },
    stalk:      { label: '𝗦𝗧𝗔𝗟𝗞',          emoji: '👀', order: 17 },
    general:    { label: '𝗚𝗘𝗡𝗘𝗥𝗔𝗟',        emoji: '📱', order: 18 },
    owner:      { label: '𝗢𝗪𝗡𝗘𝗥',          emoji: '👑', order: 99 },
    info:       { label: '𝗜𝗡𝗙𝗢',           emoji: 'ℹ️', order: 98 },
};

function getMeta(cat: string) {
    return CAT_META[cat.toLowerCase()] ?? { label: cat.toUpperCase(), emoji: '📂', order: 50 };
}

function getUptime(): string {
    const ms   = Date.now() - BOT_START;
    const s    = Math.floor(ms / 1000);
    const m    = Math.floor(s / 60);
    const h    = Math.floor(m / 60);
    const d    = Math.floor(h / 24);
    if (d > 0)  return `${d}d ${h % 24}h`;
    if (h > 0)  return `${h}h ${m % 60}m`;
    return `${m}m ${s % 60}s`;
}

function formatTime(): string {
    return new Date().toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: config.timeZone || 'UTC',
    });
}

// Split commands into rows of `n` per line
function chunkCmds(cmds: string[], n = 4): string[] {
    const rows: string[] = [];
    for (let i = 0; i < cmds.length; i += n) {
        rows.push(cmds.slice(i, i + n).map(c => `.${c}`).join('  '));
    }
    return rows;
}

// Build one category block
function catBlock(cat: string, cmds: string[], prefix: string): string {
    const meta  = getMeta(cat);
    const PFX   = prefix;
    const bar   = '━'.repeat(5);
    const inner = ` ${meta.emoji} ${meta.label} `;

    let block = `┏${bar}༺${inner}༻${bar}┓\n`;

    const rows = chunkCmds(cmds, 4);
    rows.forEach(row => {
        block += `┣⪼ ${row}\n`;
    });

    // If category has a sub-menu hint
    const bigCats = ['business', 'economy', 'court'];
    if (bigCats.includes(cat.toLowerCase())) {
        block += `┣⪼ Type \`${PFX}menu ${cat}\` for full list\n`;
    }

    block += `┗${'━'.repeat(31)}┛\n`;
    return block;
}

export default {
    command: 'menu2',
    aliases: ['cmenu', 'altmenu', 'theme2'],
    category: 'general',
    description: 'Alternative menu theme (categorized box layout)',
    usage: '.menu2',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId } = context;

        try {
            const imagePath = path.join(process.cwd(), 'assets/thumb.png');
            const thumbnail = fs.existsSync(imagePath) ? fs.readFileSync(imagePath) : null;

            const prefix = (config.prefixes?.[0]) ?? '.';
            const prefixList = (config.prefixes ?? ['.']).join(' ');
            const pluginCount = CommandHandler.commands.size;
            const botName  = config.botName  || 'COLLY MD';
            const version  = config.version  || '6.0.0';
            const time     = formatTime();
            const uptime   = getUptime();

            // ── Header ────────────────────────────────────────────────────────
            const divider = '═━'.repeat(9) + '═';
            let txt = '';
            txt += `╭━${divider}╮\n`;
            txt += `┃  🤖  *${botName} V${version}*\n`;
            txt += `┃\n`;
            txt += `┃ ⏣ 𝗩𝗲𝗿𝘀𝗶𝗼𝗻   ❯  𝗩${version}\n`;
            txt += `┃ ⏣ 𝗣𝗿𝗲𝗳𝗶𝘅    ❯  ${prefixList}\n`;
            txt += `┃ ⏣ 𝗣𝗹𝘂𝗴𝗶𝗻𝘀   ❯  ${pluginCount} Loaded\n`;
            txt += `┃ ⏣ 𝗧𝗶𝗺𝗲     ❯  ${time}\n`;
            txt += `┃ ⏣ 𝗨𝗽𝘁𝗶𝗺𝗲   ❯  ${uptime}\n`;
            txt += `┃ ⏣ 𝗦𝘁𝗮𝘁𝘂𝘀   ❯  Online [●]\n`;
            txt += `╰━${divider}╯\n`;
            txt += `➤ Type \`${prefix}help <command>\` for details\n\n`;

            // ── Category blocks ───────────────────────────────────────────────
            const allCats = Array.from(CommandHandler.categories.keys());
            const sorted  = allCats.sort((a, b) => {
                const oa = getMeta(a).order;
                const ob = getMeta(b).order;
                return oa - ob;
            });

            // Hide owner/info from public menu
            const hidden = new Set(['owner', 'info', 'menu']);
            const isOwner = message.key?.fromMe === true;

            for (const cat of sorted) {
                if (hidden.has(cat.toLowerCase()) && !isOwner) continue;
                const cmds = CommandHandler.getCommandsByCategory(cat);
                if (!cmds || cmds.length === 0) continue;
                txt += catBlock(cat, cmds, prefix) + '\n';
            }

            // ── Footer ────────────────────────────────────────────────────────
            txt += `╭─────────────────────────────╮\n`;
            txt += `│  ⚡ *Powered by DavidXTech*  ⚡\n`;
            txt += `│  © 2026 ${config.botOwner || 'Colly novels'} • All Rights Reserved\n`;
            txt += `╰─────────────────────────────╯`;

            const msgOpts = thumbnail
                ? { image: thumbnail, caption: txt }
                : { text: txt };

            await sock.sendMessage(chatId, msgOpts, { quoted: message });

        } catch (e: any) {
            console.error('[menu2] error:', e?.message);
            await sock.sendMessage(chatId, {
                text: `❌ Menu error: ${e?.message}`,
            }, { quoted: message });
        }
    },
};
