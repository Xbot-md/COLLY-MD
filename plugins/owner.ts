import type { BotContext } from '../types.js';

export default {
  command: 'owner',
  aliases: ['creator'],
  category: 'info',
  description: 'Get the contact of the bot owner and creator',
  usage: '.owner',

  async handler(sock: any, message: any, args: any, context: BotContext) {
    const chatId = context.chatId || message.key.remoteJid;
    const config = context.config;

    try {
      const ownerVcard = `BEGIN:VCARD
VERSION:3.0
FN:${config.botOwner}
TEL;waid=${config.ownerNumber2}:${config.ownerNumber2}
END:VCARD`;

      const creatorVcard = `BEGIN:VCARD
VERSION:3.0
FN:${config.author}
TEL;waid=${config.ownerNumber}:${config.ownerNumber}
END:VCARD`;

      await sock.sendMessage(chatId, {
        contacts: {
          displayName: `${config.botOwner} & ${config.author}`,
          contacts: [
            { vcard: ownerVcard },
            { vcard: creatorVcard },
          ],
        },
      }, { quoted: message });
    } catch (error: any) {
      console.error('Owner Command Error:', error);
      await sock.sendMessage(chatId, {
        text: '❌ Failed to fetch owner contact.'
      }, { quoted: message });
    }
  }
};
