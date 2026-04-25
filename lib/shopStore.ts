import { getDb } from './turso.js';

let __initDone = false;

export async function initShopTables(): Promise<void> {
  if (__initDone) return;
  const db = getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS shop_inventory (
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      qty     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, item_id)
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS shop_receipts (
      id        TEXT PRIMARY KEY,
      user_id   TEXT NOT NULL,
      shop      TEXT NOT NULL,
      item_id   TEXT NOT NULL,
      qty       INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      total     INTEGER NOT NULL,
      vat       INTEGER NOT NULL DEFAULT 0,
      ts        INTEGER NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_shop_receipts_user_ts ON shop_receipts(user_id, ts DESC)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS shop_owners (
      shop      TEXT PRIMARY KEY,
      user_id   TEXT,
      assigned_by TEXT,
      assigned_at INTEGER
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS shop_effects (
      user_id    TEXT NOT NULL,
      effect_key TEXT NOT NULL,
      data       TEXT,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, effect_key)
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS shop_scaling (
      item_id   TEXT PRIMARY KEY,
      uses      INTEGER NOT NULL DEFAULT 0,
      reset_at  INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS shop_transactions (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      shop      TEXT NOT NULL,
      type      TEXT NOT NULL,
      user_id   TEXT,
      item_id   TEXT,
      qty       INTEGER,
      amount    INTEGER NOT NULL,
      ts        INTEGER NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_shop_txn_shop_ts ON shop_transactions(shop, ts DESC)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS shop_billing (
      shop          TEXT PRIMARY KEY,
      last_billed   TEXT NOT NULL DEFAULT '',
      unpaid_days   INTEGER NOT NULL DEFAULT 0
    )
  `);
  __initDone = true;
}

// ── Billing rates (daily rent + electricity, sales tax %) ────────────────
export const SHOP_RATES: Record<string, { rent: number; electricity: number; tax: number; label: string }> = {
  supermarket: { rent: 50_000,  electricity: 21_000, tax: 0.18, label: 'Supermarket'  },
  drug:        { rent: 80_000,  electricity: 28_000, tax: 0.18, label: 'Drug Shop'    },
  market:      { rent: 120_000, electricity: 42_000, tax: 0.18, label: 'Black Market' },
};

export const SHOP_SEIZE_AFTER_DAYS = 3;

// ── Transactions ─────────────────────────────────────────────────────────
export async function recordShopTxn(opts: {
  shop: string; type: 'sale' | 'tax' | 'rent' | 'electricity' | 'seizure';
  userId?: string | null; itemId?: string | null; qty?: number | null; amount: number;
}): Promise<void> {
  await initShopTables();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO shop_transactions (shop, type, user_id, item_id, qty, amount, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [opts.shop, opts.type, opts.userId ?? null, opts.itemId ?? null, opts.qty ?? null, opts.amount, Date.now()]
  });
}

export interface ShopHistorySummary {
  shop: string;
  sinceMs: number;
  income: number;        // gross from sales
  salesCount: number;
  tax: number;           // amount paid as tax (positive)
  rent: number;          // amount paid as rent (positive)
  electricity: number;   // amount paid as electricity (positive)
  expensesTotal: number;
  net: number;
  transactions: Array<{
    id: number; type: string; user_id: string | null; item_id: string | null;
    qty: number | null; amount: number; ts: number;
  }>;
}

export async function getShopHistory(shop: string, sinceMs: number): Promise<ShopHistorySummary> {
  await initShopTables();
  const db = getDb();
  const since = Date.now() - sinceMs;
  const r = await db.execute({
    sql: `SELECT id, type, user_id, item_id, qty, amount, ts FROM shop_transactions
          WHERE shop = ? AND ts >= ? ORDER BY ts DESC`,
    args: [shop, since]
  });
  const rows = (r.rows as any[]).map(row => ({
    id: Number(row.id),
    type: String(row.type),
    user_id: row.user_id ? String(row.user_id) : null,
    item_id: row.item_id ? String(row.item_id) : null,
    qty: row.qty != null ? Number(row.qty) : null,
    amount: Number(row.amount),
    ts: Number(row.ts),
  }));
  let income = 0, salesCount = 0, tax = 0, rent = 0, electricity = 0;
  for (const t of rows) {
    if (t.type === 'sale')        { income += t.amount; salesCount++; }
    else if (t.type === 'tax')         tax += Math.abs(t.amount);
    else if (t.type === 'rent')        rent += Math.abs(t.amount);
    else if (t.type === 'electricity') electricity += Math.abs(t.amount);
  }
  const expensesTotal = tax + rent + electricity;
  return { shop, sinceMs, income, salesCount, tax, rent, electricity, expensesTotal, net: income - expensesTotal, transactions: rows };
}

// ── Daily billing ────────────────────────────────────────────────────────
function todayKey(): string {
  const d = new Date(); const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getBillingState(shop: string): Promise<{ last_billed: string; unpaid_days: number }> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT last_billed, unpaid_days FROM shop_billing WHERE shop=?`, args: [shop] });
  if (!r.rows.length) return { last_billed: '', unpaid_days: 0 };
  const row = r.rows[0] as any;
  return { last_billed: String(row.last_billed || ''), unpaid_days: Number(row.unpaid_days) || 0 };
}

async function setBillingState(shop: string, last_billed: string, unpaid_days: number): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO shop_billing (shop, last_billed, unpaid_days) VALUES (?, ?, ?)
          ON CONFLICT(shop) DO UPDATE SET last_billed=excluded.last_billed, unpaid_days=excluded.unpaid_days`,
    args: [shop, last_billed, unpaid_days]
  });
}

export async function runDailyShopBilling(): Promise<void> {
  await initShopTables();
  const today = todayKey();
  const { getWallet, saveWallet } = await import('./turso.js');
  for (const shop of Object.keys(SHOP_RATES)) {
    try {
      const state = await getBillingState(shop);
      if (state.last_billed === today) continue;          // already billed today
      const ownerId = await getShopOwner(shop);
      if (!ownerId) { await setBillingState(shop, today, 0); continue; }
      const rates = SHOP_RATES[shop];
      const totalDue = rates.rent + rates.electricity;
      const w = await getWallet(ownerId, '');
      if (w.balance >= totalDue) {
        w.balance -= totalDue;
        await saveWallet(w);
        await recordShopTxn({ shop, type: 'rent',        userId: ownerId, amount: -rates.rent });
        await recordShopTxn({ shop, type: 'electricity', userId: ownerId, amount: -rates.electricity });
        await setBillingState(shop, today, 0);
      } else {
        const newUnpaid = state.unpaid_days + 1;
        if (newUnpaid >= SHOP_SEIZE_AFTER_DAYS) {
          await setShopOwner(shop, null, 'system_seize');
          await recordShopTxn({ shop, type: 'seizure', userId: ownerId, amount: 0 });
          await setBillingState(shop, today, 0);
        } else {
          await setBillingState(shop, today, newUnpaid);
        }
      }
    } catch (e: any) {
      console.error(`[shop-billing] failed for ${shop}:`, e?.message);
    }
  }
}

let __billingTimer: NodeJS.Timeout | null = null;
export function startShopBillingScheduler(): void {
  if (__billingTimer) return;
  void runDailyShopBilling();                                       // catch-up on boot
  __billingTimer = setInterval(() => void runDailyShopBilling(), 60 * 60 * 1000); // hourly
}

export async function getShopUnpaidDays(shop: string): Promise<number> {
  await initShopTables();
  return (await getBillingState(shop)).unpaid_days;
}

// ── Analytics helpers ────────────────────────────────────────────────────
export interface ShopAnalytics {
  topItem: { item_id: string; units: number; revenue: number } | null;
  uniqueCustomers: number;
  returningCustomers: number;     // bought 2+ times
  returnRatePct: number;
  bestDay: { date: string; revenue: number } | null;
  peakHour: { hour: number; sales: number } | null;
}

export async function getShopAnalytics(shop: string, sinceMs: number): Promise<ShopAnalytics> {
  await initShopTables();
  const db = getDb();
  const since = Date.now() - sinceMs;

  const top = await db.execute({
    sql: `SELECT item_id, SUM(qty) AS units, SUM(amount) AS revenue
          FROM shop_transactions
          WHERE shop=? AND type='sale' AND ts>=? AND item_id IS NOT NULL
          GROUP BY item_id ORDER BY units DESC LIMIT 1`,
    args: [shop, since]
  });
  const topRow = (top.rows as any[])[0];
  const topItem = topRow ? { item_id: String(topRow.item_id), units: Number(topRow.units), revenue: Number(topRow.revenue) } : null;

  const cust = await db.execute({
    sql: `SELECT user_id, COUNT(*) AS c
          FROM shop_transactions
          WHERE shop=? AND type='sale' AND ts>=? AND user_id IS NOT NULL
          GROUP BY user_id`,
    args: [shop, since]
  });
  const custRows = cust.rows as any[];
  const uniqueCustomers = custRows.length;
  const returningCustomers = custRows.filter(r => Number(r.c) >= 2).length;
  const returnRatePct = uniqueCustomers ? Math.round((returningCustomers / uniqueCustomers) * 1000) / 10 : 0;

  const day = await db.execute({
    sql: `SELECT DATE(ts/1000, 'unixepoch') AS d, SUM(amount) AS rev
          FROM shop_transactions
          WHERE shop=? AND type='sale' AND ts>=?
          GROUP BY d ORDER BY rev DESC LIMIT 1`,
    args: [shop, since]
  });
  const dayRow = (day.rows as any[])[0];
  const bestDay = dayRow ? { date: String(dayRow.d), revenue: Number(dayRow.rev) } : null;

  const hour = await db.execute({
    sql: `SELECT CAST(strftime('%H', ts/1000, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS c
          FROM shop_transactions
          WHERE shop=? AND type='sale' AND ts>=?
          GROUP BY h ORDER BY c DESC LIMIT 1`,
    args: [shop, since]
  });
  const hourRow = (hour.rows as any[])[0];
  const peakHour = hourRow ? { hour: Number(hourRow.h), sales: Number(hourRow.c) } : null;

  return { topItem, uniqueCustomers, returningCustomers, returnRatePct, bestDay, peakHour };
}

// ── Default owner seeding (one-shot, idempotent) ────────────────────────
export async function seedDefaultShopOwners(superOwnerNumbers: string[]): Promise<void> {
  await initShopTables();
  const db = getDb();
  await db.execute(`CREATE TABLE IF NOT EXISTS shop_seed_flags (key TEXT PRIMARY KEY, ts INTEGER NOT NULL)`);
  const flag = await db.execute(`SELECT 1 FROM shop_seed_flags WHERE key='default_owners_v1' LIMIT 1`);
  if (flag.rows.length) return; // already done — never re-seed (respects admin removals/seizures)

  const mapping: Array<[string, string | undefined]> = [
    ['supermarket', superOwnerNumbers[0]],   // Collins (ownerNumber)
    ['drug',        superOwnerNumbers[1]],   // David (ownerNumber2)
  ];
  for (const [shop, num] of mapping) {
    if (!num) continue;
    const existing = await getShopOwner(shop);
    if (existing) continue;
    const jid = `${num}@s.whatsapp.net`;
    await setShopOwner(shop, jid, 'system_seed');
    console.log(`[shop] seeded default owner for ${shop}: ${num}`);
  }
  await db.execute({ sql: `INSERT INTO shop_seed_flags (key, ts) VALUES (?, ?)`, args: ['default_owners_v1', Date.now()] });
}

// ── Inventory ────────────────────────────────────────────────────────────
export async function addToInventory(userId: string, itemId: string, qty: number): Promise<void> {
  await initShopTables();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO shop_inventory (user_id, item_id, qty) VALUES (?, ?, ?)
          ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + excluded.qty`,
    args: [userId, itemId, qty]
  });
}

export async function removeFromInventory(userId: string, itemId: string, qty: number): Promise<boolean> {
  await initShopTables();
  const db = getDb();
  const cur = await getInventoryQty(userId, itemId);
  if (cur < qty) return false;
  if (cur === qty) {
    await db.execute({ sql: `DELETE FROM shop_inventory WHERE user_id=? AND item_id=?`, args: [userId, itemId] });
  } else {
    await db.execute({ sql: `UPDATE shop_inventory SET qty=qty-? WHERE user_id=? AND item_id=?`, args: [qty, userId, itemId] });
  }
  return true;
}

export async function getInventoryQty(userId: string, itemId: string): Promise<number> {
  await initShopTables();
  const db = getDb();
  const r = await db.execute({ sql: `SELECT qty FROM shop_inventory WHERE user_id=? AND item_id=?`, args: [userId, itemId] });
  if (!r.rows.length) return 0;
  return Number(r.rows[0].qty as any) || 0;
}

export async function getInventory(userId: string): Promise<{ item_id: string; qty: number }[]> {
  await initShopTables();
  const db = getDb();
  const r = await db.execute({ sql: `SELECT item_id, qty FROM shop_inventory WHERE user_id=? AND qty>0 ORDER BY item_id`, args: [userId] });
  return r.rows.map((row: any) => ({ item_id: String(row.item_id), qty: Number(row.qty) }));
}

// ── Receipts ─────────────────────────────────────────────────────────────
export async function createReceipt(opts: { userId: string; shop: string; itemId: string; qty: number; unitPrice: number; total: number; vat: number; }): Promise<string> {
  await initShopTables();
  const db = getDb();
  const prefixMap: Record<string, string> = { supermarket: 'NS', drug: 'DR', market: 'BM' };
  const prefix = prefixMap[opts.shop] || 'SH';
  const id = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
  await db.execute({
    sql: `INSERT INTO shop_receipts (id, user_id, shop, item_id, qty, unit_price, total, vat, ts)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, opts.userId, opts.shop, opts.itemId, opts.qty, opts.unitPrice, opts.total, opts.vat, Date.now()]
  });
  return id;
}

export async function getReceipt(id: string): Promise<any | null> {
  await initShopTables();
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM shop_receipts WHERE id=?`, args: [id.toUpperCase()] });
  return r.rows[0] || null;
}

export async function getReceiptHistory(userId: string, sinceMs: number): Promise<any[]> {
  await initShopTables();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM shop_receipts WHERE user_id=? AND ts>=? ORDER BY ts DESC LIMIT 50`,
    args: [userId, Date.now() - sinceMs]
  });
  return r.rows as any[];
}

// ── Owners ───────────────────────────────────────────────────────────────
export async function setShopOwner(shop: string, userId: string | null, assignedBy: string): Promise<void> {
  await initShopTables();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO shop_owners (shop, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(shop) DO UPDATE SET user_id=excluded.user_id, assigned_by=excluded.assigned_by, assigned_at=excluded.assigned_at`,
    args: [shop, userId, assignedBy, Date.now()]
  });
}

export async function getShopOwner(shop: string): Promise<string | null> {
  await initShopTables();
  const db = getDb();
  const r = await db.execute({ sql: `SELECT user_id FROM shop_owners WHERE shop=?`, args: [shop] });
  if (!r.rows.length) return null;
  return r.rows[0].user_id ? String(r.rows[0].user_id) : null;
}

export async function getAllShopOwners(): Promise<Record<string, string | null>> {
  await initShopTables();
  const db = getDb();
  const r = await db.execute(`SELECT shop, user_id FROM shop_owners`);
  const out: Record<string, string | null> = { supermarket: null, drug: null, market: null };
  for (const row of r.rows as any[]) out[String(row.shop)] = row.user_id ? String(row.user_id) : null;
  return out;
}

// ── Effects ──────────────────────────────────────────────────────────────
export async function setEffect(userId: string, key: string, data: any, durationMs: number): Promise<void> {
  await initShopTables();
  const db = getDb();
  const expires = durationMs > 0 ? Date.now() + durationMs : Number.MAX_SAFE_INTEGER;
  await db.execute({
    sql: `INSERT INTO shop_effects (user_id, effect_key, data, expires_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, effect_key) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at`,
    args: [userId, key, JSON.stringify(data ?? {}), expires]
  });
}

export async function getEffect(userId: string, key: string): Promise<{ data: any; expiresAt: number } | null> {
  await initShopTables();
  const db = getDb();
  const r = await db.execute({ sql: `SELECT data, expires_at FROM shop_effects WHERE user_id=? AND effect_key=? AND expires_at>?`, args: [userId, key, Date.now()] });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  let parsed: any = {};
  try { parsed = JSON.parse(String(row.data || '{}')); } catch {}
  return { data: parsed, expiresAt: Number(row.expires_at) };
}

export async function clearEffect(userId: string, key: string): Promise<void> {
  await initShopTables();
  const db = getDb();
  await db.execute({ sql: `DELETE FROM shop_effects WHERE user_id=? AND effect_key=?`, args: [userId, key] });
}

export async function listEffects(userId: string): Promise<{ key: string; data: any; expiresAt: number }[]> {
  await initShopTables();
  const db = getDb();
  const r = await db.execute({ sql: `SELECT effect_key, data, expires_at FROM shop_effects WHERE user_id=? AND expires_at>?`, args: [userId, Date.now()] });
  return (r.rows as any[]).map(row => {
    let d: any = {}; try { d = JSON.parse(String(row.data || '{}')); } catch {}
    return { key: String(row.effect_key), data: d, expiresAt: Number(row.expires_at) };
  });
}

// ── Scaling prices (rick_gun) ────────────────────────────────────────────
export async function getScalingUses(itemId: string): Promise<number> {
  await initShopTables();
  const db = getDb();
  const r = await db.execute({ sql: `SELECT uses, reset_at FROM shop_scaling WHERE item_id=?`, args: [itemId] });
  if (!r.rows.length) return 0;
  const row = r.rows[0] as any;
  if (Number(row.reset_at) && Date.now() > Number(row.reset_at)) {
    await db.execute({ sql: `UPDATE shop_scaling SET uses=0, reset_at=? WHERE item_id=?`, args: [Date.now() + 30 * 86_400_000, itemId] });
    return 0;
  }
  return Number(row.uses) || 0;
}

export async function bumpScalingUses(itemId: string): Promise<void> {
  await initShopTables();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO shop_scaling (item_id, uses, reset_at) VALUES (?, 1, ?)
          ON CONFLICT(item_id) DO UPDATE SET uses=uses+1`,
    args: [itemId, Date.now() + 30 * 86_400_000]
  });
}
