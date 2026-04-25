import { getDb } from './turso.js';

export interface PremiumUser {
    user_id:    string;
    granted_by: string;
    granted_at: number;
    expires_at: number;
    reason:     string;
    source:     string;
}

export interface PremiumLink {
    link_url:  string;
    group_jid: string;
    set_by:    string;
    set_at:    number;
}

// ── Table init ───────────────────────────────────────────────────────────────
export async function initPremiumTables(): Promise<void> {
    const c = getDb();
    await c.executeMultiple(`
        CREATE TABLE IF NOT EXISTS premium_users (
            user_id    TEXT    PRIMARY KEY,
            granted_by TEXT    NOT NULL,
            granted_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            reason     TEXT    NOT NULL DEFAULT '',
            source     TEXT    NOT NULL DEFAULT 'manual'
        );
        CREATE TABLE IF NOT EXISTS premium_commands (
            command TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS premium_links (
            id        INTEGER PRIMARY KEY DEFAULT 1,
            link_url  TEXT    NOT NULL,
            group_jid TEXT    NOT NULL DEFAULT '',
            set_by    TEXT    NOT NULL,
            set_at    INTEGER NOT NULL
        );
    `);
}

// ── User helpers ─────────────────────────────────────────────────────────────
// expires_at = 0 is the permanent sentinel (never expires)
export const PERMANENT_SENTINEL = 0;

export function isPermanent(expiresAt: number): boolean {
    return expiresAt === PERMANENT_SENTINEL;
}

export async function setPremium(
    userId: string,
    days: number,
    grantedBy: string,
    reason: string,
): Promise<void> {
    const c   = getDb();
    const now = Date.now();
    // days = 0 → permanent (expires_at = 0 sentinel)
    const exp = days === 0 ? PERMANENT_SENTINEL : now + days * 24 * 60 * 60 * 1000;
    await c.execute({
        sql: `INSERT INTO premium_users (user_id, granted_by, granted_at, expires_at, reason, source)
              VALUES (?, ?, ?, ?, ?, 'manual')
              ON CONFLICT(user_id) DO UPDATE SET
                  granted_by = excluded.granted_by,
                  granted_at = excluded.granted_at,
                  expires_at = excluded.expires_at,
                  reason     = excluded.reason,
                  source     = 'manual'`,
        args: [userId, grantedBy, now, exp, reason],
    });
}

export async function extendPremium(
    userId: string,
    days: number,
    grantedBy: string,
    reason: string,
): Promise<boolean | 'permanent'> {
    const existing = await checkPremiumUser(userId);
    if (!existing) return false;
    // Cannot extend a permanent user
    if (isPermanent(existing.expires_at)) return 'permanent';
    const c       = getDb();
    const now     = Date.now();
    const base    = Math.max(existing.expires_at, now);
    const newExp  = base + days * 24 * 60 * 60 * 1000;
    await c.execute({
        sql:  `UPDATE premium_users SET expires_at=?, granted_by=?, reason=? WHERE user_id=?`,
        args: [newExp, grantedBy, reason, userId],
    });
    return true;
}

export async function delPremium(userId: string): Promise<boolean> {
    const c   = getDb();
    const res = await c.execute({ sql: `DELETE FROM premium_users WHERE user_id=?`, args: [userId] });
    return (res.rowsAffected ?? 0) > 0;
}

export async function checkPremiumUser(userId: string): Promise<PremiumUser | null> {
    const c   = getDb();
    const res = await c.execute({ sql: `SELECT * FROM premium_users WHERE user_id=?`, args: [userId] });
    if (!res.rows.length) return null;
    const r = res.rows[0] as any;
    return {
        user_id:    r.user_id,
        granted_by: r.granted_by,
        granted_at: Number(r.granted_at),
        expires_at: Number(r.expires_at),
        reason:     r.reason,
        source:     r.source,
    };
}

export async function isPremiumUser(userId: string): Promise<boolean> {
    const p = await checkPremiumUser(userId);
    if (!p) return false;
    return isPermanent(p.expires_at) || p.expires_at > Date.now();
}

export async function listPremiumUsers(): Promise<PremiumUser[]> {
    const c   = getDb();
    const now = Date.now();
    const res = await c.execute({
        // expires_at = 0 → permanent; otherwise must be in the future
        sql:  `SELECT * FROM premium_users WHERE expires_at = 0 OR expires_at > ? ORDER BY expires_at ASC`,
        args: [now],
    });
    return res.rows.map((r: any) => ({
        user_id:    r.user_id,
        granted_by: r.granted_by,
        granted_at: Number(r.granted_at),
        expires_at: Number(r.expires_at),
        reason:     r.reason,
        source:     r.source,
    }));
}

// ── Command helpers ───────────────────────────────────────────────────────────
function normalizeCmd(c: string) {
    return c.toLowerCase().replace(/^\./, '').trim();
}

export async function addPremiumCmd(command: string): Promise<void> {
    const c   = getDb();
    await c.execute({ sql: `INSERT OR IGNORE INTO premium_commands (command) VALUES (?)`, args: [normalizeCmd(command)] });
}

export async function delPremiumCmd(command: string): Promise<boolean> {
    const c   = getDb();
    const res = await c.execute({ sql: `DELETE FROM premium_commands WHERE command=?`, args: [normalizeCmd(command)] });
    return (res.rowsAffected ?? 0) > 0;
}

export async function isPremiumCmd(command: string): Promise<boolean> {
    const c   = getDb();
    const res = await c.execute({ sql: `SELECT 1 FROM premium_commands WHERE command=?`, args: [normalizeCmd(command)] });
    return res.rows.length > 0;
}

export async function listPremiumCmds(): Promise<string[]> {
    const c   = getDb();
    const res = await c.execute({ sql: `SELECT command FROM premium_commands ORDER BY command ASC`, args: [] });
    return res.rows.map((r: any) => r.command as string);
}

// ── Link helpers ─────────────────────────────────────────────────────────────
export async function setPremiumLink(linkUrl: string, groupJid: string, setBy: string): Promise<void> {
    const c   = getDb();
    const now = Date.now();
    await c.execute({
        sql: `INSERT INTO premium_links (id, link_url, group_jid, set_by, set_at)
              VALUES (1, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                  link_url  = excluded.link_url,
                  group_jid = excluded.group_jid,
                  set_by    = excluded.set_by,
                  set_at    = excluded.set_at`,
        args: [linkUrl, groupJid, setBy, now],
    });
}

export async function delPremiumLink(): Promise<boolean> {
    const c   = getDb();
    const res = await c.execute({ sql: `DELETE FROM premium_links WHERE id=1`, args: [] });
    return (res.rowsAffected ?? 0) > 0;
}

export async function getPremiumLink(): Promise<PremiumLink | null> {
    const c   = getDb();
    const res = await c.execute({ sql: `SELECT * FROM premium_links WHERE id=1`, args: [] });
    if (!res.rows.length) return null;
    const r = res.rows[0] as any;
    return { link_url: r.link_url, group_jid: r.group_jid, set_by: r.set_by, set_at: Number(r.set_at) };
}

// ── Social links ─────────────────────────────────────────────────────────────
export const SOCIAL_PLATFORMS = ['whatsapp', 'telegram', 'facebook', 'instagram', 'youtube', 'website'] as const;
export type SocialPlatform = typeof SOCIAL_PLATFORMS[number];

export interface SocialLink {
    platform: string;
    url:      string;
    set_by:   string;
    set_at:   number;
}

export async function setSocialLink(platform: string, url: string, setBy: string): Promise<void> {
    const c   = getDb();
    const now = Date.now();
    await c.execute({
        sql: `INSERT INTO social_links (platform, url, set_by, set_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(platform) DO UPDATE SET url=excluded.url, set_by=excluded.set_by, set_at=excluded.set_at`,
        args: [platform.toLowerCase(), url, setBy, now],
    });
}

export async function delSocialLink(platform: string): Promise<boolean> {
    const c   = getDb();
    const res = await c.execute({ sql: `DELETE FROM social_links WHERE platform=?`, args: [platform.toLowerCase()] });
    return (res.rowsAffected ?? 0) > 0;
}

export async function getSocialLinks(): Promise<SocialLink[]> {
    const c   = getDb();
    const res = await c.execute({ sql: `SELECT * FROM social_links ORDER BY platform ASC`, args: [] });
    return res.rows.map((r: any) => ({
        platform: r.platform as string,
        url:      r.url as string,
        set_by:   r.set_by as string,
        set_at:   Number(r.set_at),
    }));
}

export async function getSocialLink(platform: string): Promise<SocialLink | null> {
    const c   = getDb();
    const res = await c.execute({ sql: `SELECT * FROM social_links WHERE platform=?`, args: [platform.toLowerCase()] });
    if (!res.rows.length) return null;
    const r = res.rows[0] as any;
    return { platform: r.platform, url: r.url, set_by: r.set_by, set_at: Number(r.set_at) };
}

// ── Link-member check (needs sock) ───────────────────────────────────────────
export async function isLinkMember(sock: any, userId: string): Promise<boolean> {
    try {
        const link = await getPremiumLink();
        if (!link?.group_jid) return false;
        const meta = await sock.groupMetadata(link.group_jid);
        const num  = userId.split('@')[0].split(':')[0];
        return (meta?.participants ?? []).some((p: any) => {
            const pNum = (p.id || '').split('@')[0].split(':')[0];
            return pNum === num;
        });
    } catch { return false; }
}
