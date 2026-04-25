import type { BotContext } from '../types.js';

export default {
  command: 'forwarded',
  aliases: ['viral', 'fakeforward'],
  category: 'tools',
  description: 'Send text with a fake "Frequently Forwarded" tag',
  usage: '.viral <text> OR reply to a message',

  async handler(sock: any, message: any, args: any, context: BotContext) {
    const chatId = context.chatId || message.key.remoteJid;

    try {
      let txt = "";
      const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;

      if (quoted) {
        txt = quoted.conversation ||
              quoted.extendedTextMessage?.text ||
              quoted.imageMessage?.caption ||
              quoted.videoMessage?.caption ||
              "";
      }

      if (!txt || txt.trim() === "") {
        txt = args?.join(' ') || "";
      }

      if (!txt || txt.trim() === "") {
        return await sock.sendMessage(chatId, {
          text: 'Please provide text or reply to a message to forward.'
        }, { quoted: message });
      }

      await sock.sendMessage(chatId, {
        text: txt
      });

    } catch(err: any) {
      console.error('Forwarding Spoof Error:', err);
      await sock.sendMessage(chatId, { text: '❌ Failed to spoof forwarding.' });
    }
  }
};

