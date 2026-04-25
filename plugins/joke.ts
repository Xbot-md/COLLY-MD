import type { BotContext } from '../types.js';

const FALLBACK_JOKES = [
    { setup: "Why don't scientists trust atoms?", punchline: "Because they make up everything!" },
    { setup: "Why did the scarecrow win an award?", punchline: "Because he was outstanding in his field!" },
    { setup: "I told my wife she should embrace her mistakes.", punchline: "She gave me a hug." },
    { setup: "What do you call a fake noodle?", punchline: "An impasta!" },
    { setup: "Why can't you give Elsa a balloon?", punchline: "Because she'll let it go!" },
    { setup: "I'm reading a book about anti-gravity.", punchline: "It's impossible to put down!" },
    { setup: "Why did the bicycle fall over?", punchline: "Because it was two-tired!" },
    { setup: "What do you call cheese that isn't yours?", punchline: "Nacho cheese!" },
    { setup: "I used to hate facial hair.", punchline: "But then it grew on me." },
    { setup: "Why don't eggs tell jokes?", punchline: "They'd crack each other up!" },
];

export default {
    command: 'joke',
    aliases: ['jokes', 'funny', 'dadjoke'],
    category: 'fun',
    description: 'Get a random joke',
    usage: '.joke',

    async handler(sock: any, message: any, _args: any, context: BotContext) {
        const { chatId, channelInfo } = context;

        try {
            await sock.sendPresenceUpdate('composing', chatId);

            let setup = '';
            let punchline = '';
            let fetched = false;

            try {
                const res = await fetch('https://official-joke-api.appspot.com/random_joke', {
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(8000),
                });
                if (res.ok) {
                    const data = await res.json() as any;
                    setup = data.setup || '';
                    punchline = data.punchline || '';
                    fetched = !!setup;
                }
            } catch {}

            if (!fetched) {
                try {
                    const res = await fetch('https://icanhazdadjoke.com/', {
                        headers: { 'Accept': 'application/json' },
                        signal: AbortSignal.timeout(8000),
                    });
                    if (res.ok) {
                        const data = await res.json() as any;
                        if (data.joke) {
                            setup = data.joke;
                            punchline = '';
                            fetched = true;
                        }
                    }
                } catch {}
            }

            if (!fetched) {
                const fb = FALLBACK_JOKES[Math.floor(Math.random() * FALLBACK_JOKES.length)];
                setup = fb.setup;
                punchline = fb.punchline;
            }

            const jokeText = punchline
                ? `*Q:* ${setup}\n\n*A:* ${punchline}`
                : setup;

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *😂 JOKE TIME* ❱───╮

${jokeText}

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        } catch (error: any) {
            await sock.sendMessage(chatId, {
                text: '❌ Could not fetch a joke right now. Please try again later.',
                ...channelInfo
            }, { quoted: message });
        }
    },
};
