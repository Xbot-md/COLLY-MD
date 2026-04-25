import type { BotContext } from '../types.js';
import { getWallet } from '../lib/turso.js';
import { resolveJid } from '../lib/lidUtils.js';
import { listEffects } from '../lib/shopStore.js';

function fmtTimeLeft(ms: number): string {
  if (ms <= 0) return '✅ ready';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default {
  command: 'cooldown',
  aliases: ['cooldowns', 'cd', 'cds'],
  category: 'economy',
  description: 'Show all your active cooldowns and buffs',
  usage: '.cooldown',
  async handler(sock: any, message: any, _args: string[], context: BotContext) {
    const { chatId, channelInfo } = context;
    const userId = await resolveJid(sock, context.senderId);
    const w: any = await getWallet(userId, message.pushName || '');
    const now = Date.now();

    const lines: string[] = [];
    const workCD     = (w.workCooldownMs || 0);
    const lastWork   = (w.lastWork || 0);
    const lastDaily  = (w.lastDaily || 0);
    const lastWeekly = (w.lastWeekly || 0);
    const lastRob    = (w.lastRob || 0);
    const lastGrind  = (w.lastGrind || 0);
    const lastCollect = (w.lastCollect || 0);

    if (lastWork)    lines.push(`💼 *Work*    → ${fmtTimeLeft(lastWork + workCD - now)}`);
    if (lastDaily)   lines.push(`📅 *Daily*   → ${fmtTimeLeft(lastDaily + 24 * 3_600_000 - now)}`);
    if (lastWeekly)  lines.push(`🗓️ *Weekly*  → ${fmtTimeLeft(lastWeekly + 7 * 86_400_000 - now)}`);
    if (lastRob)     lines.push(`🥷 *Rob*     → ${fmtTimeLeft(lastRob + 3_600_000 - now)}`);
    if (lastGrind)   lines.push(`🔥 *Grind*   → ${fmtTimeLeft(lastGrind + 3_600_000 - now)}`);
    if (lastCollect) lines.push(`💰 *Collect* → ${fmtTimeLeft(lastCollect + 3_600_000 - now)}`);

    // shop effects (active buffs)
    let buffLines: string[] = [];
    try {
      const effects = await listEffects(userId);
      for (const e of effects) {
        const remaining = e.expiresAt > now ? fmtTimeLeft(e.expiresAt - now) : '✅ ready';
        buffLines.push(`✨ *${e.key}* → ${remaining}`);
      }
    } catch {}

    if (!lines.length && !buffLines.length) {
      return sock.sendMessage(chatId, {
        text: `╭───❰ ⏱️ *COOLDOWNS* ❱───╮\n│ ✅ All ready! No active cooldowns or buffs.\n╰─────────────────╯`,
        ...channelInfo
      }, { quoted: message });
    }

    return sock.sendMessage(chatId, {
      text: `╭───❰ ⏱️ *YOUR COOLDOWNS* ❱───╮\n${lines.length ? lines.map(l => '│ ' + l).join('\n') : '│ _no game cooldowns_'}\n│\n├──── 🧪 *ACTIVE BUFFS* ────┤\n${buffLines.length ? buffLines.map(l => '│ ' + l).join('\n') : '│ _no buffs active_'}\n╰─────────────────╯`,
      ...channelInfo
    }, { quoted: message });
  }
};
