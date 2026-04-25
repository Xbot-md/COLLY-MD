import type { BotContext } from '../types.js';
import { DAVE_API, DAV_KEY, XAPI, UA } from '../lib/constants.js';
import config from '../config.js';

const prefix = config.prefixes[0];

// ── helpers ────────────────────────────────────────────────────────────────────

async function get(url: string, headers: Record<string, string> = {}): Promise<any> {
    const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function dlBuffer(url: string): Promise<Buffer | null> {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.length > 10000 ? buf : null;
    } catch { return null; }
}

async function sendVideo(
    sock: any, chatId: string, quotedMsg: any,
    title: string, urls: string[], thumbnail?: string
): Promise<void> {
    if (thumbnail) {
        await sock.sendMessage(chatId, {
            image: { url: thumbnail },
            caption: `🎬 *${title}*\n\n⏳ *Downloading...*`,
        }, { quoted: quotedMsg }).catch(() => {});
    }

    let buffer: Buffer | null = null;
    for (const tryUrl of urls) {
        buffer = await dlBuffer(tryUrl);
        if (buffer) break;
    }
    if (!buffer) {
        await sock.sendMessage(chatId, { text: `❌ All download links failed. Try another video.` }, { quoted: quotedMsg });
        return;
    }

    const MB = buffer.length / (1024 * 1024);
    if (MB > 65) {
        await sock.sendMessage(chatId, {
            document: buffer,
            fileName: `${title}.mp4`,
            mimetype: 'video/mp4',
            caption: `🔞 *${title}*\n📦 ${MB.toFixed(1)} MB`,
        }, { quoted: quotedMsg });
    } else {
        await sock.sendMessage(chatId, {
            video: buffer,
            caption: `✅ *${title}*`,
            mimetype: 'video/mp4',
        }, { quoted: quotedMsg });
    }
}

/** Register a timed reply-number listener. Cleans itself up after 5 min. */
function awaitReply(
    sock: any, chatId: string, sentId: string,
    onReply: (m: any, text: string) => Promise<boolean>
): void {
    const handler = async (update: any) => {
        const m = update?.messages?.[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;
        const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
        if (quotedId !== sentId) return;
        const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim();
        const handled = await onReply(m, text).catch(() => false);
        if (handled) sock.ev.off('messages.upsert', handler);
    };
    sock.ev.on('messages.upsert', handler);
    setTimeout(() => sock.ev.off('messages.upsert', handler), 5 * 60 * 1000);
}

function noDaveApi(sock: any, chatId: string, msg: any) {
    return sock.sendMessage(chatId, {
        text: `❌ *DAVE API not configured.*\nContact the bot owner to set up DAVE_API and DAV_KEY.`,
    }, { quoted: msg });
}

// ── commands ───────────────────────────────────────────────────────────────────

export default [

    // ── XNXX Search ──────────────────────────────────────────────────────────
    {
        command: 'xsearch',
        aliases: ['xnxx'],
        category: 'nsfw',
        description: 'Search XNXX videos by keyword',
        usage: `.xsearch <query>`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const query = args.join(' ');
            if (!query) return sock.sendMessage(chatId, { text: `❌ Usage: ${prefix}xsearch <keyword>`, ...channelInfo }, { quoted: message });

            await sock.sendPresenceUpdate('composing', chatId);
            try {
                const data = await get(`${XAPI}/api/nsfw/xsearch?q=${encodeURIComponent(query)}`);
                if (!data.status || !data.videos?.length)
                    return sock.sendMessage(chatId, { text: `❌ No results for *"${query}"*`, ...channelInfo }, { quoted: message });

                const results = (data.videos as any[]).slice(0, 10);
                let list = `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽ 🔞 *XNXX SEARCH RESULTS*\n╽ ───────────────────────────────\n`;
                results.forEach((r, i) => { list += `╽ *${i + 1}.* ${r.title}\n╽     ⏱️ ${r.duration?.trim() || '?'}\n`; });
                list += `╽ ───────────────────────────────\n╽ Reply with a number to download\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`;

                const sent = await sock.sendMessage(chatId, { text: list, ...channelInfo }, { quoted: message });
                const sentId = sent?.key?.id;
                if (!sentId) return;

                awaitReply(sock, chatId, sentId, async (m, text) => {
                    const n = parseInt(text);
                    if (isNaN(n) || n < 1 || n > results.length) return false;
                    const chosen = results[n - 1];
                    await xdlHandler(sock, m, chatId, channelInfo, chosen.videoUrl);
                    return true;
                });
            } catch {
                sock.sendMessage(chatId, { text: `❌ Failed to search XNXX. Try again.`, ...channelInfo }, { quoted: message });
            }
        },
    },

    // ── XNXX Download ────────────────────────────────────────────────────────
    {
        command: 'xdl',
        aliases: ['xvideo'],
        category: 'nsfw',
        description: 'Download an XNXX video by URL',
        usage: `.xdl <xnxx link>`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const url = args[0];
            if (!url) return sock.sendMessage(chatId, { text: `❌ Usage: ${prefix}xdl <xnxx link>`, ...channelInfo }, { quoted: message });
            await sock.sendPresenceUpdate('composing', chatId);
            await xdlHandler(sock, message, chatId, channelInfo, url);
        },
    },

    // ── XHamster Search ──────────────────────────────────────────────────────
    {
        command: 'xhsearch',
        aliases: ['xhamster'],
        category: 'nsfw',
        description: 'Search XHamster videos by keyword',
        usage: `.xhsearch <query>`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            if (!DAVE_API) return noDaveApi(sock, chatId, message);
            const query = args.join(' ');
            if (!query) return sock.sendMessage(chatId, { text: `❌ Usage: ${prefix}xhsearch <keyword>`, ...channelInfo }, { quoted: message });

            await sock.sendPresenceUpdate('composing', chatId);
            try {
                const data = await get(`${DAVE_API}/api/xhamster/search?q=${encodeURIComponent(query)}&apikey=${DAV_KEY}`);
                if (!data.success || !data.data?.length)
                    return sock.sendMessage(chatId, { text: `❌ No results for *"${query}"*`, ...channelInfo }, { quoted: message });

                const results = (data.data as any[]).slice(0, 10);
                let list = `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽ 🔞 *XHAMSTER SEARCH RESULTS*\n╽ ───────────────────────────────\n`;
                results.forEach((r, i) => { list += `╽ *${i + 1}.* ${r.title}\n╽     ⏱️ ${r.duration || '?'}\n`; });
                list += `╽ ───────────────────────────────\n╽ Reply with a number to download\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`;

                const sent = await sock.sendMessage(chatId, { text: list, ...channelInfo }, { quoted: message });
                const sentId = sent?.key?.id;
                if (!sentId) return;

                awaitReply(sock, chatId, sentId, async (m, text) => {
                    const n = parseInt(text);
                    if (isNaN(n) || n < 1 || n > results.length) return false;
                    await xhdlHandler(sock, m, chatId, channelInfo, results[n - 1].url);
                    return true;
                });
            } catch {
                sock.sendMessage(chatId, { text: `❌ Failed to search XHamster. Try again.`, ...channelInfo }, { quoted: message });
            }
        },
    },

    // ── XHamster Download ────────────────────────────────────────────────────
    {
        command: 'xhdl',
        aliases: ['xhdown'],
        category: 'nsfw',
        description: 'Download an XHamster video by URL',
        usage: `.xhdl <xhamster link>`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            if (!DAVE_API) return noDaveApi(sock, chatId, message);
            const url = args[0];
            if (!url) return sock.sendMessage(chatId, { text: `❌ Usage: ${prefix}xhdl <xhamster link>`, ...channelInfo }, { quoted: message });
            await sock.sendPresenceUpdate('composing', chatId);
            await xhdlHandler(sock, message, chatId, channelInfo, url);
        },
    },

    // ── PornHub Search ───────────────────────────────────────────────────────
    {
        command: 'phsearch',
        aliases: ['pornhub', 'phub'],
        category: 'nsfw',
        description: 'Search PornHub videos by keyword',
        usage: `.phsearch <query>`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            if (!DAVE_API) return noDaveApi(sock, chatId, message);
            const query = args.join(' ');
            if (!query) return sock.sendMessage(chatId, { text: `❌ Usage: ${prefix}phsearch <keyword>`, ...channelInfo }, { quoted: message });

            await sock.sendPresenceUpdate('composing', chatId);
            try {
                const data = await get(`${DAVE_API}/api/pornhub/search?q=${encodeURIComponent(query)}&apikey=${DAV_KEY}`);
                if (!data.success || !data.data?.results?.length)
                    return sock.sendMessage(chatId, { text: `❌ No results for *"${query}"*`, ...channelInfo }, { quoted: message });

                const results = (data.data.results as any[]).slice(0, 10);
                let list = `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽ 🔞 *PORNHUB SEARCH RESULTS*\n╽ ───────────────────────────────\n`;
                results.forEach((r, i) => {
                    list += `╽ *${i + 1}.* ${r.title}\n╽     ⏱️ ${r.duration || '?'} • 👀 ${r.views?.toLocaleString() || '?'}\n`;
                });
                list += `╽ ───────────────────────────────\n╽ Reply with a number to download\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`;

                const sent = await sock.sendMessage(chatId, { text: list, ...channelInfo }, { quoted: message });
                const sentId = sent?.key?.id;
                if (!sentId) return;

                awaitReply(sock, chatId, sentId, async (m, text) => {
                    const n = parseInt(text);
                    if (isNaN(n) || n < 1 || n > results.length) return false;
                    await phdlHandler(sock, m, chatId, channelInfo, results[n - 1].url);
                    return true;
                });
            } catch {
                sock.sendMessage(chatId, { text: `❌ Failed to search PornHub. Try again.`, ...channelInfo }, { quoted: message });
            }
        },
    },

    // ── PornHub Download ─────────────────────────────────────────────────────
    {
        command: 'phdl',
        aliases: ['phdown'],
        category: 'nsfw',
        description: 'Download a PornHub video by URL',
        usage: `.phdl <pornhub link>`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            if (!DAVE_API) return noDaveApi(sock, chatId, message);
            const url = args[0];
            if (!url) return sock.sendMessage(chatId, { text: `❌ Usage: ${prefix}phdl <pornhub link>`, ...channelInfo }, { quoted: message });
            await sock.sendPresenceUpdate('composing', chatId);
            await phdlHandler(sock, message, chatId, channelInfo, url);
        },
    },
];

// ── internal download handlers (shared by search→select chains) ───────────────

async function xdlHandler(sock: any, quotedMsg: any, chatId: string, channelInfo: any, videoUrl: string) {
    try {
        const data = await get(`${XAPI}/api/nsfw/xvideo?url=${encodeURIComponent(videoUrl)}`);
        if (!data.status) {
            return sock.sendMessage(chatId, { text: `❌ Could not fetch video details.`, ...channelInfo }, { quoted: quotedMsg });
        }

        const title     = data.title || 'XNXX Video';
        const thumbnail = data.thumbnail;
        const lowUrl    = data.qualities?.low  || data.download;
        const highUrl   = data.qualities?.high || data.download;

        const caption = `🎬 *${title}*\n\n` +
            `Reply with:\n*1* — Low quality\n*2* — High quality`;

        const sent = await sock.sendMessage(chatId,
            thumbnail
                ? { image: { url: thumbnail }, caption, ...channelInfo }
                : { text: caption, ...channelInfo },
            { quoted: quotedMsg }
        );
        const sentId = sent?.key?.id;
        if (!sentId) return;

        awaitReply(sock, chatId, sentId, async (m, text) => {
            if (text !== '1' && text !== '2') return false;
            const chosenUrl = text === '1' ? lowUrl : (highUrl || lowUrl);
            if (!chosenUrl) {
                await sock.sendMessage(chatId, { text: `❌ That quality is unavailable.`, ...channelInfo }, { quoted: m });
                return true;
            }
            await sock.sendPresenceUpdate('composing', chatId);
            // XNXX URLs are CDN — stream directly, no buffer needed
            const headRes = await fetch(chosenUrl, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) }).catch(() => null);
            const fileSize = parseInt(headRes?.headers.get('content-length') || '0');
            const MB = fileSize / (1024 * 1024);

            if (MB > 65) {
                await sock.sendMessage(chatId, {
                    document: { url: chosenUrl },
                    fileName: `${title}.mp4`,
                    mimetype: 'video/mp4',
                    caption: `🔞 *${title}*\n📦 ${MB.toFixed(1)} MB`,
                    ...channelInfo,
                }, { quoted: m });
            } else {
                await sock.sendMessage(chatId, {
                    video: { url: chosenUrl },
                    caption: `✅ *${title}*`,
                    mimetype: 'video/mp4',
                    ...channelInfo,
                }, { quoted: m });
            }
            return true;
        });
    } catch {
        sock.sendMessage(chatId, { text: `❌ Failed to get video details.`, ...channelInfo }, { quoted: quotedMsg });
    }
}

async function xhdlHandler(sock: any, quotedMsg: any, chatId: string, channelInfo: any, url: string) {
    try {
        await sock.sendMessage(chatId, { text: `⏳ *Fetching XHamster video...*`, ...channelInfo }, { quoted: quotedMsg });
        const data = await get(`${DAVE_API}/api/xhamster/download?url=${encodeURIComponent(url)}&apikey=${DAV_KEY}`);
        if (!data.success || !data.data)
            return sock.sendMessage(chatId, { text: `❌ Could not fetch video data.`, ...channelInfo }, { quoted: quotedMsg });

        const video = data.data;
        const title = video.title || 'XHamster Video';
        const urls: string[] = [];
        if (video.proxyDownload) urls.push(video.proxyDownload);
        for (const f of (video.formats || [])) {
            if (f.proxyDownload) urls.push(f.proxyDownload);
            else if (f.url) urls.push(f.url);
        }
        if (!urls.length) return sock.sendMessage(chatId, { text: `❌ No download link available.`, ...channelInfo }, { quoted: quotedMsg });

        await sendVideo(sock, chatId, quotedMsg, title, urls, video.thumbnail);
    } catch {
        sock.sendMessage(chatId, { text: `❌ Failed to download XHamster video.`, ...channelInfo }, { quoted: quotedMsg });
    }
}

async function phdlHandler(sock: any, quotedMsg: any, chatId: string, channelInfo: any, url: string) {
    try {
        await sock.sendMessage(chatId, { text: `⏳ *Fetching PornHub video...*`, ...channelInfo }, { quoted: quotedMsg });
        const data = await get(`${DAVE_API}/api/pornhub/download?url=${encodeURIComponent(url)}&apikey=${DAV_KEY}`);
        if (!data.success || !data.data)
            return sock.sendMessage(chatId, { text: `❌ Could not fetch video data.`, ...channelInfo }, { quoted: quotedMsg });

        const video = data.data;
        const title = video.title || 'PornHub Video';
        const sorted = ([...(video.formats || [])] as any[]).sort((a, b) => parseInt(b.quality || '0') - parseInt(a.quality || '0'));
        const urls: string[] = [];
        for (const f of sorted) {
            if (f.convert) urls.push(`${f.convert}&apikey=${DAV_KEY}`);
            else if (f.url) urls.push(f.url);
        }
        if (!urls.length) return sock.sendMessage(chatId, { text: `❌ No download link available.`, ...channelInfo }, { quoted: quotedMsg });

        await sendVideo(sock, chatId, quotedMsg, title, urls, video.thumbnail);
    } catch {
        sock.sendMessage(chatId, { text: `❌ Failed to download PornHub video.`, ...channelInfo }, { quoted: quotedMsg });
    }
}
