import type { BotContext } from '../types.js';

function numOf(jid: string) { return jid.split('@')[0].split(':')[0]; }

const WORD_LIST = [
    'apple','brave','chair','dance','eagle','fancy','grace','happy','ivory','joker',
    'knife','laser','magic','noble','ocean','piano','queen','radar','solar','tiger',
    'ultra','vivid','water','xenon','yacht','zebra','album','blaze','crisp','drape',
    'ember','flare','ghost','honey','index','jumpy','karma','lemon','mocha','nerve',
    'orbit','pixel','quirk','realm','snack','thorn','umbra','vapor','whisk','youth',
    'agile','bland','clown','depot','evoke','flint','gloom','haven','infer','jewel',
    'kudos','light','merge','novel','optic','prowl','query','risky','stone','trump',
    'unify','vivid','waltz','exact','yearn','zoned','alarm','blunt','craft','dunce',
    'elite','flesh','gripe','hatch','input','joust','knelt','lodge','marsh','nymph',
    'onset','plumb','quart','rebel','shelf','trove','usurp','vouch','wrath','expel',
];

const EMOJI_QUIZ: { emojis: string; answer: string; hint: string }[] = [
    { emojis: '🦁👑', answer: 'lion king', hint: 'Famous Disney movie' },
    { emojis: '🕷️🕸️👨', answer: 'spider man', hint: 'Marvel superhero' },
    { emojis: '❄️👸', answer: 'frozen', hint: 'Disney princess movie' },
    { emojis: '🧙‍♂️💍🌋', answer: 'lord of the rings', hint: 'Epic fantasy trilogy' },
    { emojis: '🦈🎬', answer: 'jaws', hint: 'Classic shark horror film' },
    { emojis: '🌟⚔️🌌', answer: 'star wars', hint: 'Famous sci-fi saga' },
    { emojis: '🦇🤵', answer: 'batman', hint: 'DC superhero' },
    { emojis: '🧸🧍', answer: 'toy story', hint: 'Pixar animated film' },
    { emojis: '🦸‍♂️🔨⚡', answer: 'thor', hint: 'Norse god, Marvel hero' },
    { emojis: '🐟🔍', answer: 'finding nemo', hint: 'Pixar fish adventure' },
    { emojis: '🤖🚗', answer: 'transformers', hint: 'Robots in disguise' },
    { emojis: '👻🎃', answer: 'halloween', hint: 'Horror holiday classic' },
    { emojis: '🌊🏄', answer: 'moana', hint: 'Disney ocean adventure' },
    { emojis: '🐼🥋', answer: 'kung fu panda', hint: 'DreamWorks animated movie' },
    { emojis: '👩‍🚀🚀🌙', answer: 'gravity', hint: 'Space thriller film' },
    { emojis: '🦊🐰🌆', answer: 'zootopia', hint: 'Disney animal city movie' },
    { emojis: '🐉🏔️🔥', answer: 'how to train your dragon', hint: 'Boy befriends a dragon' },
    { emojis: '🎭🎪🎠', answer: 'the greatest showman', hint: 'P.T. Barnum musical' },
    { emojis: '🌹👸🕰️', answer: 'beauty and the beast', hint: 'Tale as old as time' },
    { emojis: '🦅🇺🇸🦾', answer: 'captain america', hint: 'Marvel\'s star spangled hero' },
];

const WHOAMI_CLUES: { clues: string[]; answer: string }[] = [
    { clues: ['I have a magic wand', 'I wear round glasses', 'I study at a famous school of wizardry'], answer: 'harry potter' },
    { clues: ['I am a fictional billionaire', 'I wear a high-tech suit of armor', 'My company is called Stark Industries'], answer: 'iron man' },
    { clues: ['I live in the ocean in a pineapple', 'I am yellow and porous', 'My best friend is a pink starfish'], answer: 'spongebob' },
    { clues: ['I am a detective with a famous pipe', 'I live at 221B Baker Street', 'My partner is Dr. Watson'], answer: 'sherlock holmes' },
    { clues: ['I am the fastest thing alive', 'I wear red and collect rings', 'I am a blue hedgehog'], answer: 'sonic' },
    { clues: ['I wore a white glove', 'I moonwalked on stage', 'I am the King of Pop'], answer: 'michael jackson' },
    { clues: ['I am made of sand', 'I am tall and yellow', 'Children love building me at the beach'], answer: 'sandcastle' },
    { clues: ['I can fly and breathe fire', 'I sit on a throne of gold', 'Smaug is my famous fictional relative'], answer: 'dragon' },
    { clues: ['I was the first man on the moon', 'I said "One small step for man"', 'My last name is Armstrong'], answer: 'neil armstrong' },
    { clues: ['I write novels about magic and mystery', 'My pen name is Robert Galbraith', 'I created the wizard Harry Potter'], answer: 'jk rowling' },
];

interface WcgSession { word: string; lastJid: string | null; score: Record<string, number>; timer?: ReturnType<typeof setTimeout>; handler?: (u: any) => void; }
interface EmojiQuizSession { question: typeof EMOJI_QUIZ[0]; winner: string | null; handler?: (u: any) => void; timer?: ReturnType<typeof setTimeout>; }
interface UnscrambleSession { original: string; jumbled: string; winner: string | null; handler?: (u: any) => void; timer?: ReturnType<typeof setTimeout>; }
interface WordleSession { word: string; guesses: string[]; players: Set<string>; won: boolean; handler?: (u: any) => void; timer?: ReturnType<typeof setTimeout>; }
interface WhoamiSession { data: typeof WHOAMI_CLUES[0]; clueIdx: number; winner: string | null; handler?: (u: any) => void; timer?: ReturnType<typeof setTimeout>; }

const wcgSessions  = new Map<string, WcgSession>();
const eqSessions   = new Map<string, EmojiQuizSession>();
const unSessions   = new Map<string, UnscrambleSession>();
const wdlSessions  = new Map<string, WordleSession>();
const whoSessions  = new Map<string, WhoamiSession>();

function shuffle(str: string): string {
    const arr = str.split('');
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.join('');
}

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function wordleMask(word: string, guess: string): string {
    return guess.split('').map((c, i) => {
        if (c === word[i]) return `🟩`;
        if (word.includes(c)) return `🟨`;
        return `⬛`;
    }).join('');
}

// ── Word Chain Game ─────────────────────────────────────────────────────────────
const wcg = {
    command: 'wcg',
    aliases: ['wordchain', 'wordgame'],
    category: 'games',
    description: 'Word Chain Game: each word must start with the last letter of the previous',
    usage: '.wcg [start] — start the game | type a word to play | .wcg stop',
    groupOnly: true,

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;

        if (args[0]?.toLowerCase() === 'stop' || args[0]?.toLowerCase() === 'end') {
            const s = wcgSessions.get(chatId);
            if (!s) return sock.sendMessage(chatId, { text: '❌ No active Word Chain game.', ...channelInfo }, { quoted: message });
            if (s.handler) sock.ev.off('messages.upsert', s.handler);
            if (s.timer) clearTimeout(s.timer);
            wcgSessions.delete(chatId);
            const board = Object.entries(s.score).sort(([, a], [, b]) => b - a)
                .map(([j, n], i) => `${['🥇','🥈','🥉'][i] || '▪️'} @${numOf(j)} — ${n} word${n !== 1 ? 's' : ''}`)
                .join('\n') || '_No words played_';
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *🔤 WORD CHAIN ENDED* ❱───╮

*Final Scores:*
${board}

╰────────────────────────────╯`,
                mentions: Object.keys(s.score),
                ...channelInfo
            }, { quoted: message });
        }

        if (wcgSessions.has(chatId)) {
            return sock.sendMessage(chatId, { text: '⚠️ A Word Chain game is already active! Use .wcg stop to end it first.', ...channelInfo }, { quoted: message });
        }

        const startWord = args.join(' ').toLowerCase().trim() || pick(WORD_LIST);

        const session: WcgSession = { word: startWord, lastJid: null, score: {} };
        wcgSessions.set(chatId, session);

        await sock.sendMessage(chatId, {
            text:
`╭───❰ *🔤 WORD CHAIN GAME* ❱───╮

✅ Game started!

*First word:* *${startWord.toUpperCase()}*
*Next word must start with:* *${startWord.slice(-1).toUpperCase()}*

*Rules:*
• Type a word that starts with the last letter of the previous word
• No repeats • Real words only
• You can't play 2 words in a row

_Type .wcg stop to end the game_

╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });

        const handler = async (update: any) => {
            const m = update?.messages?.[0];
            if (!m?.message || m.key.remoteJid !== chatId || m.key.fromMe) return;
            const body = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim().toLowerCase();
            if (!body || body.includes(' ') || body.startsWith('.')) return;
            const rawSender = m.key.participant || m.key.remoteJid;

            const s = wcgSessions.get(chatId);
            if (!s) return;

            if (rawSender === s.lastJid) {
                await sock.sendMessage(chatId, { text: `❌ @${numOf(rawSender)} you can't play 2 words in a row! Wait for someone else.`, mentions: [rawSender] });
                return;
            }

            if (body[0] !== s.word.slice(-1)) {
                await sock.sendMessage(chatId, { text: `❌ *${body}* doesn't start with *${s.word.slice(-1).toUpperCase()}*!` });
                return;
            }

            s.score[rawSender] = (s.score[rawSender] || 0) + 1;
            s.word = body;
            s.lastJid = rawSender;

            await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
            await sock.sendMessage(chatId, {
                text: `✅ *${body.toUpperCase()}* — Next must start with *${body.slice(-1).toUpperCase()}*`,
            });
        };

        session.handler = handler;
        sock.ev.on('messages.upsert', handler);
    },
};

// ── Emoji Quiz ──────────────────────────────────────────────────────────────────
const emojiquiz = {
    command: 'emojiquiz',
    aliases: ['emojiguess', 'emojiriddle'],
    category: 'games',
    description: 'Guess the movie or person from emoji clues',
    usage: '.emojiquiz',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        if (eqSessions.has(chatId)) {
            const s = eqSessions.get(chatId)!;
            return sock.sendMessage(chatId, {
                text: `⚠️ A quiz is already active!\n*Emojis:* ${s.question.emojis}\n*Hint:* _${s.question.hint}_`,
                ...channelInfo
            }, { quoted: message });
        }

        const question = pick(EMOJI_QUIZ);
        const session: EmojiQuizSession = { question, winner: null };
        eqSessions.set(chatId, session);

        await sock.sendMessage(chatId, {
            text:
`╭───❰ *🎭 EMOJI QUIZ* ❱───╮

*Guess it:*
${question.emojis}

*💡 Hint:* ${question.hint}

_Type your answer! 30 seconds..._

╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });

        const handler = async (update: any) => {
            const m = update?.messages?.[0];
            if (!m?.message || m.key.remoteJid !== chatId || m.key.fromMe) return;
            const body = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim().toLowerCase();
            const s = eqSessions.get(chatId);
            if (!s || s.winner) return;

            if (body === s.question.answer || body.replace(/\s+/g, '') === s.question.answer.replace(/\s+/g, '')) {
                s.winner = m.key.participant || m.key.remoteJid;
                if (s.timer) clearTimeout(s.timer);
                if (s.handler) sock.ev.off('messages.upsert', s.handler);
                eqSessions.delete(chatId);
                await sock.sendMessage(chatId, { react: { text: '🎉', key: m.key } });
                await sock.sendMessage(chatId, {
                    text:
`╭───❰ *🎭 CORRECT!* ❱───╮

🏆 *@${numOf(s.winner!)}* got it right!

*Answer:* ${s.question.answer.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}

╰────────────────────────────╯`,
                    mentions: [s.winner!],
                });
            }
        };

        session.handler = handler;
        sock.ev.on('messages.upsert', handler);

        session.timer = setTimeout(async () => {
            const s = eqSessions.get(chatId);
            if (!s || s.winner) return;
            if (s.handler) sock.ev.off('messages.upsert', s.handler);
            eqSessions.delete(chatId);
            await sock.sendMessage(chatId, {
                text: `⏰ *Time's up!*\nThe answer was: *${s.question.answer.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}*`,
            });
        }, 30_000);
    },
};

// ── Unscramble ─────────────────────────────────────────────────────────────────
const unscramble = {
    command: 'unscramble',
    aliases: ['unshuffle', 'scramble'],
    category: 'games',
    description: 'Unscramble the jumbled word before time runs out',
    usage: '.unscramble',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        if (unSessions.has(chatId)) {
            const s = unSessions.get(chatId)!;
            return sock.sendMessage(chatId, {
                text: `⚠️ Already active! Unscramble: *${s.jumbled.toUpperCase()}*`,
                ...channelInfo
            }, { quoted: message });
        }

        const original = pick(WORD_LIST);
        let jumbled = shuffle(original);
        while (jumbled === original) jumbled = shuffle(original);

        const session: UnscrambleSession = { original, jumbled, winner: null };
        unSessions.set(chatId, session);

        await sock.sendMessage(chatId, {
            text:
`╭───❰ *🔀 UNSCRAMBLE* ❱───╮

*Jumbled word:*
🔤 *${jumbled.toUpperCase()}*

*💡 Hint:* ${original.length}-letter word

_Type the correct spelling! 25 seconds..._

╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });

        const handler = async (update: any) => {
            const m = update?.messages?.[0];
            if (!m?.message || m.key.remoteJid !== chatId || m.key.fromMe) return;
            const body = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim().toLowerCase();
            const s = unSessions.get(chatId);
            if (!s || s.winner) return;

            if (body === s.original) {
                s.winner = m.key.participant || m.key.remoteJid;
                if (s.timer) clearTimeout(s.timer);
                if (s.handler) sock.ev.off('messages.upsert', s.handler);
                unSessions.delete(chatId);
                await sock.sendMessage(chatId, { react: { text: '🎉', key: m.key } });
                await sock.sendMessage(chatId, {
                    text: `╭───❰ *✅ CORRECT!* ❱───╮\n\n🏆 *@${numOf(s.winner!)}* wins!\nThe word was: *${s.original.toUpperCase()}*\n\n╰────────────────────────────╯`,
                    mentions: [s.winner!],
                });
            }
        };

        session.handler = handler;
        sock.ev.on('messages.upsert', handler);
        session.timer = setTimeout(async () => {
            const s = unSessions.get(chatId);
            if (!s || s.winner) return;
            if (s.handler) sock.ev.off('messages.upsert', s.handler);
            unSessions.delete(chatId);
            await sock.sendMessage(chatId, {
                text: `⏰ *Time's up!*\nThe word was: *${s.original.toUpperCase()}*`,
            });
        }, 25_000);
    },
};

// ── Wordle ─────────────────────────────────────────────────────────────────────
const wordle = {
    command: 'wordle',
    aliases: ['wordlebot', 'guessword'],
    category: 'games',
    description: 'Guess the 5-letter word in 6 tries (WhatsApp Wordle)',
    usage: '.wordle — start game | .wordle <word> — make a guess',
    groupOnly: true,

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;

        const guess = args.join('').toLowerCase().trim();

        if (!guess || guess === 'new' || guess === 'start') {
            if (wdlSessions.has(chatId)) {
                const s = wdlSessions.get(chatId)!;
                return sock.sendMessage(chatId, {
                    text: `⚠️ *Wordle already active!*\n\nGuesses so far: ${s.guesses.length}/6\nUse .wordle <5-letter-word> to guess.\nUse .wordle quit to give up.`,
                    ...channelInfo
                }, { quoted: message });
            }

            const fiveLetters = WORD_LIST.filter(w => w.length === 5);
            const word = pick(fiveLetters);
            const session: WordleSession = { word, guesses: [], players: new Set(), won: false };
            wdlSessions.set(chatId, session);

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *🟩 WORDLE* ❱───╮

*A new 5-letter word is ready!*

🟩 = Correct letter, correct spot
🟨 = Correct letter, wrong spot
⬛ = Not in the word

*How to guess:*
\`.wordle <word>\`

You have *6 tries!*

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
            return;
        }

        if (guess === 'quit' || guess === 'stop') {
            const s = wdlSessions.get(chatId);
            if (!s) return sock.sendMessage(chatId, { text: '❌ No active Wordle game.', ...channelInfo }, { quoted: message });
            wdlSessions.delete(chatId);
            return sock.sendMessage(chatId, {
                text: `🏳️ *Wordle ended.*\nThe word was: *${s.word.toUpperCase()}*`,
                ...channelInfo
            }, { quoted: message });
        }

        const session = wdlSessions.get(chatId);
        if (!session) {
            return sock.sendMessage(chatId, {
                text: '❌ No active Wordle. Start one with `.wordle`',
                ...channelInfo
            }, { quoted: message });
        }

        if (guess.length !== 5 || !/^[a-z]+$/.test(guess)) {
            return sock.sendMessage(chatId, { text: '❌ Guess must be exactly 5 letters.', ...channelInfo }, { quoted: message });
        }

        if (session.guesses.includes(guess)) {
            return sock.sendMessage(chatId, { text: `❌ *${guess.toUpperCase()}* was already guessed!`, ...channelInfo }, { quoted: message });
        }

        session.guesses.push(guess);
        session.players.add(senderId);

        const mask = wordleMask(session.word, guess);
        const board = session.guesses.map((g, i) =>
            `${wordleMask(session.word, g)} ${g.toUpperCase()}`
        ).join('\n');

        const remaining = 6 - session.guesses.length;

        if (guess === session.word) {
            wdlSessions.delete(chatId);
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *🟩 WORDLE WON!* ❱───╮

🎉 @${numOf(senderId)} got it in *${session.guesses.length}/6*!

${board}

*The word was:* *${session.word.toUpperCase()}*

╰────────────────────────────╯`,
                mentions: [senderId],
                ...channelInfo
            }, { quoted: message });
        }

        if (session.guesses.length >= 6) {
            wdlSessions.delete(chatId);
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *😢 WORDLE LOST* ❱───╮

${board}

*The word was:* *${session.word.toUpperCase()}*

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            text:
`${board}

*Guesses:* ${session.guesses.length}/6 | *Remaining:* ${remaining}
Keep going!`,
            ...channelInfo
        }, { quoted: message });
    },
};

// ── Who Am I? ──────────────────────────────────────────────────────────────────
const whoami = {
    command: 'whoami',
    aliases: ['guessme', 'guesswho'],
    category: 'games',
    description: 'Guess the character or person from clues revealed one at a time',
    usage: '.whoami',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        if (args[0]?.toLowerCase() === 'hint') {
            const s = whoSessions.get(chatId);
            if (!s) return sock.sendMessage(chatId, { text: '❌ No active Who Am I game.', ...channelInfo }, { quoted: message });
            if (s.clueIdx >= s.data.clues.length - 1) {
                return sock.sendMessage(chatId, { text: '❌ No more hints available!', ...channelInfo }, { quoted: message });
            }
            s.clueIdx++;
            return sock.sendMessage(chatId, {
                text: `💡 *Clue ${s.clueIdx + 1}:* ${s.data.clues[s.clueIdx]}`,
                ...channelInfo
            }, { quoted: message });
        }

        if (whoSessions.has(chatId)) {
            const s = whoSessions.get(chatId)!;
            return sock.sendMessage(chatId, {
                text: `⚠️ Already active!\n*Clue:* ${s.data.clues[s.clueIdx]}\nUse .whoami hint for next clue, or type your guess!`,
                ...channelInfo
            }, { quoted: message });
        }

        const data = pick(WHOAMI_CLUES);
        const session: WhoamiSession = { data, clueIdx: 0, winner: null };
        whoSessions.set(chatId, session);

        await sock.sendMessage(chatId, {
            text:
`╭───❰ *🕵️ WHO AM I?* ❱───╮

*Clue 1:* ${data.clues[0]}

• Type your guess anytime
• Use \`.whoami hint\` for next clue
• 60 seconds to guess!

╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });

        const handler = async (update: any) => {
            const m = update?.messages?.[0];
            if (!m?.message || m.key.remoteJid !== chatId || m.key.fromMe) return;
            const body = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim().toLowerCase();
            if (!body || body.startsWith('.')) return;
            const s = whoSessions.get(chatId);
            if (!s || s.winner) return;

            if (body === s.data.answer || body.replace(/\s+/g, '') === s.data.answer.replace(/\s+/g, '')) {
                s.winner = m.key.participant || m.key.remoteJid;
                if (s.timer) clearTimeout(s.timer);
                if (s.handler) sock.ev.off('messages.upsert', s.handler);
                whoSessions.delete(chatId);
                await sock.sendMessage(chatId, { react: { text: '🎉', key: m.key } });
                await sock.sendMessage(chatId, {
                    text:
`╭───❰ *🕵️ CORRECT!* ❱───╮

🏆 *@${numOf(s.winner!)}* wins!
*Answer:* ${s.data.answer.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}

╰────────────────────────────╯`,
                    mentions: [s.winner!],
                });
            }
        };

        session.handler = handler;
        sock.ev.on('messages.upsert', handler);
        session.timer = setTimeout(async () => {
            const s = whoSessions.get(chatId);
            if (!s || s.winner) return;
            if (s.handler) sock.ev.off('messages.upsert', s.handler);
            whoSessions.delete(chatId);
            await sock.sendMessage(chatId, {
                text: `⏰ *Time's up!*\n*Answer:* ${s.data.answer.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}`,
            });
        }, 60_000);
    },
};

export default [wcg, emojiquiz, unscramble, wordle, whoami];
