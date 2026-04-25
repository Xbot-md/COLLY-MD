import type { BotContext } from '../types.js';
import CommandHandler from '../lib/commandHandler.js';
import { collySignature } from '../lib/format.js';

export default {
  command: 'perf',
  aliases: ['metrics', 'diagnostics'],
  category: 'general',
  description: 'View command performance and error metrics',
  usage: '.perf',
  ownerOnly: true,

  async handler(sock: any, message: any, _args: any, context: BotContext) {
    const chatId = context.chatId || message.key.remoteJid;

    try {
      const report = CommandHandler.getDiagnostics();

      if (!report || report.length === 0) {
        return await sock.sendMessage(chatId, { text: '_No performance data collected yet._' }, { quoted: message });
      }

      let text = `📊 *COLLY MD — PLUGIN PERFORMANCE*\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      report.forEach((cmd: any, index: number) => {
        const errorText = cmd.errors > 0 ? `❗ ${cmd.errors} error(s)` : `✅ Clean`;
        text += `${index + 1}. *${cmd.command.toUpperCase()}*\n`;
        text += `   ↳ Calls: ${cmd.usage}\n`;
        text += `   ↳ Latency: ${cmd.average_speed}\n`;
        text += `   ↳ Status: ${errorText}\n\n`;
      });

      text += collySignature();

      await sock.sendMessage(chatId, { text: text.trim() }, { quoted: message });

    } catch(error: any) {
      await sock.sendMessage(chatId, { text: '❌ Failed to fetch performance metrics.' }, { quoted: message });
    }
  }
};
