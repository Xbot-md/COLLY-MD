import type { BotContext } from '../types.js';

const FLIRTS = [
  "Are you a magician? Because every time I look at you, everyone else disappears.",
  "Do you have a name, or can I call you mine?",
  "If beauty were time, you'd be eternity.",
  "Is your dad a boxer? Because you're a knockout.",
  "I must be a snowflake, because I've fallen for you.",
  "Are you a parking ticket? Because you've got 'fine' written all over you.",
  "If kisses were snowflakes, I'd send you a blizzard.",
  "Do you believe in love at first sight, or should I walk by again?",
  "Is your name Google? Because you have everything I've been searching for.",
  "Are you French? Because Eiffel for you.",
  "Do you have a map? Because I just got lost in your eyes.",
  "Are you Wi-Fi? Because I'm feeling a connection.",
  "If you were a vegetable, you'd be a cute-cumber.",
  "Are you a campfire? Because you're hot and I want s'more.",
  "Are you a bank loan? Because you have my interest.",
  "Are you Australian? Because you meet all of my koala-fications.",
  "I'm not a photographer, but I can picture us together.",
  "Do you have a Band-Aid? Because I just scraped my knee falling for you.",
  "If I could rearrange the alphabet, I'd put U and I together.",
  "Are you a star? Because your beauty lights up the night.",
  "Even on my worst days, your smile still makes everything okay.",
  "Are you made of copper and tellurium? Because you're Cu-Te.",
  "If you were words on a page, you'd be fine print.",
  "Roses are red, violets are fine, you be the six, and I'll be the nine.",
  "I'm learning about important dates in history. Wanna be one of them?",
  "If I had a star for every time you brightened my day, I'd have a galaxy in my hand.",
  "Did the sun come out, or did you just smile at me?",
  "I was wondering if you had an extra heart — mine seems to have been stolen.",
  "Are you a time traveler? Because I see you in my future.",
  "If you were a triangle you'd be acute one."
];

export default {
  command: 'flirt',
  aliases: ['flirty', 'pickuplines'],
  category: 'fun',
  description: 'Get a random English flirt line',
  usage: '.flirt',
  async handler(sock: any, message: any, _args: any, context: BotContext) {
    const chatId = context.chatId || message.key.remoteJid;
    const line = FLIRTS[Math.floor(Math.random() * FLIRTS.length)];
    await sock.sendMessage(chatId, { text: `💘 ${line}` }, { quoted: message });
  }
};
