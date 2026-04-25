import type { BotContext } from '../types.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const VIBES = [
    '✨ Pure main-character energy', '🔥 Built different, hits different',
    '💀 Walking red flag but make it fashion', '🌊 Ocean eyes, chaos heart',
    '🌸 Soft on the outside, feral on the inside', '😴 Chronically tired but still iconic',
    '🎭 Two faces, both questionable', '🌙 Menace in the streets, philosopher at 3am',
    '💅 Delulu but make it your whole personality', '🤡 Chaotic good at best, disaster at worst',
    '🦋 Healing era, just not today', '📖 Secretly reads self-help books, publicly ignores them',
    '☕ Running on caffeine and bad decisions', '🎯 Laser focused on the wrong things',
    '🌪️ Doesn\'t know what they\'re doing but confident about it',
    '🧠 Big brain, bigger impulse control issues', '🕶️ Too cool to care, too caring to admit it',
    '👀 Quiet but the chaos is loud inside', '🎵 Main character with a villain soundtrack',
    '🌻 Kind soul wrapped in sarcasm',
];


const REGIONS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').reduce<Record<string, string>>((acc, c) => {
    acc[c] = String.fromCodePoint(0x1F1E6 + (c.charCodeAt(0) - 65));
    return acc;
}, {});

const FULLWIDTH: Record<string, string> = {};
for (let i = 65; i <= 90; i++) FULLWIDTH[String.fromCharCode(i)] = String.fromCodePoint(0xFF21 + i - 65);
for (let i = 97; i <= 122; i++) FULLWIDTH[String.fromCharCode(i)] = String.fromCodePoint(0xFF21 + i - 97);
for (let i = 48; i <= 57; i++) FULLWIDTH[String.fromCharCode(i)] = String.fromCodePoint(0xFF10 + i - 48);

function numOf(jid: string) { return jid.split('@')[0].split(':')[0]; }

// ── Commands ──────────────────────────────────────────────────────────────────
const gaycheck = {
    command: 'gaycheck',
    aliases: ['gaymeter', 'howgay'],
    category: 'fun',
    description: 'Check how gay someone is (humorous %)',
    usage: '.gaycheck [@user]',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const ctx = message.message?.extendedTextMessage?.contextInfo;
        const target = ctx?.mentionedJid?.[0] || ctx?.participant || senderId;
        const pct = Math.floor(Math.random() * 101);
        const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
        const level = pct >= 80 ? '🏳️‍🌈 EXTREMELY Gay' : pct >= 60 ? '💜 Pretty Gay' : pct >= 40 ? '🌈 Somewhat Gay' : pct >= 20 ? '😅 A Little Gay' : '❌ Not Gay';
        await sock.sendMessage(chatId, {
            text:
`╭───❰ *🌈 GAY METER* ❱───╮

*👤 User:* @${numOf(target)}
*📊 Gay Level:* ${pct}%
*[${bar}]*
*🏷️ Verdict:* ${level}

_Results may vary. Do not take seriously._

╰────────────────────────────╯`,
            mentions: [target], ...channelInfo
        }, { quoted: message });
    },
};

const lescheck = {
    command: 'lescheck',
    aliases: ['lesmeter', 'howlesbian'],
    category: 'fun',
    description: 'Check how lesbian someone is (humorous %)',
    usage: '.lescheck [@user]',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const ctx = message.message?.extendedTextMessage?.contextInfo;
        const target = ctx?.mentionedJid?.[0] || ctx?.participant || senderId;
        const pct = Math.floor(Math.random() * 101);
        const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
        const level = pct >= 80 ? '👩‍❤️‍👩 Fully Sapphic' : pct >= 60 ? '🌸 Openly Lesbian' : pct >= 40 ? '💕 Bi-curious' : pct >= 20 ? '🤔 Questioning' : '❌ Nope';
        await sock.sendMessage(chatId, {
            text:
`╭───❰ *👩‍❤️‍👩 LESBIAN METER* ❱───╮

*👤 User:* @${numOf(target)}
*📊 Level:* ${pct}%
*[${bar}]*
*🏷️ Verdict:* ${level}

_Totally scientific. Trust the algorithm._

╰────────────────────────────╯`,
            mentions: [target], ...channelInfo
        }, { quoted: message });
    },
};

const rate = {
    command: 'rate',
    aliases: ['rateme', 'rating'],
    category: 'fun',
    description: 'Bot rates a user or idea out of 10',
    usage: '.rate [@user or text]',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const ctx = message.message?.extendedTextMessage?.contextInfo;
        const target = ctx?.mentionedJid?.[0];
        const subject = target ? `@${numOf(target)}` : args.join(' ') || `@${numOf(senderId)}`;
        const score = (Math.random() * 10).toFixed(1);
        const stars = '⭐'.repeat(Math.round(parseFloat(score)));
        const reviews = [
            'Absolutely perfect — 10/10 would recommend',
            'Has hidden potential, just needs to believe in themselves',
            'A rare gem in a world full of gravel',
            'Would rate higher but the algorithm said no',
            'Chaotic but oddly loveable',
            'Underrated honestly',
            'The vibes are immaculate, the energy? Chef\'s kiss',
            'A work in progress — art always is',
            'Top tier material, don\'t let anyone tell you otherwise',
            'Average on paper, legendary in person',
        ];
        const review = reviews[Math.floor(Math.random() * reviews.length)];
        await sock.sendMessage(chatId, {
            text:
`╭───❰ *⭐ BOT RATING* ❱───╮

*🎯 Subject:* ${subject}
*📊 Score:* ${score}/10
*${stars}*

*📝 Review:*
_"${review}"_

╰────────────────────────────╯`,
            mentions: target ? [target] : [], ...channelInfo
        }, { quoted: message });
    },
};

const vibecheck = {
    command: 'vibecheck',
    aliases: ['vibe', 'checkvibes'],
    category: 'fun',
    description: 'AI-style vibe analysis of a user',
    usage: '.vibecheck [@user]',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const ctx = message.message?.extendedTextMessage?.contextInfo;
        const target = ctx?.mentionedJid?.[0] || senderId;
        const vibe = VIBES[Math.floor(Math.random() * VIBES.length)];
        const energy = ['🔴 Chaotic', '🟡 Neutral', '🟢 Positive', '🔵 Chill', '🟣 Mysterious'][Math.floor(Math.random() * 5)];
        const freq = `${(Math.random() * 500 + 100).toFixed(1)} Hz`;
        const aura = ['🌑 Dark academic', '🌈 Rainbow', '🌊 Ocean wave', '🌸 Soft pink', '🌙 Moonchild', '☀️ Golden hour'][Math.floor(Math.random() * 6)];
        await sock.sendMessage(chatId, {
            text:
`╭───❰ *✨ VIBE CHECK* ❱───╮

*👤 User:* @${numOf(target)}

*🎯 Vibe Reading:*
${vibe}

*⚡ Energy:* ${energy}
*📡 Frequency:* ${freq}
*🎨 Aura:* ${aura}

_Powered by advanced vibe detection AI™_

╰────────────────────────────╯`,
            mentions: [target], ...channelInfo
        }, { quoted: message });
    },
};

const shout = {
    command: 'shout',
    aliases: ['bigtext', 'loud'],
    category: 'fun',
    description: 'Converts text into large fullwidth block letters',
    usage: '.shout <text>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const text = args.join(' ').toUpperCase().trim();
        if (!text) {
            return sock.sendMessage(chatId, { text: '❌ Usage: .shout <text>', ...channelInfo }, { quoted: message });
        }
        const big = text.split('').map(c => FULLWIDTH[c] || c).join('');
        await sock.sendMessage(chatId, { text: `📢 ${big}`, ...channelInfo }, { quoted: message });
    },
};

const emojiart = {
    command: 'emojiart',
    aliases: ['emart', 'emojifont'],
    category: 'fun',
    description: 'Transform text into regional indicator emoji art',
    usage: '.emojiart <text>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const text = args.join(' ').toUpperCase().trim();
        if (!text) {
            return sock.sendMessage(chatId, { text: '❌ Usage: .emojiart <text>', ...channelInfo }, { quoted: message });
        }
        if (text.length > 30) {
            return sock.sendMessage(chatId, { text: '❌ Max 30 characters for emoji art.', ...channelInfo }, { quoted: message });
        }
        const art = text.split('').map(c => REGIONS[c] ? `${REGIONS[c]} ` : c === ' ' ? '   ' : c).join('');
        await sock.sendMessage(chatId, { text: art.trim(), ...channelInfo }, { quoted: message });
    },
};

export default [gaycheck, lescheck, rate, vibecheck, shout, emojiart];
