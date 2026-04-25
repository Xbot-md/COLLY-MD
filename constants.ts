export const TURSO_URL  = 'libsql://collins-b-davidxtech.aws-eu-west-1.turso.io';
export const TURSO_AUTH = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzU5ODYyMTMsImlkIjoiMDE5ZDgxMDYtZDIwMS03M2ZlLTgzZDgtZDVkOWJlYzI5MmEwIiwicmlkIjoiZGJmY2U3Y2EtNTBjMi00YWE1LTg5YmYtMDVmMTAyN2U5YzBhIn0.PSgMalxpZsqd1db3uPpC976WqQXGCY9yCn-i14Nw6ObgHXaAcuuK1nuZpUS9eBvK62JKfOCa6LTfhGh2qDCeBw';

export const DEFAULT_SHOP_ITEMS = [
    // ── COLLY SHOP ───────────────────────────────────────────────────────────
    { id: 'vip',               name: 'VIP Badge',               price: 5_000,              emoji: '💎', description: 'Flex your VIP status' },
    { id: 'shield',            name: 'Rob Shield',              price: 2_000,              emoji: '🛡️', description: 'Protection from robbery for 24h' },
    { id: 'lucky',             name: 'Lucky Charm',             price: 1_500,              emoji: '🍀', description: 'Boost gamble odds for 1 game' },
    { id: 'king',              name: 'King Crown',              price: 10_000,             emoji: '👑', description: 'Rare crown item — ultra flex' },
    { id: 'ticket',            name: 'Lottery Ticket',          price: 500,                emoji: '🎫', description: 'Enter the weekly lottery' },

    // ── BLACK MARKET — CONSUMABLES & RATIONS ─────────────────────────────────
    { id: 'energy_drink',      name: 'Energy Drink',            price: 150,                emoji: '🥤', description: '+10% Work Cash on next shift' },
    { id: 'protein_bar',       name: 'Protein Bar',             price: 200,                emoji: '🍫', description: 'Instantly gain 50 XP' },
    { id: 'neon_water',        name: 'Neon Water',              price: 500,                emoji: '💧', description: '-5 minutes off your work cooldown' },
    { id: 'data_tacos',        name: 'Data Tacos',              price: 8_000,              emoji: '🌮', description: 'Fully reset your work cooldown' },

    // ── BLACK MARKET — MEDICAL & LEGAL ───────────────────────────────────────
    { id: 'medkit',            name: 'Advanced Medkit',         price: 15_000,             emoji: '🩺', description: 'Heals injuries & clears debuffs' },
    { id: 'corrupt_colly',     name: 'Corrupted Colly',         price: 5_500_000_000,      emoji: '⚖️', description: 'Bypass court. No fines. No violations.' },

    // ── BLACK MARKET — ARMORY ─────────────────────────────────────────────────
    { id: 'brass_knuckles',    name: 'Brass Knuckles',          price: 25_000,             emoji: '🥊', description: '+10% Rob payout on next heist' },
    { id: 'taser_baton',       name: 'Taser Baton',             price: 50_000,             emoji: '⚡', description: 'Stun & win any battle' },
    { id: 'combat_katana',     name: 'Combat Katana',           price: 250_000,            emoji: '🗡️', description: 'Massive damage. Dominate duels.' },
    { id: 'silenced_pistol',   name: 'Silenced Pistol',         price: 150_000_000,        emoji: '🔫', description: '2x Heist Luck & Tactical Kills' },
    { id: 'm4a1',              name: 'M4A1 Assault Rifle',      price: 950_000_000,        emoji: '🪖', description: 'Ultimate Firepower. Never Lose.' },

    // ── BLACK MARKET — TACTICAL & TOOLS ──────────────────────────────────────
    { id: 'broken_hourglass',  name: 'Broken Hourglass',        price: 500,                emoji: '⏳', description: 'Resets a random cooldown instantly' },
    { id: 'temu_parcel',       name: 'Temu Mystery Parcel',     price: 1_500,              emoji: '📦', description: 'Cheap box — random useful item inside' },
    { id: 'lockpick_set',      name: 'Lockpick Set',            price: 20_000,             emoji: '🔓', description: '100% Rob success on next attempt' },
    { id: 'elon_chip',         name: 'Elon Musk Chip',          price: 1_200_000_000,      emoji: '🧠', description: 'Hack electronic locks (future use)' },
    { id: 'tate_bugatti_key',  name: 'Bugatti Key',             price: 12_000_000_000,     emoji: '🚗', description: '+50% Rob success rate permanently' },

    // ── BLACK MARKET — THE OVERLOAD ───────────────────────────────────────────
    { id: 'chronos_wand',      name: 'Chronos Wand',            price: 18_000_000_000,     emoji: '🔮', description: 'Reset ALL cooldowns at once' },
    { id: 'infinity_battery',  name: 'Infinity Battery',        price: 25_000_000_000,     emoji: '🔋', description: '1 Hour: zero work cooldown' },
    { id: 'ghost_protocol',    name: 'Ghost Protocol',          price: 30_000_000_000,     emoji: '👻', description: 'Zero heat gain for 1 hour' },
    { id: 'master_keycard',    name: 'Master Keycard',          price: 50_000_000_000,     emoji: '🪪', description: '100% Hack Success (future use)' },

    // ── BLACK MARKET — ELITE ACQUISITIONS ────────────────────────────────────
    { id: 'mrbeast_box',       name: 'MrBeast Mystery Box',     price: 800_000_000,        emoji: '🎁', description: 'Huge payout or rare item — you decide' },
];

export const BOT_OWNERS = ['2349133354644', '61474858176'];
