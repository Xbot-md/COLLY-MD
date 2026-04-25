import type { BotContext } from '../types.js';

const BOOKS = [
    'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
    '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra',
    'Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon',
    'Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos',
    'Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah',
    'Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians',
    '2 Corinthians','Galatians','Ephesians','Philippians','Colossians',
    '1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon',
    'Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'
];

/**
 * Normalise user input into the format the API expects (e.g. "John 3:16").
 * Handles:
 *   "john 3 16"        → "John 3:16"
 *   "1 john 3 16"      → "1 John 3:16"
 *   "john 3:16"        → "John 3:16"
 *   "psalm 23"         → "Psalm 23"   (whole chapter)
 *   "proverbs 3 5-6"   → "Proverbs 3:5-6"
 */
function normalizeReference(args: string[]): string {
    const parts = args.map(a => a.trim()).filter(Boolean);
    if (!parts.length) return '';

    // Already has a colon — just title-case and return
    const joined = parts.join(' ');
    if (joined.includes(':')) {
        return joined.replace(/\b([a-zA-Z])/g, c => c.toUpperCase());
    }

    // Detect trailing numbers: last token is digits (or digit range like "5-6")
    // and second-to-last is also digits → treat as chapter:verse
    const last = parts[parts.length - 1];
    const secondLast = parts.length >= 2 ? parts[parts.length - 2] : null;

    if (/^\d[\d-]*$/.test(last) && secondLast && /^\d+$/.test(secondLast)) {
        const bookParts = parts.slice(0, parts.length - 2);
        const book = bookParts.join(' ').replace(/\b([a-zA-Z])/g, c => c.toUpperCase());
        return `${book} ${secondLast}:${last}`;
    }

    // Single trailing number after a book → whole chapter
    return joined.replace(/\b([a-zA-Z])/g, c => c.toUpperCase());
}

async function fetchVerse(reference: string): Promise<{ text: string; reference: string } | null> {
    try {
        const encoded = encodeURIComponent(reference);
        const res = await fetch(`https://bible-api.com/${encoded}?translation=kjv`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return null;
        const data = await res.json() as any;
        if (!data.text) return null;
        return { text: data.text.trim(), reference: data.reference };
    } catch { return null; }
}

async function fetchRandomVerse(): Promise<{ text: string; reference: string } | null> {
    const popularVerses = [
        'John 3:16', 'Psalm 23:1', 'Romans 8:28', 'Philippians 4:13', 'Isaiah 40:31',
        'Jeremiah 29:11', 'Proverbs 3:5-6', 'Matthew 6:33', 'Romans 6:23', 'John 14:6',
        'Psalm 46:1', 'Matthew 11:28', 'Hebrews 11:1', 'Romans 12:2', 'Psalm 119:105',
        'Ephesians 2:8-9', '1 Corinthians 13:4-5', 'Galatians 5:22-23', 'Psalm 27:1',
        'Joshua 1:9', 'Deuteronomy 31:6', '2 Timothy 1:7', 'Matthew 5:3', 'John 15:13',
        'Revelation 21:4', 'Isaiah 41:10', 'Proverbs 31:25', 'Psalm 37:4', 'John 16:33'
    ];
    const ref = popularVerses[Math.floor(Math.random() * popularVerses.length)];
    return fetchVerse(ref);
}

function versePanel(result: { text: string; reference: string }): string {
    return (
        `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n` +
        `╽ 📖 *${result.reference}*\n` +
        `╽ ───────────────────────────────\n` +
        `╽ _${result.text.replace(/\n/g, '\n╽ ')}_\n` +
        `╽ ───────────────────────────────\n` +
        `╽ King James Version (KJV)\n` +
        `┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`
    );
}

export default {
    command: 'bible',
    aliases: ['verse', 'scripture', 'kjv'],
    category: 'search',
    description: 'Get a Bible verse',
    usage: '.bible John 3:16',

    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo } = context;
        await sock.sendPresenceUpdate('composing', chatId);

        // No args or "random" → random verse
        if (!args.length || args[0].toLowerCase() === 'random') {
            const result = await fetchRandomVerse();
            if (!result) return sock.sendMessage(chatId, { text: `❌ Could not fetch a verse right now. Try again later.`, ...channelInfo }, { quoted: message });
            return sock.sendMessage(chatId, { text: versePanel(result), ...channelInfo }, { quoted: message });
        }

        // Normalise the reference (handles "john 3 16" → "John 3:16" etc.)
        const normalised = normalizeReference(args);
        let result = await fetchVerse(normalised);

        if (!result) {
            // Show clear usage error first, then a random verse as a sample
            const random = await fetchRandomVerse();
            const randomBlock = random
                ? `\n╽ ───────────────────────────────\n╽ 🎲 *Random verse for now:*\n╽\n╽ 📖 *${random.reference}*\n╽ _${random.text.replace(/\n/g, '\n╽ ')}_`
                : '';

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ ❌ *VERSE NOT FOUND*
╽ ───────────────────────────────
╽ Could not find: _"${args.join(' ')}"_
╽ ───────────────────────────────
╽ *CORRECT FORMAT:*
╽ .bible John 3:16
╽ .bible Psalm 23:1
╽ .bible Romans 8:28-29
╽ .bible 1 John 4:8
╽ ───────────────────────────────
╽ Book name  + chapter *:* verse
╽ Use a colon between chapter/verse${randomBlock}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { text: versePanel(result), ...channelInfo }, { quoted: message });
    }
};
