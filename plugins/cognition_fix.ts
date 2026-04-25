import type { BotContext } from '../types.js';
import axios from 'axios';

const AI_APIS = [
    (q: string) => `https://mistral.stacktoy.workers.dev/?apikey=Suhail&text=${encodeURIComponent(q)}`,
    (q: string) => `https://llama.gtech-apiz.workers.dev/?apikey=Suhail&text=${encodeURIComponent(q)}`,
    (q: string) => `https://mistral.gtech-apiz.workers.dev/?apikey=Suhail&text=${encodeURIComponent(q)}`,
];

async function rewriteText(text: string): Promise<string> {
    const prompt = [
        'Rewrite the following message into clear, professional English.',
        'Fix all grammar, spelling, punctuation, and sentence structure.',
        'Preserve the original meaning exactly.',
        'Return ONLY the rewritten text — no explanations, no labels, no extra commentary.',
        '',
        `Original: ${text}`,
    ].join('\n');

    for (const apiUrl of AI_APIS) {
        try {
            const { data } = await axios.get(apiUrl(prompt), { timeout: 20000 });
            const response = data?.data?.response;
            if (response && typeof response === 'string' && response.trim()) {
                return response.trim();
            }
        } catch {
            continue;
        }
    }
    throw new Error('All AI services failed. Please try again later.');
}

function getInputText(message: any, args: string[]): string {
    const argsText = args.join(' ').trim();
    if (argsText) return argsText;

    const q = message?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedText = (
        q?.conversation ||
        q?.extendedTextMessage?.text ||
        ''
    ).trim();
    if (quotedText) return quotedText;

    return '';
}

export default {
    command: 'cognition_fix',
    aliases: ['cfix', 'proofread', 'rewrite', 'professionalize', 'fixtext'],
    category: 'ai',
    description: 'Rewrite any text into perfect, professional English using AI',
    usage: '.cognition_fix <messy text>  OR  reply to a message with .cognition_fix',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const chatId = context.chatId || message.key.remoteJid;

        const input = getInputText(message, args);

        if (!input) {
            return sock.sendMessage(
                chatId,
                {
                    text: [
                        '╭───❰ *COGNITION FIX* ❱───╮',
                        '│',
                        '│  Rewrite any text into perfect,',
                        '│  professional English using AI.',
                        '│',
                        '│  *Usage:*',
                        '│  • `.cfix <your messy text>`',
                        '│  • Reply to any message with `.cfix`',
                        '│',
                        '│  *Example:*',
                        '│  `.cfix hey i wanted to ask u about',
                        '│   the meeting tomoro can we change it`',
                        '│',
                        '╰────────────────────────╯',
                    ].join('\n'),
                },
                { quoted: message }
            );
        }

        await sock.sendMessage(chatId, { react: { text: '✍️', key: message.key } });

        try {
            const fixed = await rewriteText(input);

            const reply = [
                '╭───❰ *COGNITION FIX* ❱───╮',
                '│',
                '│  *Original:*',
                `│  ${input}`,
                '│',
                '│  *Rewritten:*',
                `│  ${fixed}`,
                '│',
                '╰────────────────────────╯',
            ].join('\n');

            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
            await sock.sendMessage(chatId, { text: reply }, { quoted: message });
        } catch (err: any) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(
                chatId,
                { text: `❌ *Cognition Fix failed:* ${err.message}` },
                { quoted: message }
            );
        }
    },
};
