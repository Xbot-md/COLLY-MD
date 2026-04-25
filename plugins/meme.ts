import type { BotContext } from '../types.js';

const MEME_APIS = [
    'https://meme-api.com/gimme',
    'https://meme-api.com/gimme/memes',
    'https://meme-api.com/gimme/dankmemes',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export default {
    command: 'meme',
    aliases: ['memes', 'randmeme', 'dankmeme'],
    category: 'fun',
    description: 'Get a random dank meme from Reddit',
    usage: '.meme',

    async handler(sock: any, message: any, _args: any, context: BotContext) {
        const { chatId, channelInfo } = context;

        try {
            await sock.sendPresenceUpdate('composing', chatId);
            await sock.sendMessage(chatId, { react: { text: '😂', key: message.key } });

            let imageUrl = '';
            let title = '';
            let subreddit = '';
            let ups = 0;

            for (const api of MEME_APIS) {
                try {
                    const res = await fetch(api, {
                        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
                        signal: AbortSignal.timeout(10000),
                    });
                    if (!res.ok) continue;
                    const data = await res.json() as any;
                    const url = data?.url || '';
                    if (url && /\.(jpg|jpeg|png|gif|webp)$/i.test(url)) {
                        imageUrl = url;
                        title = data.title || '';
                        subreddit = data.subreddit || '';
                        ups = data.ups || 0;
                        break;
                    }
                } catch { continue; }
            }

            if (!imageUrl) {
                try {
                    const res = await fetch('https://www.reddit.com/r/memes/random.json', {
                        headers: { 'User-Agent': UA },
                        signal: AbortSignal.timeout(10000),
                    });
                    if (res.ok) {
                        const data = await res.json() as any;
                        const post = data?.[0]?.data?.children?.[0]?.data;
                        if (post?.url && /\.(jpg|jpeg|png|gif)$/i.test(post.url)) {
                            imageUrl = post.url;
                            title = post.title;
                            subreddit = post.subreddit;
                            ups = post.ups;
                        }
                    }
                } catch {}
            }

            if (!imageUrl) {
                return sock.sendMessage(chatId, {
                    text: '❌ Could not fetch a meme right now. Try again later!',
                    ...channelInfo
                }, { quoted: message });
            }

            const imgRes = await fetch(imageUrl, {
                headers: { 'User-Agent': UA },
                signal: AbortSignal.timeout(20000),
            });
            if (!imgRes.ok) throw new Error('Failed to download meme image.');
            const imgBuf = Buffer.from(await imgRes.arrayBuffer());

            const caption =
`╭───❰ *😂 MEME* ❱───╮

*📌 ${title || 'Random Meme'}*
${subreddit ? `*📍 r/${subreddit}*` : ''}${ups ? ` • ❤️ ${ups.toLocaleString()}` : ''}

╰────────────────────────────╯`;

            await sock.sendMessage(chatId, {
                image: imgBuf,
                caption,
                ...channelInfo
            }, { quoted: message });
        } catch (error: any) {
            await sock.sendMessage(chatId, {
                text: '❌ Failed to fetch meme. Please try again later!',
                ...channelInfo
            }, { quoted: message });
        }
    },
};
