import type { BotContext } from '../types.js';
import fs from 'fs';
import path from 'path';

const TMP = path.join(process.cwd(), 'temp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

function ts() { return Date.now(); }
function cleanup(...files: string[]) { for (const f of files) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} } }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const COBALT = 'https://api.cobalt.tools';

async function cobaltDownload(url: string, mode: 'auto' | 'mute' = 'auto'): Promise<{ url?: string; filename?: string; error?: string }> {
    try {
        const res = await fetch(COBALT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': UA,
            },
            body: JSON.stringify({ url, downloadMode: mode, videoQuality: '720', filenameStyle: 'pretty' }),
            signal: AbortSignal.timeout(30000),
        });

        if (!res.ok) {
            const err = await res.text();
            return { error: `Downloader returned ${res.status}` };
        }

        const data = await res.json() as any;
        if (data.status === 'error') return { error: data.error?.code || 'Download failed' };
        if (data.url) return { url: data.url, filename: data.filename };
        if (data.status === 'stream' && data.url) return { url: data.url, filename: data.filename };
        return { error: 'No download URL returned.' };
    } catch (e: any) {
        return { error: e.message };
    }
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    } catch { return null; }
}

function getExtension(filename: string = '', url: string = ''): string {
    const fromFilename = filename.split('.').pop()?.toLowerCase();
    if (fromFilename && ['mp4', 'mp3', 'webm', 'mkv', 'gif', 'jpg', 'png', 'opus'].includes(fromFilename)) return fromFilename;
    const fromUrl = url.split('?')[0].split('.').pop()?.toLowerCase();
    if (fromUrl && ['mp4', 'mp3', 'webm'].includes(fromUrl)) return fromUrl;
    return 'mp4';
}

// ── Shared downloader logic ────────────────────────────────────────────────────
async function runDownload(sock: any, message: any, context: BotContext, url: string, label: string, mode: 'auto' | 'mute' = 'auto') {
    const { chatId, channelInfo } = context;

    await sock.sendPresenceUpdate('composing', chatId);
    await sock.sendMessage(chatId, { react: { text: '⏬', key: message.key } });

    const result = await cobaltDownload(url, mode);
    if (result.error) {
        return sock.sendMessage(chatId, {
            text: `❌ *${label} download failed:*\n${result.error}\n\n_Make sure the link is valid and public._`,
            ...channelInfo
        }, { quoted: message });
    }

    const buf = await fetchBuffer(result.url!);
    if (!buf) {
        return sock.sendMessage(chatId, {
            text: `❌ Failed to download the media file. The link may have expired.`,
            ...channelInfo
        }, { quoted: message });
    }

    const ext = getExtension(result.filename, result.url);
    const isAudio = ['mp3', 'opus', 'm4a', 'ogg'].includes(ext);
    const isVideo = ['mp4', 'webm', 'mkv', 'mov'].includes(ext);

    if (isVideo) {
        await sock.sendMessage(chatId, {
            video: buf,
            caption: `╭───❰ *⬇️ ${label.toUpperCase()}* ❱───╮\n✅ Downloaded successfully!\n╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });
    } else if (isAudio) {
        await sock.sendMessage(chatId, {
            audio: buf,
            mimetype: 'audio/mpeg',
            fileName: result.filename || `audio.${ext}`,
            ...channelInfo
        }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, {
            document: buf,
            fileName: result.filename || `file.${ext}`,
            mimetype: 'application/octet-stream',
            ...channelInfo
        }, { quoted: message });
    }
}

// ── threads ────────────────────────────────────────────────────────────────────
const threads = {
    command: 'threads',
    aliases: ['threadsdown', 'tdl'],
    category: 'download',
    description: 'Download content from Instagram Threads',
    usage: '.threads <threads-link>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const url = args[0]?.trim();
        if (!url || !url.includes('threads.net')) {
            return sock.sendMessage(chatId, {
                text: '❌ *Usage:* `.threads <Threads URL>`\nExample: `.threads https://threads.net/@user/post/xxx`',
                ...channelInfo
            }, { quoted: message });
        }
        await runDownload(sock, message, context, url, 'Threads');
    },
};

// ── capcut ─────────────────────────────────────────────────────────────────────
const capcut = {
    command: 'capcut',
    aliases: ['capcutdl', 'ccdl'],
    category: 'download',
    description: 'Download videos from CapCut',
    usage: '.capcut <capcut-link>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const url = args[0]?.trim();
        if (!url) {
            return sock.sendMessage(chatId, {
                text: '❌ *Usage:* `.capcut <CapCut URL>`\nExample: `.capcut https://www.capcut.com/t/xxx`',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);
        await sock.sendMessage(chatId, { react: { text: '⏬', key: message.key } });

        try {
            const apiUrl = `https://capcutapi.vercel.app/api?url=${encodeURIComponent(url)}`;
            const res = await fetch(apiUrl, {
                headers: { 'User-Agent': UA },
                signal: AbortSignal.timeout(20000),
            });

            let videoUrl = '';
            if (res.ok) {
                const data = await res.json() as any;
                videoUrl = data?.video || data?.url || data?.data?.url || '';
            }

            if (!videoUrl) {
                const r2 = await cobaltDownload(url);
                if (r2.url) videoUrl = r2.url;
            }

            if (!videoUrl) throw new Error('Could not extract CapCut video URL.');

            const buf = await fetchBuffer(videoUrl);
            if (!buf) throw new Error('Failed to download the CapCut video.');

            await sock.sendMessage(chatId, {
                video: buf,
                caption: `╭───❰ *⬇️ CAPCUT* ❱───╮\n✅ Downloaded!\n╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ CapCut download failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

// ── dlall ──────────────────────────────────────────────────────────────────────
const dlall = {
    command: 'dlall',
    aliases: ['download', 'dl', 'unidl'],
    category: 'download',
    description: 'Universal downloader — works with any supported link (TikTok, Instagram, YouTube, Twitter, etc.)',
    usage: '.dlall <link>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const url = args[0]?.trim();
        if (!url || !url.startsWith('http')) {
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *⬇️ UNIVERSAL DOWNLOADER* ❱───╮

*Usage:* .dlall <link>

*Supported platforms:*
🎵 TikTok  📸 Instagram  🐦 Twitter/X
▶️ YouTube  🎵 Spotify  📌 Pinterest
🎵 SoundCloud  💬 Threads  + more

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }
        await runDownload(sock, message, context, url, 'Download');
    },
};

// ── rmwm ───────────────────────────────────────────────────────────────────────
const rmwm = {
    command: 'rmwm',
    aliases: ['nowatermark', 'removewm', 'nowm'],
    category: 'download',
    description: 'Remove watermarks from TikTok and other videos',
    usage: '.rmwm <tiktok/video link>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const url = args[0]?.trim();
        if (!url || !url.startsWith('http')) {
            return sock.sendMessage(chatId, {
                text: '❌ *Usage:* `.rmwm <TikTok or video link>`\nExample: `.rmwm https://vm.tiktok.com/xxxxx`',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);
        await sock.sendMessage(chatId, { react: { text: '🧹', key: message.key } });

        try {
            let videoUrl = '';

            if (url.includes('tiktok') || url.includes('vm.tiktok')) {
                const musicalRes = await fetch(`https://musicaldown.com/api/download?url=${encodeURIComponent(url)}`, {
                    headers: { 'User-Agent': UA },
                    signal: AbortSignal.timeout(15000),
                });
                if (musicalRes.ok) {
                    const data = await musicalRes.json() as any;
                    videoUrl = data?.video_no_wm || data?.video || '';
                }
            }

            if (!videoUrl) {
                const r = await cobaltDownload(url, 'mute');
                if (r.url) videoUrl = r.url;
                else if (r.error) throw new Error(r.error);
            }

            if (!videoUrl) throw new Error('Could not extract watermark-free video.');

            const buf = await fetchBuffer(videoUrl);
            if (!buf) throw new Error('Failed to download the video.');

            await sock.sendMessage(chatId, {
                video: buf,
                caption: `╭───❰ *🧹 WATERMARK REMOVED* ❱───╮\n✅ Clean video • No watermark!\n╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Watermark removal failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

export default [threads, capcut, dlall, rmwm];
