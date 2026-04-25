import type { BotContext } from '../types.js';
import os from 'os';
import process from 'process';
import { collyBox } from '../lib/format.js';

export default {
  command: 'alive',
  aliases: ['status', 'bot'],
  category: 'general',
  description: 'Check bot status and system info',
  usage: '.alive',
  isPrefixless: true,

  async handler(sock: any, message: any, _args: any, context: BotContext) {
    const { chatId, config } = context;

    try {
      let uptime = Math.floor(process.uptime());
      const days = Math.floor(uptime / 86400); uptime %= 86400;
      const hours = Math.floor(uptime / 3600); uptime %= 3600;
      const minutes = Math.floor(uptime / 60);
      const seconds = uptime % 60;

      const uptimeParts: string[] = [];
      if (days) uptimeParts.push(`${days}d`);
      if (hours) uptimeParts.push(`${hours}h`);
      if (minutes) uptimeParts.push(`${minutes}m`);
      if (seconds || uptimeParts.length === 0) uptimeParts.push(`${seconds}s`);

      const uptimeText = uptimeParts.join(' ');
      const totalMem = (os.totalmem() / 1024 / 1024).toFixed(0);
      const freeMem  = (os.freemem()  / 1024 / 1024).toFixed(0);
      const usedMem  = (Number(totalMem) - Number(freeMem)).toFixed(0);
      const cpuLoad  = os.loadavg()[0].toFixed(2);

      const text = collyBox('🤖 *BOT IS ALIVE!*', [
        `✅ *Status:* Online & Ready`,
        `📦 *Version:* ${config.version}`,
        `⏱️ *Uptime:* ${uptimeText}`,
        `💾 *RAM:* ${usedMem} MB / ${totalMem} MB`,
        `⚙️ *CPU Load:* ${cpuLoad}`,
        `🖥️ *Platform:* ${os.platform()} (${os.arch()})`,
        `🟢 *Node.js:* ${process.version}`,
      ]);

      await sock.sendMessage(chatId, { text }, { quoted: message });

    } catch(error: any) {
      await sock.sendMessage(chatId, { text: '✅ Bot is alive and running!' }, { quoted: message });
    }
  }
};
