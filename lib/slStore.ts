import { getDb } from './turso.js';

export type EquipSlot = 'weapon' | 'armor' | 'jewelry' | 'artifact';

export interface SlEquipment {
    weapon:   string | null;
    armor:    string | null;
    jewelry:  string | null;
    artifact: string | null;
}

let tablesReady = false;
async function ensureTables(): Promise<void> {
    if (tablesReady) return;
    const c = getDb();
    await c.executeMultiple(`
        CREATE TABLE IF NOT EXISTS sl_equipment (
            user_id TEXT NOT NULL,
            slot    TEXT NOT NULL,
            item_id TEXT NOT NULL,
            PRIMARY KEY (user_id, slot)
        );
        CREATE TABLE IF NOT EXISTS sl_shift_cd (
            user_id    TEXT NOT NULL,
            biz_id     TEXT NOT NULL,
            expires_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, biz_id)
        );
    `);
    tablesReady = true;
}

export async function getEquipment(userId: string): Promise<SlEquipment> {
    await ensureTables();
    const c = getDb();
    const res = await c.execute({ sql: `SELECT slot, item_id FROM sl_equipment WHERE user_id = ?`, args: [userId] });
    const eq: SlEquipment = { weapon: null, armor: null, jewelry: null, artifact: null };
    for (const r of res.rows) {
        const slot = r.slot as EquipSlot;
        if (slot in eq) eq[slot] = r.item_id as string;
    }
    return eq;
}

export async function setEquip(userId: string, slot: EquipSlot, itemId: string): Promise<void> {
    await ensureTables();
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO sl_equipment (user_id, slot, item_id) VALUES (?, ?, ?)
              ON CONFLICT(user_id, slot) DO UPDATE SET item_id = excluded.item_id`,
        args: [userId, slot, itemId]
    });
}

export async function clearEquip(userId: string, slot: EquipSlot): Promise<void> {
    await ensureTables();
    const c = getDb();
    await c.execute({ sql: `DELETE FROM sl_equipment WHERE user_id = ? AND slot = ?`, args: [userId, slot] });
}

export async function getShiftCd(userId: string, bizId: string): Promise<number> {
    await ensureTables();
    const c = getDb();
    const res = await c.execute({ sql: `SELECT expires_at FROM sl_shift_cd WHERE user_id = ? AND biz_id = ?`, args: [userId, bizId] });
    if (!res.rows.length) return 0;
    return Number(res.rows[0].expires_at);
}

export async function setShiftCd(userId: string, bizId: string, expiresAt: number): Promise<void> {
    await ensureTables();
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO sl_shift_cd (user_id, biz_id, expires_at) VALUES (?, ?, ?)
              ON CONFLICT(user_id, biz_id) DO UPDATE SET expires_at = excluded.expires_at`,
        args: [userId, bizId, expiresAt]
    });
}
