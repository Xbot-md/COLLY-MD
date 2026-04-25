import type { BotContext } from '../types.js';

const CRASH_LINES = [
  '💥 SYSTEM PANIC — Kernel oops at 0xDEADBEEF',
  '🔥 Stack overflow in /dev/null',
  '⚠️  Segmentation fault (core dumped)',
  '🚨 Memory corruption detected — aborting',
  '💀 Fatal: cannot allocate the void',
  '🌀 Infinite recursion in TimeMachine.exe',
  '⚡ Unhandled exception: BananaNotFoundError',
  '🛑 BSOD — IRQL_NOT_LESS_OR_EQUAL'
];

export default {
  command: 'crash',
  aliases: ['boom', 'panic'],
  category: 'fun',
  description: 'Pretend to crash — fake error message for laughs (no actual crash)',
  usage: '.crash',
  async handler(sock: any, message: any, _args: string[], context: BotContext) {
    const { chatId, channelInfo } = context;
    const lines = [];
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      lines.push(CRASH_LINES[Math.floor(Math.random() * CRASH_LINES.length)]);
    }
    const stack = `\nat handler (line ${100 + Math.floor(Math.random() * 9000)})\nat process (node:internal/${Math.random().toString(36).slice(2, 10)})\nat <anonymous>`;
    return sock.sendMessage(chatId, {
      text: `╭───❰ 💥 *CRASH* ❱───╮\n${lines.map(l => '│ ' + l).join('\n')}\n│${stack.split('\n').map(l => '\n│ ' + l).join('')}\n│\n│ ✅ _Just kidding — bot is fine._\n╰─────────────────╯`,
      ...channelInfo
    }, { quoted: message });
  }
};
