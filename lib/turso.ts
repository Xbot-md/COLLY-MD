import { createClient, type Client } from '@libsql/client';
import { TURSO_URL, TURSO_AUTH, DEFAULT_SHOP_ITEMS } from '../constants.js';

export interface LawIdEntry {
    userId: string;
    idNumber: string;
    name: string;
    rank: string;
    lawGroup: string;
    age: number;
    registrationDate: string;
    permissions: string[];
}

export interface WalletEntry {
    energy:         number;
    health:         number;
    userId: string;
    name: string;
    balance: number;
    bank: number;
    xp: number;
    level: number;
    lastDaily: number;
    lastWork: number;
    lastRob: number;
    inventory: string[];
    workCooldownMs: number;
    toxicity: number;
}

export interface ShopItem {
    id: string;
    name: string;
    price: number;
    emoji: string;
    description: string;
}

export interface CourtCase {
    id: string;
    groupId: string;
    accuser: string;
    accuserName: string;
    defendant: string;
    defendantName: string;
    reason: string;
    status: 'pending' | 'voting' | 'guilty' | 'innocent' | 'settled';
    votesGuilty: string[];
    votesInnocent: string[];
    startTime: number;
    punishment?: string;
}

let db: Client | null = null;

// ─── WRITE-BACK IN-MEMORY CACHE ───────────────────────────────────────────────
// Reads hit memory first (zero DB reads). Writes queue in memory and flush to
// Turso in bulk every FLUSH_INTERVAL_MS or when FLUSH_THRESHOLD dirty items pile up.
// This keeps daily Turso read/write usage near the bare minimum.

const FLUSH_THRESHOLD   = 25;               // bulk-write after this many pending changes
const FLUSH_INTERVAL_MS = 2 * 60 * 1000;   // also flush every 2 minutes

// Wallet store (permanent in-process cache, write-back)
const wCache = new Map<string, WalletEntry>(); // userId → wallet
const wDirty = new Set<string>();              // userId → pending DB write

// Bot-settings store (lazy-load on first access, write-back)
const sCache = new Map<string, string | null>(); // key → value | null=absent
const sDirty = new Set<string>();

// Eco-vault (single scalar, write-back)
let vCache: number | null = null;
let vDirty = false;

let _totalDirty = 0;

function _markDirty() {
    _totalDirty++;
    if (_totalDirty >= FLUSH_THRESHOLD) {
        cacheFlush().catch(e => console.error('[cache] auto-flush error:', e));
    }
}

export async function cacheFlush(): Promise<void> {
    if (wDirty.size === 0 && sDirty.size === 0 && !vDirty) return;
    const c = getDb();
    let n = 0;

    // ── Wallets ──────────────────────────────────────────────────────────────
    for (const uid of wDirty) {
        const w = wCache.get(uid);
        if (!w) continue;
        await c.execute({
            sql: `INSERT INTO eco_wallets
                    (user_id, name, balance, bank, xp, level, last_daily, last_work, last_rob, inventory, work_cooldown_ms, toxicity, energy, health)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(user_id) DO UPDATE SET
                    name = excluded.name, balance = excluded.balance, bank = excluded.bank,
                    xp = excluded.xp, level = excluded.level, last_daily = excluded.last_daily,
                    last_work = excluded.last_work, last_rob = excluded.last_rob,
                    inventory = excluded.inventory, work_cooldown_ms = excluded.work_cooldown_ms,
                    toxicity = excluded.toxicity, energy = excluded.energy, health = excluded.health`,
            args: [w.userId, w.name, w.balance, w.bank, w.xp, w.level,
                   w.lastDaily, w.lastWork, w.lastRob,
                   JSON.stringify(w.inventory), w.workCooldownMs ?? 7_200_000, w.toxicity ?? 0,
                   w.energy ?? 100, w.health ?? 100],
        });
        n++;
    }
    wDirty.clear();

    // ── Bot settings ─────────────────────────────────────────────────────────
    for (const key of sDirty) {
        const val = sCache.get(key);
        if (val === undefined) continue;
        await c.execute({
            sql: `INSERT INTO bot_settings (key, value) VALUES (?, ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            args: [key, val ?? ''],
        });
        n++;
    }
    sDirty.clear();

    // ── Eco vault ────────────────────────────────────────────────────────────
    if (vDirty && vCache !== null) {
        await c.execute({ sql: `UPDATE eco_vault SET amount = ? WHERE id = 'main'`, args: [vCache] });
        vDirty = false;
        n++;
    }

    _totalDirty = 0;
    if (n > 0) console.log(`[cache] flushed ${n} item(s) to Turso`);
}

function _startFlushTimer() {
    setInterval(() => cacheFlush().catch(e => console.error('[cache] timer flush error:', e)), FLUSH_INTERVAL_MS);
    const graceful = () => cacheFlush().then(() => process.exit(0)).catch(() => process.exit(1));
    process.once('SIGTERM', graceful);
    process.once('SIGINT',  graceful);
}
// ─────────────────────────────────────────────────────────────────────────────

const blacklistCache = new Set<string>();
let blacklistCacheTs = 0;
const BLACKLIST_TTL = 60 * 1000;

export function getDb(): Client {
    if (!db) {
        db = createClient({ url: TURSO_URL, authToken: TURSO_AUTH });
    }
    return db;
}

export async function initTurso(): Promise<void> {
    const c = getDb();
    await c.executeMultiple(`
        CREATE TABLE IF NOT EXISTS case_meta (
            case_id TEXT NOT NULL,
            key     TEXT NOT NULL,
            value   TEXT NOT NULL,
            PRIMARY KEY (case_id, key)
        );
        CREATE TABLE IF NOT EXISTS group_rules (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id    TEXT    NOT NULL,
            rule_num    INTEGER NOT NULL,
            text        TEXT    NOT NULL,
            UNIQUE(group_id, rule_num)
        );
        CREATE TABLE IF NOT EXISTS rule_proposals (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id      TEXT    NOT NULL,
            proposer      TEXT    NOT NULL,
            proposer_name TEXT    NOT NULL,
            text          TEXT    NOT NULL,
            status        TEXT    NOT NULL DEFAULT 'pending',
            created_at    INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS plead_responses (
            case_id   TEXT PRIMARY KEY,
            defendant TEXT    NOT NULL,
            response  TEXT    NOT NULL,
            timestamp INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS court_mutes (
            user_id     TEXT    NOT NULL,
            group_id    TEXT    NOT NULL,
            msg_count   INTEGER NOT NULL DEFAULT 0,
            muted_by    TEXT    NOT NULL,
            muted_at    INTEGER NOT NULL,
            muted_until INTEGER NOT NULL DEFAULT 0,
            reason      TEXT    NOT NULL DEFAULT '',
            PRIMARY KEY (user_id, group_id)
        );

        CREATE TABLE IF NOT EXISTS group_mutes (
            user_id     TEXT    NOT NULL,
            group_id    TEXT    NOT NULL,
            muted_by    TEXT    NOT NULL,
            muted_at    INTEGER NOT NULL,
            muted_until INTEGER NOT NULL DEFAULT 0,
            reason      TEXT    NOT NULL DEFAULT '',
            PRIMARY KEY (user_id, group_id)
        );
        CREATE TABLE IF NOT EXISTS court_labor (
            user_id     TEXT    NOT NULL,
            group_id    TEXT    NOT NULL,
            task        TEXT    NOT NULL,
            assigned_by TEXT    NOT NULL,
            expires_at  INTEGER NOT NULL,
            verified    INTEGER NOT NULL DEFAULT 0,
            verifier    TEXT,
            PRIMARY KEY (user_id, group_id)
        );
        CREATE TABLE IF NOT EXISTS court_dare (
            user_id     TEXT    NOT NULL,
            group_id    TEXT    NOT NULL,
            task        TEXT    NOT NULL,
            assigned_by TEXT    NOT NULL,
            expires_at  INTEGER NOT NULL,
            verified    INTEGER NOT NULL DEFAULT 0,
            verifier    TEXT,
            PRIMARY KEY (user_id, group_id)
        );
        CREATE TABLE IF NOT EXISTS criminal_records (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    TEXT    NOT NULL,
            group_id   TEXT    NOT NULL,
            case_id    TEXT    NOT NULL,
            verdict    TEXT    NOT NULL,
            charge     TEXT    NOT NULL,
            punishment TEXT,
            judge      TEXT    NOT NULL,
            judge_name TEXT    NOT NULL,
            timestamp  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS citizens (
            user_id    TEXT    NOT NULL,
            group_id   TEXT    NOT NULL,
            alias      TEXT,
            granted_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, group_id)
        );
        CREATE TABLE IF NOT EXISTS marriages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user1      TEXT    NOT NULL,
            user2      TEXT    NOT NULL,
            married_at INTEGER NOT NULL,
            status     TEXT    NOT NULL DEFAULT 'active',
            group_id   TEXT    NOT NULL
        );
        CREATE TABLE IF NOT EXISTS family_tree (
            parent_id  TEXT    NOT NULL,
            child_id   TEXT    NOT NULL,
            group_id   TEXT    NOT NULL,
            adopted_at INTEGER NOT NULL,
            PRIMARY KEY (parent_id, child_id, group_id)
        );
        CREATE TABLE IF NOT EXISTS deportations (
            user_id     TEXT    NOT NULL,
            group_id    TEXT    NOT NULL,
            expires_at  INTEGER NOT NULL,
            deported_by TEXT    NOT NULL,
            PRIMARY KEY (user_id, group_id)
        );
        CREATE TABLE IF NOT EXISTS appeals (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id    TEXT    NOT NULL,
            appellant  TEXT    NOT NULL,
            group_id   TEXT    NOT NULL,
            reason     TEXT    NOT NULL,
            status     TEXT    NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bribe_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id    TEXT    NOT NULL,
            defendant  TEXT    NOT NULL,
            admin_id   TEXT    NOT NULL,
            amount     INTEGER NOT NULL,
            status     TEXT    NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS admin_duty (
            user_id       TEXT    NOT NULL,
            group_id      TEXT    NOT NULL,
            duty_points   INTEGER NOT NULL DEFAULT 0,
            pending_coins INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, group_id)
        );
        CREATE TABLE IF NOT EXISTS group_settings (
            group_id TEXT NOT NULL,
            key      TEXT NOT NULL,
            value    TEXT NOT NULL,
            PRIMARY KEY (group_id, key)
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id   TEXT    NOT NULL,
            admin_name TEXT    NOT NULL,
            group_id   TEXT    NOT NULL,
            action     TEXT    NOT NULL,
            amount     INTEGER NOT NULL DEFAULT 0,
            timestamp  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS admin_votes (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id       TEXT    NOT NULL,
            candidate      TEXT    NOT NULL,
            candidate_name TEXT    NOT NULL,
            votes          TEXT    NOT NULL DEFAULT '[]',
            started_by     TEXT    NOT NULL,
            started_at     INTEGER NOT NULL,
            status         TEXT    NOT NULL DEFAULT 'active'
        );
        CREATE TABLE IF NOT EXISTS marriage_proposals (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            proposer      TEXT    NOT NULL,
            proposer_name TEXT    NOT NULL,
            target        TEXT    NOT NULL,
            group_id      TEXT    NOT NULL,
            created_at    INTEGER NOT NULL,
            status        TEXT    NOT NULL DEFAULT 'pending'
        );
        CREATE TABLE IF NOT EXISTS eco_wallets (
            user_id     TEXT    PRIMARY KEY,
            name        TEXT    NOT NULL DEFAULT '',
            balance     INTEGER NOT NULL DEFAULT 100,
            bank        INTEGER NOT NULL DEFAULT 0,
            xp          INTEGER NOT NULL DEFAULT 0,
            level       INTEGER NOT NULL DEFAULT 1,
            last_daily  INTEGER NOT NULL DEFAULT 0,
            last_work   INTEGER NOT NULL DEFAULT 0,
            last_rob    INTEGER NOT NULL DEFAULT 0,
            inventory   TEXT    NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS eco_shop (
            id          TEXT    PRIMARY KEY,
            name        TEXT    NOT NULL,
            price       INTEGER NOT NULL,
            emoji       TEXT    NOT NULL,
            description TEXT    NOT NULL
        );
        CREATE TABLE IF NOT EXISTS eco_vault (
            id     TEXT    PRIMARY KEY,
            amount INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS court_cases (
            id              TEXT    PRIMARY KEY,
            group_id        TEXT    NOT NULL,
            accuser         TEXT    NOT NULL,
            accuser_name    TEXT    NOT NULL,
            defendant       TEXT    NOT NULL,
            defendant_name  TEXT    NOT NULL,
            reason          TEXT    NOT NULL,
            status          TEXT    NOT NULL DEFAULT 'voting',
            votes_guilty    TEXT    NOT NULL DEFAULT '[]',
            votes_innocent  TEXT    NOT NULL DEFAULT '[]',
            start_time      INTEGER NOT NULL,
            punishment      TEXT
        );
        CREATE TABLE IF NOT EXISTS court_blacklist (
            user_id TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS court_vault (
            id     TEXT    PRIMARY KEY,
            amount INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS court_ids (
            user_id       TEXT    PRIMARY KEY,
            group_id      TEXT    NOT NULL,
            legal_name    TEXT    NOT NULL,
            dob           TEXT    NOT NULL,
            nationality   TEXT    NOT NULL DEFAULT 'N/A',
            id_number     TEXT    NOT NULL UNIQUE,
            issue_date    INTEGER NOT NULL,
            expiry_date   INTEGER NOT NULL,
            citizen_since INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS citizen_loans (
            user_id    TEXT    PRIMARY KEY,
            amount     INTEGER NOT NULL,
            interest   INTEGER NOT NULL,
            issued_at  INTEGER NOT NULL,
            due_date   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS lottery_pool (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      TEXT    NOT NULL,
            user_name    TEXT    NOT NULL DEFAULT '',
            purchased_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_adoptions (
            parent_id  TEXT    NOT NULL,
            child_id   TEXT    NOT NULL,
            group_id   TEXT    NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (child_id, group_id)
        );
        CREATE TABLE IF NOT EXISTS suspended_ids (
            user_id          TEXT    NOT NULL,
            group_id         TEXT    NOT NULL,
            suspended_by     TEXT    NOT NULL,
            suspended_by_name TEXT   NOT NULL DEFAULT '',
            suspended_until  INTEGER NOT NULL,
            reason           TEXT    NOT NULL DEFAULT '',
            PRIMARY KEY (user_id, group_id)
        );

        CREATE TABLE IF NOT EXISTS credit_freezes (
            user_id    TEXT    NOT NULL,
            group_id   TEXT    NOT NULL,
            amount     INTEGER NOT NULL,
            tax        INTEGER NOT NULL DEFAULT 0,
            reason     TEXT    NOT NULL DEFAULT '',
            issued_by  TEXT    NOT NULL DEFAULT '',
            issued_at  INTEGER NOT NULL,
            PRIMARY KEY (user_id, group_id)
        );

        CREATE TABLE IF NOT EXISTS admin_banned_cmds (
            admin_id   TEXT    NOT NULL,
            group_id   TEXT    NOT NULL,
            command    TEXT    NOT NULL,
            banned_by  TEXT    NOT NULL DEFAULT '',
            banned_at  INTEGER NOT NULL,
            PRIMARY KEY (admin_id, group_id, command)
        );

        CREATE TABLE IF NOT EXISTS law_ids (
            user_id           TEXT    PRIMARY KEY,
            id_number         TEXT    UNIQUE NOT NULL,
            name              TEXT    NOT NULL,
            rank              TEXT    NOT NULL,
            law_group         TEXT    NOT NULL,
            age               INTEGER NOT NULL,
            registration_date TEXT    NOT NULL,
            permissions       TEXT    NOT NULL DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS biz_cards (
            biz_id        TEXT    NOT NULL PRIMARY KEY,
            name          TEXT    NOT NULL,
            owner_id      TEXT    NOT NULL,
            owner_name    TEXT    NOT NULL DEFAULT '',
            contact       TEXT    NOT NULL DEFAULT '',
            registered_at INTEGER NOT NULL,
            status        TEXT    NOT NULL DEFAULT 'Registered'
        );

        CREATE TABLE IF NOT EXISTS biz_employees (
            biz_id        TEXT    NOT NULL,
            user_id       TEXT    NOT NULL,
            user_name     TEXT    NOT NULL DEFAULT '',
            hired_at      INTEGER NOT NULL,
            PRIMARY KEY (biz_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS worker_cards (
            worker_id     TEXT    NOT NULL UNIQUE,
            user_id       TEXT    NOT NULL PRIMARY KEY,
            user_name     TEXT    NOT NULL DEFAULT '',
            registered_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plots (
            plot_id    TEXT    NOT NULL PRIMARY KEY,
            owner_id   TEXT    NOT NULL,
            owner_name TEXT    NOT NULL DEFAULT '',
            has_permit INTEGER NOT NULL DEFAULT 0,
            permit_at  INTEGER,
            biz_id     TEXT,
            bought_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tesla_bots (
            bot_id          TEXT    NOT NULL PRIMARY KEY,
            name            TEXT    NOT NULL UNIQUE,
            owner_id        TEXT    NOT NULL,
            biz_id          TEXT,
            plot_id         TEXT,
            level           INTEGER NOT NULL DEFAULT 1,
            income_bonus    REAL    NOT NULL DEFAULT 0.15,
            bought_at       INTEGER NOT NULL,
            last_maintained INTEGER NOT NULL DEFAULT 0,
            status          TEXT    NOT NULL DEFAULT 'Idle'
        );

        CREATE TABLE IF NOT EXISTS biz_applications (
            biz_id     TEXT    NOT NULL,
            user_id    TEXT    NOT NULL,
            user_name  TEXT    NOT NULL DEFAULT '',
            applied_at INTEGER NOT NULL,
            invited    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (biz_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS biz_invites (
            biz_id     TEXT    NOT NULL,
            user_id    TEXT    NOT NULL,
            invited_by TEXT    NOT NULL,
            invited_at INTEGER NOT NULL,
            PRIMARY KEY (biz_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS biz_transactions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            biz_id      TEXT    NOT NULL,
            type        TEXT    NOT NULL,
            amount      REAL    NOT NULL,
            description TEXT    NOT NULL DEFAULT '',
            created_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bot_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bot_owners (
            user_id   TEXT PRIMARY KEY,
            added_by  TEXT NOT NULL DEFAULT 'system',
            added_at  INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS msg_activity (
            group_id  TEXT    NOT NULL,
            user_id   TEXT    NOT NULL,
            last_seen INTEGER NOT NULL DEFAULT 0,
            msg_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (group_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS msg_hourly (
            group_id     TEXT    NOT NULL,
            hour_of_day  INTEGER NOT NULL,
            msg_count    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (group_id, hour_of_day)
        );

        CREATE TABLE IF NOT EXISTS confessions_settings (
            group_id   TEXT    PRIMARY KEY,
            enabled    INTEGER NOT NULL DEFAULT 0,
            set_by     TEXT    NOT NULL DEFAULT '',
            set_at     INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS trigger_rules (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id  TEXT    NOT NULL,
            trigger   TEXT    NOT NULL,
            response  TEXT    NOT NULL,
            set_by    TEXT    NOT NULL DEFAULT '',
            set_at    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS tempmail_accounts (
            user_id   TEXT    PRIMARY KEY,
            address   TEXT    NOT NULL,
            token     TEXT    NOT NULL,
            created   INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS multipoll_data (
            poll_id    TEXT    PRIMARY KEY,
            group_id   TEXT    NOT NULL,
            question   TEXT    NOT NULL,
            options    TEXT    NOT NULL,
            votes      TEXT    NOT NULL DEFAULT '{}',
            creator    TEXT    NOT NULL,
            created_at INTEGER NOT NULL DEFAULT 0,
            closed     INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS antiraid_settings (
            group_id   TEXT    PRIMARY KEY,
            enabled    INTEGER NOT NULL DEFAULT 0,
            threshold  INTEGER NOT NULL DEFAULT 5,
            window_sec INTEGER NOT NULL DEFAULT 30,
            action     TEXT    NOT NULL DEFAULT 'kick+lock'
        );

        CREATE TABLE IF NOT EXISTS social_links (
            platform TEXT    PRIMARY KEY,
            url      TEXT    NOT NULL,
            set_by   TEXT    NOT NULL DEFAULT '',
            set_at   INTEGER NOT NULL DEFAULT 0
        );

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

    // Migrate citizen_loans: add reason + hours columns if missing
    try { await c.execute(`ALTER TABLE citizen_loans ADD COLUMN reason TEXT NOT NULL DEFAULT ''`); } catch {}
    try { await c.execute(`ALTER TABLE citizen_loans ADD COLUMN hours INTEGER NOT NULL DEFAULT 168`); } catch {}
    // Migrate eco_wallets: add columns if missing
    try { await c.execute(`ALTER TABLE eco_wallets ADD COLUMN work_cooldown_ms INTEGER NOT NULL DEFAULT 7200000`); } catch {}
    try { await c.execute(`ALTER TABLE eco_wallets ADD COLUMN toxicity INTEGER NOT NULL DEFAULT 0`); } catch {}
    try { await c.execute(`ALTER TABLE eco_wallets ADD COLUMN energy INTEGER NOT NULL DEFAULT 100`); } catch {}
    try { await c.execute(`ALTER TABLE eco_wallets ADD COLUMN health INTEGER NOT NULL DEFAULT 100`); } catch {}
    // Migrate court_mutes: add timed-mute columns
    try { await c.execute(`ALTER TABLE court_mutes ADD COLUMN muted_until INTEGER NOT NULL DEFAULT 0`); } catch {}
    try { await c.execute(`ALTER TABLE court_mutes ADD COLUMN reason TEXT NOT NULL DEFAULT ''`); } catch {}
    // Migrate biz_cards: add full business-sim columns
    const bizMigs = [
        `ALTER TABLE biz_cards ADD COLUMN type TEXT NOT NULL DEFAULT 'General'`,
        `ALTER TABLE biz_cards ADD COLUMN plot_id TEXT NOT NULL DEFAULT ''`,
        `ALTER TABLE biz_cards ADD COLUMN balance REAL NOT NULL DEFAULT 0`,
        `ALTER TABLE biz_cards ADD COLUMN income_rate REAL NOT NULL DEFAULT 250`,
        `ALTER TABLE biz_cards ADD COLUMN last_collected INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE biz_cards ADD COLUMN last_worked INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE biz_cards ADD COLUMN reputation INTEGER NOT NULL DEFAULT 50`,
        `ALTER TABLE biz_cards ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1`,
        `ALTER TABLE biz_cards ADD COLUMN is_insured INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE biz_cards ADD COLUMN security_level INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE biz_cards ADD COLUMN upgrade_level INTEGER NOT NULL DEFAULT 1`,
        `ALTER TABLE biz_cards ADD COLUMN tax_due REAL NOT NULL DEFAULT 0`,
        `ALTER TABLE biz_cards ADD COLUMN default_salary REAL NOT NULL DEFAULT 100`,
        `ALTER TABLE biz_cards ADD COLUMN assets TEXT NOT NULL DEFAULT '[]'`,
        `ALTER TABLE biz_cards ADD COLUMN is_grinding INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE biz_cards ADD COLUMN grind_started INTEGER NOT NULL DEFAULT 0`,
    ];
    for (const sql of bizMigs) { try { await c.execute(sql); } catch {} }
    // Migrate biz_employees: add salary + role
    try { await c.execute(`ALTER TABLE biz_employees ADD COLUMN salary REAL NOT NULL DEFAULT 100`); } catch {}
    try { await c.execute(`ALTER TABLE biz_employees ADD COLUMN role TEXT NOT NULL DEFAULT 'Employee'`); } catch {}

    const ecoVault = await c.execute(`SELECT id FROM eco_vault WHERE id = 'main'`);
    if (!ecoVault.rows.length) await c.execute(`INSERT INTO eco_vault (id, amount) VALUES ('main', 0)`);

    const courtVault = await c.execute(`SELECT id FROM court_vault WHERE id = 'main'`);
    if (!courtVault.rows.length) await c.execute(`INSERT INTO court_vault (id, amount) VALUES ('main', 0)`);

    for (const item of DEFAULT_SHOP_ITEMS) {
        await c.execute({
            sql: `INSERT OR IGNORE INTO eco_shop (id, name, price, emoji, description) VALUES (?, ?, ?, ?, ?)`,
            args: [item.id, item.name, item.price, item.emoji, item.description]
        });
    }

    // Start write-back flush timer
    _startFlushTimer();
}

function rowToWallet(row: any): WalletEntry {
    return {
        userId:         row.user_id as string,
        name:           row.name as string,
        balance:        Number(row.balance),
        bank:           Number(row.bank),
        xp:             Number(row.xp),
        level:          Number(row.level),
        lastDaily:      Number(row.last_daily),
        lastWork:       Number(row.last_work),
        lastRob:        Number(row.last_rob),
        inventory:      JSON.parse(row.inventory as string || '[]'),
        workCooldownMs: Number(row.work_cooldown_ms) || 7_200_000,
        toxicity:       Number(row.toxicity) || 0,
        energy:         row.energy != null ? Number(row.energy) : 100,
        health:         row.health != null ? Number(row.health) : 100,
    };
}

export async function getWallet(userId: string, name = ''): Promise<WalletEntry> {
    // Check in-memory first — zero DB read
    const cached = wCache.get(userId);
    if (cached) {
        if (name && cached.name !== name) cached.name = name;
        return { ...cached };
    }
    // Miss — load from DB (1 read)
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM eco_wallets WHERE user_id = ?`, args: [userId] });
    if (res.rows.length) {
        const w = rowToWallet(res.rows[0]);
        if (name && w.name !== name) w.name = name;
        wCache.set(userId, { ...w });
        return w;
    }
    // New user — create in memory + mark dirty (1 deferred write)
    const fresh: WalletEntry = { userId, name, balance: 100, bank: 0, xp: 0, level: 1, lastDaily: 0, lastWork: 0, lastRob: 0, inventory: [], workCooldownMs: 7_200_000, toxicity: 0, energy: 100, health: 100 };
    wCache.set(userId, { ...fresh });
    wDirty.add(userId);
    _markDirty();
    return fresh;
}

export async function saveWallet(w: WalletEntry): Promise<void> {
    // Write to memory only — deferred DB write
    wCache.set(w.userId, { ...w });
    wDirty.add(w.userId);
    _markDirty();
}

export async function getLeaderboard(limit = 10): Promise<{ userId: string; name: string; total: number; level: number }[]> {
    // Flush dirty wallets first so DB reflects latest balances
    await cacheFlush();
    const c = getDb();
    const res = await c.execute({
        sql: `SELECT user_id, name, (balance + bank) as total, level FROM eco_wallets ORDER BY total DESC LIMIT ?`,
        args: [limit]
    });
    return res.rows.map(r => ({
        userId: r.user_id as string,
        name:   r.name as string,
        total:  Number(r.total),
        level:  Number(r.level),
    }));
}

export async function getShop(): Promise<ShopItem[]> {
    const c = getDb();
    const res = await c.execute(`SELECT * FROM eco_shop`);
    return res.rows.map(r => ({
        id: r.id as string, name: r.name as string,
        price: Number(r.price), emoji: r.emoji as string, description: r.description as string
    }));
}

export async function getEcoVault(): Promise<number> {
    if (vCache !== null) return vCache;
    const c = getDb();
    const res = await c.execute(`SELECT amount FROM eco_vault WHERE id = 'main'`);
    vCache = res.rows.length ? Number(res.rows[0].amount) : 0;
    return vCache;
}

export async function setEcoVault(amount: number): Promise<void> {
    vCache = amount;
    vDirty = true;
    _markDirty();
}

export async function addToEcoVault(amount: number): Promise<void> {
    // Ensure vault is loaded first, then add in memory
    if (vCache === null) await getEcoVault();
    vCache = (vCache ?? 0) + amount;
    vDirty = true;
    _markDirty();
}

export async function getCourtVault(): Promise<number> {
    const c = getDb();
    const res = await c.execute(`SELECT amount FROM court_vault WHERE id = 'main'`);
    return res.rows.length ? Number(res.rows[0].amount) : 0;
}

export async function setCourtVault(amount: number): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `UPDATE court_vault SET amount = ? WHERE id = 'main'`, args: [amount] });
}

export async function isBlacklisted(userId: string): Promise<boolean> {
    if (Date.now() - blacklistCacheTs < BLACKLIST_TTL) {
        return blacklistCache.has(userId);
    }
    const c = getDb();
    const res = await c.execute(`SELECT user_id FROM court_blacklist`);
    blacklistCache.clear();
    res.rows.forEach(r => blacklistCache.add(r.user_id as string));
    blacklistCacheTs = Date.now();
    return blacklistCache.has(userId);
}

export async function addBlacklist(userId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `INSERT OR IGNORE INTO court_blacklist (user_id) VALUES (?)`, args: [userId] });
    blacklistCache.add(userId);
}

export async function removeBlacklist(userId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `DELETE FROM court_blacklist WHERE user_id = ?`, args: [userId] });
    blacklistCache.delete(userId);
}

export async function getBlacklist(): Promise<string[]> {
    const c = getDb();
    const res = await c.execute(`SELECT user_id FROM court_blacklist`);
    return res.rows.map(r => r.user_id as string);
}

export async function createCase(courtCase: CourtCase): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO court_cases (id, group_id, accuser, accuser_name, defendant, defendant_name, reason, status, votes_guilty, votes_innocent, start_time, punishment)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            courtCase.id, courtCase.groupId, courtCase.accuser, courtCase.accuserName,
            courtCase.defendant, courtCase.defendantName, courtCase.reason,
            courtCase.status, JSON.stringify(courtCase.votesGuilty),
            JSON.stringify(courtCase.votesInnocent), courtCase.startTime,
            courtCase.punishment || null
        ]
    });
}

export async function updateCase(courtCase: CourtCase): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `UPDATE court_cases SET status = ?, votes_guilty = ?, votes_innocent = ?, punishment = ? WHERE id = ?`,
        args: [courtCase.status, JSON.stringify(courtCase.votesGuilty), JSON.stringify(courtCase.votesInnocent), courtCase.punishment || null, courtCase.id]
    });
}

export async function getCase(caseId: string): Promise<CourtCase | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM court_cases WHERE id = ?`, args: [caseId.toUpperCase()] });
    if (!res.rows.length) return null;
    return rowToCase(res.rows[0]);
}

export async function getActiveCases(groupId: string): Promise<CourtCase[]> {
    const c = getDb();
    const res = await c.execute({
        sql: `SELECT * FROM court_cases WHERE group_id = ? AND status = 'voting' ORDER BY start_time DESC`,
        args: [groupId]
    });
    return res.rows.map(rowToCase);
}

function rowToCase(r: any): CourtCase {
    return {
        id:            r.id as string,
        groupId:       r.group_id as string,
        accuser:       r.accuser as string,
        accuserName:   r.accuser_name as string,
        defendant:     r.defendant as string,
        defendantName: r.defendant_name as string,
        reason:        r.reason as string,
        status:        r.status as CourtCase['status'],
        votesGuilty:   JSON.parse(r.votes_guilty as string || '[]'),
        votesInnocent: JSON.parse(r.votes_innocent as string || '[]'),
        startTime:     Number(r.start_time),
        punishment:    r.punishment as string | undefined,
    };
}

// ─── Law ID helpers ──────────────────────────────────────────────────────────

function rowToLawId(r: any): LawIdEntry {
    return {
        userId:           r.user_id as string,
        idNumber:         r.id_number as string,
        name:             r.name as string,
        rank:             r.rank as string,
        lawGroup:         r.law_group as string,
        age:              Number(r.age),
        registrationDate: r.registration_date as string,
        permissions:      JSON.parse(r.permissions as string || '[]'),
    };
}

export async function getLawId(userId: string): Promise<LawIdEntry | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM law_ids WHERE user_id = ?`, args: [userId] });
    return res.rows.length ? rowToLawId(res.rows[0]) : null;
}

export async function setLawId(entry: LawIdEntry): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO law_ids (user_id, id_number, name, rank, law_group, age, registration_date, permissions)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET
                id_number = excluded.id_number, name = excluded.name, rank = excluded.rank,
                law_group = excluded.law_group, age = excluded.age,
                registration_date = excluded.registration_date, permissions = excluded.permissions`,
        args: [entry.userId, entry.idNumber, entry.name, entry.rank, entry.lawGroup,
               entry.age, entry.registrationDate, JSON.stringify(entry.permissions)]
    });
}

export async function getLawList(): Promise<LawIdEntry[]> {
    const c = getDb();
    const res = await c.execute(`SELECT * FROM law_ids ORDER BY rank, name`);
    return res.rows.map(rowToLawId);
}

export async function deleteLawId(userId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `DELETE FROM law_ids WHERE user_id = ?`, args: [userId] });
}

// ─── BUSINESS CARD HELPERS ────────────────────────────────────────────────────

export interface BizEntry {
    bizId: string;
    name: string;
    ownerId: string;
    ownerName: string;
    contact: string;
    registeredAt: number;
    status: string;
}

export interface WorkerCardEntry {
    workerId: string;
    userId: string;
    userName: string;
    registeredAt: number;
}

function genId(prefix: string): string {
    return prefix + Math.floor(1000 + Math.random() * 9000).toString();
}

export async function registerBiz(ownerId: string, ownerName: string, name: string, contact = ''): Promise<string> {
    const c = getDb();
    // ensure unique biz_id
    let bizId = genId('BE');
    while ((await c.execute({ sql: `SELECT 1 FROM biz_cards WHERE biz_id = ?`, args: [bizId] })).rows.length) {
        bizId = genId('BE');
    }
    await c.execute({
        sql: `INSERT INTO biz_cards (biz_id, name, owner_id, owner_name, contact, registered_at, status) VALUES (?, ?, ?, ?, ?, ?, 'Registered')`,
        args: [bizId, name, ownerId, ownerName, contact, Date.now()]
    });
    return bizId;
}

export async function getOwnerBizCount(ownerId: string): Promise<number> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT COUNT(*) as cnt FROM biz_cards WHERE owner_id = ?`, args: [ownerId] });
    return Number(res.rows[0]?.cnt ?? 0);
}

export async function getOwnerBizList(ownerId: string): Promise<BizEntry[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM biz_cards WHERE owner_id = ? ORDER BY registered_at ASC`, args: [ownerId] });
    return res.rows.map(r => ({
        bizId: r.biz_id as string, name: r.name as string, ownerId: r.owner_id as string,
        ownerName: r.owner_name as string, contact: r.contact as string,
        registeredAt: Number(r.registered_at), status: r.status as string
    }));
}

export async function getBizById(bizId: string): Promise<BizEntry | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM biz_cards WHERE biz_id = ?`, args: [bizId.toUpperCase()] });
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return { bizId: r.biz_id as string, name: r.name as string, ownerId: r.owner_id as string,
             ownerName: r.owner_name as string, contact: r.contact as string,
             registeredAt: Number(r.registered_at), status: r.status as string };
}

export async function updateBizContact(bizId: string, contact: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `UPDATE biz_cards SET contact = ? WHERE biz_id = ?`, args: [contact, bizId] });
}

export async function updateBizStatus(bizId: string, status: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `UPDATE biz_cards SET status = ? WHERE biz_id = ?`, args: [status, bizId] });
}

export async function getBizStaffCount(bizId: string): Promise<number> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT COUNT(*) as cnt FROM biz_employees WHERE biz_id = ?`, args: [bizId] });
    return Number(res.rows[0]?.cnt ?? 0);
}

export async function getBizStaffList(bizId: string): Promise<{ userId: string; userName: string; hiredAt: number }[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT user_id, user_name, hired_at FROM biz_employees WHERE biz_id = ?`, args: [bizId] });
    return res.rows.map(r => ({ userId: r.user_id as string, userName: r.user_name as string, hiredAt: Number(r.hired_at) }));
}

export async function hireWorker(bizId: string, userId: string, userName: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO biz_employees (biz_id, user_id, user_name, hired_at) VALUES (?, ?, ?, ?) ON CONFLICT(biz_id, user_id) DO NOTHING`,
        args: [bizId, userId, userName, Date.now()]
    });
    // Keep staff_count accurate via count query (no stored count to drift)
}

export async function fireWorker(bizId: string, userId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `DELETE FROM biz_employees WHERE biz_id = ? AND user_id = ?`, args: [bizId, userId] });
}

export async function getWorkerEmployers(userId: string): Promise<{ bizId: string; bizName: string; hiredAt: number }[]> {
    const c = getDb();
    const res = await c.execute({
        sql: `SELECT be.biz_id, bc.name, be.hired_at FROM biz_employees be JOIN biz_cards bc ON be.biz_id = bc.biz_id WHERE be.user_id = ? ORDER BY be.hired_at ASC`,
        args: [userId]
    });
    return res.rows.map(r => ({ bizId: r.biz_id as string, bizName: r.name as string, hiredAt: Number(r.hired_at) }));
}

export async function getWorkerBizIds(userId: string): Promise<string[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT biz_id FROM biz_employees WHERE user_id = ?`, args: [userId] });
    return res.rows.map(r => r.biz_id as string);
}

export async function registerWorkerCard(userId: string, userName: string): Promise<string> {
    const c = getDb();
    // Check if already registered
    const existing = await c.execute({ sql: `SELECT worker_id FROM worker_cards WHERE user_id = ?`, args: [userId] });
    if (existing.rows.length) return existing.rows[0].worker_id as string;
    // ensure unique worker_id
    let workerId = genId('WK');
    while ((await c.execute({ sql: `SELECT 1 FROM worker_cards WHERE worker_id = ?`, args: [workerId] })).rows.length) {
        workerId = genId('WK');
    }
    await c.execute({
        sql: `INSERT INTO worker_cards (worker_id, user_id, user_name, registered_at) VALUES (?, ?, ?, ?)`,
        args: [workerId, userId, userName, Date.now()]
    });
    return workerId;
}

export async function getWorkerCard(userId: string): Promise<WorkerCardEntry | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM worker_cards WHERE user_id = ?`, args: [userId] });
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return { workerId: r.worker_id as string, userId: r.user_id as string, userName: r.user_name as string, registeredAt: Number(r.registered_at) };
}

export async function getWorkerCardById(workerId: string): Promise<WorkerCardEntry | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM worker_cards WHERE worker_id = ?`, args: [workerId.toUpperCase()] });
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return { workerId: r.worker_id as string, userId: r.user_id as string, userName: r.user_name as string, registeredAt: Number(r.registered_at) };
}

// ─── BUSINESS SIM — FULL ENTRY ────────────────────────────────────────────────

export interface BizFullEntry extends BizEntry {
    type: string; plotId: string; balance: number; incomeRate: number;
    lastCollected: number; lastWorked: number; reputation: number;
    isPublic: boolean; isInsured: boolean; securityLevel: number;
    upgradeLevel: number; taxDue: number; defaultSalary: number;
    assets: string[]; isGrinding: boolean; grindStarted: number;
}

function rowToBizFull(r: any): BizFullEntry {
    return {
        bizId: r.biz_id as string, name: r.name as string, ownerId: r.owner_id as string,
        ownerName: r.owner_name as string, contact: r.contact as string,
        registeredAt: Number(r.registered_at), status: r.status as string,
        type: (r.type as string) || 'General', plotId: (r.plot_id as string) || '',
        balance: Number(r.balance ?? 0), incomeRate: Number(r.income_rate ?? 250),
        lastCollected: Number(r.last_collected ?? 0), lastWorked: Number(r.last_worked ?? 0),
        reputation: Number(r.reputation ?? 50), isPublic: Number(r.is_public ?? 1) === 1,
        isInsured: Number(r.is_insured ?? 0) === 1, securityLevel: Number(r.security_level ?? 0),
        upgradeLevel: Number(r.upgrade_level ?? 1), taxDue: Number(r.tax_due ?? 0),
        defaultSalary: Number(r.default_salary ?? 100),
        assets: JSON.parse((r.assets as string) || '[]'),
        isGrinding: Number(r.is_grinding ?? 0) === 1, grindStarted: Number(r.grind_started ?? 0),
    };
}

export async function getBizFull(bizId: string): Promise<BizFullEntry | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM biz_cards WHERE biz_id = ?`, args: [bizId.toUpperCase()] });
    return res.rows.length ? rowToBizFull(res.rows[0]) : null;
}

export async function findBizByName(name: string, ownerId?: string): Promise<BizFullEntry | null> {
    const c = getDb();
    if (name.toUpperCase().startsWith('BE')) {
        const res = await c.execute({ sql: `SELECT * FROM biz_cards WHERE biz_id = ?`, args: [name.toUpperCase()] });
        return res.rows.length ? rowToBizFull(res.rows[0]) : null;
    }
    const sql = ownerId
        ? `SELECT * FROM biz_cards WHERE LOWER(name) = LOWER(?) AND owner_id = ? LIMIT 1`
        : `SELECT * FROM biz_cards WHERE LOWER(name) = LOWER(?) LIMIT 1`;
    const args: any[] = ownerId ? [name, ownerId] : [name];
    const res = await c.execute({ sql, args });
    return res.rows.length ? rowToBizFull(res.rows[0]) : null;
}

export async function searchBizByName(term: string, ownerId: string): Promise<BizFullEntry | null> {
    const c = getDb();
    // Try exact match first, then partial
    const exact = await c.execute({ sql: `SELECT * FROM biz_cards WHERE LOWER(name) = LOWER(?) AND owner_id = ? LIMIT 1`, args: [term, ownerId] });
    if (exact.rows.length) return rowToBizFull(exact.rows[0]);
    const partial = await c.execute({ sql: `SELECT * FROM biz_cards WHERE LOWER(name) LIKE LOWER(?) AND owner_id = ? LIMIT 1`, args: [`%${term}%`, ownerId] });
    return partial.rows.length ? rowToBizFull(partial.rows[0]) : null;
}

export async function updateBizSim(bizId: string, fields: Partial<{
    balance: number; incomeRate: number; lastCollected: number; lastWorked: number;
    reputation: number; isPublic: number; isInsured: number; securityLevel: number;
    upgradeLevel: number; taxDue: number; defaultSalary: number; assets: string;
    isGrinding: number; grindStarted: number; status: string; contact: string; name: string;
    type: string; plotId: string;
}>): Promise<void> {
    const c = getDb();
    const map: Record<string, string> = {
        balance: 'balance', incomeRate: 'income_rate', lastCollected: 'last_collected',
        lastWorked: 'last_worked', reputation: 'reputation', isPublic: 'is_public',
        isInsured: 'is_insured', securityLevel: 'security_level', upgradeLevel: 'upgrade_level',
        taxDue: 'tax_due', defaultSalary: 'default_salary', assets: 'assets',
        isGrinding: 'is_grinding', grindStarted: 'grind_started', status: 'status',
        contact: 'contact', name: 'name', type: 'type', plotId: 'plot_id',
    };
    const sets: string[] = []; const args: any[] = [];
    for (const [k, v] of Object.entries(fields)) {
        if (map[k] !== undefined) { sets.push(`${map[k]} = ?`); args.push(v); }
    }
    if (!sets.length) return;
    args.push(bizId);
    await c.execute({ sql: `UPDATE biz_cards SET ${sets.join(', ')} WHERE biz_id = ?`, args });
}

export async function getPublicBizList(): Promise<BizFullEntry[]> {
    const c = getDb();
    const res = await c.execute(`SELECT * FROM biz_cards WHERE is_public = 1 ORDER BY balance DESC LIMIT 20`);
    return res.rows.map(rowToBizFull);
}

export async function getBizLeaderboard(): Promise<BizFullEntry[]> {
    const c = getDb();
    const res = await c.execute(`SELECT * FROM biz_cards WHERE status != 'Closed' ORDER BY balance DESC LIMIT 10`);
    return res.rows.map(rowToBizFull);
}

export async function getBizEmployee(bizId: string, userId: string): Promise<{ userId: string; userName: string; salary: number; role: string; hiredAt: number } | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM biz_employees WHERE biz_id = ? AND user_id = ?`, args: [bizId, userId] });
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return { userId: r.user_id as string, userName: r.user_name as string, salary: Number(r.salary ?? 100), role: (r.role as string) || 'Employee', hiredAt: Number(r.hired_at) };
}

export async function updateEmployeeField(bizId: string, userId: string, fields: { salary?: number; role?: string }): Promise<void> {
    const c = getDb();
    const sets: string[] = []; const args: any[] = [];
    if (fields.salary !== undefined) { sets.push('salary = ?'); args.push(fields.salary); }
    if (fields.role !== undefined) { sets.push('role = ?'); args.push(fields.role); }
    if (!sets.length) return;
    args.push(bizId, userId);
    await c.execute({ sql: `UPDATE biz_employees SET ${sets.join(', ')} WHERE biz_id = ? AND user_id = ?`, args });
}

export async function getBizEmployeesFull(bizId: string): Promise<{ userId: string; userName: string; salary: number; role: string; hiredAt: number }[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM biz_employees WHERE biz_id = ? ORDER BY role, hired_at ASC`, args: [bizId] });
    return res.rows.map(r => ({ userId: r.user_id as string, userName: r.user_name as string, salary: Number(r.salary ?? 100), role: (r.role as string) || 'Employee', hiredAt: Number(r.hired_at) }));
}

// ─── PLOT HELPERS ─────────────────────────────────────────────────────────────

export interface PlotEntry { plotId: string; ownerId: string; ownerName: string; hasPermit: boolean; permitAt: number | null; bizId: string | null; boughtAt: number; }

function rowToPlot(r: any): PlotEntry {
    return { plotId: r.plot_id as string, ownerId: r.owner_id as string, ownerName: r.owner_name as string, hasPermit: Number(r.has_permit) === 1, permitAt: r.permit_at ? Number(r.permit_at) : null, bizId: (r.biz_id as string) || null, boughtAt: Number(r.bought_at) };
}

export async function buyPlot(ownerId: string, ownerName: string): Promise<string> {
    const c = getDb();
    let plotId = 'PLT' + Math.floor(1000 + Math.random() * 9000);
    while ((await c.execute({ sql: `SELECT 1 FROM plots WHERE plot_id = ?`, args: [plotId] })).rows.length) {
        plotId = 'PLT' + Math.floor(1000 + Math.random() * 9000);
    }
    await c.execute({ sql: `INSERT INTO plots (plot_id, owner_id, owner_name, has_permit, bought_at) VALUES (?, ?, ?, 0, ?)`, args: [plotId, ownerId, ownerName, Date.now()] });
    return plotId;
}

export async function getPlot(plotId: string): Promise<PlotEntry | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM plots WHERE plot_id = ?`, args: [plotId.toUpperCase()] });
    return res.rows.length ? rowToPlot(res.rows[0]) : null;
}

export async function getOwnerPlots(ownerId: string): Promise<PlotEntry[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM plots WHERE owner_id = ? ORDER BY bought_at ASC`, args: [ownerId] });
    return res.rows.map(rowToPlot);
}

export async function grantPermit(plotId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `UPDATE plots SET has_permit = 1, permit_at = ? WHERE plot_id = ?`, args: [Date.now(), plotId] });
}

export async function attachBizToPlot(plotId: string, bizId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `UPDATE plots SET biz_id = ? WHERE plot_id = ?`, args: [bizId, plotId] });
}

// ─── TESLA BOT HELPERS ────────────────────────────────────────────────────────

export interface BotEntry { botId: string; name: string; ownerId: string; bizId: string | null; plotId: string | null; level: number; incomeBonus: number; boughtAt: number; lastMaintained: number; status: string; }

function rowToBot(r: any): BotEntry {
    return { botId: r.bot_id as string, name: r.name as string, ownerId: r.owner_id as string, bizId: (r.biz_id as string) || null, plotId: (r.plot_id as string) || null, level: Number(r.level ?? 1), incomeBonus: Number(r.income_bonus ?? 0.15), boughtAt: Number(r.bought_at), lastMaintained: Number(r.last_maintained ?? 0), status: (r.status as string) || 'Idle' };
}

export async function buyBot(ownerId: string, name: string): Promise<string> {
    const c = getDb();
    const exists = await c.execute({ sql: `SELECT 1 FROM tesla_bots WHERE LOWER(name) = LOWER(?)`, args: [name] });
    if (exists.rows.length) throw new Error(`A Tesla bot named "${name}" already exists.`);
    let botId = 'BOT' + Math.floor(1000 + Math.random() * 9000);
    while ((await c.execute({ sql: `SELECT 1 FROM tesla_bots WHERE bot_id = ?`, args: [botId] })).rows.length) {
        botId = 'BOT' + Math.floor(1000 + Math.random() * 9000);
    }
    await c.execute({ sql: `INSERT INTO tesla_bots (bot_id, name, owner_id, bought_at, status) VALUES (?, ?, ?, ?, 'Idle')`, args: [botId, name, ownerId, Date.now()] });
    return botId;
}

export async function getBot(name: string, ownerId?: string): Promise<BotEntry | null> {
    const c = getDb();
    const sql = ownerId ? `SELECT * FROM tesla_bots WHERE LOWER(name) = LOWER(?) AND owner_id = ? LIMIT 1` : `SELECT * FROM tesla_bots WHERE LOWER(name) = LOWER(?) LIMIT 1`;
    const args = ownerId ? [name, ownerId] : [name];
    const res = await c.execute({ sql, args });
    return res.rows.length ? rowToBot(res.rows[0]) : null;
}

export async function getOwnerBots(ownerId: string): Promise<BotEntry[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM tesla_bots WHERE owner_id = ? ORDER BY bought_at ASC`, args: [ownerId] });
    return res.rows.map(rowToBot);
}

export async function getDeployedBotsForBiz(bizId: string): Promise<BotEntry[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM tesla_bots WHERE biz_id = ?`, args: [bizId] });
    return res.rows.map(rowToBot);
}

export async function updateBot(botId: string, fields: Partial<{ bizId: string | null; plotId: string | null; level: number; incomeBonus: number; status: string; name: string; lastMaintained: number }>): Promise<void> {
    const c = getDb();
    const map: Record<string, string> = { bizId: 'biz_id', plotId: 'plot_id', level: 'level', incomeBonus: 'income_bonus', status: 'status', name: 'name', lastMaintained: 'last_maintained' };
    const sets: string[] = []; const args: any[] = [];
    for (const [k, v] of Object.entries(fields)) { if (map[k]) { sets.push(`${map[k]} = ?`); args.push(v); } }
    if (!sets.length) return;
    args.push(botId);
    await c.execute({ sql: `UPDATE tesla_bots SET ${sets.join(', ')} WHERE bot_id = ?`, args });
}

export async function deleteBot(botId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `DELETE FROM tesla_bots WHERE bot_id = ?`, args: [botId] });
}

// ─── BIZ APPLICATIONS & INVITES ──────────────────────────────────────────────

export async function applyToBiz(bizId: string, userId: string, userName: string, invited = false): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `INSERT INTO biz_applications (biz_id, user_id, user_name, applied_at, invited) VALUES (?, ?, ?, ?, ?) ON CONFLICT(biz_id, user_id) DO NOTHING`, args: [bizId, userId, userName, Date.now(), invited ? 1 : 0] });
}

export async function getBizApplications(bizId: string): Promise<{ userId: string; userName: string; appliedAt: number; invited: boolean }[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM biz_applications WHERE biz_id = ? ORDER BY applied_at ASC`, args: [bizId] });
    return res.rows.map(r => ({ userId: r.user_id as string, userName: r.user_name as string, appliedAt: Number(r.applied_at), invited: Number(r.invited) === 1 }));
}

export async function removeApplication(bizId: string, userId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `DELETE FROM biz_applications WHERE biz_id = ? AND user_id = ?`, args: [bizId, userId] });
}

export async function inviteToBiz(bizId: string, userId: string, invitedBy: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `INSERT INTO biz_invites (biz_id, user_id, invited_by, invited_at) VALUES (?, ?, ?, ?) ON CONFLICT(biz_id, user_id) DO NOTHING`, args: [bizId, userId, invitedBy, Date.now()] });
}

// ─── BIZ TRANSACTIONS ─────────────────────────────────────────────────────────

export async function logBizTx(bizId: string, type: string, amount: number, description: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `INSERT INTO biz_transactions (biz_id, type, amount, description, created_at) VALUES (?, ?, ?, ?, ?)`, args: [bizId, type, amount, description, Date.now()] });
}

export async function getBizTxHistory(bizId: string, limit = 10): Promise<{ type: string; amount: number; description: string; createdAt: number }[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT * FROM biz_transactions WHERE biz_id = ? ORDER BY created_at DESC LIMIT ?`, args: [bizId, limit] });
    return res.rows.map(r => ({ type: r.type as string, amount: Number(r.amount), description: r.description as string, createdAt: Number(r.created_at) }));
}

// ─── BOT SETTINGS (global key/value) ─────────────────────────────────────────

export async function getBotSetting(key: string): Promise<string | null> {
    // Check in-memory cache first
    const cached = sCache.get(key);
    if (cached !== undefined) return cached; // null means key is absent in DB
    // Miss — read from DB once, then cache forever
    const c = getDb();
    const res = await c.execute({ sql: `SELECT value FROM bot_settings WHERE key = ?`, args: [key] });
    const val = res.rows.length ? (res.rows[0].value as string) : null;
    sCache.set(key, val);
    return val;
}

export async function setBotSetting(key: string, value: string): Promise<void> {
    // Write to memory only — deferred DB write
    sCache.set(key, value);
    sDirty.add(key);
    _markDirty();
}

// ─── DAILY / WEEKLY RANK TRACKING ────────────────────────────────────────────

function _todayKey(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function _weekKey(): string {
    const d = new Date();
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day); // nearest Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function incrementRankCount(chatId: string, userId: string, type: 'daily' | 'weekly'): Promise<void> {
    const period = type === 'daily' ? _todayKey() : _weekKey();
    const settingKey = `rank${type === 'daily' ? 'd' : 'w'}:${chatId}:${period}`;
    const raw = await getBotSetting(settingKey);
    const counts: Record<string, number> = raw ? JSON.parse(raw) : {};
    counts[userId] = (counts[userId] || 0) + 1;
    await setBotSetting(settingKey, JSON.stringify(counts));
}

export async function getRankCounts(chatId: string, type: 'daily' | 'weekly'): Promise<Record<string, number>> {
    const period = type === 'daily' ? _todayKey() : _weekKey();
    const settingKey = `rank${type === 'daily' ? 'd' : 'w'}:${chatId}:${period}`;
    const raw = await getBotSetting(settingKey);
    return raw ? JSON.parse(raw) : {};
}
