import type { BotContext } from '../types.js';
import commandHandler from '../lib/commandHandler.js';

export default [
{
    command: 'allmenu',
    aliases: ['allcommands', 'fullmenu', 'cmdlist'],
    category: 'general',
    description: 'Show every single bot command grouped by category',
    usage: '.allmenu [category]',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const filterCat = args.join(' ').toLowerCase().trim();

        const catMap = new Map<string, string[]>();
        for (const [, entry] of commandHandler.commands) {
            const cat = entry.category || 'misc';
            if (!catMap.has(cat)) catMap.set(cat, []);
            catMap.get(cat)!.push(entry.command);
        }

        const sortedCats = [...catMap.keys()].sort();

        const filteredCats = filterCat
            ? sortedCats.filter(c => c.includes(filterCat))
            : sortedCats;

        if (!filteredCats.length) {
            return sock.sendMessage(chatId, {
                text: `❌ Category "*${filterCat}*" not found.\n\nAvailable: ${sortedCats.join(', ')}`,
                ...channelInfo
            }, { quoted: message });
        }

        const EMOJI: Record<string, string> = {
            economy: '💰', business: '🏢', shop: '🛒', games: '🎮',
            squidgame: '🦑', court: '⚖️', jobs: '💼', sololeveling: '⚔️',
            general: '🤖', admin: '🔧', fun: '😄', social: '👥', misc: '📦'
        };

        const sections: string[] = [];
        let totalCmds = 0;

        for (const cat of filteredCats) {
            const cmds = catMap.get(cat)!.sort();
            totalCmds += cmds.length;
            const emoji = EMOJI[cat] || '▸';
            const formatted = cmds.map(c => `.${c}`).join('  ');
            sections.push(`╽  ${emoji} *${cat.toUpperCase()}* (${cmds.length})\n╽  ${formatted}`);
        }

        const header = filterCat
            ? `📋 *${filterCat.toUpperCase()}* COMMANDS`
            : `📋 *ALL COMMANDS* — ${totalCmds} total`;

        const tipLine = filterCat
            ? `╽  Use _.allmenu_ to see all categories`
            : `╽  Use _.allmenu <category>_ to filter`;

        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ${header}
╽  ─────────────────────────────
${sections.join('\n╽\n')}
╽
${tipLine}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},
];
