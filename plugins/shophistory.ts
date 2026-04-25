import type { BotContext } from '../types.js';
import { resolveJid } from '../lib/lidUtils.js';
import {
  getShopOwner, getShopHistory, getShopUnpaidDays,
  getShopAnalytics, SHOP_RATES, SHOP_SEIZE_AFTER_DAYS
} from '../lib/shopStore.js';
import { fmtCoins, shopMeta, findItem } from '../lib/shopCatalog.js';
import isOwnerOrSudo from '../lib/isOwner.js';

const MIN_DAYS = 7;
const MAX_RECENT_SALES = 12;

const SHOP_ALIASES: Record<string, string> = {
  supermarket: 'supermarket', super: 'supermarket', mart: 'supermarket', store: 'supermarket',
  drug: 'drug', drugs: 'drug', drugshop: 'drug', pharmacy: 'drug',
  bmarket: 'market', blackmarket: 'market', black: 'market', bm: 'market', market: 'market',
};

function parseShop(arg?: string): string | null {
  if (!arg) return null;
  const k = arg.toLowerCase().replace(/[^a-z]/g, '');
  return SHOP_ALIASES[k] || null;
}

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

function itemName(itemId: string | null): string {
  if (!itemId) return 'unknown';
  const it = findItem(itemId);
  return it ? it.name : itemId.replace(/_/g, ' ');
}

export default {
  command: 'shophistory',
  aliases: ['shoplog', 'shopstats', 'shopledger'],
  category: 'economy',
  description: 'Shop owner: detailed sales + expenses panel for your shop. Min window 7 days.',
  usage: '.shophistory <shop> <days>',

  async handler(sock: any, message: any, args: string[], context: BotContext) {
    const { chatId, channelInfo } = context;
    const senderJid = await resolveJid(sock, context.senderId);

    const shop = parseShop(args[0]);
    if (!shop) {
      return sock.sendMessage(chatId, {
        text: `❌ Usage: *.shophistory <shop> <days>*\n\nShops: supermarket, drugshop, bmarket\n_Min window: ${MIN_DAYS} days_\n\nExample: .shophistory supermarket 7`,
        ...channelInfo
      }, { quoted: message });
    }

    const numTok = args.slice(1).find(a => /^\d+$/.test(a));
    const days = numTok ? parseInt(numTok, 10) : 0;
    if (!days) {
      return sock.sendMessage(chatId, {
        text: `❌ Specify how many days to look back (minimum *${MIN_DAYS}*).\n\nExample: *.shophistory ${shop} 7*`,
        ...channelInfo
      }, { quoted: message });
    }
    if (days < MIN_DAYS) {
      return sock.sendMessage(chatId, {
        text: `🔒 Minimum lookback window is *${MIN_DAYS} days* (you asked for ${days}).\n\n_This protects customer privacy on short-term purchases._`,
        ...channelInfo
      }, { quoted: message });
    }

    const ownerJid = await getShopOwner(shop);
    const meta = shopMeta(shop as any);
    if (!ownerJid) {
      return sock.sendMessage(chatId, {
        text: `${meta.emoji} *${meta.title}* has no owner yet.\n_Bot owners can assign one with .setshopowner ${shop} @user_`,
        ...channelInfo
      }, { quoted: message });
    }
    const senderIsBotOwner = await isOwnerOrSudo(senderJid, sock, chatId).catch(() => false);
    if (senderJid !== ownerJid && !senderIsBotOwner) {
      return sock.sendMessage(chatId, {
        text: `🚫 Only the owner of *${meta.title}* (@${ownerJid.split('@')[0]}) can view its history.`,
        mentions: [ownerJid], ...channelInfo
      }, { quoted: message });
    }

    const sinceMs = days * 86_400_000;
    const [h, a] = await Promise.all([
      getShopHistory(shop, sinceMs),
      getShopAnalytics(shop, sinceMs)
    ]);
    const rates = SHOP_RATES[shop];
    const unpaid = await getShopUnpaidDays(shop);
    const periodStart = Date.now() - sinceMs;

    // Stub categories not yet wired (theft/hacks/staff/auto-restock/security/insurance)
    const staffWages   = 0;
    const restockCost  = 0;
    const securityCost = 0;
    const insuranceCost = 0;
    const theftLosses  = 0;

    const expensesTotal = h.tax + h.rent + h.electricity + staffWages + restockCost + securityCost + insuranceCost + theftLosses;
    const net = h.income - expensesTotal;
    const margin = h.income > 0 ? Math.round((net / h.income) * 1000) / 10 : 0;
    const dailyAvg = Math.round(net / days);

    const sales = h.transactions.filter(t => t.type === 'sale').slice(0, MAX_RECENT_SALES);
    const mentions: string[] = [ownerJid, ...sales.map(s => s.user_id).filter(Boolean) as string[]];

    let salesBlock = '';
    if (sales.length === 0) {
      salesBlock = '_no sales in this window_\n';
    } else {
      sales.forEach(s => {
        const name = s.user_id ? `@${s.user_id.split('@')[0]}` : 'unknown';
        const item = itemName(s.item_id);
        const qty = s.qty || 1;
        salesBlock += `${pad(ago(s.ts), 7)} ${pad(name, 18)} ${pad(`${item} x${qty}`, 24)} +${fmtCoins(s.amount)} 🪙\n`;
      });
    }

    const tier = 1; // TODO: per-shop tier system
    const peakStr = a.peakHour ? `${String(a.peakHour.hour).padStart(2, '0')}:00-${String((a.peakHour.hour + 1) % 24).padStart(2, '0')}:00 UTC` : '—';
    const topStr  = a.topItem ? `${itemName(a.topItem.item_id)} [${a.topItem.units} sold]` : '—';
    const bestDayStr = a.bestDay ? `${a.bestDay.date.slice(5)} — ${fmtCoins(a.bestDay.revenue)} 🪙` : '—';
    const warnLine = unpaid > 0
      ? `⚠️  ${unpaid}/${SHOP_SEIZE_AFTER_DAYS} days behind on bills — shop will be seized at ${SHOP_SEIZE_AFTER_DAYS}.\n\n`
      : '';

    const text =
`╔════════════════════════════════════════╗
║ 📊 ${meta.title.toUpperCase()} — ${days}D HISTORY
╚════════════════════════════════════════╝
Owner: @${ownerJid.split('@')[0]} | Tier ${tier} | Auto-Restock: OFF
Period: ${fmtDate(periodStart)} - ${fmtDate(Date.now())}

[ 💰 FINANCIALS ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Gross Income:  ${fmtCoins(h.income)} 🪙  [${h.salesCount} sales]
Total Expenses: -${fmtCoins(expensesTotal)} 🪙
├─ Tax [${Math.round(rates.tax * 100)}%]:        ${fmtCoins(h.tax)} 🪙
├─ Rent:             ${fmtCoins(h.rent)} 🪙
├─ Electricity:      ${fmtCoins(h.electricity)} 🪙
├─ Staff Wages:      ${fmtCoins(staffWages)} 🪙   _(coming soon)_
├─ Auto-Restock:     ${fmtCoins(restockCost)} 🪙   _(coming soon)_
├─ Security:         ${fmtCoins(securityCost)} 🪙   _(coming soon)_
├─ Insurance:        ${fmtCoins(insuranceCost)} 🪙   _(coming soon)_
└─ Theft Losses:     ${fmtCoins(theftLosses)} 🪙   _(coming soon)_

${net >= 0 ? '✨' : '🔻'} *Net Profit: ${net >= 0 ? '+' : '-'}${fmtCoins(Math.abs(net))} 🪙*  |  Margin: ${margin}%
Daily Avg: ${dailyAvg >= 0 ? '+' : '-'}${fmtCoins(Math.abs(dailyAvg))} 🪙

[ 📈 STATS ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Top Seller:    ${topStr}
Peak Hour:     ${peakStr}
Customers:     ${a.uniqueCustomers} unique | ${a.returnRatePct}% return rate
Best Day:      ${bestDayStr}
Security:      _coming soon (hack/steal logging not wired)_

[ 🧾 RECENT SALES ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${salesBlock}
[ ⚙️ SHOP STATUS ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Auto-Restock:   OFF  _(coming soon)_
Stock Status:   All items in stock
Security Lv:    1 (default)
Insurance:      Inactive  _(coming soon)_
Daily fixed:    ${fmtCoins(rates.rent + rates.electricity)} 🪙/day

${warnLine}╭───❰ COMMANDS ❱───╮
│ .shophistory ${shop} <days>
│ .setshopowner ${shop} @user
│ .shop ${shop}
╰─────────────────╯`;

    return sock.sendMessage(chatId, { text, mentions, ...channelInfo }, { quoted: message });
  }
};
