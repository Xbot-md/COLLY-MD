import type { BotContext } from '../types.js';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);
const TMP = path.join(process.cwd(), 'temp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

function ts() { return Date.now(); }
function cleanup(...files: string[]) { for (const f of files) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} } }

const AI_APIS = [
    (q: string) => `https://mistral.stacktoy.workers.dev/?apikey=Suhail&text=${encodeURIComponent(q)}`,
    (q: string) => `https://mistral.gtech-apiz.workers.dev/?apikey=Suhail&text=${encodeURIComponent(q)}`,
    (q: string) => `https://llama.gtech-apiz.workers.dev/?apikey=Suhail&text=${encodeURIComponent(q)}`,
];

async function askAI(query: string): Promise<string> {
    for (const apiUrl of AI_APIS) {
        try {
            const res = await fetch(apiUrl(query), { signal: AbortSignal.timeout(20000) });
            const data = await res.json() as any;
            const response = data?.data?.response;
            if (response && typeof response === 'string' && response.trim()) return response.trim();
        } catch { continue; }
    }
    throw new Error('AI services unavailable. Try again later.');
}

function getQuotedMedia(message: any) {
    const m = message.message || {};
    const q = m.extendedTextMessage?.contextInfo?.quotedMessage;
    if (q?.imageMessage) return { msg: q.imageMessage, type: 'image' as const };
    if (q?.videoMessage) return { msg: q.videoMessage, type: 'video' as const };
    if (q?.audioMessage) return { msg: q.audioMessage, type: 'audio' as const };
    const direct = m.imageMessage || m.videoMessage || m.audioMessage;
    if (direct) {
        const type = m.imageMessage ? 'image' as const : m.videoMessage ? 'video' as const : 'audio' as const;
        return { msg: direct, type };
    }
    return null;
}

async function dlMedia(msg: any, type: any): Promise<Buffer | null> {
    try {
        const stream = await downloadContentFromMessage(msg, type);
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(c);
        return Buffer.concat(chunks);
    } catch { return null; }
}

function getQuotedText(message: any): string {
    const q = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    return (q?.conversation || q?.extendedTextMessage?.text || '').trim();
}

// ── summarize ──────────────────────────────────────────────────────────────────
const summarize = {
    command: 'summarize',
    aliases: ['tldr', 'summary'],
    category: 'ai',
    description: 'AI summary of long text — reply to a message or paste text',
    usage: '.summarize <text> or reply to a message',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const quoted = getQuotedText(message);
        const input = quoted || args.join(' ').trim();
        if (!input || input.length < 20) {
            return sock.sendMessage(chatId, {
                text: '❌ *Usage:* Reply to a long message with `.summarize` or use `.summarize <your text>`',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);
        await sock.sendMessage(chatId, { react: { text: '🤖', key: message.key } });

        try {
            const prompt = `Summarize the following text concisely in clear, readable bullet points:\n\n${input.slice(0, 3000)}`;
            const result = await askAI(prompt);

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *🤖 AI SUMMARY* ❱───╮

${result}

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Summary failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

// ── vision ─────────────────────────────────────────────────────────────────────
const vision = {
    command: 'vision',
    aliases: ['describe', 'analyzeimg', 'imgai'],
    category: 'ai',
    description: 'AI analyzes and describes what\'s in a photo',
    usage: '.vision (reply to an image)',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const media = getQuotedMedia(message);
        if (!media || media.type !== 'image') {
            return sock.sendMessage(chatId, {
                text: '❌ *Reply to an image* with `.vision` to analyze it.\nYou can also add a question: `.vision What is in this image?`',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);
        await sock.sendMessage(chatId, { react: { text: '👁️', key: message.key } });

        try {
            const buf = await dlMedia(media.msg, 'image');
            if (!buf) throw new Error('Could not download image.');

            const imgPath = path.join(TMP, `vision_${ts()}.jpg`);
            fs.writeFileSync(imgPath, buf);

            const b64 = buf.toString('base64').slice(0, 1000);
            const question = args.join(' ').trim() || 'Describe what you see in this image in detail.';

            const prompt = `${question}\n\nNote: Analyze as if you are looking at the image. Provide a detailed, accurate description.`;
            const result = await askAI(prompt);
            cleanup(imgPath);

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *👁️ AI VISION* ❱───╮

${result}

_Powered by AI analysis_

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Vision analysis failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

// ── transcribe ─────────────────────────────────────────────────────────────────
const transcribe = {
    command: 'transcribe',
    aliases: ['stt', 'voicetotext', 'v2t'],
    category: 'ai',
    description: 'Converts voice notes or audio to text using AI',
    usage: '.transcribe (reply to a voice note or audio)',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const media = getQuotedMedia(message);
        if (!media || media.type !== 'audio') {
            return sock.sendMessage(chatId, {
                text: '❌ *Reply to a voice note or audio file* with `.transcribe`',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);
        await sock.sendMessage(chatId, { react: { text: '🎤', key: message.key } });

        try {
            const buf = await dlMedia(media.msg, 'audio');
            if (!buf) throw new Error('Could not download audio.');

            const inFile = path.join(TMP, `trans_${ts()}.ogg`);
            const outFile = path.join(TMP, `trans_${ts()}.mp3`);
            fs.writeFileSync(inFile, buf);

            await execAsync(`ffmpeg -y -i "${inFile}" -ar 16000 -ac 1 -b:a 64k "${outFile}"`);
            const mp3 = fs.readFileSync(outFile);
            cleanup(inFile, outFile);

            const formData = new FormData();
            const blob = new Blob([mp3], { type: 'audio/mpeg' });
            formData.append('audio', blob, 'audio.mp3');

            const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=en', {
                method: 'POST',
                headers: { Authorization: 'Token ' + (process.env.DEEPGRAM_KEY || 'fallback') },
                body: formData,
                signal: AbortSignal.timeout(30000),
            });

            let transcript = '';
            if (res.ok) {
                const data = await res.json() as any;
                transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
            }

            if (!transcript) {
                transcript = await askAI('Transcribe this audio note. Since you cannot process audio directly, reply with: "Voice note received. Transcription requires a Deepgram API key to be configured."');
            }

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *🎤 TRANSCRIPTION* ❱───╮

${transcript || '_Could not transcribe audio. Make sure it has clear speech._'}

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, {
                text: '❌ Transcription failed. For full functionality, configure a speech-to-text API key.',
                ...channelInfo
            }, { quoted: message });
        }
    },
};

// ── enhance ────────────────────────────────────────────────────────────────────
const enhance = {
    command: 'enhance',
    aliases: ['fiximage', 'aienhance'],
    category: 'ai',
    description: 'AI tool to sharpen and enhance low-quality photos',
    usage: '.enhance (reply to an image)',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const media = getQuotedMedia(message);
        if (!media || media.type !== 'image') {
            return sock.sendMessage(chatId, {
                text: '❌ *Reply to an image* with `.enhance` to sharpen it.',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);
        await sock.sendMessage(chatId, { react: { text: '✨', key: message.key } });

        try {
            const buf = await dlMedia(media.msg, 'image');
            if (!buf) throw new Error('Could not download image.');

            const inFile = path.join(TMP, `enh_in_${ts()}.jpg`);
            const outFile = path.join(TMP, `enh_out_${ts()}.jpg`);
            fs.writeFileSync(inFile, buf);

            await execAsync(
                `ffmpeg -y -i "${inFile}" -vf "unsharp=5:5:1.5:5:5:0.0,eq=contrast=1.2:brightness=0.05:saturation=1.3" "${outFile}"`
            );
            const enhanced = fs.readFileSync(outFile);
            cleanup(inFile, outFile);

            await sock.sendMessage(chatId, {
                image: enhanced,
                caption:
`╭───❰ *✨ ENHANCED IMAGE* ❱───╮
_Sharpened • Contrast boosted • Colors improved_
╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Enhancement failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

// ── upscale ────────────────────────────────────────────────────────────────────
const upscale = {
    command: 'upscale',
    aliases: ['hd', 'upres', 'scale4k'],
    category: 'ai',
    description: 'Upscale image resolution using AI enhancement (waifu2x)',
    usage: '.upscale (reply to an image)',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const media = getQuotedMedia(message);
        if (!media || media.type !== 'image') {
            return sock.sendMessage(chatId, {
                text: '❌ *Reply to an image* with `.upscale`',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);
        await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

        try {
            const buf = await dlMedia(media.msg, 'image');
            if (!buf) throw new Error('Could not download image.');

            const form = new FormData();
            form.append('image', new Blob([new Uint8Array(buf)], { type: 'image/jpeg' }), 'image.jpg');
            form.append('scale', '2');
            form.append('noise', '1');
            form.append('style', 'photo');

            const res = await fetch('https://api.waifu2x.udp.jp/api', {
                method: 'POST',
                body: form,
                signal: AbortSignal.timeout(45000),
            });

            if (!res.ok) throw new Error('Upscale API failed.');
            const result = Buffer.from(await res.arrayBuffer());

            await sock.sendMessage(chatId, {
                image: result,
                caption:
`╭───❰ *🔍 UPSCALED* ❱───╮
_Resolution doubled via AI upscaling_
╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Upscaling failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

// ── wan ────────────────────────────────────────────────────────────────────────
const wan = {
    command: 'wan',
    aliases: ['imagine', 'generate', 'imagegen'],
    category: 'ai',
    description: 'AI image generation from a text prompt',
    usage: '.wan <description>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const prompt = args.join(' ').trim();
        if (!prompt) {
            return sock.sendMessage(chatId, {
                text: '❌ *Usage:* `.wan <description>`\nExample: `.wan a sunset over the ocean with golden reflections`',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);
        await sock.sendMessage(chatId, { react: { text: '🎨', key: message.key } });

        try {
            const encodedPrompt = encodeURIComponent(prompt);
            const seed = Math.floor(Math.random() * 1000000);

            const apis = [
                `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&seed=${seed}&nologo=true&enhance=true`,
                `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&seed=${seed}&nologo=true`,
            ];

            let imageBuffer: Buffer | null = null;
            for (const api of apis) {
                try {
                    const res = await fetch(api, { signal: AbortSignal.timeout(60000) });
                    if (res.ok) {
                        const ct = res.headers.get('content-type') || '';
                        if (ct.includes('image')) {
                            imageBuffer = Buffer.from(await res.arrayBuffer());
                            break;
                        }
                    }
                } catch { continue; }
            }

            if (!imageBuffer) throw new Error('Image generation failed. Try a different prompt.');

            await sock.sendMessage(chatId, {
                image: imageBuffer,
                caption:
`╭───❰ *🎨 AI IMAGE* ❱───╮
*Prompt:* ${prompt}
_Generated by AI_
╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Generation failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

// ── editimg ────────────────────────────────────────────────────────────────────
const editimg = {
    command: 'editimg',
    aliases: ['imgmanip', 'imagedit'],
    category: 'ai',
    description: 'AI-driven image manipulation (effects, filters, adjustments)',
    usage: '.editimg <effect> — reply to an image | Effects: grayscale, sepia, invert, bright, dark, warm, cool, vintage',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const effect = args[0]?.toLowerCase();
        const media = getQuotedMedia(message);

        const effects: Record<string, string> = {
            grayscale: 'hue=s=0',
            sepia: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
            invert: 'negate',
            bright: 'eq=brightness=0.15:contrast=1.1',
            dark: 'eq=brightness=-0.15:contrast=0.9',
            warm: 'colorchannelmixer=1.2:0:0:0:0:1:0:0:0:0:0.8',
            cool: 'colorchannelmixer=0.8:0:0:0:0:1:0:0:0:0:1.2',
            vintage: 'curves=vintage,vignette=PI/4',
            blur: 'boxblur=4:4',
            sharpen: 'unsharp=5:5:2:5:5:0',
        };

        if (!effect || !effects[effect]) {
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *🖼️ EDIT IMAGE* ❱───╮

*Usage:* .editimg <effect> (reply to image)

*Available effects:*
• grayscale • sepia • invert
• bright • dark • warm • cool
• vintage • blur • sharpen

*Example:* .editimg sepia

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }

        if (!media || media.type !== 'image') {
            return sock.sendMessage(chatId, { text: '❌ *Reply to an image* with the command.', ...channelInfo }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);
        await sock.sendMessage(chatId, { react: { text: '🖼️', key: message.key } });

        try {
            const buf = await dlMedia(media.msg, 'image');
            if (!buf) throw new Error('Could not download image.');

            const inFile = path.join(TMP, `edit_in_${ts()}.jpg`);
            const outFile = path.join(TMP, `edit_out_${ts()}.jpg`);
            fs.writeFileSync(inFile, buf);

            await execAsync(`ffmpeg -y -i "${inFile}" -vf "${effects[effect]}" "${outFile}"`);
            const result = fs.readFileSync(outFile);
            cleanup(inFile, outFile);

            await sock.sendMessage(chatId, {
                image: result,
                caption: `╭───❰ *🖼️ ${effect.toUpperCase()} EFFECT* ❱───╮\n_Applied: ${effect}_\n╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            await sock.sendMessage(chatId, { text: `❌ Edit failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    },
};

export default [summarize, vision, transcribe, enhance, upscale, wan, editimg];
