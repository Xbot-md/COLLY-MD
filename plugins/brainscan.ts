import type { BotContext } from '../types.js';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import axios from 'axios';

const OCR_API = 'https://api.ocr.space/parse/image';
const OCR_KEY = 'helloworld';

function getImageMsg(message: any) {
    const m = message?.message;
    if (!m) return null;
    const q = m.extendedTextMessage?.contextInfo?.quotedMessage;
    if (q?.imageMessage) return q.imageMessage;
    if (m.imageMessage) return m.imageMessage;
    return null;
}

async function downloadImage(imgMsg: any): Promise<Buffer | null> {
    try {
        const stream = await downloadContentFromMessage(imgMsg, 'image');
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(c);
        return Buffer.concat(chunks);
    } catch {
        return null;
    }
}

async function runOCR(imgBuffer: Buffer): Promise<string> {
    const base64 = imgBuffer.toString('base64');
    const payload = new URLSearchParams();
    payload.append('apikey', OCR_KEY);
    payload.append('base64Image', `data:image/jpeg;base64,${base64}`);
    payload.append('language', 'eng');
    payload.append('isOverlayRequired', 'false');
    payload.append('detectOrientation', 'true');
    payload.append('scale', 'true');
    payload.append('OCREngine', '2');

    const { data } = await axios.post(OCR_API, payload.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
    });

    if (data?.IsErroredOnProcessing) {
        throw new Error(data?.ErrorMessage?.[0] || 'OCR processing failed');
    }

    const text = data?.ParsedResults?.[0]?.ParsedText?.trim();
    if (!text) throw new Error('No text found in the image');
    return text;
}

export default {
    command: 'brainscan',
    aliases: ['ocr', 'readtext', 'scantext', 'textread'],
    category: 'ai',
    description: 'Extract all text from a photo of a document or image',
    usage: '.brainscan (reply to an image)',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const chatId = context.chatId || message.key.remoteJid;

        const imgMsg = getImageMsg(message);
        if (!imgMsg) {
            return sock.sendMessage(
                chatId,
                {
                    text: [
                        '╭───❰ *BRAINSCAN — OCR* ❱───╮',
                        '│',
                        '│  Reply to an image with `.brainscan`',
                        '│  to extract all text from it.',
                        '│',
                        '│  Works best with:',
                        '│  • Photos of documents',
                        '│  • Handwritten notes',
                        '│  • Screenshots with text',
                        '│  • Business cards, receipts',
                        '│',
                        '╰────────────────────────╯',
                    ].join('\n'),
                },
                { quoted: message }
            );
        }

        await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });
        await sock.sendMessage(chatId, { text: '⏳ Scanning image, please wait...' }, { quoted: message });

        const buf = await downloadImage(imgMsg);
        if (!buf) {
            return sock.sendMessage(
                chatId,
                { text: '❌ Failed to download the image. Please try again.' },
                { quoted: message }
            );
        }

        try {
            const extracted = await runOCR(buf);
            const lines = extracted.split('\n').filter((l: string) => l.trim()).join('\n');

            const reply = [
                '╭───❰ *BRAINSCAN RESULT* ❱───╮',
                '│',
                lines,
                '│',
                `╰─ ${lines.split('\n').length} lines extracted ─╯`,
            ].join('\n');

            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
            await sock.sendMessage(chatId, { text: reply }, { quoted: message });
        } catch (err: any) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(
                chatId,
                { text: `❌ *BrainScan failed:* ${err.message}` },
                { quoted: message }
            );
        }
    },
};
