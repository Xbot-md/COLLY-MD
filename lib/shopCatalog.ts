// Central shop catalog. Each item: id, name, price, description, useText, effect kind.
// `kind` controls what `.use` does. `target` controls which shop sells it.

export type ShopId = 'supermarket' | 'drug' | 'market' | 'hunter';

export interface CatalogItem {
  id: string;            // canonical id used in .buy / .use / inventory storage
  name: string;          // display name
  price: number;         // cost in coins
  shop: ShopId;          // which shop sells it
  category: string;      // section header on the menu
  desc: string;          // one-liner shown in the menu under "↳"
  effect: ItemEffect;    // what happens on .use
  consumable?: boolean;  // default true; if false, item stays after use (e.g. clubcard)
  scaling?: boolean;     // for items whose price doubles each purchase (rick_gun)
}

export type ItemEffect =
  | { kind: 'buff'; stat: string; mult?: number; flat?: number; durationMs: number; note?: string }
  | { kind: 'cure'; status: string }
  | { kind: 'unlock'; feature: string }
  | { kind: 'cooldown_skip'; charges: number }
  | { kind: 'cooldown_reset_all' }
  | { kind: 'gamble'; min: number; max: number }
  | { kind: 'level_swing'; min: number; max: number }
  | { kind: 'shield'; durationMs: number }
  | { kind: 'curse'; durationMs: number; penalty: number }
  | { kind: 'insurance'; pct: number; durationMs: number }
  | { kind: 'poor_status'; durationMs: number }
  | { kind: 'crime_tool'; tool: 'vault_cracker' | 'backdoor' | 'grabber' | 'shield_breaker' | 'scanner' }
  | { kind: 'discount_card'; pct: number; durationMs: number }
  | { kind: 'instant_xp'; amount: number }
  | { kind: 'note'; text: string };

const H = 3_600_000, M = 60_000, D = 86_400_000;

export const CATALOG: CatalogItem[] = [
  // ── ⚡ ENERGY & RECOVERY ───────────────────────────────────────────────
  { id: 'monster',         name: 'Monster Energy',          price: 350,        shop: 'supermarket', category: '⚡ ENERGY & RECOVERY',
    desc: '+25 Energy + +15% Pay 30m',           effect: { kind: 'buff', stat: 'pay',      mult: 1.15, flat: 25, durationMs: 30 * M, note: '+25 energy, +15% pay 30m' } },
  { id: 'redbull',         name: 'Red Bull 4-Pack',         price: 1_600,      shop: 'supermarket', category: '⚡ ENERGY & RECOVERY',
    desc: '2x XP for 3h + -25% Cooldown',         effect: { kind: 'buff', stat: 'xp',       mult: 2.0,  durationMs: 3 * H,  note: '2x XP, -25% cooldown 3h' } },
  { id: 'bioplus',         name: 'Bioplus 10-Pack',         price: 1_100,      shop: 'supermarket', category: '⚡ ENERGY & RECOVERY',
    desc: '+50 Energy over 10min',                effect: { kind: 'buff', stat: 'energy',   flat: 50,   durationMs: 10 * M, note: '+50 energy over 10m' } },
  { id: 'golden_apple',    name: 'Enchanted Golden Apple',  price: 8_500_000,  shop: 'supermarket', category: '⚡ ENERGY & RECOVERY',
    desc: '+100 Energy + 100 Health + +50% All Stats 30m',
                                                  effect: { kind: 'buff', stat: 'all',      mult: 1.5,  flat: 100,  durationMs: 30 * M, note: 'God mode 30m' } },

  // ── 🧺 PHARMACY ────────────────────────────────────────────────────────
  { id: 'grandpa',         name: 'Grand-Pa Headache',       price: 300,        shop: 'supermarket', category: '🧺 PHARMACY',
    desc: "ONLY cure for 'Tired' + 25 Energy",    effect: { kind: 'cure', status: 'tired' } },
  { id: 'medlemon',        name: 'Med Lemon Sachet',        price: 3_750,      shop: 'supermarket', category: '🧺 PHARMACY',
    desc: '100 Health',                           effect: { kind: 'buff', stat: 'health',   flat: 100,  durationMs: 0, note: '+100 HP' } },
  { id: 'lawyer',          name: 'Legal Counsel Retainer',  price: 15_000,     shop: 'supermarket', category: '🧺 PHARMACY',
    desc: "Removes 'Lay Low' Status",             effect: { kind: 'cure', status: 'lay_low' } },

  // ── 🔧 WORK GEAR ───────────────────────────────────────────────────────
  { id: 'work_gloves',     name: 'Leather Work Gloves',     price: 1_400,      shop: 'supermarket', category: '🔧 WORK GEAR',
    desc: '-15% Work Cooldown 2h',                effect: { kind: 'buff', stat: 'work_cd',  mult: 0.85, durationMs: 2 * H, note: '-15% work cd 2h' } },
  { id: 'boots',           name: 'Steel Cap Boots',         price: 9_000,      shop: 'supermarket', category: '🔧 WORK GEAR',
    desc: 'Unlock Construction + +5% Pay',        effect: { kind: 'unlock', feature: 'construction' }, consumable: false },
  { id: 'drill',           name: 'Bosch Cordless Drill',    price: 27_500,     shop: 'supermarket', category: '🔧 WORK GEAR',
    desc: '+20% Work Payout 4h',                  effect: { kind: 'buff', stat: 'pay',      mult: 1.20, durationMs: 4 * H, note: '+20% work pay 4h' } },
  { id: 'comfort_boots',   name: 'Comfort Work Boots',      price: 40_000,     shop: 'supermarket', category: '🔧 WORK GEAR',
    desc: 'All Earnings x1.25 for 6h',            effect: { kind: 'buff', stat: 'pay',      mult: 1.25, durationMs: 6 * H, note: '+25% all earnings 6h' } },

  // ── 💀 BLACK MARKET HACKS (sold here too) ──────────────────────────────
  { id: 'vault_cracker',   name: 'Vault Cracker v3',        price: 25_000_000, shop: 'supermarket', category: '💀 BLACK MARKET HACKS',
    desc: '40% chance vault hack 5-15% | 60% fail + Lay Low 2h',
                                                  effect: { kind: 'crime_tool', tool: 'vault_cracker' } },
  { id: 'backdoor',        name: 'Business Backdoor',       price: 50_000_000, shop: 'supermarket', category: '💀 BLACK MARKET HACKS',
    desc: '35% chance hack biz 10-25% | 65% fail + bounty',
                                                  effect: { kind: 'crime_tool', tool: 'backdoor' } },
  { id: 'grabber',         name: 'Phantom Grabber',         price: 35_000_000, shop: 'supermarket', category: '💀 BLACK MARKET HACKS',
    desc: '50% chance steal 1 item | 50% fail + notify',
                                                  effect: { kind: 'crime_tool', tool: 'grabber' } },
  { id: 'shield_breaker',  name: 'Shield Breaker',          price: 500_000,    shop: 'supermarket', category: '💀 BLACK MARKET HACKS',
    desc: "Removes 1 random player's rob shield",  effect: { kind: 'crime_tool', tool: 'shield_breaker' } },
  { id: 'scanner',         name: 'Scanner App',             price: 2_000_000,  shop: 'supermarket', category: '💀 BLACK MARKET HACKS',
    desc: 'Shows players with Shields/Curses',     effect: { kind: 'crime_tool', tool: 'scanner' } },
  { id: 'curse',           name: 'Curse Contract',          price: 750_000,    shop: 'supermarket', category: '💀 BLACK MARKET HACKS',
    desc: 'Robbers lose 5,000 🪙 if they try you', effect: { kind: 'curse', durationMs: 7 * D, penalty: 5_000 } },
  { id: 'insurance',       name: 'Theft Insurance',         price: 25_000,     shop: 'supermarket', category: '💀 BLACK MARKET HACKS',
    desc: 'Recover 60% if robbed, 24h',           effect: { kind: 'insurance', pct: 0.6, durationMs: 24 * H } },
  { id: 'poor_contract',   name: 'Bankruptcy Contract',     price: 10_000_000, shop: 'supermarket', category: '💀 BLACK MARKET HACKS',
    desc: "'Poor' status — unrobbable 24h",        effect: { kind: 'poor_status', durationMs: 24 * H } },

  // ── 👽 RICK & MORTY IMPORTS ────────────────────────────────────────────
  { id: 'szechuan',        name: 'Szechuan Sauce',          price: 1_500_000,  shop: 'supermarket', category: '👽 RICK & MORTY IMPORTS',
    desc: '+50 Energy + +25% Pay 1h + quote',     effect: { kind: 'buff', stat: 'pay',      mult: 1.25, flat: 50, durationMs: 1 * H,  note: '+25% pay 1h' } },
  { id: 'roy',             name: 'Roy Game Cartridge',      price: 15_000_000, shop: 'supermarket', category: '👽 RICK & MORTY IMPORTS',
    desc: 'Auto-complete 1 Work + 200 XP',        effect: { kind: 'instant_xp', amount: 200 } },
  { id: 'plumbus',         name: 'Plumbus',                 price: 5_000_000,  shop: 'supermarket', category: '👽 RICK & MORTY IMPORTS',
    desc: '+10% ALL stats 3h',                    effect: { kind: 'buff', stat: 'all',      mult: 1.1,  durationMs: 3 * H,  note: '+10% all 3h' } },
  { id: 'microverse',      name: 'Microverse Battery',      price: 250_000_000,shop: 'supermarket', category: '👽 RICK & MORTY IMPORTS',
    desc: 'Infinite Energy 30min, 24h cooldown',  effect: { kind: 'buff', stat: 'energy',   mult: 999,  durationMs: 30 * M, note: '∞ energy 30m' } },
  { id: 'portal_fluid',    name: 'Portal Fluid',            price: 80_000_000, shop: 'supermarket', category: '👽 RICK & MORTY IMPORTS',
    desc: 'Skip 5 Work Cooldowns',                effect: { kind: 'cooldown_skip', charges: 5 } },
  { id: 'rick_gun',        name: "Rick's Portal Device",    price: 2_500_000_000, shop: 'supermarket', category: '👽 RICK & MORTY IMPORTS',
    desc: 'Reset ALL Cooldowns + Clear Bills/Tax. Price doubles each use. Resets monthly.',
                                                  effect: { kind: 'cooldown_reset_all' }, scaling: true },

  // ── 💳 SERVICES & EXTRAS ───────────────────────────────────────────────
  { id: 'lotto',           name: 'Lotto Ticket',            price: 568_000,    shop: 'supermarket', category: '💳 SERVICES & EXTRAS',
    desc: 'Win 2 - 2,000,000 🪙',                  effect: { kind: 'gamble', min: 2, max: 2_000_000 } },
  { id: 'scratch',         name: 'Scratch Card',            price: 700_000,    shop: 'supermarket', category: '💳 SERVICES & EXTRAS',
    desc: 'Win 2 - 2,000,000 🪙',                  effect: { kind: 'gamble', min: 2, max: 2_000_000 } },
  { id: 'level_vial',      name: 'Lucky Level Vial',        price: 12_000_000, shop: 'supermarket', category: '💳 SERVICES & EXTRAS',
    desc: 'Random Level -5 to +15',               effect: { kind: 'level_swing', min: -5, max: 15 } },
  { id: 'data',            name: 'Data Bundle 1GB',         price: 1_250,      shop: 'supermarket', category: '💳 SERVICES & EXTRAS',
    desc: '+25% XP for 1h',                       effect: { kind: 'buff', stat: 'xp',       mult: 1.25, durationMs: 1 * H, note: '+25% XP 1h' } },
  { id: 'clubcard',        name: 'Clicks ClubCard',         price: 17_500,     shop: 'supermarket', category: '💳 SERVICES & EXTRAS',
    desc: '5% Off All Purchases 7 days',          effect: { kind: 'discount_card', pct: 0.05, durationMs: 7 * D }, consumable: false },

  // ── 💍 JEWELRY & MARRIAGE ──────────────────────────────────────────────
  { id: 'silver_ring',     name: 'Silver Ring',             price: 25_000,     shop: 'supermarket', category: '💍 JEWELRY & MARRIAGE',
    desc: 'Used to propose to @user — .propose @user',
    effect: { kind: 'note', text: 'Keep the ring in your inventory and use .propose @user to propose. (marriage system coming soon)' }, consumable: false },
  { id: 'gold_ring',       name: 'Gold Ring',               price: 250_000,    shop: 'supermarket', category: '💍 JEWELRY & MARRIAGE',
    desc: 'Used to propose to @user — .propose @user',
    effect: { kind: 'note', text: 'Keep the ring in your inventory and use .propose @user to propose. (marriage system coming soon)' }, consumable: false },
  { id: 'diamond_ring',    name: 'Diamond Ring',            price: 2_500_000,  shop: 'supermarket', category: '💍 JEWELRY & MARRIAGE',
    desc: 'Used to propose to @user — .propose @user',
    effect: { kind: 'note', text: 'Keep the ring in your inventory and use .propose @user to propose. (marriage system coming soon)' }, consumable: false },
  { id: 'divorce',         name: 'Divorce Papers',          price: 1_000,      shop: 'supermarket', category: '💍 JEWELRY & MARRIAGE',
    desc: 'End marriage — .divorce',
    effect: { kind: 'note', text: 'Use .divorce to end your marriage with these papers. (marriage system coming soon)' }, consumable: false },
  { id: 'milk',            name: 'Milk Carton',             price: 1_000,      shop: 'supermarket', category: '💍 JEWELRY & MARRIAGE',
    desc: "Abandon family — instant divorce + 'Deadbeat' status 24h | .abandon",
    effect: { kind: 'note', text: "Use .abandon to walk out — instant divorce + 'Deadbeat' for 24h. (family system coming soon)" }, consumable: false },

  // ── 🤖 BUSINESS ROBOTS ─────────────────────────────────────────────────
  { id: 'cashier_bot',     name: 'Cashier Bot',             price: 1_200_000,  shop: 'supermarket', category: '🤖 BUSINESS ROBOTS',
    desc: 'Replaces 1 NPC staff — -50% wages, 24h uptime',
    effect: { kind: 'unlock', feature: 'cashier_bot' }, consumable: false },
  { id: 'security_bot',    name: 'Security Bot',            price: 3_500_000,  shop: 'supermarket', category: '🤖 BUSINESS ROBOTS',
    desc: 'Blocks 4 .hack biz attempts per hour on your shop',
    effect: { kind: 'unlock', feature: 'security_bot' }, consumable: false },
  { id: 'restock_drone',   name: 'Restock Drone',           price: 5_000_000,  shop: 'supermarket', category: '🤖 BUSINESS ROBOTS',
    desc: 'Auto-restock instant — -15% restock cost',
    effect: { kind: 'unlock', feature: 'restock_drone' }, consumable: false },
  { id: 'sales_bot',       name: 'Sales Bot',               price: 8_000_000,  shop: 'supermarket', category: '🤖 BUSINESS ROBOTS',
    desc: '+20% customer traffic to your shop for 7 days',
    effect: { kind: 'buff', stat: 'shop_traffic', mult: 1.2, durationMs: 7 * D, note: '+20% shop traffic 7d' } },
  { id: 'ceo_bot',         name: 'CEO Bot',                 price: 25_000_000, shop: 'supermarket', category: '🤖 BUSINESS ROBOTS',
    desc: 'Runs shop while offline — collects 80% profit',
    effect: { kind: 'unlock', feature: 'ceo_bot' }, consumable: false },

  // ── ⚙️ ROBOT UPGRADES ──────────────────────────────────────────────────
  { id: 'efficiency_chip', name: 'Bot Efficiency Chip',     price: 2_000,      shop: 'supermarket', category: '⚙️ ROBOT UPGRADES',
    desc: '+25% output for any 1 robot for 7 days',
    effect: { kind: 'buff', stat: 'bot_output', mult: 1.25, durationMs: 7 * D, note: '+25% bot output 7d' } },
  { id: 'overclock',       name: 'Bot Overclock Module',    price: 5_000_000,  shop: 'supermarket', category: '⚙️ ROBOT UPGRADES',
    desc: 'Doubles 1 robot effect for 24h | 1h cooldown after',
    effect: { kind: 'buff', stat: 'bot_overclock', mult: 2.0, durationMs: 24 * H, note: '2x bot effect 24h' } },
  { id: 'ai_core',         name: 'AI Core Mk.III',          price: 15_000_000, shop: 'supermarket', category: '⚙️ ROBOT UPGRADES',
    desc: '+1 extra ability for any bot, permanent',
    effect: { kind: 'unlock', feature: 'ai_core' }, consumable: false },
  { id: 'fusion_reactor',  name: 'Fusion Reactor',          price: 40_000_000, shop: 'supermarket', category: '⚙️ ROBOT UPGRADES',
    desc: 'All owned bots run 50% more effective, permanent',
    effect: { kind: 'unlock', feature: 'fusion_reactor' }, consumable: false },
  { id: 'neural_link',     name: 'Neural Link',             price: 75_000_000, shop: 'supermarket', category: '⚙️ ROBOT UPGRADES',
    desc: 'All bots share buffs — stack effects across bots',
    effect: { kind: 'unlock', feature: 'neural_link' }, consumable: false },

  // ── 🏗️ BUSINESS UPGRADES ───────────────────────────────────────────────
  { id: 'biz_chip',        name: 'Business Upgrade Chip',   price: 300_000,    shop: 'supermarket', category: '🏗️ BUSINESS UPGRADES',
    desc: 'Upgrades shop tier | +1 item slot, -5% all expenses | Price doubles each purchase',
    effect: { kind: 'unlock', feature: 'biz_chip' }, scaling: true, consumable: false },

  // ═══════════════════════════════════════════════════════════════════════
  // ⚔️ HUNTER ASSOCIATION — Solo Leveling Shop
  // ═══════════════════════════════════════════════════════════════════════

  // ── [E-RANK GEAR] ──────────────────────────────────────────────────────
  { id: 'woodensword',   name: 'Training Wooden Sword [E]', price: 1_000,      shop: 'hunter', category: '[E-RANK GEAR]',
    desc: 'Sword | Win Rate: +8% | STR +3 | Use .equip woodensword',
    effect: { kind: 'note', text: '⚔️ Use .equip woodensword to equip in weapon slot.' }, consumable: false },
  { id: 'leatherarmor',  name: 'Basic Leather Armor [E]',   price: 2_500,      shop: 'hunter', category: '[E-RANK GEAR]',
    desc: 'Armor | DEF +12 | Use .equip leatherarmor',
    effect: { kind: 'note', text: '🛡️ Use .equip leatherarmor to equip in armor slot.' }, consumable: false },
  { id: 'cerberusfang',  name: 'Cerberus Fang Shard [E]',   price: 250_000,    shop: 'hunter', category: '[E-RANK GEAR]',
    desc: 'Dagger | Win Rate: +19.01% | INT +30 | [BLACK MARKET]',
    effect: { kind: 'note', text: '⚔️ Use .equip cerberusfang to equip in weapon slot.' }, consumable: false },
  { id: 'bread',         name: 'Stamina Bread [E]',          price: 500,        shop: 'hunter', category: '[E-RANK GEAR]',
    desc: 'Food | Restores 20% HP in dungeon',
    effect: { kind: 'buff', stat: 'hp', flat: 20, durationMs: 0, note: '+20 HP restored' } },
  { id: 'xpbottle',      name: 'Minor XP Bottle [E]',        price: 800,        shop: 'hunter', category: '[E-RANK GEAR]',
    desc: 'Consumable | +500 XP',
    effect: { kind: 'instant_xp', amount: 500 } },
  { id: 'erkey',         name: 'E-Rank Gate Key [E]',        price: 2_000,      shop: 'hunter', category: '[E-RANK GEAR]',
    desc: 'Key | Unlocks E-Rank dungeon — .enterinstantdungeon erkey',
    effect: { kind: 'note', text: 'Use .enterinstantdungeon erkey to enter the E-Rank dungeon.' } },

  // ── [D-RANK GEAR] ──────────────────────────────────────────────────────
  { id: 'steelsword',    name: 'Steel Longsword [D]',        price: 15_000,     shop: 'hunter', category: '[D-RANK GEAR]',
    desc: 'Sword | Win Rate: +10.01% | STR +10 | Use .equip steelsword',
    effect: { kind: 'note', text: '⚔️ Use .equip steelsword to equip in weapon slot.' }, consumable: false },
  { id: 'venomfang',     name: "Kasaka's Venom Fang [D]",    price: 25_000,     shop: 'hunter', category: '[D-RANK GEAR]',
    desc: 'Dagger | Win Rate: +11.37% | AGI +15 | Poison effect',
    effect: { kind: 'note', text: '⚔️ Use .equip venomfang to equip in weapon slot.' }, consumable: false },
  { id: 'meat',          name: 'Dried Meat Ration [D]',      price: 1_200,      shop: 'hunter', category: '[D-RANK GEAR]',
    desc: 'Food | Restores 35% HP in dungeon',
    effect: { kind: 'buff', stat: 'hp', flat: 35, durationMs: 0, note: '+35 HP restored' } },
  { id: 'drkey',         name: 'D-Rank Gate Key [D]',        price: 8_000,      shop: 'hunter', category: '[D-RANK GEAR]',
    desc: 'Key | Unlocks D-Rank dungeon — .enterinstantdungeon drkey',
    effect: { kind: 'note', text: 'Use .enterinstantdungeon drkey to enter the D-Rank dungeon.' } },

  // ── [C-RANK GEAR] ──────────────────────────────────────────────────────
  { id: 'knightkiller',  name: 'Knight Killer [C]',          price: 80_000,     shop: 'hunter', category: '[C-RANK GEAR]',
    desc: 'Dagger | Win Rate: +14.05% | STR +20 | Armor Pen +30%',
    effect: { kind: 'note', text: '⚔️ Use .equip knightkiller to equip in weapon slot.' }, consumable: false },
  { id: 'huntersbow',    name: "Hunter's Bow [C]",           price: 80_000,     shop: 'hunter', category: '[C-RANK GEAR]',
    desc: 'Bow | Win Rate: +14.92% | DEX +20, AGI +10',
    effect: { kind: 'note', text: '⚔️ Use .equip huntersbow to equip in weapon slot.' }, consumable: false },
  { id: 'magerobe',      name: 'Mage Initiate Robe [C]',     price: 75_000,     shop: 'hunter', category: '[C-RANK GEAR]',
    desc: 'Armor | INT +20 | MP +400 | Use .equip magerobe',
    effect: { kind: 'note', text: '🛡️ Use .equip magerobe to equip in armor slot.' }, consumable: false },
  { id: 'crkey',         name: 'C-Rank Gate Key [C]',        price: 25_000,     shop: 'hunter', category: '[C-RANK GEAR]',
    desc: 'Key | Unlocks C-Rank dungeon — .enterinstantdungeon crkey',
    effect: { kind: 'note', text: 'Use .enterinstantdungeon crkey to enter the C-Rank dungeon.' } },

  // ── [B-RANK GEAR] ──────────────────────────────────────────────────────
  { id: 'orcsword',      name: 'Orc Broadsword [B]',         price: 320_000,    shop: 'hunter', category: '[B-RANK GEAR]',
    desc: 'Sword | Win Rate: +19.53% | STR +35, VIT +15',
    effect: { kind: 'note', text: '⚔️ Use .equip orcsword to equip in weapon slot.' }, consumable: false },
  { id: 'orcplate',      name: 'High Orc Chief Plate [B]',   price: 350_000,    shop: 'hunter', category: '[B-RANK GEAR]',
    desc: 'Heavy Armor | DEF +100, VIT +25 | Use .equip orcplate',
    effect: { kind: 'note', text: '🛡️ Use .equip orcplate to equip in armor slot.' }, consumable: false },
  { id: 'xpscroll',      name: 'XP Boost Scroll [B]',        price: 150_000,    shop: 'hunter', category: '[B-RANK GEAR]',
    desc: 'Consumable | +100% XP 24h',
    effect: { kind: 'buff', stat: 'xp', mult: 2.0, durationMs: 24 * H, note: '+100% XP 24h' } },
  { id: 'brkey',         name: 'B-Rank Gate Key [B]',        price: 100_000,    shop: 'hunter', category: '[B-RANK GEAR]',
    desc: 'Key | Unlocks B-Rank dungeon — .enterinstantdungeon brkey',
    effect: { kind: 'note', text: 'Use .enterinstantdungeon brkey to enter the B-Rank dungeon.' } },

  // ── [A-RANK GEAR] ──────────────────────────────────────────────────────
  { id: 'barukas',       name: "Baruka's Dagger [A]",        price: 1_200_000,  shop: 'hunter', category: '[A-RANK GEAR]',
    desc: 'Dagger | Win Rate: +25% | INT +50, AGI +25 | Ice',
    effect: { kind: 'note', text: '⚔️ Use .equip barukas to equip in weapon slot.' }, consumable: false },
  { id: 'reaperblades',  name: "Reaper's Twin Blades [A]",   price: 1_800_000,  shop: 'hunter', category: '[A-RANK GEAR]',
    desc: 'Dual Blades | Win Rate: +26.88% | DEX +60, AGI +35, Crit +15% | Execute <10% HP',
    effect: { kind: 'note', text: '⚔️ Use .equip reaperblades to equip in weapon slot.' }, consumable: false },
  { id: 'hppotion',      name: 'HP Potion [A]',              price: 5_000,      shop: 'hunter', category: '[A-RANK GEAR]',
    desc: 'Potion | Restores 50% HP in dungeon',
    effect: { kind: 'buff', stat: 'hp', flat: 50, durationMs: 0, note: '+50 HP restored' } },
  { id: 'mppotion',      name: 'MP Potion [A]',              price: 5_000,      shop: 'hunter', category: '[A-RANK GEAR]',
    desc: 'Potion | Restores 60% MP in dungeon',
    effect: { kind: 'buff', stat: 'mp', flat: 60, durationMs: 0, note: '+60 MP restored' } },
  { id: 'arkey',         name: 'A-Rank Gate Key [A]',        price: 500_000,    shop: 'hunter', category: '[A-RANK GEAR]',
    desc: 'Key | Unlocks A-Rank dungeon — .enterinstantdungeon arkey',
    effect: { kind: 'note', text: 'Use .enterinstantdungeon arkey to enter the A-Rank dungeon.' } },

  // ── [S-RANK GEAR] ──────────────────────────────────────────────────────
  { id: 'demonsword',    name: "Demon King's Longsword [S]", price: 8_000_000,  shop: 'hunter', category: '[S-RANK GEAR]',
    desc: '2H Sword | Win Rate: +31.48% | STR +150, VIT +50, CritDmg +40% | Ruler\'s Authority',
    effect: { kind: 'note', text: '⚔️ Use .equip demonsword to equip in weapon slot.' }, consumable: false },
  { id: 'shadowfangs',   name: 'Twin Shadow Fangs [S]',      price: 5_200_000,  shop: 'hunter', category: '[S-RANK GEAR]',
    desc: 'Dual Blades | Win Rate: +30.48% | AGI +100, DEX +70, AS +35% | Phantom Slash',
    effect: { kind: 'note', text: '⚔️ Use .equip shadowfangs to equip in weapon slot.' }, consumable: false },
  { id: 'monarcharmor',  name: 'Shadow Monarch Armor [S]',   price: 12_000_000, shop: 'hunter', category: '[S-RANK GEAR]',
    desc: 'Full Set | DEF +300, All Stats +40 | Shadow Energy Regen +50%',
    effect: { kind: 'note', text: '🛡️ Use .equip monarcharmor to equip in armor slot.' }, consumable: false },
  { id: 'frostcloak',    name: 'Frost Monarch Cloak [S]',    price: 6_500_000,  shop: 'hunter', category: '[S-RANK GEAR]',
    desc: 'Light Armor | INT +80, AGI +50 | IceRes +50%',
    effect: { kind: 'note', text: '🛡️ Use .equip frostcloak to equip in armor slot.' }, consumable: false },
  { id: 'manacrystal',   name: 'Mana Crystal [S]',           price: 250_000,    shop: 'hunter', category: '[S-RANK GEAR]',
    desc: 'Artifact | Max MP +500 | Limit: 1/Rank',
    effect: { kind: 'note', text: '💎 Use .equip manacrystal to equip in artifact slot.' }, consumable: false },
  { id: 'monarchring',   name: "Monarch's Ring [S]",         price: 25_000_000, shop: 'hunter', category: '[S-RANK GEAR]',
    desc: 'Jewelry | All Stats +100 | Luck +30 | XP x2 | Ruler\'s Authority',
    effect: { kind: 'note', text: '💍 Use .equip monarchring to equip in jewelry slot.' }, consumable: false },
  { id: 'srkey',         name: 'S-Rank Gate Key [S]',        price: 2_000_000,  shop: 'hunter', category: '[S-RANK GEAR]',
    desc: 'Key | Unlocks S-Rank dungeon | 15% death risk — .enterinstantdungeon srkey',
    effect: { kind: 'note', text: 'Use .enterinstantdungeon srkey to enter the S-Rank dungeon. 15% death risk.' } },
  { id: 'redkey',        name: 'Red Gate Key [S]',           price: 5_000_000,  shop: 'hunter', category: '[S-RANK GEAR]',
    desc: 'Key | Unlocks Red Gate raid | 30% death risk — .enterinstantdungeon redkey',
    effect: { kind: 'note', text: 'Use .enterinstantdungeon redkey to enter the Red Gate. 30% death risk.' } },
  { id: 'demonkey',      name: 'Demon Castle Key [S]',       price: 10_000_000, shop: 'hunter', category: '[S-RANK GEAR]',
    desc: 'Key | Unlocks 100-Floor Castle — .enterinstantdungeon demonkey',
    effect: { kind: 'note', text: 'Use .enterinstantdungeon demonkey to enter the Demon Castle.' } },
];

export function findItem(id: string): CatalogItem | undefined {
  const lower = id.toLowerCase();
  return CATALOG.find(c => c.id === lower || c.name.toLowerCase() === lower);
}

export function itemsByShop(shop: ShopId): CatalogItem[] {
  return CATALOG.filter(c => c.shop === shop);
}

export function shopMeta(shop: ShopId): { title: string; emoji: string; comingSoon: boolean } {
  switch (shop) {
    case 'supermarket': return { title: "Nathaniel's Supermarket",  emoji: '🛒', comingSoon: false };
    case 'drug':        return { title: 'Drug Shop',                emoji: '💊', comingSoon: true };
    case 'market':      return { title: 'Black Market',             emoji: '🕶️', comingSoon: true };
    case 'hunter':      return { title: 'Hunter Association',       emoji: '⚔️', comingSoon: false };
  }
}

export function fmtCoins(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '') + 'B';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1_000)         return n.toLocaleString('en-US');
  return String(n);
}
