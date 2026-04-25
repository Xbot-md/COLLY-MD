import type { BotContext } from '../types.js';
import { getWallet, saveWallet } from '../lib/turso.js';
import { cleanJid } from '../lib/isOwner.js';
import { addToInventory, removeFromInventory, getInventoryQty } from '../lib/shopStore.js';
import { getEquipment, setEquip, clearEquip, EquipSlot } from '../lib/slStore.js';
import { findItem, itemsByShop, fmtCoins } from '../lib/shopCatalog.js';

// ─── WEAPON WIN RATES ──────────────────────────────────────────────────────────
const WEAPON_WIN_RATES: Record<string, number> = {
    woodensword:  0.08,
    cerberusfang: 0.1901,
    steelsword:   0.1001,
    venomfang:    0.1137,
    knightkiller: 0.1405,
    huntersbow:   0.1492,
    orcsword:     0.1953,
    barukas:      0.25,
    reaperblades: 0.2688,
    demonsword:   0.3148,
    shadowfangs:  0.3048,
};

// ─── DUNGEON CONFIG ────────────────────────────────────────────────────────────
interface DungeonTier {
    name: string;
    rank: string;
    baseWin: number;
    deathRisk: number;
    minLoot: number;
    maxLoot: number;
    xp: number;
    boss: string;
    emoji: string;
}

const DUNGEON_TIERS: Record<string, DungeonTier> = {
    erkey:   { name: 'E-Rank Gate',       rank: 'E', baseWin: 0.65, deathRisk: 0,    minLoot: 2_000,       maxLoot: 10_000,      xp: 200,  boss: 'Goblin Chief',        emoji: '🟢' },
    drkey:   { name: 'D-Rank Gate',       rank: 'D', baseWin: 0.55, deathRisk: 0,    minLoot: 8_000,       maxLoot: 35_000,      xp: 500,  boss: 'Stone Giant',         emoji: '🔵' },
    crkey:   { name: 'C-Rank Gate',       rank: 'C', baseWin: 0.50, deathRisk: 0,    minLoot: 30_000,      maxLoot: 120_000,     xp: 1000, boss: 'Shadow Assassin',     emoji: '🟡' },
    brkey:   { name: 'B-Rank Gate',       rank: 'B', baseWin: 0.45, deathRisk: 0,    minLoot: 100_000,     maxLoot: 400_000,     xp: 2500, boss: 'High Orc General',    emoji: '🟠' },
    arkey:   { name: 'A-Rank Gate',       rank: 'A', baseWin: 0.40, deathRisk: 0.05, minLoot: 400_000,     maxLoot: 1_500_000,   xp: 6000, boss: 'Demon Noble',         emoji: '🔴' },
    srkey:   { name: 'S-Rank Gate',       rank: 'S', baseWin: 0.35, deathRisk: 0.15, minLoot: 1_200_000,   maxLoot: 5_000_000,   xp: 15000,boss: 'Baran, Commander of the Destruction Knights', emoji: '⚫' },
    redkey:  { name: 'Red Gate Raid',     rank: 'S', baseWin: 0.30, deathRisk: 0.30, minLoot: 3_000_000,   maxLoot: 12_000_000,  xp: 30000,boss: 'Cerberus (Triple Head)', emoji: '🔥' },
    demonkey:{ name: 'Demon Castle',      rank: 'S', baseWin: 0.25, deathRisk: 0.50, minLoot: 10_000_000,  maxLoot: 50_000_000,  xp: 80000,boss: 'Demon King Antares',   emoji: '💀' },
};

// ─── SLOT DETECTION ────────────────────────────────────────────────────────────
const WEAPON_IDS  = new Set(['woodensword','cerberusfang','steelsword','venomfang','knightkiller','huntersbow','orcsword','barukas','reaperblades','demonsword','shadowfangs']);
const ARMOR_IDS   = new Set(['leatherarmor','magerobe','orcplate','monarcharmor','frostcloak']);
const JEWELRY_IDS = new Set(['monarchring']);
const ARTIFACT_IDS= new Set(['manacrystal']);

function detectSlot(itemId: string): EquipSlot | null {
    if (WEAPON_IDS.has(itemId))   return 'weapon';
    if (ARMOR_IDS.has(itemId))    return 'armor';
    if (JEWELRY_IDS.has(itemId))  return 'jewelry';
    if (ARTIFACT_IDS.has(itemId)) return 'artifact';
    return null;
}

function fmtMs(ms: number): string {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function addXpSafe(w: any, amount: number): string | null {
    const xpPerLevel = 500;
    w.xp = (w.xp || 0) + amount;
    let msg: string | null = null;
    while (w.xp >= (w.level || 1) * xpPerLevel) {
        w.xp -= (w.level || 1) * xpPerLevel;
        w.level = (w.level || 1) + 1;
        msg = `🆙 Level up! You are now Level *${w.level}*!`;
    }
    return msg;
}

const DUNGEON_CD_MS = 30 * 60 * 1000; // 30 min

// ─── CRAFT RECIPES ─────────────────────────────────────────────────────────────
const CRAFT_RECIPES: Array<{ result: string; ingredients: { id: string; qty: number }[]; cost: number }> = [
    { result: 'steelsword',  ingredients: [{ id: 'woodensword', qty: 2 }], cost: 8_000 },
    { result: 'venomfang',   ingredients: [{ id: 'steelsword', qty: 1 }, { id: 'meat', qty: 3 }], cost: 15_000 },
    { result: 'orcsword',    ingredients: [{ id: 'knightkiller', qty: 1 }, { id: 'huntersbow', qty: 1 }], cost: 100_000 },
    { result: 'hppotion',    ingredients: [{ id: 'bread', qty: 5 }, { id: 'meat', qty: 3 }], cost: 2_000 },
    { result: 'mppotion',    ingredients: [{ id: 'hppotion', qty: 2 }], cost: 3_000 },
    { result: 'xpscroll',    ingredients: [{ id: 'xpbottle', qty: 10 }], cost: 50_000 },
    { result: 'orcplate',    ingredients: [{ id: 'leatherarmor', qty: 3 }, { id: 'magerobe', qty: 1 }], cost: 180_000 },
    { result: 'manacrystal', ingredients: [{ id: 'mppotion', qty: 20 }], cost: 120_000 },
];

// Track dungeon cooldowns in memory (per session)
const dungeonCds = new Map<string, number>();

export default [

// ─── .huntershop ──────────────────────────────────────────────────────────────
{
    command: 'huntershop',
    aliases: ['slshop', 'hshop', 'hunterassociation'],
    category: 'sololeveling',
    description: 'View the Hunter Association shop',
    usage: '.huntershop [rank]',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const items = itemsByShop('hunter');
        const rankFilter = args[0]?.toUpperCase();

        const cats = [...new Set(items.map(i => i.category))];
        const filtered = rankFilter
            ? cats.filter(c => c.includes(rankFilter))
            : cats;

        if (!filtered.length) {
            return sock.sendMessage(chatId, {
                text: `❌ No items found for rank "${rankFilter}". Valid: E, D, C, B, A, S`,
                ...channelInfo
            }, { quoted: message });
        }

        const lines: string[] = [];
        for (const cat of filtered) {
            lines.push(`╽\n╽  ✦ *${cat}*`);
            for (const item of items.filter(i => i.category === cat)) {
                lines.push(`╽  • *${item.name}*\n╽    ID: \`${item.id}\` | 💰 ${fmtCoins(item.price)}\n╽    ↳ ${item.desc}`);
            }
        }

        const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ⚔️ *HUNTER ASSOCIATION SHOP*
╽  ─────────────────────────────
╽  💰 *Your Balance:* ${fmtCoins(w.balance)} 🪙
╽
╽  Use _.buy <id>_ to purchase
╽  Use _.equip <id>_ to equip weapons/armor
╽  Use _.huntershop E_ to filter by rank
╽  ─────────────────────────────
${lines.join('\n')}
╽
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

// ─── .equip ───────────────────────────────────────────────────────────────────
{
    command: 'equip',
    aliases: ['slequip', 'wearitem'],
    category: 'sololeveling',
    description: 'Equip a hunter weapon, armor, jewelry or artifact',
    usage: '.equip <itemid>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const itemId = args[0]?.toLowerCase();
        if (!itemId) return sock.sendMessage(chatId, { text: `❌ Usage: .equip <itemid>`, ...channelInfo }, { quoted: message });

        const item = findItem(itemId);
        if (!item || item.shop !== 'hunter') {
            return sock.sendMessage(chatId, { text: `❌ *${itemId}* is not a hunter item. Check _.huntershop_.`, ...channelInfo }, { quoted: message });
        }

        const slot = detectSlot(item.id);
        if (!slot) {
            return sock.sendMessage(chatId, { text: `❌ *${item.name}* cannot be equipped. It's a consumable — use _.use ${item.id}_ instead.`, ...channelInfo }, { quoted: message });
        }

        const qty = await getInventoryQty(senderId, item.id);
        if (qty < 1) {
            return sock.sendMessage(chatId, { text: `❌ You don't own *${item.name}*. Buy it first: _.buy ${item.id}_.`, ...channelInfo }, { quoted: message });
        }

        await setEquip(senderId, slot, item.id);
        const eq = await getEquipment(senderId);
        const slotEmoji = slot === 'weapon' ? '⚔️' : slot === 'armor' ? '🛡️' : slot === 'jewelry' ? '💍' : '💎';

        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ${slotEmoji} *ITEM EQUIPPED*
╽  ─────────────────────────────
╽  ❏ *Item:*  ${item.name}
╽  ❏ *Slot:*  ${slot.toUpperCase()}
╽  ❏ *Stats:* ${item.desc}
╽
╽  🎽 *Current Loadout:*
╽  ⚔️ Weapon:   ${eq.weapon   ? findItem(eq.weapon)?.name   ?? eq.weapon   : '— none —'}
╽  🛡️ Armor:    ${eq.armor    ? findItem(eq.armor)?.name    ?? eq.armor    : '— none —'}
╽  💍 Jewelry:  ${eq.jewelry  ? findItem(eq.jewelry)?.name  ?? eq.jewelry  : '— none —'}
╽  💎 Artifact: ${eq.artifact ? findItem(eq.artifact)?.name ?? eq.artifact : '— none —'}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

// ─── .unequip ─────────────────────────────────────────────────────────────────
{
    command: 'unequip',
    aliases: ['slunequip', 'removeitem'],
    category: 'sololeveling',
    description: 'Unequip a hunter slot (weapon / armor / jewelry / artifact)',
    usage: '.unequip <weapon|armor|jewelry|artifact>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const slotArg = args[0]?.toLowerCase() as EquipSlot | undefined;
        const validSlots: EquipSlot[] = ['weapon', 'armor', 'jewelry', 'artifact'];
        if (!slotArg || !validSlots.includes(slotArg)) {
            return sock.sendMessage(chatId, { text: `❌ Usage: .unequip <weapon|armor|jewelry|artifact>`, ...channelInfo }, { quoted: message });
        }
        const eq = await getEquipment(senderId);
        if (!eq[slotArg]) {
            return sock.sendMessage(chatId, { text: `⚠️ Your ${slotArg} slot is already empty.`, ...channelInfo }, { quoted: message });
        }
        const old = eq[slotArg]!;
        await clearEquip(senderId, slotArg);
        return sock.sendMessage(chatId, {
            text: `✅ Unequipped *${findItem(old)?.name ?? old}* from your ${slotArg} slot.`,
            ...channelInfo
        }, { quoted: message });
    }
},

// ─── .stats / .slstats ────────────────────────────────────────────────────────
{
    command: 'slstats',
    aliases: ['hunterstats', 'hstats'],
    category: 'sololeveling',
    description: 'View your hunter stats and equipped gear',
    usage: '.slstats',
    async handler(sock: any, message: any, _args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const w  = await getWallet(senderId, message.pushName || cleanJid(senderId));
        const eq = await getEquipment(senderId);

        const weaponWin = eq.weapon ? (WEAPON_WIN_RATES[eq.weapon] ?? 0) : 0;
        const baseWin   = 0.50;
        const totalWin  = Math.min(baseWin + weaponWin, 0.97);

        const rankMap: Record<number, string> = { 0:'E', 5:'D', 10:'C', 20:'B', 35:'A', 50:'S' };
        const thresholds = [0, 5, 10, 20, 35, 50];
        const lvl = w.level ?? 1;
        let hunterRank = 'E';
        for (const t of thresholds) { if (lvl >= t) hunterRank = rankMap[t]; }

        const eqLine = (slot: EquipSlot, emoji: string) =>
            `╽  ${emoji} ${slot.charAt(0).toUpperCase() + slot.slice(1).padEnd(8)}: ${eq[slot] ? findItem(eq[slot]!)?.name ?? eq[slot]! : '— none —'}`;

        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ⚔️ *HUNTER PROFILE*
╽  ─────────────────────────────
╽  ❏ *Name:*     ${w.name || cleanJid(senderId)}
╽  ❏ *Rank:*     ${hunterRank}-Rank Hunter
╽  ❏ *Level:*    ${lvl}
╽  ❏ *XP:*       ${(w.xp ?? 0).toLocaleString()}
╽  ❏ *Balance:*  ${fmtCoins(w.balance)} 🪙
╽
╽  🎽 *LOADOUT*
╽  ─────────────────────────────
${eqLine('weapon',   '⚔️')}
${eqLine('armor',    '🛡️')}
${eqLine('jewelry',  '💍')}
${eqLine('artifact', '💎')}
╽
╽  ⚡ *DUNGEON WIN RATE:* ${(totalWin * 100).toFixed(1)}%
╽  (Base 50% + weapon bonus ${(weaponWin * 100).toFixed(2)}%)
╽
╽  Use _.huntershop_ to gear up!
╽  Use _.enterinstantdungeon <key>_ to fight!
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

// ─── .slcraft ─────────────────────────────────────────────────────────────────
{
    command: 'slcraft',
    aliases: ['craftitem', 'hcraft'],
    category: 'sololeveling',
    description: 'Craft hunter items from ingredients',
    usage: '.slcraft [itemid] or .slcraft list',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const target = args[0]?.toLowerCase();

        if (!target || target === 'list') {
            const lines = CRAFT_RECIPES.map(r => {
                const result = findItem(r.result);
                const ingList = r.ingredients.map(i => `${i.qty}x ${findItem(i.id)?.name ?? i.id}`).join(' + ');
                return `╽  • *${result?.name ?? r.result}*\n╽    Ingredients: ${ingList}\n╽    Craft Cost: 💰 ${fmtCoins(r.cost)}`;
            }).join('\n╽\n');
            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🔨 *CRAFT RECIPES*
╽  ─────────────────────────────
${lines}
╽
╽  Usage: _.slcraft <itemid>_
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }

        const recipe = CRAFT_RECIPES.find(r => r.result === target);
        if (!recipe) {
            return sock.sendMessage(chatId, {
                text: `❌ No recipe for *${target}*. Use _.slcraft list_ to see all recipes.`,
                ...channelInfo
            }, { quoted: message });
        }

        const result = findItem(recipe.result)!;
        const w = await getWallet(senderId);
        if (w.balance < recipe.cost) {
            return sock.sendMessage(chatId, {
                text: `❌ You need 💰 ${fmtCoins(recipe.cost)} to craft *${result.name}*. You have ${fmtCoins(w.balance)}.`,
                ...channelInfo
            }, { quoted: message });
        }

        for (const ing of recipe.ingredients) {
            const has = await getInventoryQty(senderId, ing.id);
            if (has < ing.qty) {
                const ingName = findItem(ing.id)?.name ?? ing.id;
                return sock.sendMessage(chatId, {
                    text: `❌ You need *${ing.qty}x ${ingName}* but only have ${has}.`,
                    ...channelInfo
                }, { quoted: message });
            }
        }

        for (const ing of recipe.ingredients) {
            await removeFromInventory(senderId, ing.id, ing.qty);
        }
        w.balance -= recipe.cost;
        await saveWallet(w);
        await addToInventory(senderId, recipe.result, 1);

        const ingDesc = recipe.ingredients.map(i => `${i.qty}x ${findItem(i.id)?.name ?? i.id}`).join(', ');
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🔨 *CRAFT SUCCESSFUL!*
╽  ─────────────────────────────
╽  ❏ *Crafted:*  ${result.name}
╽  ❏ *Used:*     ${ingDesc}
╽  ❏ *Cost:*     💰 ${fmtCoins(recipe.cost)}
╽  ❏ *Balance:*  💰 ${fmtCoins(w.balance)}
╽
╽  Item added to your inventory!
╽  Use _.equip ${recipe.result}_ if it's a weapon/armor.
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

// ─── .enterinstantdungeon ─────────────────────────────────────────────────────
{
    command: 'enterinstantdungeon',
    aliases: ['dungeon', 'enterdungeon', 'raid'],
    category: 'sololeveling',
    description: 'Enter an instant dungeon using a Gate Key',
    usage: '.enterinstantdungeon <keyid>  e.g. .enterinstantdungeon erkey',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const keyId = args[0]?.toLowerCase();
        if (!keyId) {
            return sock.sendMessage(chatId, {
                text: `❌ Usage: .enterinstantdungeon <keyid>\nKeys: erkey, drkey, crkey, brkey, arkey, srkey, redkey, demonkey`,
                ...channelInfo
            }, { quoted: message });
        }

        const tier = DUNGEON_TIERS[keyId];
        if (!tier) {
            return sock.sendMessage(chatId, {
                text: `❌ Unknown key: *${keyId}*.\nValid keys: erkey, drkey, crkey, brkey, arkey, srkey, redkey, demonkey`,
                ...channelInfo
            }, { quoted: message });
        }

        const now = Date.now();
        const cdKey = `${senderId}_dungeon`;
        const lastCd = dungeonCds.get(cdKey) ?? 0;
        if (now < lastCd) {
            return sock.sendMessage(chatId, {
                text: `⏳ Your dungeon is still on cooldown. Ready in *${fmtMs(lastCd - now)}*.`,
                ...channelInfo
            }, { quoted: message });
        }

        const qty = await getInventoryQty(senderId, keyId);
        if (qty < 1) {
            return sock.sendMessage(chatId, {
                text: `❌ You don't have a *${findItem(keyId)?.name ?? keyId}*. Buy one at _.huntershop_.`,
                ...channelInfo
            }, { quoted: message });
        }

        await removeFromInventory(senderId, keyId, 1);
        dungeonCds.set(cdKey, now + DUNGEON_CD_MS);

        const eq     = await getEquipment(senderId);
        const weapon = eq.weapon;
        const bonusWin = weapon ? (WEAPON_WIN_RATES[weapon] ?? 0) : 0;
        const totalWin = Math.min(tier.baseWin + bonusWin, 0.97);

        const roll = Math.random();

        if (roll < tier.deathRisk) {
            const penalty = Math.floor(Math.random() * 0.25 * (tier.maxLoot - tier.minLoot) + tier.minLoot * 0.25);
            const w = await getWallet(senderId);
            w.balance = Math.max(0, w.balance - penalty);
            await saveWallet(w);
            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ${tier.emoji} *DUNGEON FAILED — NEAR DEATH*
╽  ─────────────────────────────
╽  ❏ *Gate:* ${tier.name}
╽  ❏ *Boss:* ${tier.boss}
╽
╽  💀 You were critically wounded and
╽     barely escaped with your life.
╽
╽  ❏ *Penalty:* -${fmtCoins(penalty)} 🪙
╽  ❏ *Balance:* ${fmtCoins(w.balance)} 🪙
╽
╽  ⏳ Cooldown: ${fmtMs(DUNGEON_CD_MS)}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }

        const won = roll < totalWin + tier.deathRisk;
        const w   = await getWallet(senderId);

        if (won) {
            const loot = Math.floor(Math.random() * (tier.maxLoot - tier.minLoot) + tier.minLoot);
            w.balance += loot;
            const lvlUpMsg = addXpSafe(w, tier.xp);
            await saveWallet(w);

            const weaponLine = weapon
                ? `╽  ⚔️ *Weapon:* ${findItem(weapon)?.name ?? weapon} (+${(bonusWin * 100).toFixed(2)}%)`
                : `╽  ⚔️ *Weapon:* — none — (no bonus)`;

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ${tier.emoji} *DUNGEON CLEAR!*
╽  ─────────────────────────────
╽  ❏ *Gate:*  ${tier.name}
╽  ❏ *Boss:*  ${tier.boss} ☠️
╽  ❏ *Rank:*  ${tier.rank}
╽
${weaponLine}
╽  🎯 *Win Chance:* ${(totalWin * 100).toFixed(1)}%
╽
╽  💰 *Loot:*    +${fmtCoins(loot)} 🪙
╽  ⭐ *XP Earned:* +${tier.xp.toLocaleString()}
╽  💵 *Balance:* ${fmtCoins(w.balance)} 🪙
╽
╽  ⏳ Cooldown: ${fmtMs(DUNGEON_CD_MS)}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷${lvlUpMsg ? '\n\n' + lvlUpMsg : ''}`,
                ...channelInfo
            }, { quoted: message });
        } else {
            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ${tier.emoji} *DUNGEON FAILED*
╽  ─────────────────────────────
╽  ❏ *Gate:* ${tier.name}
╽  ❏ *Boss:* ${tier.boss}
╽
╽  🏃 You were overwhelmed and
╽     forced to retreat.
╽
╽  ⚡ *Win Chance Was:* ${(totalWin * 100).toFixed(1)}%
╽  💡 Equip a better weapon to
╽     increase your win rate!
╽
╽  ⏳ Cooldown: ${fmtMs(DUNGEON_CD_MS)}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    }
},

];
