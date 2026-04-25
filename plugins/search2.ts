import type { BotContext } from '../types.js';
import { DAVE_API, DAV_KEY } from '../lib/constants.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ── google (DuckDuckGo Instant Answer) ────────────────────────────────────────
const google = {
    command: 'google',
    aliases: ['search', 'ddg', 'websearch'],
    category: 'search',
    description: 'Live web search via DuckDuckGo',
    usage: '.google <query>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const query = args.join(' ').trim();
        if (!query) return sock.sendMessage(chatId, { text: '❌ Usage: .google <query>', ...channelInfo }, { quoted: message });

        await sock.sendPresenceUpdate('composing', chatId);
        try {
            const data = await getJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
            const answer   = data.AbstractText || data.Answer || '';
            const source   = data.AbstractSource || '';
            const abstract = data.Abstract || '';
            const related  = (data.RelatedTopics || []).slice(0, 3).map((t: any) => `• ${t.Text || t.Result || ''}`).filter(Boolean);

            if (!answer && !abstract && !related.length) {
                return sock.sendMessage(chatId, {
                    text: `❌ No direct results for *"${query}"*.\nTry a more specific search term.`,
                    ...channelInfo
                }, { quoted: message });
            }

            let text = `╭───❰ *🔍 SEARCH RESULTS* ❱───╮\n\n*Query:* ${query}\n\n`;
            if (answer)   text += `*💡 Answer:*\n${answer}\n\n`;
            if (abstract && abstract !== answer) text += `*📖 Info:*\n${abstract}\n`;
            if (source)   text += `*🌐 Source:* ${source}\n`;
            if (related.length) text += `\n*🔗 Related:*\n${related.join('\n')}`;
            text += '\n\n╰────────────────────────────╯';

            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Search failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

// ── ud (Urban Dictionary) ──────────────────────────────────────────────────────
const ud = {
    command: 'ud',
    aliases: ['urban', 'slang'],
    category: 'search',
    description: 'Look up a slang term on Urban Dictionary',
    usage: '.ud <term>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const term = args.join(' ').trim();
        if (!term) return sock.sendMessage(chatId, { text: '❌ Usage: .ud <term>', ...channelInfo }, { quoted: message });

        await sock.sendPresenceUpdate('composing', chatId);
        try {
            const data = await getJson(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`);
            const entry = data?.list?.[0];
            if (!entry) {
                return sock.sendMessage(chatId, { text: `❌ No definition found for *"${term}"*`, ...channelInfo }, { quoted: message });
            }
            const def     = (entry.definition || '').replace(/\[|\]/g, '').slice(0, 500);
            const example = (entry.example || '').replace(/\[|\]/g, '').slice(0, 300);
            const thumbsUp = entry.thumbs_up || 0;
            const thumbsDown = entry.thumbs_down || 0;

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *📖 URBAN DICTIONARY* ❱───╮

*🔤 Term:* ${entry.word}
*✍️ Author:* ${entry.author}

*📝 Definition:*
${def}

${example ? `*💬 Example:*\n_${example}_\n` : ''}
*👍 ${thumbsUp}  👎 ${thumbsDown}*

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

// ── currency ───────────────────────────────────────────────────────────────────
const currency = {
    command: 'currency',
    aliases: ['convert', 'fx', 'exchange'],
    category: 'search',
    description: 'Live currency exchange rate converter',
    usage: '.currency <amount> <FROM> <TO> — e.g. .currency 100 USD NGN',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const amount = parseFloat(args[0]);
        const from   = args[1]?.toUpperCase();
        const to     = args[2]?.toUpperCase();

        if (!amount || isNaN(amount) || !from || !to) {
            return sock.sendMessage(chatId, {
                text: '❌ Usage: .currency <amount> <FROM> <TO>\nExample: .currency 100 USD NGN',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);
        try {
            const data = await getJson(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from.toLowerCase()}.json`);
            const rates = data[from.toLowerCase()];
            const rate  = rates?.[to.toLowerCase()];
            if (!rate) {
                return sock.sendMessage(chatId, { text: `❌ Currency *${to}* not found. Check the 3-letter code.`, ...channelInfo }, { quoted: message });
            }
            const result = (amount * rate).toFixed(2);

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *💱 CURRENCY CONVERTER* ❱───╮

*💰 ${amount.toLocaleString()} ${from}*
         ↓
*💵 ${parseFloat(result).toLocaleString()} ${to}*

*📊 Rate:* 1 ${from} = ${rate.toFixed(6)} ${to}
*📅 Date:* ${data.date || 'Today'}

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Conversion failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

// ── ftball (football scores) ──────────────────────────────────────────────────
const ftball = {
    command: 'ftball',
    aliases: ['football', 'soccer', 'scores'],
    category: 'search',
    description: 'Live football scores and today\'s matches',
    usage: '.ftball [league]',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        await sock.sendPresenceUpdate('composing', chatId);
        try {
            // Using TheSportsDB free API (no key needed)
            const data = await getJson(`https://www.thesportsdb.com/api/v1/json/3/eventspastleague.php?id=4328`);
            const events = (data?.events || []).slice(0, 8);
            if (!events.length) {
                return sock.sendMessage(chatId, { text: '❌ No recent matches found.', ...channelInfo }, { quoted: message });
            }
            const rows = events.map((e: any) =>
                `🏟️ *${e.strHomeTeam}* ${e.intHomeScore ?? '-'} — ${e.intAwayScore ?? '-'} *${e.strAwayTeam}*\n   📅 ${e.dateEvent}`
            );

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *⚽ FOOTBALL RESULTS* ❱───╮
*🏆 English Premier League*
━━━━━━━━━━━━━━━━━━━━━━

${rows.join('\n\n')}

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Failed to fetch scores: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

// ── tiksearch ──────────────────────────────────────────────────────────────────
const tiksearch = {
    command: 'tiksearch',
    aliases: ['ttsearch', 'tiktoksearch'],
    category: 'search',
    description: 'Search TikTok videos by keyword',
    usage: '.tiksearch <query>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const query = args.join(' ').trim();
        if (!query) return sock.sendMessage(chatId, { text: '❌ Usage: .tiksearch <query>', ...channelInfo }, { quoted: message });
        if (!DAVE_API) {
            return sock.sendMessage(chatId, { text: '❌ DAVE API not configured. Contact the bot owner.', ...channelInfo }, { quoted: message });
        }
        await sock.sendPresenceUpdate('composing', chatId);
        try {
            const data = await getJson(`${DAVE_API}/api/tiktok/search?q=${encodeURIComponent(query)}&apikey=${DAV_KEY}`);
            const results = data?.data || data?.results || [];
            if (!results.length) {
                return sock.sendMessage(chatId, { text: `❌ No TikTok results for *"${query}"*`, ...channelInfo }, { quoted: message });
            }
            const rows = results.slice(0, 8).map((v: any, i: number) =>
                `*${i + 1}.* ${v.title || v.desc || 'Untitled'}\n   👁️ ${v.views || '?'} | ❤️ ${v.likes || '?'}`
            );
            await sock.sendMessage(chatId, {
                text:
`╭───❰ *🎵 TIKTOK SEARCH* ❱───╮

*🔍 Query:* ${query}

${rows.join('\n\n')}

_Reply with a number to download_

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ TikTok search failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

// ── spotisearch ────────────────────────────────────────────────────────────────
const spotisearch = {
    command: 'spotisearch',
    aliases: ['spotify', 'spotifysearch', 'spoti'],
    category: 'search',
    description: 'Search Spotify songs by name',
    usage: '.spotisearch <song name>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const query = args.join(' ').trim();
        if (!query) return sock.sendMessage(chatId, { text: '❌ Usage: .spotisearch <song>', ...channelInfo }, { quoted: message });

        await sock.sendPresenceUpdate('composing', chatId);
        try {
            // Use a free Spotify metadata search
            const data = await getJson(`https://saavnapi-nine.vercel.app/api.php?query=${encodeURIComponent(query)}&category=song&n=8`);
            const songs = data?.data || data?.results || [];
            if (!songs.length) {
                return sock.sendMessage(chatId, { text: `❌ No Spotify results for *"${query}"*`, ...channelInfo }, { quoted: message });
            }
            const rows = songs.slice(0, 8).map((s: any, i: number) => {
                const title  = s.song || s.title || s.name || 'Unknown';
                const artist = s.singers || s.artist || s.primaryArtists || 'Unknown';
                const album  = s.album || '';
                return `*${i + 1}.* ${title}\n   🎤 ${artist}${album ? ` | 💿 ${album}` : ''}`;
            });

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *🎵 SPOTIFY SEARCH* ❱───╮

*🔍 Query:* ${query}

${rows.join('\n\n')}

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Search failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

export default [google, ud, currency, ftball, tiksearch, spotisearch];
