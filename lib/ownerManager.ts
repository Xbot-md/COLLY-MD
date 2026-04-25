/**
 * lib/ownerManager.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Single source of truth for the COLLY MD two-tier owner system.
 *
 * TIER 1 — SUPER OWNERS (Collins + David)
 *   Hardcoded here, imported everywhere.  Cannot be added / removed via commands.
 *   Have unrestricted access to every command including superOwnerOnly commands.
 *
 * TIER 2 — REGULAR OWNERS
 *   Stored in the `bot_owners` Turso table.
 *   Can be added / removed by super owners at runtime.
 *   Have access to ownerOnly commands but NOT superOwnerOnly commands.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import config from '../config.js';
import { getDb } from './turso.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function clean(jid: string): string {
    if (!jid) return '';
    return jid.split(':')[0].split('@')[0];
}

function toJid(raw: string): string {
    const n = clean(raw);
    return n.includes('@') ? raw : `${n}@s.whatsapp.net`;
}

// ── TIER 1: super owners (hardcoded, never DB) ────────────────────────────────

export const SUPER_OWNER_NUMBERS: string[] = [
    clean(config.ownerNumber),   // Collins
    clean(config.ownerNumber2),  // David
].filter(Boolean);

/** True if the jid belongs to a super owner (Collins / David). */
export function isSuperOwner(jid: string): boolean {
    return SUPER_OWNER_NUMBERS.includes(clean(jid));
}

// ── TIER 2: regular owners (DB) ───────────────────────────────────────────────

/** True if the jid is a regular (non-super) owner stored in the DB. */
export async function isRegularOwner(jid: string): Promise<boolean> {
    const db = getDb();
    const res = await db.execute({
        sql: 'SELECT 1 FROM bot_owners WHERE user_id = ? LIMIT 1',
        args: [clean(jid)],
    });
    return res.rows.length > 0;
}

/** True if the jid is any owner — super or regular. */
export async function isAnyOwner(jid: string): Promise<boolean> {
    if (isSuperOwner(jid)) return true;
    return isRegularOwner(jid);
}

// ── management ────────────────────────────────────────────────────────────────

export interface OwnerEntry {
    userId:  string;   // clean number
    addedBy: string;   // clean number of whoever added them
    addedAt: number;   // unix ms
    tier:    'super' | 'owner';
}

/** Returns all owners: super owners first, then regular owners from DB. */
export async function getOwnerList(): Promise<OwnerEntry[]> {
    const superEntries: OwnerEntry[] = SUPER_OWNER_NUMBERS.map(n => ({
        userId:  n,
        addedBy: 'system',
        addedAt: 0,
        tier:    'super',
    }));

    const db = getDb();
    const res = await db.execute('SELECT user_id, added_by, added_at FROM bot_owners ORDER BY added_at ASC');
    const regularEntries: OwnerEntry[] = res.rows.map((r: any) => ({
        userId:  r.user_id  as string,
        addedBy: r.added_by as string,
        addedAt: r.added_at as number,
        tier:    'owner',
    }));

    return [...superEntries, ...regularEntries];
}

/**
 * Add a regular owner.
 * Returns 'added' | 'already_super' | 'already_owner' | 'ok'
 */
export async function addOwner(jid: string, addedBy: string): Promise<'added' | 'already_super' | 'already_owner'> {
    const num = clean(jid);
    if (isSuperOwner(num)) return 'already_super';

    const db = getDb();
    const existing = await db.execute({ sql: 'SELECT 1 FROM bot_owners WHERE user_id = ?', args: [num] });
    if (existing.rows.length) return 'already_owner';

    await db.execute({
        sql: 'INSERT INTO bot_owners (user_id, added_by, added_at) VALUES (?, ?, ?)',
        args: [num, clean(addedBy), Date.now()],
    });
    return 'added';
}

/**
 * Remove a regular owner.
 * Returns 'removed' | 'is_super' | 'not_found'
 */
export async function removeOwner(jid: string): Promise<'removed' | 'is_super' | 'not_found'> {
    const num = clean(jid);
    if (isSuperOwner(num)) return 'is_super';

    const db = getDb();
    const existing = await db.execute({ sql: 'SELECT 1 FROM bot_owners WHERE user_id = ?', args: [num] });
    if (!existing.rows.length) return 'not_found';

    await db.execute({ sql: 'DELETE FROM bot_owners WHERE user_id = ?', args: [num] });
    return 'removed';
}
