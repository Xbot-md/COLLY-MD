import type { BotContext } from '../types.js';
import axios from 'axios';
import { collySignature } from '../lib/format.js';

export default {
  command: 'pair',
  aliases: ['paircode', 'session', 'getsession', 'sessionid'],
  category: 'general',
  description: 'Get session id for COLLY MD',
  usage: '.pair 2349133354644',

  async handler(sock: any, message: any, args: any, context: BotContext) {
    const { chatId } = context;

    const query = args.join('').trim();
    if (!query) {
      return await sock.sendMessage(chatId, {
        text: `❌ *Missing Number*\nExample: .pair 2349133354644${collySignature()}`
      }, { quoted: message });
    }

    const number = query.replace(/[^0-9]/g, '');

    if (number.length < 10 || number.length > 15) {
      return await sock.sendMessage(chatId, {
        text: `❌ *Invalid Format*\nPlease provide the number with country code but without + or spaces.${collySignature()}`
      }, { quoted: message });
    }

    await sock.sendMessage(chatId, {
      text: `⚡ *Requesting pairing code from server...*`
    }, { quoted: message });

    try {
      const response = await axios.get(`https://mega-pairing.onrender.com/pair?number=${number}`, {
        timeout: 60000
      });

      if (response.data && response.data.code) {
        const pairingCode = response.data.code;

        if (pairingCode.includes("Unavailable") || pairingCode.includes("Error")) {
          throw new Error("Server is busy");
        }

        const successText =
          `✅ *COLLY MD — PAIRING CODE*\n\n` +
          `🔑 *Code:* \`${pairingCode}\`\n\n` +
          `*📋 How to link:*\n` +
          `1. Open WhatsApp ⚙️ Settings\n` +
          `2. Tap *Linked Devices*\n` +
          `3. Tap *Link a Device*\n` +
          `4. Choose *Link with phone number*\n` +
          `5. Enter the code above` +
          collySignature();

        await sock.sendMessage(chatId, { text: successText }, { quoted: message });

      } else {
        throw new Error("Invalid response format");
      }

    } catch(error: any) {
      let errorMsg = `❌ *Pairing Failed*\n\n`;
      if (error.code === 'ECONNABORTED') {
        errorMsg += "⏱️ Server timeout. Please try again in 1 minute.";
      } else if (error.response?.status === 400) {
        errorMsg += "📵 Invalid phone number format.";
      } else {
        errorMsg += "🔌 The server is currently offline or busy. Try again later.";
      }
      errorMsg += collySignature();

      await sock.sendMessage(chatId, { text: errorMsg }, { quoted: message });
    }
  }
};
