import type { BotContext } from '../types.js';
import { getWallet, saveWallet } from '../lib/turso.js';
import config from '../config.js';

const prefix = config.prefixes[0];

function fmtP(n: number): string {
    if (n >= 1e12) return (n / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
    if (n >= 1e9)  return (n / 1e9).toFixed(1).replace(/\.0$/, '')  + 'B';
    if (n >= 1e6)  return (n / 1e6).toFixed(0) + 'M';
    if (n >= 1e3)  return (n / 1e3).toFixed(0) + 'K';
    return n.toLocaleString();
}

function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }

// Items the .use command can consume with immediate effects
const USABLE: Record<string, (w: any) => string> = {
    energy_drink: (w) => {
        // Grant +10% bonus coins immediately (avg work ~800, so 80 bonus)
        const bonus = Math.floor(Math.max(w.balance * 0.01, 80));
        w.balance += bonus;
        return `🥤 *Energy Drink used!*\n\nAdrenaline surging — you got an instant *+${bonus.toLocaleString()} 🪙* cash boost.`;
    },
    protein_bar: (w) => {
        w.xp += 50;
        return `🍫 *Protein Bar consumed!*\n\nYou gained *+50 XP* — gainz mode activated.`;
    },
    neon_water: (w) => {
        const fiveMin = 5 * 60 * 1000;
        w.lastWork = Math.max(0, w.lastWork - fiveMin);
        return `💧 *Neon Water drank!*\n\n-5 minutes shaved off your work cooldown.`;
    },
    data_tacos: (w) => {
        w.lastWork = 0;
        return `🌮 *Data Tacos devoured!*\n\nWork cooldown fully reset. Get back on the grind.`;
    },
    medkit: (w) => {
        // Clear any debt flags / XP loss — for now reset lastRob penalty timer
        w.lastRob = Math.max(0, w.lastRob - 60 * 60 * 1000); // -1h off rob probation
        return `🩺 *Advanced Medkit used!*\n\nInjuries treated. Rob probation reduced by 1 hour.`;
    },
    broken_hourglass: (w) => {
        const cooldowns = ['lastRob', 'lastWork', 'lastDaily'];
        const pick = cooldowns[Math.floor(Math.random() * cooldowns.length)] as keyof typeof w;
        (w as any)[pick] = 0;
        const names: Record<string, string> = { lastRob: 'Rob Cooldown', lastWork: 'Work Cooldown', lastDaily: 'Daily Cooldown' };
        return `⏳ *Broken Hourglass smashed!*\n\nTime fractured — *${names[pick as string]}* has been reset.`;
    },
    chronos_wand: (w) => {
        w.lastRob   = 0;
        w.lastWork  = 0;
        w.lastDaily = 0;
        return `🔮 *Chronos Wand activated!*\n\nAll cooldowns wiped. Time is yours.`;
    },
    mrbeast_box: (w) => {
        const roll = Math.random();
        if (roll < 0.05) {
            // Jackpot — rare item
            const rarePrize = ['combat_katana', 'taser_baton', 'silenced_pistol'][Math.floor(Math.random() * 3)];
            w.inventory.push(rarePrize);
            return `🎁 *MrBeast Mystery Box opened!*\n\n🎉 JACKPOT! You pulled a *${rarePrize.replace(/_/g, ' ')}* from the box!`;
        }
        const payout = Math.floor(Math.random() * 4_950_000 + 50_000);
        w.balance += payout;
        return `🎁 *MrBeast Mystery Box opened!*\n\nHey, ${['champ', 'legend', 'winner', 'absolute savage'][Math.floor(Math.random() * 4)]}! You got *${payout.toLocaleString()} 🪙*!`;
    },
    temu_parcel: (w) => {
        const pool = ['shield', 'lucky', 'energy_drink', 'protein_bar', 'neon_water', 'broken_hourglass', 'ticket'];
        const gift = pool[Math.floor(Math.random() * pool.length)];
        w.inventory.push(gift);
        return `📦 *Temu Mystery Parcel opened!*\n\nSomewhat suspicious packaging... You got a *${gift.replace(/_/g, ' ')}*!`;
    },
};

export default [
    {
        command: 'bmarket',
        aliases: ['blackmarket', 'dmarket', 'bm'],
        category: 'economy',
        description: 'Browse the DavidXTech Black Market',
        usage: '.bmarket',

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));

            await sock.sendMessage(chatId, {
                text:
`╔═════════════════════════════════════╗
║  🕵️ *D A V I D X T E C H* 🕵️  ║
║      *B L A C K  M A R K E T*      ║
╚═════════════════════════════════════╝

_OPERATOR_   :: DavidXTech
_REGISTRY_   :: Unsanctioned
_CREDIT_     :: ${w.balance.toLocaleString()} 🪙
_ENCRYPTION_ :: AES-256 Active
_CUSTOMER_   :: ${message.pushName || cleanJid(senderId)}

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  _GEAR UP. GET PAID. GET OUT._  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

_[ ⚡ CONSUMABLES & RATIONS ]_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- _Energy Drink_ ─ 150 🪙
  ↳ _[+10% Work Cash] .buy energy\\_drink_
- _Protein Bar_ ─ 200 🪙
  ↳ _[+50 XP] .buy protein\\_bar_
- _Neon Water_ ─ 500 🪙
  ↳ _[-5m Work CD] .buy neon\\_water_
- _Data Tacos_ ─ 8K 🪙
  ↳ _[Full Work Reset] .buy data\\_tacos_

_[ 💊 MEDICAL & LEGAL ]_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- _Advanced Medkit_ ─ 15K 🪙
  ↳ _[Heals Injuries] .buy medkit_
- _Corrupted Colly_ ─ 5.5B 🪙
  ↳ _[No Court. No Violations.] .buy corrupt\\_colly_

_[ ⚔️ ARMORY — BATTLE READY ]_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- _Brass Knuckles_ ─ 25K 🪙
  ↳ _[+10% Rob Payout] .buy brass\\_knuckles_
- _Taser Baton_ ─ 50K 🪙
  ↳ _[Stun & Win Battles] .buy taser\\_baton_
- _Combat Katana_ ─ 250K 🪙
  ↳ _[Dominate Duels] .buy combat\\_katana_
- _Silenced Pistol_ ─ 150M 🪙
  ↳ _[2x Heist Luck] .buy silenced\\_pistol_
- _M4A1 Assault Rifle_ ─ 950M 🪙
  ↳ _[Ultimate Firepower] .buy m4a1_

_[ 🥷 TACTICAL & TOOLS ]_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- _Broken Hourglass_ ─ 500 🪙
  ↳ _[Resets random CD] .buy broken\\_hourglass_
- _Temu Mystery Parcel_ ─ 1.5K 🪙
  ↳ _[Random useful item] .buy temu\\_parcel_
- _Lockpick Set_ ─ 20K 🪙
  ↳ _[100% Rob Success] .buy lockpick\\_set_
- _Elon Musk Chip_ ─ 1.2B 🪙
  ↳ _[Hack Locks] .buy elon\\_chip_
- _Bugatti Key_ ─ 12B 🪙
  ↳ _[+50% Rob Success] .buy tate\\_bugatti\\_key_

_[ 🔮 THE OVERLOAD ]_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- _Chronos Wand_ ─ 18B 🪙
  ↳ _[Reset ALL CDs] .buy chronos\\_wand_
- _Infinity Battery_ ─ 25B 🪙
  ↳ _[1H Infinite Energy] .buy infinity\\_battery_
- _Ghost Protocol_ ─ 30B 🪙
  ↳ _[Zero Heat Gain] .buy ghost\\_protocol_
- _Master Keycard_ ─ 50B 🪙
  ↳ _[100% Hack Success] .buy master\\_keycard_

_[ 🎁 ELITE ACQUISITIONS ]_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- _MrBeast Mystery Box_ ─ 800M 🪙
  ↳ _[Huge payout or rare item] .buy mrbeast\\_box_

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🕵️ _SNEAKY INFO:_  ┃
┃  _Visit the *Colly Drug Shop* via:_  ┃
┃  ⮕ ${prefix}drugshop  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`,
                ...channelInfo
            }, { quoted: message });
        },
    },

    // .use moved to plugins/shopsystem.ts (unified consumable handler with shop_effects table)
];
