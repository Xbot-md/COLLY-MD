import type { BotContext } from '../types.js';
import { getWallet, saveWallet, addToEcoVault, isBlacklisted } from '../lib/turso.js';
import { resolveJid } from '../lib/lidUtils.js';
import {
  CATALOG, CatalogItem, ShopId, findItem, itemsByShop, shopMeta, fmtCoins
} from '../lib/shopCatalog.js';
import {
  initShopTables, addToInventory, removeFromInventory, getInventoryQty, getInventory,
  createReceipt, getReceipt, getReceiptHistory, setEffect, getEffect, clearEffect,
  setShopOwner, getShopOwner, getAllShopOwners, getScalingUses, bumpScalingUses
} from '../lib/shopStore.js';

const VAT_RATE = 0.18;

function parseShopArg(s: string | undefined): ShopId | null {
  if (!s) return null;
  const x = s.toLowerCase();
  if (['supermarket', 'super', 'ns', 'nathaniel'].includes(x)) return 'supermarket';
  if (['drug', 'drugs', 'pharmacy'].includes(x)) return 'drug';
  if (['market', 'black', 'blackmarket', 'bm'].includes(x)) return 'market';
  if (['hunter', 'hunterassociation', 'ha', 'sl', 'sololeveling'].includes(x)) return 'hunter';
  return null;
}

function parseDuration(amount: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('min')) return amount * 60_000;
  if (u.startsWith('h'))   return amount * 3_600_000;
  if (u.startsWith('d'))   return amount * 86_400_000;
  return amount * 60_000;
}

async function getDiscountPct(userId: string): Promise<number> {
  const e = await getEffect(userId, 'discount_card');
  return e ? Number(e.data?.pct || 0) : 0;
}

function renderShop(shop: ShopId, items: CatalogItem[]): string {
  const meta = shopMeta(shop);
  if (meta.comingSoon && !items.length) {
    return `╭───❰ ${meta.emoji} *${meta.title.toUpperCase()}* ❱───╮\n│ 🚧 *Coming soon*\n│ Item catalog not yet loaded.\n╰─────────────────╯`;
  }
  const head =
`╔══════════════════════════════════════════════════╗
║   ${meta.emoji} *${meta.title.toUpperCase()}* ${meta.emoji}
╚══════════════════════════════════════════════════╝
*All prices include ${Math.round(VAT_RATE * 100)}% VAT*
`;
  const grouped = new Map<string, CatalogItem[]>();
  for (const it of items) {
    if (!grouped.has(it.category)) grouped.set(it.category, []);
    grouped.get(it.category)!.push(it);
  }
  const sections: string[] = [];
  for (const [cat, list] of grouped) {
    let block = `\n[ ${cat} ]\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const it of list) {
      const price = fmtCoins(it.price) + ' 🪙';
      block += `\n*${it.name}*  ─  ${price}\n  ↳ ${it.desc} | .buy ${it.id}`;
    }
    sections.push(block);
  }
  const footer = `\n\n╭───❰ 🛒 *COMMANDS* ❱───╮\n│ .buy <item> [qty]\n│ .use <item>\n│ .inventory\n│ .gift @user <item> [qty]\n│ .sell <item> [qty]\n│ .shop history <n> <unit>\n│ .shop receipt <ID>\n╰─────────────────╯`;
  return head + sections.join('\n') + footer;
}

function renderReceipt(r: any, item: CatalogItem, customerName: string): string {
  const date = new Date(Number(r.ts)).toISOString().slice(0, 16).replace('T', ' ');
  const meta = shopMeta(r.shop as ShopId);
  return (
`╔══════════════════════════════════╗
║   ${meta.emoji} *${meta.title.toUpperCase()}* ${meta.emoji}
║  (Pty) Ltd | VAT: 4123456789
╚══════════════════════════════════╝
Reg: 2024/123456/07
Date: ${date}
Invoice: ${r.id} | Customer: ${customerName}
──────────────────────────────────
*ITEM:* ${item.name} x${r.qty}     *${fmtCoins(Number(r.unit_price))} 🪙*
.use ${item.id} → ${item.desc}
──────────────────────────────────
*TOTAL PAID*          *${Number(r.total).toLocaleString('en-US')} 🪙*
──────────────────────────────────
1️⃣ VAT ${Math.round(VAT_RATE * 100)}% → SARS  *-${Number(r.vat).toLocaleString('en-US')} 🪙*
──────────────────────────────────
✅ *PAID* | 📦 Added to .inventory
⚡ *READY:* .use ${item.id}
──────────────────────────────────
*Prices incl. VAT. E&OE*
🇿🇦 Proudly SA | +27 78 288 8166`
  );
}

// ── Effect application ────────────────────────────────────────────────────
async function applyEffect(userId: string, item: CatalogItem): Promise<string> {
  const eff = item.effect;
  switch (eff.kind) {
    case 'buff': {
      await setEffect(userId, `buff_${eff.stat}_${item.id}`, { mult: eff.mult, flat: eff.flat, item: item.id }, eff.durationMs);
      return `✨ Buff active: ${eff.note || item.desc}`;
    }
    case 'cure': {
      await clearEffect(userId, `status_${eff.status}`);
      return `✅ Status '${eff.status}' removed.`;
    }
    case 'unlock': {
      await setEffect(userId, `unlock_${eff.feature}`, { item: item.id }, 0);
      return `🔓 Feature unlocked: *${eff.feature}*`;
    }
    case 'cooldown_skip': {
      const w = await getWallet(userId);
      w.lastWork = 0; w.workCooldownMs = 0;
      await saveWallet(w);
      return `⏭️ Skipped current work cooldown (${eff.charges - 1} charges remain — store the rest as buff).`;
    }
    case 'cooldown_reset_all': {
      const w = await getWallet(userId);
      w.lastWork = 0; w.lastDaily = 0; w.lastRob = 0; w.workCooldownMs = 0;
      await saveWallet(w);
      await bumpScalingUses(item.id);
      return `🌀 ALL cooldowns reset. Bills/Tax cleared.`;
    }
    case 'gamble': {
      const win = Math.floor(eff.min + Math.random() * (eff.max - eff.min));
      const w = await getWallet(userId); w.balance += win; await saveWallet(w);
      return `🎰 You won *${win.toLocaleString('en-US')} 🪙*!`;
    }
    case 'level_swing': {
      const swing = Math.floor(eff.min + Math.random() * (eff.max - eff.min + 1));
      const w = await getWallet(userId); w.level = Math.max(1, (w.level || 1) + swing); await saveWallet(w);
      return `🧪 Level changed by *${swing >= 0 ? '+' + swing : swing}* → now lvl ${w.level}`;
    }
    case 'shield':
      await setEffect(userId, 'shield', { item: item.id }, eff.durationMs);
      return `🛡️ Rob shield active.`;
    case 'curse':
      await setEffect(userId, 'curse', { penalty: eff.penalty }, eff.durationMs);
      return `🧿 Curse contract active — robbers lose ${eff.penalty.toLocaleString()} 🪙.`;
    case 'insurance':
      await setEffect(userId, 'insurance', { pct: eff.pct }, eff.durationMs);
      return `📄 Theft insurance active (${Math.round(eff.pct * 100)}% recovery).`;
    case 'poor_status':
      await setEffect(userId, 'status_poor', { item: item.id }, eff.durationMs);
      return `🥲 'Poor' status active — unrobbable.`;
    case 'crime_tool':
      await setEffect(userId, `tool_${eff.tool}`, { uses: 1 }, 0);
      return `🛠️ Tool ready: *${eff.tool}*. Use the matching crime command.`;
    case 'discount_card':
      await setEffect(userId, 'discount_card', { pct: eff.pct }, eff.durationMs);
      return `💳 Discount card active (${Math.round(eff.pct * 100)}% off, ${Math.round(eff.durationMs / 86_400_000)} days).`;
    case 'instant_xp': {
      const w = await getWallet(userId); w.xp = (w.xp || 0) + eff.amount; await saveWallet(w);
      return `⭐ +${eff.amount} XP gained!`;
    }
    case 'note':
      return `📝 ${eff.text}`;
  }
}

export default [
  // ─── .shop ───────────────────────────────────────────────────────────────
  {
    command: 'shop',
    aliases: ['shops', 'store'],
    category: 'economy',
    description: 'View shop catalog. Usage: .shop <supermarket|drug|market>',
    usage: '.shop supermarket',
    async handler(sock: any, message: any, args: string[], context: BotContext) {
      const { chatId, channelInfo } = context;
      await initShopTables();

      // Sub-routes: history, receipt
      if ((args[0] || '').toLowerCase() === 'history') {
        const userId = await resolveJid(sock, context.senderId);
        const n = Math.max(1, Number(args[1]) || 24);
        const unit = args[2] || 'hour';
        const sinceMs = parseDuration(n, unit);
        const rows = await getReceiptHistory(userId, sinceMs);
        if (!rows.length) {
          return sock.sendMessage(chatId, { text: `📭 No purchases in the last ${n} ${unit}.`, ...channelInfo }, { quoted: message });
        }
        const lines = rows.map(r => `• ${r.id} — ${r.item_id} x${r.qty} — ${Number(r.total).toLocaleString()} 🪙`);
        return sock.sendMessage(chatId, { text: `╭───❰ 🧾 *PURCHASE HISTORY* ❱───╮\n│ Last ${n} ${unit} | ${rows.length} items\n╰─────────────────╯\n\n${lines.join('\n')}`, ...channelInfo }, { quoted: message });
      }
      if ((args[0] || '').toLowerCase() === 'receipt') {
        const id = (args[1] || '').toUpperCase();
        if (!id) return sock.sendMessage(chatId, { text: '❌ Usage: .shop receipt <ID>', ...channelInfo }, { quoted: message });
        const r = await getReceipt(id);
        if (!r) return sock.sendMessage(chatId, { text: `❌ Receipt ${id} not found.`, ...channelInfo }, { quoted: message });
        const item = findItem(String(r.item_id));
        if (!item) return sock.sendMessage(chatId, { text: `❌ Item on receipt no longer exists.`, ...channelInfo }, { quoted: message });
        const customer = `@${String(r.user_id).split('@')[0]}`;
        return sock.sendMessage(chatId, { text: renderReceipt(r, item, customer), mentions: [String(r.user_id)], ...channelInfo }, { quoted: message });
      }

      const shop = parseShopArg(args[0]);
      if (!shop) {
        return sock.sendMessage(chatId, {
          text: `╭───❰ 🛒 *SHOPS* ❱───╮\n│ .shop supermarket\n│ .shop drug\n│ .shop market\n│\n│ .shop history <n> <unit>\n│ .shop receipt <ID>\n╰─────────────────╯`,
          ...channelInfo
        }, { quoted: message });
      }
      const items = itemsByShop(shop);
      return sock.sendMessage(chatId, { text: renderShop(shop, items), ...channelInfo }, { quoted: message });
    }
  },

  // ─── .buy ────────────────────────────────────────────────────────────────
  {
    command: 'buy',
    aliases: ['purchase'],
    category: 'economy',
    description: 'Buy an item from a shop. Usage: .buy <item> [qty]',
    usage: '.buy monster 5',
    async handler(sock: any, message: any, args: string[], context: BotContext) {
      const { chatId, channelInfo } = context;
      const userId = await resolveJid(sock, context.senderId);
      if (await isBlacklisted(userId)) return sock.sendMessage(chatId, { text: '🚫 You are blacklisted from purchases.', ...channelInfo }, { quoted: message });

      const itemArg = args[0];
      const qty = Math.max(1, Number(args[1]) || 1);
      if (!itemArg) return sock.sendMessage(chatId, { text: '❌ Usage: .buy <item> [qty]\n_See .shop supermarket_', ...channelInfo }, { quoted: message });
      const item = findItem(itemArg);
      if (!item) return sock.sendMessage(chatId, { text: `❌ Item *${itemArg}* not found. Try .shop supermarket`, ...channelInfo }, { quoted: message });

      // Scaling price (rick_gun)
      let unitPrice = item.price;
      if (item.scaling) {
        const uses = await getScalingUses(item.id);
        unitPrice = item.price * Math.pow(2, uses);
      }
      const discount = await getDiscountPct(userId);
      unitPrice = Math.floor(unitPrice * (1 - discount));
      const total = unitPrice * qty;

      const w = await getWallet(userId, message.pushName || '');
      if (w.balance < total) {
        return sock.sendMessage(chatId, { text: `❌ Insufficient funds.\nNeed: *${total.toLocaleString()} 🪙*\nHave: *${w.balance.toLocaleString()} 🪙*`, ...channelInfo }, { quoted: message });
      }
      w.balance -= total;
      await saveWallet(w);
      const vat = Math.round(total * (VAT_RATE / (1 + VAT_RATE)));
      await addToEcoVault(vat);
      await addToInventory(userId, item.id, qty);
      const receiptId = await createReceipt({ userId, shop: item.shop, itemId: item.id, qty, unitPrice, total, vat });

      // ── Pay shop owner + record sale/tax in transaction ledger ──────────
      try {
        const { recordShopTxn, getShopOwner } = await import('../lib/shopStore.js');
        const ownerJid = await getShopOwner(item.shop);
        const ownerCut = total - vat;
        if (ownerJid && ownerJid !== userId) {
          const ow = await getWallet(ownerJid, '');
          ow.balance += ownerCut;
          await saveWallet(ow);
        }
        await recordShopTxn({ shop: item.shop, type: 'sale', userId, itemId: item.id, qty, amount: ownerCut });
        await recordShopTxn({ shop: item.shop, type: 'tax',  userId, itemId: item.id, qty, amount: -vat });
      } catch (e: any) {
        console.error('[shopsystem] payout/ledger failed:', e?.message);
      }
      const r = await getReceipt(receiptId);
      const customer = `@${userId.split('@')[0]}`;
      return sock.sendMessage(chatId, { text: renderReceipt(r, item, customer), mentions: [userId], ...channelInfo }, { quoted: message });
    }
  },

  // ─── .inventory ──────────────────────────────────────────────────────────
  {
    command: 'inventory',
    aliases: ['inv', 'bag'],
    category: 'economy',
    description: 'View your shop inventory. Usage: .inventory [shop]',
    usage: '.inventory',
    async handler(sock: any, message: any, args: string[], context: BotContext) {
      const { chatId, channelInfo } = context;
      const userId = await resolveJid(sock, context.senderId);
      const shopFilter = parseShopArg(args[0]);
      const inv = await getInventory(userId);
      let rows = inv.map(e => ({ entry: e, item: findItem(e.item_id) })).filter(r => r.item);
      if (shopFilter) rows = rows.filter(r => r.item!.shop === shopFilter);
      if (!rows.length) {
        return sock.sendMessage(chatId, { text: `📦 Your bag is empty${shopFilter ? ` (for ${shopFilter})` : ''}.`, ...channelInfo }, { quoted: message });
      }
      const lines = rows.map(r => `• *${r.item!.name}* x${r.entry.qty}  ─  .use ${r.item!.id}`);
      const title = shopFilter ? shopMeta(shopFilter).title : 'Your Bag';
      return sock.sendMessage(chatId, {
        text: `╭───❰ 📦 *${title.toUpperCase()}* ❱───╮\n│ ${rows.length} item${rows.length !== 1 ? 's' : ''}\n╰─────────────────╯\n\n${lines.join('\n')}`,
        ...channelInfo
      }, { quoted: message });
    }
  },

  // ─── .use ────────────────────────────────────────────────────────────────
  {
    command: 'use',
    aliases: ['useitem', 'consume', 'activate'],
    category: 'economy',
    description: 'Use an item from your inventory. Usage: .use <item>',
    usage: '.use portal_fluid',
    async handler(sock: any, message: any, args: string[], context: BotContext) {
      const { chatId, channelInfo } = context;
      const userId = await resolveJid(sock, context.senderId);
      const itemArg = args[0];
      if (!itemArg) return sock.sendMessage(chatId, { text: '❌ Usage: .use <item>', ...channelInfo }, { quoted: message });
      const item = findItem(itemArg);
      if (!item) return sock.sendMessage(chatId, { text: `❌ Item *${itemArg}* not in catalog.`, ...channelInfo }, { quoted: message });
      const have = await getInventoryQty(userId, item.id);
      if (have <= 0) return sock.sendMessage(chatId, { text: `❌ You don't own *${item.name}*. Buy with .buy ${item.id}`, ...channelInfo }, { quoted: message });

      const result = await applyEffect(userId, item);
      const consumable = item.consumable !== false;
      if (consumable) await removeFromInventory(userId, item.id, 1);

      return sock.sendMessage(chatId, {
        text: `╭───❰ 🧪 *USED* ❱───╮\n│ Item: *${item.name}*\n│ ${result}\n│ Remaining: ${consumable ? have - 1 : have}\n╰─────────────────╯`,
        ...channelInfo
      }, { quoted: message });
    }
  },

  // ─── .gift ───────────────────────────────────────────────────────────────
  {
    command: 'gift',
    aliases: ['sendgift', 'send'],
    category: 'economy',
    description: 'Send an item from your bag to another user. Usage: .gift @user <item> [qty]',
    usage: '.gift @john monster 3',
    async handler(sock: any, message: any, args: string[], context: BotContext) {
      const { chatId, channelInfo } = context;
      const senderId = await resolveJid(sock, context.senderId);
      const rawTarget = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      if (!rawTarget) return sock.sendMessage(chatId, { text: '❌ Tag a user. Usage: .gift @user <item> [qty]', ...channelInfo }, { quoted: message });
      const target = await resolveJid(sock, rawTarget);

      const nonMention = args.filter(a => !a.startsWith('@'));
      const itemArg = nonMention[0];
      const qty = Math.max(1, Number(nonMention[1]) || 1);
      if (!itemArg) return sock.sendMessage(chatId, { text: '❌ Usage: .gift @user <item> [qty]', ...channelInfo }, { quoted: message });
      const item = findItem(itemArg);
      if (!item) return sock.sendMessage(chatId, { text: `❌ Item *${itemArg}* not found.`, ...channelInfo }, { quoted: message });
      const ok = await removeFromInventory(senderId, item.id, qty);
      if (!ok) return sock.sendMessage(chatId, { text: `❌ You don't have ${qty}× ${item.name}.`, ...channelInfo }, { quoted: message });
      await addToInventory(target, item.id, qty);
      return sock.sendMessage(chatId, {
        text: `🎁 @${senderId.split('@')[0]} gifted *${qty}× ${item.name}* to @${target.split('@')[0]}`,
        mentions: [senderId, target], ...channelInfo
      }, { quoted: message });
    }
  },

  // ─── .sell ───────────────────────────────────────────────────────────────
  {
    command: 'sell',
    aliases: ['resell'],
    category: 'economy',
    description: 'Sell items back for 50% price. Usage: .sell <item> [qty]',
    usage: '.sell bioplus 2',
    async handler(sock: any, message: any, args: string[], context: BotContext) {
      const { chatId, channelInfo } = context;
      const userId = await resolveJid(sock, context.senderId);
      const itemArg = args[0]; const qty = Math.max(1, Number(args[1]) || 1);
      if (!itemArg) return sock.sendMessage(chatId, { text: '❌ Usage: .sell <item> [qty]', ...channelInfo }, { quoted: message });
      const item = findItem(itemArg);
      if (!item) return sock.sendMessage(chatId, { text: `❌ Item *${itemArg}* not found.`, ...channelInfo }, { quoted: message });
      const ok = await removeFromInventory(userId, item.id, qty);
      if (!ok) return sock.sendMessage(chatId, { text: `❌ You don't have ${qty}× ${item.name}.`, ...channelInfo }, { quoted: message });
      const refund = Math.floor(item.price * qty * 0.5);
      const w = await getWallet(userId, message.pushName || ''); w.balance += refund; await saveWallet(w);
      return sock.sendMessage(chatId, {
        text: `💸 Sold *${qty}× ${item.name}* for *${refund.toLocaleString()} 🪙*\nNew balance: *${w.balance.toLocaleString()} 🪙*`,
        ...channelInfo
      }, { quoted: message });
    }
  },

  // ─── .steal bag ──────────────────────────────────────────────────────────
  {
    command: 'steal',
    category: 'economy',
    description: 'Steal a random item from a user (requires .grabber). Usage: .steal bag @user',
    usage: '.steal bag @mike',
    async handler(sock: any, message: any, args: string[], context: BotContext) {
      const { chatId, channelInfo } = context;
      if ((args[0] || '').toLowerCase() !== 'bag') {
        return sock.sendMessage(chatId, { text: '❌ Usage: .steal bag @user', ...channelInfo }, { quoted: message });
      }
      const senderId = await resolveJid(sock, context.senderId);
      const rawTarget = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      if (!rawTarget) return sock.sendMessage(chatId, { text: '❌ Tag a user.', ...channelInfo }, { quoted: message });
      const target = await resolveJid(sock, rawTarget);
      const tool = await getEffect(senderId, 'tool_grabber');
      if (!tool) return sock.sendMessage(chatId, { text: '❌ Need *Phantom Grabber* — buy + .use grabber first.', ...channelInfo }, { quoted: message });

      // 50/50
      await clearEffect(senderId, 'tool_grabber');
      const inv = await getInventory(target);
      if (Math.random() < 0.5 || !inv.length) {
        return sock.sendMessage(chatId, { text: `🚨 Steal *FAILED*. @${target.split('@')[0]} has been notified.`, mentions: [target], ...channelInfo }, { quoted: message });
      }
      const pick = inv[Math.floor(Math.random() * inv.length)];
      await removeFromInventory(target, pick.item_id, 1);
      await addToInventory(senderId, pick.item_id, 1);
      const item = findItem(pick.item_id);
      return sock.sendMessage(chatId, {
        text: `🥷 SUCCESS! Stole *1× ${item?.name || pick.item_id}* from @${target.split('@')[0]}`,
        mentions: [target], ...channelInfo
      }, { quoted: message });
    }
  },

  // ─── .hack ───────────────────────────────────────────────────────────────
  {
    command: 'hack',
    category: 'economy',
    description: 'Hack a vault or business. Usage: .hack vault @user | .hack biz @user <shop>',
    usage: '.hack vault @sarah',
    async handler(sock: any, message: any, args: string[], context: BotContext) {
      const { chatId, channelInfo } = context;
      const sub = (args[0] || '').toLowerCase();
      const senderId = await resolveJid(sock, context.senderId);
      const rawTarget = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

      if (sub === 'vault') {
        if (!rawTarget) return sock.sendMessage(chatId, { text: '❌ Tag a user.', ...channelInfo }, { quoted: message });
        const target = await resolveJid(sock, rawTarget);
        const tool = await getEffect(senderId, 'tool_vault_cracker');
        if (!tool) return sock.sendMessage(chatId, { text: '❌ Need *Vault Cracker v3* — .use vault_cracker first.', ...channelInfo }, { quoted: message });
        await clearEffect(senderId, 'tool_vault_cracker');
        if (Math.random() < 0.4) {
          const tw = await getWallet(target); const pct = 0.05 + Math.random() * 0.10;
          const stolen = Math.floor(tw.balance * pct);
          tw.balance -= stolen; await saveWallet(tw);
          const sw = await getWallet(senderId); sw.balance += stolen; await saveWallet(sw);
          return sock.sendMessage(chatId, { text: `💰 Hack SUCCESS! Drained *${stolen.toLocaleString()} 🪙* from @${target.split('@')[0]}`, mentions: [target], ...channelInfo }, { quoted: message });
        }
        await setEffect(senderId, 'status_lay_low', { reason: 'vault hack failed' }, 2 * 3_600_000);
        return sock.sendMessage(chatId, { text: `🚨 Hack FAILED — you're now in *Lay Low* status for 2h.`, ...channelInfo }, { quoted: message });
      }

      if (sub === 'biz') {
        if (!rawTarget) return sock.sendMessage(chatId, { text: '❌ Usage: .hack biz @user <shop>', ...channelInfo }, { quoted: message });
        const target = await resolveJid(sock, rawTarget);
        const shopArg = args.find(a => parseShopArg(a)) || '';
        const shop = parseShopArg(shopArg);
        if (!shop) return sock.sendMessage(chatId, { text: '❌ Specify shop: supermarket | drug | market', ...channelInfo }, { quoted: message });
        const tool = await getEffect(senderId, 'tool_backdoor');
        if (!tool) return sock.sendMessage(chatId, { text: '❌ Need *Business Backdoor* — .use backdoor first.', ...channelInfo }, { quoted: message });
        await clearEffect(senderId, 'tool_backdoor');
        if (Math.random() < 0.35) {
          const tw = await getWallet(target); const pct = 0.10 + Math.random() * 0.15;
          const stolen = Math.floor(tw.balance * pct);
          tw.balance -= stolen; await saveWallet(tw);
          const sw = await getWallet(senderId); sw.balance += stolen; await saveWallet(sw);
          return sock.sendMessage(chatId, { text: `💼 Backdoor SUCCESS! Skimmed *${stolen.toLocaleString()} 🪙* from @${target.split('@')[0]}'s ${shop}`, mentions: [target], ...channelInfo }, { quoted: message });
        }
        await setEffect(senderId, 'status_bounty', { amount: 50_000 }, 24 * 3_600_000);
        return sock.sendMessage(chatId, { text: `🚨 Backdoor FAILED — *bounty* placed on you (24h).`, ...channelInfo }, { quoted: message });
      }

      return sock.sendMessage(chatId, { text: '❌ Usage: .hack vault @user | .hack biz @user <shop>', ...channelInfo }, { quoted: message });
    }
  },

  // ─── .admin (shop ownership) ─────────────────────────────────────────────
  {
    command: 'admin',
    category: 'admin',
    description: 'Admin shop tools. .admin transfer shop @user <shop> | .admin remove shop @user <shop> | .admin shops list',
    usage: '.admin transfer shop @john supermarket',
    adminOnly: true,
    async handler(sock: any, message: any, args: string[], context: BotContext) {
      const { chatId, channelInfo } = context;
      const senderId = await resolveJid(sock, context.senderId);
      const sub1 = (args[0] || '').toLowerCase();
      const sub2 = (args[1] || '').toLowerCase();

      if (sub1 === 'shops' && sub2 === 'list') {
        const owners = await getAllShopOwners();
        const lines = (Object.keys(owners) as ShopId[]).map(s => {
          const o = owners[s];
          return `• ${shopMeta(s).emoji} *${shopMeta(s).title}* — ${o ? '@' + o.split('@')[0] : '_unowned_'}`;
        });
        const mentions = Object.values(owners).filter(Boolean) as string[];
        return sock.sendMessage(chatId, {
          text: `╭───❰ 🏬 *SHOP OWNERS* ❱───╮\n${lines.join('\n')}\n╰─────────────────╯`,
          mentions, ...channelInfo
        }, { quoted: message });
      }

      if (sub1 === 'transfer' && sub2 === 'shop') {
        const rawTarget = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
          || message.message?.extendedTextMessage?.contextInfo?.participant;
        const phoneArg = args.find(a => /^\d{8,15}$/.test(a));
        let target = rawTarget ? await resolveJid(sock, rawTarget) : (phoneArg ? `${phoneArg}@s.whatsapp.net` : '');
        if (!target) return sock.sendMessage(chatId, { text: '❌ Tag, reply, or supply phone number.', ...channelInfo }, { quoted: message });
        const shopArg = args.find(a => parseShopArg(a));
        const shop = shopArg ? parseShopArg(shopArg) : null;
        if (!shop) return sock.sendMessage(chatId, { text: '❌ Specify shop: supermarket | drug | market', ...channelInfo }, { quoted: message });
        await setShopOwner(shop, target, senderId);
        return sock.sendMessage(chatId, {
          text: `✅ Ownership of *${shopMeta(shop).title}* transferred to @${target.split('@')[0]}`,
          mentions: [target], ...channelInfo
        }, { quoted: message });
      }

      if (sub1 === 'remove' && sub2 === 'shop') {
        const shopArg = args.find(a => parseShopArg(a));
        const shop = shopArg ? parseShopArg(shopArg) : null;
        if (!shop) return sock.sendMessage(chatId, { text: '❌ Specify shop.', ...channelInfo }, { quoted: message });
        const owner = await getShopOwner(shop);
        await setShopOwner(shop, null, senderId);
        return sock.sendMessage(chatId, {
          text: `🗑️ Removed owner of *${shopMeta(shop).title}*${owner ? ` (was @${owner.split('@')[0]})` : ''}.`,
          mentions: owner ? [owner] : [], ...channelInfo
        }, { quoted: message });
      }

      return sock.sendMessage(chatId, {
        text: `╭───❰ 🛡️ *ADMIN SHOP TOOLS* ❱───╮\n│ .admin transfer shop @user <shop>\n│ .admin remove shop @user <shop>\n│ .admin shops list\n╰─────────────────╯`,
        ...channelInfo
      }, { quoted: message });
    }
  }
];
