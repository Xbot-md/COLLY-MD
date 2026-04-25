import type { BotContext } from '../types.js';
import { getWallet, saveWallet } from '../lib/turso.js';
import { addEffect, hasEffect, getActiveEffects, clearAllEffects } from '../lib/effects.js';
import config from '../config.js';

const prefix = config.prefixes[0];
const fmt    = (n: number) => n.toLocaleString();
const cleanJid = (jid: string) => jid.split(':')[0].split('@')[0];

// ── Drug definitions ───────────────────────────────────────────────────────────
interface DrugDef {
    id: string;
    name: string;
    price: number;
    toxicity: number;
    category: string;
    displayPrice: string;
    effectName: string;
    effectDesc: string;
    durationMs: number; // 0 = instant
}

const DRUGS: DrugDef[] = [
    // ── Performance Enhancers
    { id: 'neon_glitch',         name: 'Neon Glitch',          price: 1_200,           toxicity: 5,  category: 'performance', displayPrice: '1.2K',  effectName: 'bypass_job_cd',      effectDesc: 'Bypass 1 Job Cooldown instantly',              durationMs: 0 },
    { id: 'cyber_dust',          name: 'Cyber-Dust',           price: 2_500,           toxicity: 10, category: 'performance', displayPrice: '2.5K',  effectName: 'crime_luck',         effectDesc: '+40% Luck on your next 3 Crimes',              durationMs: 0 },
    { id: 'iron_lung_serum',     name: 'Iron-Lung Serum',      price: 5_000,           toxicity: 5,  category: 'performance', displayPrice: '5.0K',  effectName: 'energy_drain_50pct', effectDesc: 'Infinite Sprint: -50% Energy Drain for 1h',    durationMs: 3_600_000 },
    // ── Skill Boosters
    { id: 'neural_linker',       name: 'Neural-Linker',        price: 12_000,          toxicity: 15, category: 'skill',       displayPrice: '12K',   effectName: 'xp_boost_20pct',    effectDesc: '+20% more XP from all actions for 2h',         durationMs: 7_200_000 },
    { id: 'venom_vial',          name: 'Venom-Vial',           price: 45_000,          toxicity: 25, category: 'skill',       displayPrice: '45K',   effectName: 'battle_dominate',   effectDesc: '+50% Battle Damage | Win any Street Fight',    durationMs: 3_600_000 },
    // ── Tactical Advantages
    { id: 'liquid_shadow',       name: 'Liquid Shadow',        price: 150_000,         toxicity: 5,  category: 'tactical',    displayPrice: '150K',  effectName: 'rob_invisible',     effectDesc: 'Invisibility: Hide from rob list for 30m',     durationMs: 1_800_000 },
    { id: 'collys_cocktail',     name: "Colly's Cocktail",     price: 1_500_000,       toxicity: 85, category: 'tactical',    displayPrice: '1.5M',  effectName: 'reset_all_cds',     effectDesc: 'Randomly resets 3 CDs & Restores Full Energy', durationMs: 0 },
    { id: 'diddys_secret_stash', name: "Diddy's Secret Stash", price: 5_000_000,       toxicity: 85, category: 'tactical',    displayPrice: '5.0M',  effectName: 'remove_freeze',     effectDesc: 'Bribe a judge: Removes Freeze & Legal Status', durationMs: 0 },
    { id: 'god_mode_injector',   name: 'God-Mode Injector',    price: 8_500_000,       toxicity: 50, category: 'tactical',    displayPrice: '8.5M',  effectName: 'immune_jail',       effectDesc: 'Immune to Jail and Death for 15 minutes',      durationMs: 900_000 },
    // ── Elite Modifiers
    { id: 'lucky_beast_juice',   name: 'Lucky Beast Juice',    price: 80_000_000,      toxicity: 40, category: 'elite',       displayPrice: '80M',   effectName: 'mrbeast_luck',      effectDesc: 'Massive Luck boost for MrBeast Mystery Boxes', durationMs: 3_600_000 },
    { id: 'temu_prime_serum',    name: 'Temu Prime Serum',     price: 2_000_000,       toxicity: 20, category: 'elite',       displayPrice: '2.0M',  effectName: 'temu_guaranteed',   effectDesc: 'Guarantees rare/useful items from Temu Parcels',durationMs: 3_600_000 },
    { id: 'high_roller_drop',    name: 'High-Roller Drop',     price: 15_000_000,      toxicity: 35, category: 'elite',       displayPrice: '15M',   effectName: 'gamble_win_boost',  effectDesc: '+30% Win Chance on Gambling & Slots for 1h',   durationMs: 3_600_000 },
    { id: 'asset_accelerator',   name: 'Asset-Accelerator',    price: 250_000_000,     toxicity: 45, category: 'elite',       displayPrice: '250M',  effectName: 'corp_income_2x',    effectDesc: 'Doubles income from all owned Corporations for 2h', durationMs: 7_200_000 },
    { id: 'bank_breaker_fluid',  name: 'Bank-Breaker Fluid',   price: 500_000_000,     toxicity: 50, category: 'elite',       displayPrice: '500M',  effectName: 'vault_bypass',      effectDesc: 'Allows bypass of Vault security for 1 heist',  durationMs: 3_600_000 },
    { id: 'void_extract',        name: 'Void-Extract',         price: 500_000_000_000, toxicity: 70, category: 'elite',       displayPrice: '500B',  effectName: 'immune_fines',      effectDesc: 'Total immunity to ALL local fines/penalties for 4h', durationMs: 14_400_000 },
    // ── Recovery & Detox
    { id: 'purification_iv',     name: 'Purification IV',      price: 800,             toxicity: 0,  category: 'recovery',    displayPrice: '800',   effectName: 'detox_25pct',       effectDesc: 'Instantly removes 25% Toxicity',               durationMs: 0 },
    { id: 'colly_cleanse',       name: 'Colly-Cleanse',        price: 2_500,           toxicity: 0,  category: 'recovery',    displayPrice: '2.5K',  effectName: 'detox_full',        effectDesc: 'Complete Detox: Resets Toxicity to 0%',        durationMs: 0 },
];

export const DRUG_IDS = new Set(DRUGS.map(d => d.id));
const DRUG_MAP = new Map(DRUGS.map(d => [d.id, d]));
export { DRUG_MAP };

// ── Toxicity status ────────────────────────────────────────────────────────────
function toxStatus(tox: number) {
    if (tox <= 0)  return { label: '✅ Clean',    bar: '░░░░░░░░░░', risk: 'None' };
    if (tox <= 30) return { label: '🟢 Safe',     bar: '█░░░░░░░░░'.repeat(0).padEnd(10,'░'), risk: 'Low' };
    if (tox <= 60) return { label: '🟡 Caution',  bar: '██████░░░░', risk: 'Moderate' };
    if (tox <= 85) return { label: '🔴 Danger',   bar: '████████░░', risk: 'High' };
    return              { label: '☠️  Critical',  bar: '██████████', risk: 'OVERDOSE RISK' };
}

function buildToxBar(tox: number): string {
    const capped = Math.min(100, Math.max(0, tox));
    const filled = Math.round(capped / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// ── Shop panel ─────────────────────────────────────────────────────────────────
function buildShopPanel(name: string, balance: number, toxicity: number): string {
    const cats: Record<string, string> = {
        performance: '_[ ⚡ PERFORMANCE ENHANCERS ]_',
        skill:       '_[ 🧬 SKILL BOOSTERS ]_',
        tactical:    '_[ 🛡️ TACTICAL ADVANTAGES ]_',
        elite:       '_[ 💎 ELITE MODIFIERS ]_',
        recovery:    '_[ 🧼 RECOVERY & DETOX ]_',
    };

    let out =
`╔═══════════════════════════════════════╗
║ 🧪 *_C O L L Y  D R U G  L A B_* 🧪 ║
║         *_B I O - H A C K E D_*        ║
╚═══════════════════════════════════════╝
_CHEMIST_  :: Dr. Colly
_CHEM-ID_  :: #DX-001-ALPHA
_LOCATION_ :: Restricted Sector - Lab 09
_CUSTOMER_ :: ${name}
_CREDIT_   :: ${fmt(balance)} 🪙
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  _INNOVATE FOR A HEALTHIER TOMORROW_  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    let lastCat = '';
    for (const d of DRUGS) {
        if (d.category !== lastCat) {
            out += `\n${cats[d.category]}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
            lastCat = d.category;
        }
        out += `\n ⮕ _${d.name}_ ─ ${d.displayPrice} 🪙\n   ↳ _[${d.effectDesc}] Toxicity: ${d.toxicity}%_`;
    }

    out +=
`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
›*${prefix}buydrg* <drug_id> — Purchase chemical
›*${prefix}usedrg* <drug_id> — Administer dose
›*${prefix}toxicity*         — Check body's limit
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 📦 _INVENTORY ACCESS:_ ┃
┃ _To see the items you have purchased_ ┃
┃ _use the following command:_          ┃
┃ ⮕ *${prefix}inventory*                   ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
_YOUR CURRENT TOXICITY_: ${buildToxBar(toxicity)} ${toxicity}%`;
    return out;
}

// ── Exports ────────────────────────────────────────────────────────────────────
export default [
    {
        command: 'druglab',
        aliases: ['dlshop', 'dlab', 'chemist', 'drlab'],
        category: 'economy',
        description: "Visit Colly's Drug Lab shop",
        usage: `.druglab`,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            await sock.sendMessage(chatId, { text: buildShopPanel(w.name || cleanJid(senderId), w.balance, w.toxicity ?? 0), ...channelInfo }, { quoted: message });
        },
    },

    {
        command: 'buydrg',
        aliases: ['purchasedrug', 'buydrug'],
        category: 'economy',
        description: 'Purchase a drug from the lab',
        usage: `.buydrg <drug_id>`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const drugId = args[0]?.toLowerCase().replace(/-/g, '_');
            if (!drugId) return sock.sendMessage(chatId, { text: `❌ Usage: *${prefix}buydrg <drug_id>*\nSee all drugs with *${prefix}druglab*.`, ...channelInfo }, { quoted: message });

            const drug = DRUG_MAP.get(drugId);
            if (!drug) return sock.sendMessage(chatId, { text: `❌ Drug *${drugId}* not found. Use *${prefix}druglab* to browse available chemicals.`, ...channelInfo }, { quoted: message });

            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            if (w.balance < drug.price) return sock.sendMessage(chatId, { text: `❌ Insufficient funds.\nNeed: *${fmt(drug.price)} 🪙* | You have: *${fmt(w.balance)} 🪙*`, ...channelInfo }, { quoted: message });

            // Chemicals capacity check (max 3)
            const chemCount = w.inventory.filter(id => DRUG_IDS.has(id)).length;
            if (DRUG_IDS.has(drug.id) && drug.category !== 'recovery' && chemCount >= 3) {
                return sock.sendMessage(chatId, { text: `🧬 *Chemical storage full!*\nYou can only carry *3 chemicals* at once. Use or discard one first.`, ...channelInfo }, { quoted: message });
            }

            w.balance -= drug.price;
            w.inventory.push(drug.id);
            await saveWallet(w);

            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ 🧪 *PURCHASE CONFIRMED*
╽ ───────────────────────────────
╽ ITEM      :: ${drug.name}
╽ COST      :: -${fmt(drug.price)} 🪙
╽ BALANCE   :: ${fmt(w.balance)} 🪙
╽ EFFECT    :: ${drug.effectDesc}
╽ TOXICITY  :: +${drug.toxicity}% on use
╽ ───────────────────────────────
╽ Use *${prefix}usedrg ${drug.id}* to administer.
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        },
    },

    {
        command: 'usedrg',
        aliases: ['takedrug', 'inject', 'dosedrug'],
        category: 'economy',
        description: 'Administer a drug from your inventory',
        usage: `.usedrg <drug_id>`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const drugId = args[0]?.toLowerCase().replace(/-/g, '_');
            if (!drugId) return sock.sendMessage(chatId, { text: `❌ Usage: *${prefix}usedrg <drug_id>*`, ...channelInfo }, { quoted: message });

            const drug = DRUG_MAP.get(drugId);
            if (!drug) return sock.sendMessage(chatId, { text: `❌ Unknown drug ID. Check *${prefix}druglab*.`, ...channelInfo }, { quoted: message });

            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const idx = w.inventory.indexOf(drug.id);
            if (idx === -1) return sock.sendMessage(chatId, { text: `❌ You don't have *${drug.name}* in your bag. Buy it with *${prefix}buydrg ${drug.id}*.`, ...channelInfo }, { quoted: message });

            const currentTox = w.toxicity ?? 0;

            // Overdose check
            if (currentTox + drug.toxicity > 100) {
                const overdoseFinePct = 0.12;
                const fine = Math.floor(w.balance * overdoseFinePct);
                w.balance = Math.max(0, w.balance - fine);
                w.toxicity = 50;
                await saveWallet(w);
                return sock.sendMessage(chatId, {
                    text:
`☠️ *OVERDOSE WARNING!*
Your toxicity is too high (*${currentTox}%*). Using *${drug.name}* would push you to *${currentTox + drug.toxicity}%* — fatal territory.

*Medical emergency deduction: -${fmt(fine)} 🪙*
Toxicity stabilised at *50%*.

Use *${prefix}usedrg purification_iv* or *${prefix}usedrg colly_cleanse* to detox first.`,
                    ...channelInfo
                }, { quoted: message });
            }

            // Remove from inventory and apply toxicity
            w.inventory.splice(idx, 1);
            w.toxicity = Math.min(100, currentTox + drug.toxicity);

            let effectResult = '';

            // Apply effects
            switch (drug.effectName) {
                // Instant effects
                case 'bypass_job_cd':
                    w.lastWork = 0;
                    effectResult = '⚡ Work cooldown bypassed! You can work again immediately.';
                    break;
                case 'crime_luck':
                    addEffect(senderId, { drug: drug.id, effectName: 'crime_luck', expiresAt: Date.now() + 7_200_000, data: { charges: 3 } });
                    effectResult = '🎲 +40% crime luck active for your next 3 crimes.';
                    break;
                case 'reset_all_cds':
                    w.lastWork = 0; w.lastDaily = 0; w.lastRob = 0;
                    effectResult = '🔁 All cooldowns reset. Energy fully restored.';
                    break;
                case 'remove_freeze':
                    effectResult = "⚖️ Judge bribed. All legal freezes and warrants cleared.";
                    break;
                case 'detox_25pct':
                    const reduction = Math.floor(currentTox * 0.25);
                    w.toxicity = Math.max(0, currentTox - reduction);
                    effectResult = `💉 Toxicity reduced by ${reduction}%. Now at *${w.toxicity}%*.`;
                    break;
                case 'detox_full':
                    w.toxicity = 0;
                    clearAllEffects(senderId);
                    effectResult = '🧼 Full detox complete. Toxicity reset to *0%*. All drug effects cleared.';
                    break;
                // Duration-based effects — stored in effects store
                default:
                    if (drug.durationMs > 0) {
                        addEffect(senderId, { drug: drug.id, effectName: drug.effectName, expiresAt: Date.now() + drug.durationMs });
                        const mins = Math.round(drug.durationMs / 60000);
                        const durStr = mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}min`;
                        effectResult = `✅ *${drug.name}* active for *${durStr}*.\n${drug.effectDesc}`;
                    } else {
                        effectResult = `✅ *${drug.name}* effect applied.`;
                    }
            }

            await saveWallet(w);

            let toxWarning = '';
            if (w.toxicity >= 85) toxWarning = '\n\n⚠️ *CRITICAL TOXICITY!* Use *${prefix}usedrg colly_cleanse* immediately before your next dose.';
            else if (w.toxicity >= 61) toxWarning = '\n\n🔴 *High toxicity!* Consider detoxing soon.';

            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ 🧬 *DOSE ADMINISTERED*
╽ ───────────────────────────────
╽ DRUG      :: ${drug.name}
╽ TOXICITY  :: +${drug.toxicity}% → *${w.toxicity}%* total
╽ STATUS    :: ${buildToxBar(w.toxicity)} ${w.toxicity}%
╽ ───────────────────────────────
╽ ${effectResult}${toxWarning}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        },
    },

    {
        command: 'toxicity',
        aliases: ['tox', 'toxcheck', 'bodycheck'],
        category: 'economy',
        description: 'Check your current toxicity level and active drug effects',
        usage: `.toxicity`,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const tox = w.toxicity ?? 0;
            const st  = toxStatus(tox);
            const active = getActiveEffects(senderId);

            let effectLines = '';
            if (active.length === 0) {
                effectLines = '╽ None';
            } else {
                for (const e of active) {
                    const rem = Math.ceil((e.expiresAt - Date.now()) / 60000);
                    const d = DRUG_MAP.get(e.drug);
                    const remStr = rem >= 60 ? `${Math.round(rem / 60)}h` : `${rem}min`;
                    effectLines += `╽ • *${d?.name || e.drug}* — ${remStr} left\n`;
                }
            }

            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ 🧪 *TOXICITY REPORT*
╽ ───────────────────────────────
╽ PATIENT   :: ${w.name || cleanJid(senderId)}
╽ TOXICITY  :: ${buildToxBar(tox)} *${tox}%*
╽ STATUS    :: ${st.label}
╽ RISK LVL  :: ${st.risk}
╽ ───────────────────────────────
╽ *ACTIVE EFFECTS*
${effectLines}
╽ ───────────────────────────────
╽ Detox: *${prefix}usedrg purification_iv* (−25%)
╽ Full:  *${prefix}usedrg colly_cleanse*   (0%)
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        },
    },
];
