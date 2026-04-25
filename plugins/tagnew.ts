import type { BotContext } from '../types.js';
import fs from 'fs';
import path from 'path';

const STORE_PATH = path.join(process.cwd(), 'data', 'recent_joins.json');

function loadStore(): Record<string, { jid: string; ts: number }[]> {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch { return {}; }
}

function saveStore(data: Record<string, { jid: string; ts: number }[]>) {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(data));
  } catch (e) { console.error('[tagnew] save failed:', e); }
}

export function trackJoin(groupId: string, jid: string) {
  const data = loadStore();
  if (!data[groupId]) data[groupId] = [];
  data[groupId].push({ jid, ts: Date.now() });
  // keep last 50
  data[groupId] = data[groupId].slice(-50);
  saveStore(data);
}

export default {
  command: 'tagnew',
  aliases: ['newmembers', 'tagrecent'],
  category: 'admin',
  description: 'Tag members who joined recently (default: last 7 days, max 30)',
  usage: '.tagnew [days]',
  groupOnly: true,
  adminOnly: true,
  async handler(sock: any, message: any, args: string[], context: BotContext) {
    const { chatId, channelInfo } = context;
    const days = Math.max(1, Math.min(30, Number(args[0]) || 7));
    const cutoff = Date.now() - days * 86400_000;

    const data = loadStore();
    const recent = (data[chatId] || []).filter(e => e.ts >= cutoff);

    if (!recent.length) {
      return sock.sendMessage(chatId, {
        text: `📭 No new members tracked in the last ${days} day${days !== 1 ? 's' : ''}.\n_Joins are tracked from when the bot is online._`,
        ...channelInfo
      }, { quoted: message });
    }

    const seen = new Set<string>();
    const unique = recent.filter(e => !seen.has(e.jid) && seen.add(e.jid));
    const mentions = unique.map(e => e.jid);
    const lines = unique.map((e, i) => {
      const ago = Math.floor((Date.now() - e.ts) / 86400_000);
      return `${i + 1}. @${e.jid.split('@')[0]} — ${ago === 0 ? 'today' : ago + 'd ago'}`;
    });

    await sock.sendMessage(chatId, {
      text: `╭───❰ 👋 *NEW MEMBERS* ❱───╮\n│ 🗓️ Last ${days} day${days !== 1 ? 's' : ''}\n│ 👥 ${unique.length} member${unique.length !== 1 ? 's' : ''}\n╰─────────────────╯\n\n${lines.join('\n')}`,
      mentions,
      ...channelInfo
    }, { quoted: message });
  }
};
