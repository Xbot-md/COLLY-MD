import type { BotContext } from '../types.js';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);
const TMP = path.join(process.cwd(), 'temp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

function ts() { return Date.now(); }

function cleanup(...files: string[]) {
    for (const f of files) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} }
}

async function dlMedia(message: any, type: 'image' | 'video' | 'audio' | 'sticker'): Promise<Buffer | null> {
    try {
        const stream = await downloadContentFromMessage(message, type);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    } catch { return null; }
}

function getQuotedMedia(message: any) {
    const m = message.message || {};
    const q = m.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!q) {
        const direct = m.videoMessage || m.imageMessage || m.audioMessage || m.stickerMessage;
        if (direct) {
            const type = m.videoMessage ? 'video' : m.imageMessage ? 'image' : m.audioMessage ? 'audio' : 'sticker';
            return { msg: direct, type };
        }
        return null;
    }
    if (q.videoMessage)   return { msg: q.videoMessage,   type: 'video'   };
    if (q.imageMessage)   return { msg: q.imageMessage,   type: 'image'   };
    if (q.audioMessage)   return { msg: q.audioMessage,   type: 'audio'   };
    if (q.stickerMessage) return { msg: q.stickerMessage, type: 'sticker' };
    return null;
}

// ── togif ──────────────────────────────────────────────────────────────────────
const togif = {
    command: 'togif',
    aliases: ['tgif', 'convert2gif'],
    category: 'tools',
    description: 'Convert video or sticker to looping GIF',
    usage: '.togif (reply to video/sticker)',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const media = getQuotedMedia(message);
        if (!media || !['video', 'sticker'].includes(media.type)) {
            return sock.sendMessage(chatId, { text: '❌ Reply to a *video or sticker* with .togif', ...channelInfo }, { quoted: message });
        }
        await sock.sendPresenceUpdate('composing', chatId);
        const buf = await dlMedia(media.msg, media.type as any);
        if (!buf) return sock.sendMessage(chatId, { text: '❌ Failed to download media.', ...channelInfo }, { quoted: message });

        const inFile  = path.join(TMP, `tgif_${ts()}.${media.type === 'sticker' ? 'webp' : 'mp4'}`);
        const outFile = path.join(TMP, `tgif_${ts()}.gif`);
        fs.writeFileSync(inFile, buf);

        try {
            await execAsync(`ffmpeg -y -i "${inFile}" -vf "fps=10,scale=320:-1:flags=lanczos" -loop 0 "${outFile}"`);
            const gif = fs.readFileSync(outFile);
            await sock.sendMessage(chatId, { image: gif, mimetype: 'image/gif', caption: '🎞️ Here\'s your GIF!', ...channelInfo }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Conversion failed: ${e.message}`, ...channelInfo }, { quoted: message });
        } finally { cleanup(inFile, outFile); }
    },
};

// ── toptt ──────────────────────────────────────────────────────────────────────
const toptt = {
    command: 'toptt',
    aliases: ['ptt', 'tovoice'],
    category: 'tools',
    description: 'Convert audio file to Push-to-Talk voice note',
    usage: '.toptt (reply to audio)',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const media = getQuotedMedia(message);
        if (!media || media.type !== 'audio') {
            return sock.sendMessage(chatId, { text: '❌ Reply to an *audio file* with .toptt', ...channelInfo }, { quoted: message });
        }
        await sock.sendPresenceUpdate('composing', chatId);
        const buf = await dlMedia(media.msg, 'audio');
        if (!buf) return sock.sendMessage(chatId, { text: '❌ Failed to download audio.', ...channelInfo }, { quoted: message });

        const inFile  = path.join(TMP, `ptt_${ts()}.mp3`);
        const outFile = path.join(TMP, `ptt_${ts()}.ogg`);
        fs.writeFileSync(inFile, buf);

        try {
            await execAsync(`ffmpeg -y -i "${inFile}" -c:a libopus -b:a 64k -ar 48000 "${outFile}"`);
            const ogg = fs.readFileSync(outFile);
            await sock.sendMessage(chatId, { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true, ...channelInfo }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Conversion failed: ${e.message}`, ...channelInfo }, { quoted: message });
        } finally { cleanup(inFile, outFile); }
    },
};

// ── tovideo ────────────────────────────────────────────────────────────────────
const tovideo = {
    command: 'tovideo',
    aliases: ['img2vid', 'sticker2video'],
    category: 'tools',
    description: 'Convert image or sticker to video format',
    usage: '.tovideo (reply to image/sticker)',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const media = getQuotedMedia(message);
        if (!media || !['image', 'sticker'].includes(media.type)) {
            return sock.sendMessage(chatId, { text: '❌ Reply to an *image or sticker* with .tovideo', ...channelInfo }, { quoted: message });
        }
        await sock.sendPresenceUpdate('composing', chatId);
        const buf = await dlMedia(media.msg, media.type as any);
        if (!buf) return sock.sendMessage(chatId, { text: '❌ Failed to download media.', ...channelInfo }, { quoted: message });

        const ext     = media.type === 'sticker' ? 'webp' : 'jpg';
        const inFile  = path.join(TMP, `v_${ts()}.${ext}`);
        const outFile = path.join(TMP, `v_${ts()}.mp4`);
        fs.writeFileSync(inFile, buf);

        try {
            await execAsync(`ffmpeg -y -loop 1 -i "${inFile}" -c:v libx264 -t 3 -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "${outFile}"`);
            const vid = fs.readFileSync(outFile);
            await sock.sendMessage(chatId, { video: vid, caption: '🎬 Converted to video!', ...channelInfo }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Conversion failed: ${e.message}`, ...channelInfo }, { quoted: message });
        } finally { cleanup(inFile, outFile); }
    },
};

// ── toaudio ────────────────────────────────────────────────────────────────────
const toaudio = {
    command: 'toaudio',
    aliases: ['extractaudio', 'vid2audio'],
    category: 'tools',
    description: 'Extract audio track from a video',
    usage: '.toaudio (reply to video)',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const media = getQuotedMedia(message);
        if (!media || media.type !== 'video') {
            return sock.sendMessage(chatId, { text: '❌ Reply to a *video* with .toaudio', ...channelInfo }, { quoted: message });
        }
        await sock.sendPresenceUpdate('composing', chatId);
        const buf = await dlMedia(media.msg, 'video');
        if (!buf) return sock.sendMessage(chatId, { text: '❌ Failed to download video.', ...channelInfo }, { quoted: message });

        const inFile  = path.join(TMP, `ta_${ts()}.mp4`);
        const outFile = path.join(TMP, `ta_${ts()}.mp3`);
        fs.writeFileSync(inFile, buf);

        try {
            await execAsync(`ffmpeg -y -i "${inFile}" -vn -ar 44100 -ac 2 -b:a 192k "${outFile}"`);
            const aud = fs.readFileSync(outFile);
            await sock.sendMessage(chatId, { audio: aud, mimetype: 'audio/mpeg', fileName: 'audio.mp3', ...channelInfo }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Extraction failed: ${e.message}`, ...channelInfo }, { quoted: message });
        } finally { cleanup(inFile, outFile); }
    },
};

// ── tomp3 ──────────────────────────────────────────────────────────────────────
const tomp3 = {
    command: 'tomp3',
    aliases: ['mp3', 'convertmp3'],
    category: 'tools',
    description: 'Convert any audio/video to MP3',
    usage: '.tomp3 (reply to audio/video)',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const media = getQuotedMedia(message);
        if (!media || !['audio', 'video'].includes(media.type)) {
            return sock.sendMessage(chatId, { text: '❌ Reply to an *audio or video* with .tomp3', ...channelInfo }, { quoted: message });
        }
        await sock.sendPresenceUpdate('composing', chatId);
        const buf = await dlMedia(media.msg, media.type as any);
        if (!buf) return sock.sendMessage(chatId, { text: '❌ Failed to download media.', ...channelInfo }, { quoted: message });

        const ext     = media.type === 'video' ? 'mp4' : 'mp3';
        const inFile  = path.join(TMP, `mp3_${ts()}.${ext}`);
        const outFile = path.join(TMP, `mp3_${ts()}.mp3`);
        fs.writeFileSync(inFile, buf);

        try {
            await execAsync(`ffmpeg -y -i "${inFile}" -ar 44100 -ac 2 -b:a 192k "${outFile}"`);
            const mp3 = fs.readFileSync(outFile);
            await sock.sendMessage(chatId, {
                audio: mp3,
                mimetype: 'audio/mpeg',
                fileName: `audio_${ts()}.mp3`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Conversion failed: ${e.message}`, ...channelInfo }, { quoted: message });
        } finally { cleanup(inFile, outFile); }
    },
};

export default [togif, toptt, tovideo, toaudio, tomp3];
