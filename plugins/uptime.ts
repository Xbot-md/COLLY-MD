import { collyBox } from '../lib/format.js';

export default {
  command: 'uptime',
  aliases: ['runtime'],
  category: 'general',
  description: 'Show bot uptime and status information',
  usage: '.uptime',
  isPrefixless: true,

  async handler(sock: any, message: any) {
    const chatId = message.key.remoteJid;
    const commandHandler = (await import('../lib/commandHandler.js')).default;
    const uptimeMs = process.uptime() * 1000;

    const sec = Math.floor(uptimeMs / 1000) % 60;
    const min = Math.floor(uptimeMs / (1000 * 60)) % 60;
    const hr  = Math.floor(uptimeMs / (1000 * 60 * 60)) % 24;
    const day = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));

    const parts: string[] = [];
    if (day) parts.push(`${day}d`);
    if (hr) parts.push(`${hr}h`);
    if (min) parts.push(`${min}m`);
    parts.push(`${sec}s`);

    const uptimeStr = parts.join(' ');
    const startedAt = new Date(Date.now() - uptimeMs).toLocaleString();
    const ramMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
    const commandCount = commandHandler.commands.size;

    const text = collyBox('⏱️ *BOT UPTIME*', [
      `🟢 *Running:* ${uptimeStr}`,
      `🚀 *Started:* ${startedAt}`,
      `📦 *Plugins:* ${commandCount}`,
      `💾 *RAM Usage:* ${ramMb} MB`,
    ]);

    await sock.sendMessage(chatId, { text }, { quoted: message });
  }
};
