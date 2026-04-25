import type { BotContext } from '../types.js';
import store from '../lib/lightweight_store.js';

export default [
  {
    command: 'onhere',
    aliases: ['boton', 'enablebot'],
    category: 'admin',
    description: 'Enable the bot in this group only',
    usage: '.onhere',
    groupOnly: true,
    adminOnly: true,
    async handler(sock: any, message: any, _args: any[], context: BotContext) {
      const { chatId, channelInfo } = context;
      await store.saveSetting(chatId, 'bot_enabled', { enabled: true });
      await sock.sendMessage(chatId, {
        text: `╭───❰ *BOT STATUS* ❱───╮\n│ ✅ Bot is now *ON* in this group\n│ Commands will respond here.\n╰─────────────────╯`,
        ...channelInfo
      }, { quoted: message });
    }
  },
  {
    command: 'offhere',
    aliases: ['botoff', 'disablebot'],
    category: 'admin',
    description: 'Disable the bot in this group only (owner/sudo can still use)',
    usage: '.offhere',
    groupOnly: true,
    adminOnly: true,
    async handler(sock: any, message: any, _args: any[], context: BotContext) {
      const { chatId, channelInfo } = context;
      await store.saveSetting(chatId, 'bot_enabled', { enabled: false });
      await sock.sendMessage(chatId, {
        text: `╭───❰ *BOT STATUS* ❱───╮\n│ 🚫 Bot is now *OFF* in this group\n│ Only owner/sudo commands work here.\n╰─────────────────╯`,
        ...channelInfo
      }, { quoted: message });
    }
  }
];
