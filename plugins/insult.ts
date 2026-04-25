import type { BotContext } from '../types.js';

const insults = [
    "You're like a cloud. When you disappear, it's a beautiful day!",
    "You bring everyone so much joy when you leave the room!",
    "I'd agree with you, but then we'd both be wrong.",
    "You're not stupid; you just have bad luck thinking.",
    "Your secrets are always safe with me. I never even listen to them.",
    "You're proof that even evolution takes a break sometimes.",
    "You have something on your chin... no, the third one down.",
    "You're like a software update. Whenever I see you, I think: 'Do I really need this right now?'",
    "You bring everyone happiness... you know, when you leave.",
    "You're like a penny—two-faced and not worth much.",
    "You have something on your mind... oh wait, never mind.",
    "You're the reason they put directions on shampoo bottles.",
    "You're like a cloud. Always floating around with no real purpose.",
    "Your jokes are like expired milk—sour and hard to digest.",
    "You're like a candle in the wind... useless when things get tough.",
    "You have something unique—your ability to annoy everyone equally.",
    "You're like a Wi-Fi signal—always weak when needed most.",
    "You're proof that not everyone needs a filter to be unappealing.",
    "Your energy is like a black hole—it just sucks the life out of the room.",
    "You have the perfect face for radio.",
    "You're like a traffic jam—nobody wants you, but here you are.",
    "You're like a broken pencil—pointless.",
    "Your ideas are so original, I'm sure I've heard them all before.",
    "You're living proof that even mistakes can be productive.",
    "You're not lazy; you're just highly motivated to do nothing.",
    "Your brain's running Windows 95—slow and outdated.",
    "You're like a speed bump—nobody likes you, but everyone has to deal with you.",
    "You're like a cloud of mosquitoes—just irritating.",
    "You bring people together... to talk about how annoying you are.",
    "You're like a parking ticket—nobody wants you but you keep showing up.",
    "Your potential is unlimited. Unfortunately so is your ability to waste it.",
    "If brains were gasoline, you wouldn't have enough to power a moped.",
];

export default {
    command: 'insult',
    aliases: ['roast', 'mock'],
    category: 'fun',
    description: 'Send a playful roast to someone by mentioning them or replying to their message',
    usage: '.insult @username or reply to their message',

    async handler(sock: any, message: any, _args: any, context: BotContext) {
        const { chatId, channelInfo } = context;

        try {
            let userToInsult: string | undefined;

            const ctx = message.message?.extendedTextMessage?.contextInfo;
            if (ctx?.mentionedJid?.length) {
                userToInsult = ctx.mentionedJid[0];
            } else if (ctx?.participant) {
                userToInsult = ctx.participant;
            }

            if (!userToInsult) {
                return sock.sendMessage(chatId, {
                    text: '❌ *Mention someone* or reply to their message to roast them!\n\nUsage: `.insult @username` or reply with `.insult`',
                    ...channelInfo
                }, { quoted: message });
            }

            const insult = insults[Math.floor(Math.random() * insults.length)];
            const shortJid = userToInsult.split('@')[0].split(':')[0];

            await sock.sendMessage(chatId, {
                text:
`╭───❰ *🔥 ROAST* ❱───╮

Hey @${shortJid}... 👀

_"${insult}"_

😂😂😂

╰────────────────────────────╯`,
                mentions: [userToInsult],
                ...channelInfo
            }, { quoted: message });
        } catch (error: any) {
            await sock.sendMessage(chatId, {
                text: '❌ Failed to send the roast. Please try again!',
                ...channelInfo
            }, { quoted: message });
        }
    },
};
