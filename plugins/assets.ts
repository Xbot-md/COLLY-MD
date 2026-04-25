import type { BotContext } from '../types.js';
import { getWallet, saveWallet, getEcoVault, addToEcoVault, getBotSetting, setBotSetting } from '../lib/turso.js';
import { requireId } from '../lib/idGate.js';
import config from '../config.js';

function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }
function $$(n: number): string {
    if (Math.abs(n) >= 1_000_000_000_000) return `$${(n / 1_000_000_000_000).toFixed(2)}T`;
    if (Math.abs(n) >= 1_000_000_000)     return `$${(n / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(n) >= 1_000_000)         return `$${(n / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 1_000)             return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toLocaleString()}`;
}
function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ── Registry Asset Catalog ────────────────────────────────────────────────────
interface RegistryAsset {
    id:          string;
    name:        string;
    display:     string;
    emoji:       string;
    price:       number;
    sector:      number;
    embargoed:   boolean;
    untaxed?:    boolean;
    embargoNote?: string;
}

const REGISTRY: RegistryAsset[] = [
    // Sector 01 — Micro-Infrastructure
    { id: 'popup-stall',        name: 'pop-up stall',           display: 'Pop-up Stall',           emoji: '🏪', price: 100,               sector: 1, embargoed: false },
    { id: 'small-shop',         name: 'small shop',             display: 'Small Shop',             emoji: '🏬', price: 500,               sector: 1, embargoed: false },
    { id: 'coffee-shop',        name: 'coffee shop setup',      display: 'Coffee Shop Setup',      emoji: '☕', price: 1_000,             sector: 1, embargoed: false },
    { id: 'gadget-lab',         name: 'gadget lab',             display: "Colly's Gadget Lab",     emoji: '🔬', price: 1_500,             sector: 1, embargoed: false },
    { id: 'prototype-hub',      name: 'prototype hub',          display: "David's Prototype Hub",  emoji: '⚙️', price: 2_500,             sector: 1, embargoed: false },
    // Sector 02 — Shadow Ops
    { id: 'lgbtq-grant',        name: 'lgbtq phony grant fund',        display: 'LGBTQ Phony Grant Fund',        emoji: '🏴', price: 4_000,             sector: 2, embargoed: false, untaxed: true },
    { id: 'phishing-center',    name: 'phishing call center',          display: 'Phishing Call Center',          emoji: '📞', price: 80_500,            sector: 2, embargoed: false, untaxed: true },
    { id: 'fake-charity',       name: 'fake charity foundation',       display: 'Fake Charity Foundation',       emoji: '🎭', price: 1_200,             sector: 2, embargoed: false, untaxed: true },
    { id: 'black-market',       name: "nathaneil's black market",      display: "Nathaneil's Black Market",      emoji: '🕶️', price: 1_800_000,         sector: 2, embargoed: false, untaxed: true },
    { id: 'ransomware-cell',    name: 'deepfake ransomware cell',      display: 'Deepfake Ransomware Cell',      emoji: '💀', price: 2_200,             sector: 2, embargoed: false, untaxed: true },
    { id: 'sex-scam',           name: 'private sex scam',              display: 'Private Sex Skm',               emoji: '🔞', price: 2_500_000,         sector: 2, embargoed: false, untaxed: true },
    { id: 'yt-id-scam',         name: 'fake youtuber identity scam',   display: 'Fake YouTuber Identity Scam',   emoji: '📹', price: 8_500_000,         sector: 2, embargoed: false, untaxed: true },
    { id: 'diddy-club',         name: "diddy's freak-off club",        display: "Diddy's Freak-Off Club",        emoji: '🕯️', price: 15_000_000,        sector: 2, embargoed: false, untaxed: true },
    { id: 'epstein-hub',        name: 'epstein island asset hub',      display: 'Epstein Island Asset Hub',      emoji: '🏝️', price: 85_000_000,        sector: 2, embargoed: false, untaxed: true },
    { id: 'sbf-ponzi',          name: 'sbf crypto ponzi scheme',       display: 'SBF Crypto Ponzi Scheme',       emoji: '💸', price: 250_000_000,       sector: 2, embargoed: false, untaxed: true },
    // Sector 03 — Silicon Core
    { id: 'vr-headset',         name: 'vr headset',             display: 'VR Headset',             emoji: '🥽', price: 5_000,             sector: 3, embargoed: false },
    { id: 'gaming-pc',          name: 'gaming pc',              display: 'Gaming PC',              emoji: '🖥️', price: 10_000,            sector: 3, embargoed: false },
    { id: '3d-studio',          name: '3d printing studio',     display: '3D Printing Studio',     emoji: '🖨️', price: 50_000,            sector: 3, embargoed: false },
    { id: 'coding-lab',         name: 'coding lab',             display: 'Coding Lab',             emoji: '💻', price: 400_000,           sector: 3, embargoed: false },
    { id: 'mining-rig',         name: 'crypto mining rig',      display: 'Crypto Mining Rig',      emoji: '⛏️', price: 500_000,           sector: 3, embargoed: false },
    // Sector 04 — Metro Luxury
    { id: 'photo-studio',       name: 'photography studio',     display: 'Photography Studio',     emoji: '📸', price: 80_000,            sector: 4, embargoed: false },
    { id: 'music-production',   name: 'music production',       display: 'Music Production',       emoji: '🎵', price: 150_000,           sector: 4, embargoed: false },
    { id: 'recording-studio',   name: 'recording studio',       display: 'Recording Studio',       emoji: '🎙️', price: 300_000,           sector: 4, embargoed: false },
    { id: 'film-studio',        name: 'film studio',            display: 'Film Studio',            emoji: '🎬', price: 500_000,           sector: 4, embargoed: false },
    { id: 'night-club',         name: 'night club',             display: 'Night Club',             emoji: '🕺', price: 800_000,           sector: 4, embargoed: false },
    { id: 'gay-bar',            name: 'gay bar',                display: 'Gay Bar',                emoji: '🏳️‍🌈', price: 800_000,           sector: 4, embargoed: false },
    // Sector 05 — Legendary Enterprises
    { id: 'mrbeast',            name: 'mrbeast productions',    display: 'MrBeast Productions',    emoji: '🐉', price: 700_000_000,        sector: 5, embargoed: false },
    { id: 'adult-swim',         name: 'adult swim',             display: 'Adult Swim - Rick & Morty', emoji: '🌊', price: 1_200_000_000,  sector: 5, embargoed: false },
    { id: 'rockstar-games',     name: 'rockstar games',         display: 'Rockstar Games - GTA VI',emoji: '🎮', price: 2_000_000_000,      sector: 5, embargoed: false },
    { id: 'epic-games',         name: 'epic games',             display: 'Epic Games - Fortnite',  emoji: '🎯', price: 3_100_000_000,      sector: 5, embargoed: false },
    { id: 'mojang',             name: 'mojang studios',         display: 'Mojang Studios - Minecraft', emoji: '🧱', price: 3_300_000_000, sector: 5, embargoed: false },
    { id: 'nintendo',           name: 'nintendo',               display: 'Nintendo',               emoji: '🎮', price: 8_500_000_000,      sector: 5, embargoed: false },
    { id: 'mappa',              name: 'mappa',                  display: 'MAPPA - Jujutsu Kaisen', emoji: '✒️', price: 12_000_000_000,     sector: 5, embargoed: false },
    { id: 'openai',             name: 'openai',                 display: 'OpenAI',                 emoji: '🤖', price: 300_000_000_000,    sector: 5, embargoed: false },
    { id: 'spacex',             name: 'spacex',                 display: 'SpaceX',                 emoji: '🚀', price: 350_000_000_000,    sector: 5, embargoed: false },
    { id: 'tesla',              name: 'tesla',                  display: 'Tesla Inc.',             emoji: '⚡', price: 650_000_000_000,    sector: 5, embargoed: false },
    // Sovereign Tier — Embargo
    { id: 'colly-novels',       name: 'colly erotic novels',    display: 'Colly Erotic Novels',    emoji: '📚', price: 700_000_000_000,    sector: 99, embargoed: true, embargoNote: 'SEIZED — COURT INJUNCTION'   },
    { id: 'stark-industries',   name: 'stark industries',       display: 'Stark Industries',       emoji: '🦾', price: 400_000_000_000,    sector: 99, embargoed: true, embargoNote: 'NATIONALIZED — DEFENSE ACT' },
    { id: 'quantum-server',     name: 'quantum server',         display: 'Quantum Server',         emoji: '💠', price: 500_000_000_000,    sector: 99, embargoed: true, embargoNote: 'FROZEN — ANTITRUST PROCEEDINGS' },
    { id: 'wayne-enterprises',  name: 'wayne enterprises',      display: 'Wayne Enterprises',      emoji: '🦇', price: 600_000_000_000,    sector: 99, embargoed: true, embargoNote: 'SANCTIONED — EXPORT CONTROL'  },
];

function findAsset(query: string): RegistryAsset | null {
    const q = query.toLowerCase().trim();
    return (
        REGISTRY.find(a => a.id === q) ||
        REGISTRY.find(a => a.name === q) ||
        REGISTRY.find(a => a.name.includes(q) || q.includes(a.name)) ||
        REGISTRY.find(a => a.id.replace(/-/g, ' ').includes(q) || q.includes(a.id.replace(/-/g, ' '))) ||
        null
    );
}

// ── 14 Acquisition Outcomes ───────────────────────────────────────────────────
interface Outcome {
    id:          number;
    weight:      number;
    success:     boolean;
    taxPct:      number;
    freezeSecs:  number;
    payoutMin:   number;
    payoutMax:   number;
    desc:        string;
}

const OUTCOMES: Outcome[] = [
    { id:  1, weight: 70.00, success: true,  taxPct:   0, freezeSecs:      0, payoutMin:        600, payoutMax:       20_000, desc: 'Clean acquisition. Registry approved.' },
    { id:  2, weight: 10.00, success: false, taxPct: 100, freezeSecs:      0, payoutMin:          0, payoutMax:            0, desc: 'Rejected. Full payment seized by Registry.' },
    { id:  3, weight:  5.00, success: false, taxPct:  75, freezeSecs:      0, payoutMin:        500, payoutMax:        1_250, desc: 'Partial failure. Heavy tax, minor recovery.' },
    { id:  4, weight:  5.00, success: false, taxPct: 150, freezeSecs:      0, payoutMin:       -500, payoutMax:       -2_000, desc: 'Acquisition rejected with penalty surcharge.' },
    { id:  5, weight:  4.00, success: false, taxPct:  40, freezeSecs:   3600, payoutMin:        600, payoutMax:        3_000, desc: 'Compliance hold. Account frozen 1 hour.' },
    { id:  6, weight:  2.50, success: false, taxPct: 100, freezeSecs:    600, payoutMin:          0, payoutMax:            0, desc: 'Sanctions enforced. Brief freeze.' },
    { id:  7, weight:  2.00, success: true,  taxPct:   0, freezeSecs:  14400, payoutMin:     15_000, payoutMax:       30_000, desc: 'High-value deal approved — account under review.' },
    { id:  8, weight:  1.00, success: true,  taxPct:   0, freezeSecs:   1800, payoutMin:    100_000, payoutMax:      250_000, desc: 'Windfall acquisition. Brief verification hold.' },
    { id:  9, weight:  0.30, success: false, taxPct: 150, freezeSecs:  43200, payoutMin:    -10_000, payoutMax:      -25_000, desc: 'Red-flag audit. Heavy penalty and 12-hour freeze.' },
    { id: 10, weight:  0.10, success: true,  taxPct:   0, freezeSecs:  86400, payoutMin:  1_000_000, payoutMax:    5_000_000, desc: 'Mega-deal. 24-hour verification hold — worth it.' },
    { id: 11, weight:  0.05, success: false, taxPct: 100, freezeSecs: 129600, payoutMin:          0, payoutMax:            0, desc: 'Seizure order. 36-hour freeze, all funds taken.' },
    { id: 12, weight:  0.03, success: true,  taxPct:   0, freezeSecs:      0, payoutMin: 50_000_000, payoutMax:   90_000_000, desc: 'Legendary deal. Clean acquisition, massive bonus.' },
    { id: 13, weight:  0.01, success: false, taxPct: 200, freezeSecs:      0, payoutMin: -100_000_000, payoutMax: -100_000_000, desc: 'Catastrophic failure. Registry blacklisted you temporarily.' },
    { id: 14, weight:  0.01, success: true,  taxPct:   0, freezeSecs: 259200, payoutMin: 1_000_000_000, payoutMax: 5_000_000_000, desc: 'HISTORIC ACQUISITION. 72-hour compliance lock — you\'re legend.' },
];

const TOTAL_WEIGHT = OUTCOMES.reduce((s, o) => s + o.weight, 0);

function rollOutcome(): Outcome {
    let r = Math.random() * TOTAL_WEIGHT;
    for (const o of OUTCOMES) {
        r -= o.weight;
        if (r <= 0) return o;
    }
    return OUTCOMES[0];
}

// ── Freeze helpers ────────────────────────────────────────────────────────────
const FREEZE_KEY = (userId: string) => `asset_freeze:${userId}`;

async function getFreezeExpiry(userId: string): Promise<number> {
    const val = await getBotSetting(FREEZE_KEY(userId));
    return val ? parseInt(val, 10) : 0;
}

async function setFreeze(userId: string, secs: number): Promise<void> {
    const until = Date.now() + secs * 1000;
    await setBotSetting(FREEZE_KEY(userId), String(until));
}

function fmtDuration(secs: number): string {
    if (secs >= 3600) return `${Math.round(secs / 3600)}h`;
    if (secs >= 60)   return `${Math.round(secs / 60)}m`;
    return `${secs}s`;
}

// ── Old catalog kept for backward compat (.assets / .buycard / .vault) ────────
const OLD_CATALOG = [
    { id: 'land',     name: 'Plot of Land',    emoji: '🌍', price: 1000,  income: 50,  desc: 'A plot of land. Generates passive income.' },
    { id: 'shop',     name: 'Corner Shop',     emoji: '🏪', price: 3000,  income: 150, desc: 'A small shop that earns coins when you work.' },
    { id: 'factory',  name: 'Factory',         emoji: '🏭', price: 8000,  income: 400, desc: 'A factory that generates serious income.' },
    { id: 'robot',    name: 'Work Robot',      emoji: '🤖', price: 5000,  income: 250, desc: 'Automates odd jobs. Earns while you sleep.' },
    { id: 'bankcard', name: 'Premium Bank Card', emoji: '💳', price: 500,  income: 0,  desc: 'Unlocks bank interest and higher withdraw limits.' },
];

function getOwnedOld(inventory: string[]) {
    const counts: Record<string, number> = {};
    for (const id of inventory) { counts[id] = (counts[id] || 0) + 1; }
    return OLD_CATALOG.filter(a => counts[a.id]).map(a => ({ asset: a, level: counts[a.id] }));
}

// ── Registry display text ─────────────────────────────────────────────────────
function buildRegistryText(userName: string, phone: string, balance: number, assetCount: number): string {
    return (
`╔═══════════════════════════════════════╗
║  ◆ *C O L L Y  M D  :  G L O B A L* ◆  ║
║        *R E G I S T R Y  O S*        ║
╚═══════════════════════════════════════╝

*OPERATOR*        :: ${userName}
*PHONE NUMBER*    :: ${phone}
*CAPITAL*         :: ${$$(balance)}
*ASSETS*          :: ${assetCount} Owned
*LEGAL*           :: COMPLIANT
*BUSINESS STATUS* :: ACTIVE

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  *EMPIRE STATUS: ${assetCount > 0 ? '[ ACTIVE PORTFOLIO ]' : '[ NO PORTFOLIO ]'}*  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
${assetCount === 0 ? ' › _Acquire your first asset: .buyasset <name>_\n' : ''}
▰▰

*[ SECTOR 01 - MICRO-INFRASTRUCTURE ]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 › _Entry-level infrastructure for independent operators._

 - *Pop-up Stall* ─ $100
 - *Small Shop* ─ $500
 - *Coffee Shop Setup* ─ $1,000
 - *Colly's Gadget Lab* ─ $1,500
 - *David's Prototype Hub* ─ $2,500

*[ SECTOR 02 - SHADOW OPS ]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 › _High-risk fraudulent operations tagged for surveillance._

 - *LGBTQ Phony Grant Fund* ─ $4,000 *[UNTAXED]*
 - *Fake Charity Foundation* ─ $1,200 *[UNTAXED]*
 - *Deepfake Ransomware Cell* ─ $2,200 *[UNTAXED]*
 - *Phishing Call Center* ─ $80,500 *[UNTAXED]*
 - *Nathaneil's Black Market* ─ $1.8M *[UNTAXED]*
 - *Private Sex Skm* ─ $2.5M *[UNTAXED]*
 - *Fake YouTuber Identity Scam* ─ $8.5M *[UNTAXED]*
 - *Diddy's Freak-Off Club* ─ $15M *[UNTAXED]*
 - *Epstein Island Asset Hub* ─ $85M *[UNTAXED]*
 - *SBF Crypto Ponzi Scheme* ─ $250M *[UNTAXED]*

*[ SECTOR 03 - SILICON CORE ]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 › _Advanced tech assets for digital entrepreneurs._

 - *VR Headset* ─ $5,000
 - *Gaming PC* ─ $10,000
 - *3D Printing Studio* ─ $50,000
 - *Coding Lab* ─ $400,000
 - *Crypto Mining Rig* ─ $500,000

*[ SECTOR 04 - METRO LUXURY ]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 › _High-end entertainment and media ventures._

 - *Photography Studio* ─ $80,000
 - *Music Production* ─ $150,000
 - *Recording Studio* ─ $300,000
 - *Film Studio* ─ $500,000
 - *Night Club* ─ $800,000
 - *Gay Bar* ─ $800,000

*[ SECTOR 05 - LEGENDARY ENTERPRISES ]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 › _Global-tier corporations for industry domination._

 - *MrBeast Productions* ─ $700M
 - *Adult Swim - Rick and Morty* ─ $1.2B
 - *Rockstar Games - GTA VI* ─ $2B
 - *Epic Games - Fortnite* ─ $3.1B
 - *Mojang Studios - Minecraft* ─ $3.3B
 - *Nintendo* ─ $8.5B
 - *MAPPA - Jujutsu Kaisen* ─ $12B
 - *OpenAI* ─ $300B
 - *SpaceX* ─ $350B
 - *Tesla Inc.* ─ $650B

*[ SOVEREIGN TIER - EMBARGO ]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 › _Restricted assets under Registry sanction._

 - *Colly Erotic Novels* ─ $700B *[SEIZED - COURT INJUNCTION]*
 - *Stark Industries* ─ $400B *[NATIONALIZED - DEFENSE ACT]*
 - *Quantum Server* ─ $500B *[FROZEN - ANTITRUST PROCEEDINGS]*
 - *Wayne Enterprises* ─ $600B *[SANCTIONED - EXPORT CONTROL]*

*[ SECURITY PROTOCOL ]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 › _Registry compliance and acquisition framework._

 - *Acquisition Command*: \`.buyasset <name>\`
 - *Compliance Notice*: Untaxed operations trigger Registry enforcement.
 - *Enforcement Actions*: Revenue Audit | Tax Withholding | Account Freeze

▰▰
[ PORTFOLIO ] .myregistry  |  [ MANUAL ] .guide  |  [ TERMS ] .terms`
    );
}

export default [
    // ── .vault ───────────────────────────────────────────────────────────────
    {
        command:     'vault',
        aliases:     ['ecovault', 'treasury'],
        category:    'economy',
        description: 'View the community economy vault',
        usage:       '.vault',
        async handler(sock: any, message: any, _args: string[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const vaultAmt = await getEcoVault();
            await sock.sendMessage(chatId, {
                text:
                    `┌─〔 🏛️ 𝐄𝐂𝐎𝐍𝐎𝐌𝐘 𝐕𝐀𝐔𝐋𝐓 〕──────────┈⊷\n` +
                    `┆\n` +
                    `┆  🏦 *Community Vault Balance*\n` +
                    `┆  💰 ${$$(vaultAmt)}\n` +
                    `┆\n` +
                    `┆  _This vault holds fines, court fees,_\n` +
                    `┆  _tax seizures and community funds._\n` +
                    `┆\n` +
                    `└──────────────────────────────────┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ── .buycard ─────────────────────────────────────────────────────────────
    {
        command:     'buycard',
        aliases:     ['getcard', 'premiumcard', 'buycard2'],
        category:    'economy',
        description: 'Buy a Premium Bank Card',
        usage:       '.buycard',
        async handler(sock: any, message: any, _args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const CARD_PRICE = 500;
            if (w.inventory.includes('bankcard')) {
                return sock.sendMessage(chatId, {
                    text: `💳 *You already have a Premium Bank Card!*\n\n✅ Perks: 2% bank interest · higher withdraw limit · priority loan approval`,
                    ...channelInfo
                }, { quoted: message });
            }
            if (w.balance < CARD_PRICE) {
                return sock.sendMessage(chatId, {
                    text: `❌ A Premium Bank Card costs *$500*.\nYour balance: *${$$(w.balance)}*`,
                    ...channelInfo
                }, { quoted: message });
            }
            w.balance -= CARD_PRICE;
            w.inventory.push('bankcard');
            await saveWallet(w);
            await sock.sendMessage(chatId, {
                text: `💳 *Premium Bank Card Purchased!*\n\n✅ Perks unlocked:\n• 2% interest on bank balance\n• Higher withdraw limit\n• Priority loan approval\n\n💵 *New balance:* ${$$(w.balance)}`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ── .assets / .myassets ───────────────────────────────────────────────────
    {
        command:     'assets',
        aliases:     ['myassets', 'properties', 'myregistry', 'portfolio'],
        category:    'economy',
        description: 'View your owned assets and Registry portfolio',
        usage:       '.assets [@user]',
        async handler(sock: any, message: any, _args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const target = mentioned || senderId;
            const name = mentioned
                ? (message.message?.extendedTextMessage?.contextInfo?.pushName || cleanJid(target))
                : (message.pushName || cleanJid(senderId));
            const w = await getWallet(target, name);

            const regOwned  = REGISTRY.filter(a => !a.embargoed && w.inventory.includes(a.id));
            const oldOwned  = getOwnedOld(w.inventory);
            const hasCard   = w.inventory.includes('bankcard');
            const freezeExp = await getFreezeExpiry(target);
            const frozen    = Date.now() < freezeExp;

            if (regOwned.length === 0 && oldOwned.length === 0 && !hasCard) {
                return sock.sendMessage(chatId, {
                    text: `🏠 *${w.name || cleanJid(target)}* owns no assets yet.\n\n_Use .registry to browse the market, then .buyasset <name> to acquire one._`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }

            let text = `┌─〔 🏛️ 𝐑𝐄𝐆𝐈𝐒𝐓𝐑𝐘 𝐏𝐎𝐑𝐓𝐅𝐎𝐋𝐈𝐎 〕────────┈⊷\n`;
            text += `┆  👤 *${w.name || cleanJid(target)}*\n`;
            if (frozen) text += `┆  🔒 *Account Frozen* until ${new Date(freezeExp).toLocaleTimeString()}\n`;
            text += `┆\n`;

            if (regOwned.length) {
                text += `┆  *[ Registry Assets ]*\n`;
                for (const a of regOwned) {
                    text += `┆  ${a.emoji} *${a.display}*\n`;
                    text += `┆     Sector ${a.sector < 99 ? `0${a.sector}` : 'Sovereign'} | Value: ${$$(a.price)}\n`;
                }
                text += `┆\n`;
            }
            if (oldOwned.length) {
                text += `┆  *[ Economy Assets ]*\n`;
                for (const { asset, level } of oldOwned) {
                    if (asset.id === 'bankcard') continue;
                    text += `┆  ${asset.emoji} *${asset.name}* ×${level}`;
                    if (asset.income) text += ` — +$${(asset.income * level).toLocaleString()}/claim`;
                    text += `\n`;
                }
                text += `┆\n`;
            }
            if (hasCard) text += `┆  💳 *Premium Bank Card* — Active\n┆\n`;
            text += `┆  📊 *Total Registry Assets:* ${regOwned.length}\n`;
            text += `└──────────────────────────────────────┈⊷`;

            await sock.sendMessage(chatId, { text, mentions: [target], ...channelInfo }, { quoted: message });
        }
    },

    // ── .registry ─────────────────────────────────────────────────────────────
    {
        command:     'registry',
        aliases:     ['assetmarket', 'regsitry', 'registy'],
        category:    'economy',
        description: 'View the COLLY MD Global Registry asset market',
        usage:       '.registry',
        async handler(sock: any, message: any, _args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const assetCount = REGISTRY.filter(a => !a.embargoed && w.inventory.includes(a.id)).length;
            const phone = cleanJid(senderId);
            await sock.sendMessage(chatId, {
                text: buildRegistryText(w.name || phone, phone, w.balance, assetCount),
                ...channelInfo,
            }, { quoted: message });
        }
    },

    // ── .buyasset ─────────────────────────────────────────────────────────────
    {
        command:     'buyasset',
        aliases:     ['acquire', 'getasset', 'purchaseasset'],
        category:    'economy',
        description: 'Attempt to acquire a Registry asset (ID required)',
        usage:       '.buyasset <asset name>',
        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;

            if (!args.length) {
                return sock.sendMessage(chatId, {
                    text: `🏛️ *Registry Asset Acquisition*\n\nUsage: *.buyasset <asset name>*\n\nExamples:\n• \`.buyasset small shop\`\n• \`.buyasset gaming pc\`\n• \`.buyasset mrbeast productions\`\n\n_View the full market: .registry_`,
                    ...channelInfo
                }, { quoted: message });
            }

            const query = args.join(' ');
            const asset = findAsset(query);

            if (!asset) {
                return sock.sendMessage(chatId, {
                    text: `❌ *"${query}"* not found in the Registry.\n\n_Use .registry to browse all available assets._`,
                    ...channelInfo
                }, { quoted: message });
            }

            if (asset.embargoed) {
                return sock.sendMessage(chatId, {
                    text:
                        `🚫 *ACQUISITION BLOCKED*\n\n` +
                        `${asset.emoji} *${asset.display}* is under Registry embargo.\n\n` +
                        `*Status:* ${asset.embargoNote}\n\n` +
                        `_This asset is not available for private acquisition. Registry enforcement is in effect._`,
                    ...channelInfo
                }, { quoted: message });
            }

            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));

            const freezeExp = await getFreezeExpiry(senderId);
            if (Date.now() < freezeExp) {
                const remaining = Math.ceil((freezeExp - Date.now()) / 1000);
                return sock.sendMessage(chatId, {
                    text:
                        `🔒 *Account Frozen*\n\n` +
                        `Your account is under Registry compliance hold.\n` +
                        `*Unfreezes in:* ${fmtDuration(remaining)}\n\n` +
                        `_You cannot acquire assets while your account is frozen._`,
                    ...channelInfo
                }, { quoted: message });
            }

            if (w.balance < asset.price) {
                return sock.sendMessage(chatId, {
                    text:
                        `❌ *Insufficient Capital*\n\n` +
                        `${asset.emoji} *${asset.display}* requires *${$$(asset.price)}*\n` +
                        `Your capital: *${$$(w.balance)}*\n\n` +
                        `_Earn more with .work, .grind, .daily, or .crime._`,
                    ...channelInfo
                }, { quoted: message });
            }

            // Already owns it?
            if (w.inventory.includes(asset.id)) {
                return sock.sendMessage(chatId, {
                    text: `⚠️ You already own *${asset.display}* in your Registry portfolio.\n\n_View your assets: .assets_`,
                    ...channelInfo
                }, { quoted: message });
            }

            // Deduct acquisition cost
            w.balance -= asset.price;
            await saveWallet(w);

            // Roll outcome
            const outcome = rollOutcome();
            const payout  = outcome.payoutMin === outcome.payoutMax
                ? outcome.payoutMin
                : rand(Math.min(outcome.payoutMin, outcome.payoutMax), Math.max(outcome.payoutMin, outcome.payoutMax));

            // Apply tax seizure — skipped for UNTAXED shadow ops assets
            const taxAmount = asset.untaxed ? 0 : Math.floor(asset.price * (outcome.taxPct / 100));
            if (taxAmount > 0) {
                w.balance = Math.max(0, w.balance - taxAmount);
                await addToEcoVault(taxAmount);
            }

            // Apply payout (can be negative = further loss)
            w.balance = Math.max(0, w.balance + payout);

            // Apply freeze
            if (outcome.freezeSecs > 0) {
                await setFreeze(senderId, outcome.freezeSecs);
            }

            // Add asset to inventory on success
            if (outcome.success) {
                w.inventory.push(asset.id);
            }

            await saveWallet(w);

            // Build response
            const statusIcon = outcome.success ? '✅' : '❌';
            const statusLabel = outcome.success ? 'ACQUISITION SUCCESSFUL' : 'ACQUISITION FAILED';
            const payoutLabel = payout >= 0
                ? `+${$$(payout)} bonus`
                : `${$$(payout)} penalty`;

            let text =
                `┌─〔 🏛️ 𝐑𝐄𝐆𝐈𝐒𝐓𝐑𝐘 𝐀𝐂𝐐𝐔𝐈𝐒𝐈𝐓𝐈𝐎𝐍 〕────────┈⊷\n` +
                `┆\n` +
                `┆  ${statusIcon} *${statusLabel}*\n` +
                `┆  *Outcome ID:* #${String(outcome.id).padStart(2, '0')}\n` +
                `┆\n` +
                `┆  ${asset.emoji} *${asset.display}*\n` +
                `┆  Sector 0${asset.sector}${asset.untaxed ? ' | ⚠️ *UNTAXED — SHADOW OPS*' : ''} | Listed: ${$$(asset.price)}\n` +
                `┆\n` +
                `┆  *[ OUTCOME BREAKDOWN ]*\n` +
                `┆  ├ Asset Cost:   -${$$(asset.price)}\n`;

            if (taxAmount > 0) {
                text += `┆  ├ Tax Seized:  -${$$(taxAmount)} (${outcome.taxPct}%)\n`;
            }
            if (payout !== 0) {
                text += `┆  ├ Registry Pay: ${payoutLabel}\n`;
            }
            if (outcome.freezeSecs > 0) {
                text += `┆  ├ Account Freeze: ${fmtDuration(outcome.freezeSecs)}\n`;
            }

            text +=
                `┆  └ Net Balance: ${$$(w.balance)}\n` +
                `┆\n` +
                `┆  _"${outcome.desc}"_\n` +
                `┆\n` +
                `└──────────────────────────────────────┈⊷`;

            if (outcome.success) {
                text += `\n\n_View your portfolio: .assets_`;
            } else {
                text += `\n\n_Better luck next time. Use .registry to browse again._`;
            }

            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        }
    },

    // ── .upgrade ──────────────────────────────────────────────────────────────
    {
        command:     'upgrade',
        aliases:     ['upgradeasset', 'levelup'],
        category:    'economy',
        description: 'Upgrade a legacy economy asset to increase income',
        usage:       '.upgrade <land|shop|factory|robot>',
        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            if (!args[0]) {
                return sock.sendMessage(chatId, {
                    text: `❌ Usage: .upgrade <land|shop|factory|robot>\n\n_Upgrading doubles the income. Cost = original price × current level._`,
                    ...channelInfo
                }, { quoted: message });
            }
            const assetId = args[0].toLowerCase();
            const asset = OLD_CATALOG.find(a => a.id === assetId && a.id !== 'bankcard');
            if (!asset) {
                return sock.sendMessage(chatId, {
                    text: `❌ Unknown asset *"${args[0]}"*.\nUpgradeable: land, shop, factory, robot`,
                    ...channelInfo
                }, { quoted: message });
            }
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const level = w.inventory.filter(id => id === asset.id).length;
            if (level === 0) {
                return sock.sendMessage(chatId, {
                    text: `❌ You don't own a *${asset.name}* yet.\n\nBuy one with *.buyasset ${asset.id}*`,
                    ...channelInfo
                }, { quoted: message });
            }
            const MAX = 5;
            if (level >= MAX) {
                return sock.sendMessage(chatId, { text: `✅ Your *${asset.name}* is already at max level (${MAX})!`, ...channelInfo }, { quoted: message });
            }
            const cost = asset.price * level;
            if (w.balance < cost) {
                return sock.sendMessage(chatId, {
                    text: `❌ Upgrading *${asset.name}* to level ${level + 1} costs *$${cost.toLocaleString()}*.\nYour balance: *${$$(w.balance)}*`,
                    ...channelInfo
                }, { quoted: message });
            }
            w.balance -= cost;
            w.inventory.push(asset.id);
            await saveWallet(w);
            await sock.sendMessage(chatId, {
                text:
                    `${asset.emoji} *Asset Upgraded!*\n\n` +
                    `*${asset.name}* → Level *${level + 1}*\n` +
                    `💰 *New income:* +$${(asset.income * (level + 1)).toLocaleString()} per claim\n` +
                    `💵 *New balance:* ${$$(w.balance)}`,
                ...channelInfo
            }, { quoted: message });
        }
    },
];
