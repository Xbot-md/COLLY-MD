import type { BotContext } from '../types.js';

const IMG_CATS = ['waifu', 'neko', 'trap'];

async function fetchImageUrl(): Promise<string | null> {
    for (let i = 0; i < 3; i++) {
        try {
            const cat  = IMG_CATS[Math.floor(Math.random() * IMG_CATS.length)];
            const res  = await fetch(`https://api.waifu.pics/nsfw/${cat}`, { signal: AbortSignal.timeout(10000) });
            const data = await res.json() as any;
            const url: string | null = data?.url || null;
            if (url && !url.endsWith('.gif')) return url;
        } catch { /* retry */ }
    }
    try {
        const res  = await fetch('https://nekos.best/api/v2/neko', { signal: AbortSignal.timeout(10000) });
        const data = await res.json() as any;
        const url: string | null = data?.results?.[0]?.url || null;
        if (url && !url.endsWith('.gif')) return url;
    } catch { /* ignore */ }
    return null;
}

async function sendHentai(sock: any, chatId: any, quotedMsg: any, channelInfo: any): Promise<string | null> {
    const imageUrl = await fetchImageUrl();
    if (!imageUrl) {
        await sock.sendMessage(chatId, { text: `❌ Couldn't fetch an image right now. Try again!`, ...channelInfo }, { quoted: quotedMsg });
        return null;
    }
    try {
        const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error('fetch failed');
        const buf = Buffer.from(await res.arrayBuffer());
        const sent = await sock.sendMessage(chatId, {
            image:   buf,
            caption: `🔞 *NSFW* | COLLY MD\n\n_Reply *1* for another_`,
            ...channelInfo,
        }, { quoted: quotedMsg });
        return sent?.key?.id ?? null;
    } catch {
        await sock.sendMessage(chatId, { text: `🔞 *NSFW Image:*\n${imageUrl}`, ...channelInfo }, { quoted: quotedMsg });
        return null;
    }
}

export default {
    command:     'hentai',
    aliases:     ['nsfw', 'ero', 'lewdie', 'h'],
    category:    'nsfw',
    description: 'Send a random NSFW/hentai image',
    usage:       '.hentai',

    async handler(sock: any, message: any, _args: any[], context: BotContext) {
        const { chatId, channelInfo } = context;
        await sock.sendPresenceUpdate('composing', chatId);

        const messageId = await sendHentai(sock, chatId, message, channelInfo);
        if (!messageId) return;

        const handler = async (update: any) => {
            const m = update?.messages?.[0];
            if (!m?.message || m.key.remoteJid !== chatId) return;
            const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
            if (quotedId !== messageId) return;
            const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim();
            if (text !== '1') return;
            sock.ev.off('messages.upsert', handler);
            await sendHentai(sock, chatId, m, channelInfo);
        };

        sock.ev.on('messages.upsert', handler);
        setTimeout(() => sock.ev.off('messages.upsert', handler), 5 * 60 * 1000);
    },
};
