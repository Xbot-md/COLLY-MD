import type { BotContext } from '../types.js';
import store from '../lib/lightweight_store.js';

export default [
  {
    command: 'antiedit',
    aliases: ['antiedits', 'editlog'],
    category: 'admin',
    description: 'Toggle anti-edit on/off — when on, edited messages are exposed in this group',
    usage: '.antiedit on | .antiedit off',
    groupOnly: true,
    adminOnly: true,
    async handler(sock: any, message: any, args: string[], context: BotContext) {
      const { chatId, channelInfo } = context;
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'on' || sub === 'enable') {
        await store.saveSetting(chatId, 'antiedit', { enabled: true });
        return sock.sendMessage(chatId, {
          text: `╭───❰ ✏️ *ANTI-EDIT* ❱───╮\n│ ✅ *ON* — edited messages will be exposed in this group.\n╰─────────────────╯`,
          ...channelInfo
        }, { quoted: message });
      }

      if (sub === 'off' || sub === 'disable') {
        await store.saveSetting(chatId, 'antiedit', { enabled: false });
        return sock.sendMessage(chatId, {
          text: `╭───❰ ✏️ *ANTI-EDIT* ❱───╮\n│ 🚫 *OFF* — edits will no longer be exposed.\n╰─────────────────╯`,
          ...channelInfo
        }, { quoted: message });
      }

      const current = await store.getSetting(chatId, 'antiedit');
      const status = current?.enabled ? '✅ ON' : '🚫 OFF';
      return sock.sendMessage(chatId, {
        text: `╭───❰ ✏️ *ANTI-EDIT STATUS* ❱───╮\n│ Current: ${status}\n│ Toggle: .antiedit on | .antiedit off\n╰─────────────────╯`,
        ...channelInfo
      }, { quoted: message });
    }
  }
];
