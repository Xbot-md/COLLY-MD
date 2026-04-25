import { collySignature } from '../lib/format.js';

export default {
  command: 'ping',
  aliases: ['p', 'pong'],
  category: 'general',
  description: 'Check bot response time',
  usage: '.ping',
  isPrefixless: true,

  async handler(sock: any, message: any, _args: any) {
    const start = Date.now();
    const chatId = message.key.remoteJid;

    const sent = await sock.sendMessage(chatId, { text: '🏓 Pinging...' });
    const latency = Date.now() - start;

    await sock.sendMessage(chatId, {
      text: `🏓 *Pong!*\n\n⚡ *Speed:* ${latency}ms${collySignature()}`,
      edit: sent.key
    });
  }
};
