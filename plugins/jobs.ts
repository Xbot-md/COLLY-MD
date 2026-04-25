import type { BotContext } from '../types.js';
import { getWallet, saveWallet } from '../lib/turso.js';
import { resolveJid } from '../lib/lidUtils.js';
import config from '../config.js';

const prefix = config.prefixes[0];
const fmt  = (n: number) => n.toLocaleString();
const rng  = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const cleanJid = (jid: string) => jid.split(':')[0].split('@')[0];

// ── Job configs ───────────────────────────────────────────────────────────────
interface JobConfig {
    emoji: string;
    verb: string;
    payMin: number;
    payMax: number;
    xp: number;
    cdMs: number;
    drops: { id: string; name: string; emoji: string; chance: number }[];
    narratives: (() => string)[];
}

const JOBS: Record<string, JobConfig> = {
    scavenge: {
        emoji: '🗑️', verb: 'scavenging',
        payMin: 100, payMax: 500, xp: 15, cdMs: 30 * 60 * 1000,
        drops: [
            { id: 'temu_parcel',       name: 'Temu Parcel',      emoji: '📦', chance: 0.12 },
            { id: 'brass_knuckles',    name: 'Brass Knuckles',   emoji: '🥊', chance: 0.05 },
            { id: 'counterfeit_cash',  name: 'Counterfeit Cash', emoji: '💵', chance: 0.08 },
        ],
        narratives: [
            () => 'You dug through three dumpsters behind the mall. Found some cash and weird stuff.',
            () => 'Alley scavenge. Someone left a bag of coins near the trash bins.',
            () => 'Old abandoned lot. Kicked through the rubble and came up with something decent.',
            () => 'Behind the abandoned warehouse. The junk pile was full of forgotten valuables.',
        ],
    },
    recycling: {
        emoji: '♻️', verb: 'collecting recyclables',
        payMin: 80, payMax: 320, xp: 10, cdMs: 25 * 60 * 1000,
        drops: [
            { id: 'burner_phone', name: 'Burner Phone', emoji: '📱', chance: 0.08 },
            { id: 'energy_drink', name: 'Energy Drink', emoji: '🥤', chance: 0.15 },
        ],
        narratives: [
            () => 'Sorted cans and bottles all shift. Recycling centre cut you a cheque.',
            () => 'Long day at the depot. Arms ache but the payout was solid.',
            () => 'Found a working phone in the bins. Handed most in, kept a little.',
            () => 'Three bags of aluminium. The weigh-in was better than expected.',
        ],
    },
    mining: {
        emoji: '⛏️', verb: 'mining',
        payMin: 300, payMax: 900, xp: 30, cdMs: 60 * 60 * 1000,
        drops: [
            { id: 'gold_bullion',  name: 'Gold Bullion',  emoji: '🥇', chance: 0.06 },
            { id: 'diamond_ring',  name: 'Diamond Ring',  emoji: '💍', chance: 0.03 },
            { id: 'elon_chip',     name: 'Elon Chip',     emoji: '🧠', chance: 0.02 },
        ],
        narratives: [
            () => 'Deep shaft. Pickaxe hit something solid. Not gold — but still worth cashing.',
            () => 'Four hours in the dark. Dust, sweat, and a decent haul of ore.',
            () => 'The vein was thinner than the map suggested. Still cleared the day.',
            () => 'Hit an unexpected pocket of minerals. Quick cash at the smelter.',
        ],
    },
    fishing: {
        emoji: '🎣', verb: 'fishing',
        payMin: 200, payMax: 650, xp: 20, cdMs: 45 * 60 * 1000,
        drops: [
            { id: 'energy_drink', name: 'Energy Drink', emoji: '🥤', chance: 0.15 },
            { id: 'protein_bar',  name: 'Protein Bar',  emoji: '🍫', chance: 0.12 },
            { id: 'neon_water',   name: 'Neon Water',   emoji: '💧', chance: 0.10 },
        ],
        narratives: [
            () => 'Quiet morning on the dock. Caught a decent haul and sold at the pier market.',
            () => 'Rain started halfway through but the fish were biting. Good sell at the end.',
            () => 'Trophy catch this session. Auctioned the rarest one on the spot.',
            () => 'Night fishing off the bridge. Calm water, full net, solid earnings.',
        ],
    },
    logging: {
        emoji: '🪓', verb: 'logging',
        payMin: 150, payMax: 420, xp: 15, cdMs: 40 * 60 * 1000,
        drops: [
            { id: 'lockpick', name: 'Lockpick', emoji: '🔑', chance: 0.08 },
            { id: 'shield',   name: 'Rob Shield', emoji: '🛡️', chance: 0.04 },
        ],
        narratives: [
            () => 'Felled six trees before lunch. Timber yard paid well by the cubic metre.',
            () => 'Chainsaw work deep in the forest reserve. Muscles dead but wallet alive.',
            () => 'Contract job for a construction company. Delivered on time, paid in full.',
            () => 'Early shift at the mill. Clean cuts, good yield, fair price.',
        ],
    },
    hunting: {
        emoji: '🏹', verb: 'hunting',
        payMin: 250, payMax: 750, xp: 20, cdMs: 50 * 60 * 1000,
        drops: [
            { id: 'protein_bar', name: 'Protein Bar', emoji: '🍫', chance: 0.20 },
            { id: 'neon_water',  name: 'Neon Water',  emoji: '💧', chance: 0.12 },
            { id: 'medkit',      name: 'Medkit',      emoji: '🩺', chance: 0.05 },
        ],
        narratives: [
            () => 'Tracked a prize buck for three hours. Worth every step in the end.',
            () => 'Quick hunt, clean shot. Sold the hide and meat at the outpost.',
            () => 'Small game, but plentiful. Trap haul plus a couple of kills made it worthwhile.',
            () => 'Sniper position, dawn patrol. Two clean kills before sunrise.',
        ],
    },
    gardening: {
        emoji: '🌱', verb: 'gardening',
        payMin: 100, payMax: 380, xp: 12, cdMs: 35 * 60 * 1000,
        drops: [
            { id: 'neon_water',  name: 'Neon Water',   emoji: '💧', chance: 0.18 },
            { id: 'data_tacos',  name: 'Data Tacos',   emoji: '🌮', chance: 0.08 },
            { id: 'energy_drink',name: 'Energy Drink', emoji: '🥤', chance: 0.10 },
        ],
        narratives: [
            () => 'Tended the community garden. Sold the surplus harvest at the market.',
            () => 'Long day in the greenhouse. Premium crop fetched a premium price.',
            () => 'Grafted some rare strains. Lab paid generously for the specimens.',
            () => 'Garden therapy session and a solid side income. Win-win.',
        ],
    },
    crafting: {
        emoji: '🔨', verb: 'crafting',
        payMin: 200, payMax: 600, xp: 30, cdMs: 90 * 60 * 1000,
        drops: [
            { id: 'lockpick_set',  name: 'Lockpick Set',    emoji: '🔓', chance: 0.07 },
            { id: 'broken_hourglass', name: 'Broken Hourglass', emoji: '⏳', chance: 0.10 },
            { id: 'temu_parcel',   name: 'Temu Parcel',     emoji: '📦', chance: 0.12 },
        ],
        narratives: [
            () => 'Built a batch of custom tools. Sold them to a crew in the underground market.',
            () => 'Welded, shaped, sanded. The finished product moved fast on the grey market.',
            () => 'Prototype session. First three failed. The fourth sold for triple.',
            () => 'Workshop all night. Craft fair at dawn. Cleaned up before most stalls opened.',
        ],
    },
};

// ── Per-job in-memory cooldowns: Map<jobName, Map<userId, expiresAt>> ─────────
const cooldowns = new Map<string, Map<string, number>>(
    Object.keys(JOBS).map(k => [k, new Map()])
);

function buildResult(jobName: string, cfg: JobConfig, w: any, earnings: number, drop: { id: string; name: string; emoji: string } | null) {
    const cdMins = Math.round(cfg.cdMs / 60000);
    let text =
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ ${cfg.emoji} *${jobName.toUpperCase()}*
╽ ───────────────────────────────
╽ ${pick(cfg.narratives)()}
╽ ───────────────────────────────
╽ EARNED      :: +${fmt(earnings)} 🪙
╽ XP GAINED   :: +${cfg.xp}`;
    if (drop) text += `\n╽ ITEM FOUND  :: ${drop.emoji} *${drop.name}*`;
    text +=
`\n╽ NEW BALANCE :: ${fmt(w.balance)} 🪙
╽ COOLDOWN    :: ${cdMins >= 60 ? Math.round(cdMins / 60) + 'h' : cdMins + ' min'}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`;
    return text;
}

function makeJobHandler(jobName: string) {
    return async function(sock: any, message: any, _args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const cfg = JOBS[jobName];
        const cdMap = cooldowns.get(jobName)!;
        const now = Date.now();

        const expires = cdMap.get(senderId);
        if (expires && now < expires) {
            const rem = Math.ceil((expires - now) / 60000);
            return sock.sendMessage(chatId, {
                text: `${cfg.emoji} You're still recovering from ${cfg.verb}. Come back in *${rem} minute${rem !== 1 ? 's' : ''}*.`,
                ...channelInfo
            }, { quoted: message });
        }

        const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
        const earnings = rng(cfg.payMin, cfg.payMax);
        w.balance += earnings;
        w.xp      += cfg.xp;

        // Item drop roll
        let drop: { id: string; name: string; emoji: string } | null = null;
        for (const d of cfg.drops) {
            if (Math.random() < d.chance) {
                drop = d;
                w.inventory.push(d.id);
                break;
            }
        }

        cdMap.set(senderId, now + cfg.cdMs);
        await saveWallet(w);
        await sock.sendMessage(chatId, { text: buildResult(jobName, cfg, w, earnings, drop), ...channelInfo }, { quoted: message });
    };
}

// ── Bet command ───────────────────────────────────────────────────────────────
const BET_NPCS = ['BadBoy','City Punk','Iron Mike','El Toro','The Beast','Crusher','Shadow King','Zero'];
const betCooldowns = new Map<string, number>();
const BET_CD = 20 * 60 * 1000;

const betHandler = async function(sock: any, message: any, args: any[], context: BotContext) {
    const { chatId, channelInfo, senderId } = context;
    const now = Date.now();
    const cdExp = betCooldowns.get(senderId);
    if (cdExp && now < cdExp) {
        const rem = Math.ceil((cdExp - now) / 60000);
        return sock.sendMessage(chatId, { text: `🎲 Still cooling down from last bet. Wait *${rem} min*.`, ...channelInfo }, { quoted: message });
    }

    const amountArg = args.find((a: string) => /^\d+$/.test(a));
    const amount = parseInt(amountArg);
    if (!amount || amount < 100) return sock.sendMessage(chatId, { text: `❌ Usage: *${prefix}bet <amount> [@player | npc_name]*\nMinimum bet: *100 🪙*`, ...channelInfo }, { quoted: message });

    const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
    if (w.balance < amount) return sock.sendMessage(chatId, { text: `❌ Not enough coins. You have *${fmt(w.balance)} 🪙*, need *${fmt(amount)} 🪙*.`, ...channelInfo }, { quoted: message });

    let target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (target?.includes('@lid')) target = await resolveJid(sock, target);

    const isPvP = !!target && target !== senderId;
    const oppName = isPvP ? `@${cleanJid(target)}` : pick(BET_NPCS);
    const winChance = isPvP ? 0.50 : 0.48;
    const won = Math.random() < winChance;

    if (won) {
        const payout = Math.floor(amount * 1.8);
        w.balance += payout - amount;
        betCooldowns.set(senderId, now + BET_CD);
        await saveWallet(w);
        if (isPvP) {
            const ow = await getWallet(target!, cleanJid(target!));
            ow.balance = Math.max(0, ow.balance - amount);
            await saveWallet(ow);
        }
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ 🎲 *BET — YOU WON!*
╽ Opponent :: ${oppName}
╽ ───────────────────────────────
╽ WAGERED   :: ${fmt(amount)} 🪙
╽ PAYOUT    :: +${fmt(payout)} 🪙
╽ NET GAIN  :: +${fmt(payout - amount)} 🪙
╽ BALANCE   :: ${fmt(w.balance)} 🪙
╽ COOLDOWN  :: 20 Minutes
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            mentions: isPvP ? [target!] : [], ...channelInfo
        }, { quoted: message });
    } else {
        w.balance -= amount;
        betCooldowns.set(senderId, now + BET_CD);
        await saveWallet(w);
        if (isPvP) {
            const ow = await getWallet(target!, cleanJid(target!));
            ow.balance += amount;
            await saveWallet(ow);
        }
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ 🎲 *BET — YOU LOST*
╽ Opponent :: ${oppName}
╽ ───────────────────────────────
╽ WAGERED   :: ${fmt(amount)} 🪙
╽ LOST      :: -${fmt(amount)} 🪙
╽ BALANCE   :: ${fmt(w.balance)} 🪙
╽ COOLDOWN  :: 20 Minutes
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            mentions: isPvP ? [target!] : [], ...channelInfo
        }, { quoted: message });
    }
};

// ── Export all commands ───────────────────────────────────────────────────────
export default [
    {
        command: 'scavenge',
        aliases: ['scav', 'dumpsterdive'],
        category: 'economy',
        description: 'Scavenge for valuables',
        usage: `.scavenge`,
        handler: makeJobHandler('scavenge'),
    },
    {
        command: 'recycling',
        aliases: ['recycle', 'junkcollect'],
        category: 'economy',
        description: 'Collect recyclables for cash',
        usage: `.recycling`,
        handler: makeJobHandler('recycling'),
    },
    {
        command: 'mining',
        aliases: ['mine', 'dig'],
        category: 'economy',
        description: 'Mine for resources',
        usage: `.mining`,
        handler: makeJobHandler('mining'),
    },
    {
        command: 'fishing',
        aliases: ['fish', 'catchfish'],
        category: 'economy',
        description: 'Go fishing for cash and items',
        usage: `.fishing`,
        handler: makeJobHandler('fishing'),
    },
    {
        command: 'logging',
        aliases: ['chopwood', 'lumber'],
        category: 'economy',
        description: 'Chop wood for cash',
        usage: `.logging`,
        handler: makeJobHandler('logging'),
    },
    {
        command: 'hunting',
        aliases: ['hunt', 'trackanimal'],
        category: 'economy',
        description: 'Hunt animals for cash and food drops',
        usage: `.hunting`,
        handler: makeJobHandler('hunting'),
    },
    {
        command: 'gardening',
        aliases: ['garden', 'farm'],
        category: 'economy',
        description: 'Tend to your garden and sell crops',
        usage: `.gardening`,
        handler: makeJobHandler('gardening'),
    },
    {
        command: 'crafting',
        aliases: ['craft', 'workshop'],
        category: 'economy',
        description: 'Craft and sell items on the underground market',
        usage: `.crafting`,
        handler: makeJobHandler('crafting'),
    },
    {
        command: 'wager',
        aliases: ['placebet'],
        category: 'economy',
        description: 'Bet coins on a fight against an NPC or player',
        usage: `.wager <amount> [npc | @player]`,
        handler: betHandler,
    },
];
