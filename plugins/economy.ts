import type { BotContext } from '../types.js';
import { resolveJid } from '../lib/lidUtils.js';
import {
    getWallet, saveWallet, getLeaderboard, getShop,
    getEcoVault, setEcoVault, addToEcoVault, type WalletEntry, type ShopItem
} from '../lib/turso.js';
import { requireId, requireIdForBoth, getIdAge } from '../lib/idGate.js';
import { getCourtId, getLoan, getCreditFreeze, garnishFreeze, garnishWorkFreeze } from '../lib/turso2.js';
import config from '../config.js';

function fmt(n: number) { return n.toLocaleString(); }
function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }
function xpForLevel(lvl: number) { return lvl * 500; }

const LEVEL_BONUSES: Record<number, { coins: number; label: string }> = {
    10:   { coins: 500,       label: '🎁 Starter Bonus' },
    25:   { coins: 2_000,     label: '🏅 Hustler Reward' },
    50:   { coins: 10_000,    label: '💎 Mid-Tier Bonus' },
    75:   { coins: 25_000,    label: '🔥 Veteran Bonus' },
    100:  { coins: 75_000,    label: '👑 Century Milestone' },
    200:  { coins: 200_000,   label: '🚀 Double Century' },
    500:  { coins: 1_000_000, label: '⚡ Elite Unlock' },
    750:  { coins: 3_000_000, label: '🌟 Legend Bonus' },
    1000: { coins: 10_000_000,label: '🏆 MAX Tier' },
};

function addXP(w: WalletEntry, amount: number): string | null {
    w.xp += amount;
    const needed = xpForLevel(w.level);
    if (w.xp >= needed) {
        w.level++;
        w.xp -= needed;
        const bonus = LEVEL_BONUSES[w.level];
        if (bonus) {
            w.balance += bonus.coins;
            return `🎉 *LEVEL UP!* You are now *Level ${w.level}*!\n╽  ${bonus.label}: *+$${bonus.coins.toLocaleString()}* added to your wallet!`;
        }
        // Energy fully restored on level up
        w.energy = Math.min(100, (w.energy ?? 100) + 20);
        return `🎉 *LEVEL UP!* You are now *Level ${w.level}*! (+20 Energy)`;
    }
    return null;
}

function getLivingExpenses(level: number): { wifi: number; electricity: number; rent: number } {
    if (level >= 500) return { wifi: 2_000,  electricity: 3_000,  rent: 10_000 };
    if (level >= 100) return { wifi: 500,    electricity: 750,    rent: 2_500  };
    if (level >= 50)  return { wifi: 200,    electricity: 300,    rent: 1_000  };
    if (level >= 20)  return { wifi: 100,    electricity: 150,    rent: 500    };
    return                   { wifi: 50,     electricity: 75,     rent: 200    };
}

function getEnergyRegen(lastWork: number): number {
    const msElapsed = Date.now() - lastWork;
    return Math.min(Math.floor(msElapsed / (5 * 60_000)), 100); // 1 energy per 5 min, max 100
}

function parseAmount(arg: string, wallet: WalletEntry): number | null {
    if (!arg) return null;
    const s = arg.toLowerCase();
    if (s === 'all') return wallet.balance;
    if (s === 'half') return Math.floor(wallet.balance / 2);
    const n = parseInt(s.replace(/[^0-9]/g, ''));
    if (isNaN(n) || n <= 0) return null;
    return n;
}

const BAIL_AMOUNT  = 1000;
const DAILY_BONUS  = 500;

const H = 3_600_000;
interface JobEntry { level: number; name: string; emoji: string; min: number; max: number; cat: string; cooldownMs: number; }
const JOBS: JobEntry[] = [
    // [ SERVICE & INFRASTRUCTURE ]
    { level: 10,   name: 'KFC Cashier',                      emoji: '🍗',  min: 500,       max: 700,        cat: 'service',  cooldownMs: 1 * H       },
    { level: 15,   name: 'School Teacher',                   emoji: '📚',  min: 800,       max: 1200,       cat: 'service',  cooldownMs: 1 * H       },
    { level: 30,   name: 'Street Food Vendor',               emoji: '🌮',  min: 1500,      max: 2500,       cat: 'service',  cooldownMs: 1.5 * H     },
    { level: 40,   name: 'Delivery Driver',                  emoji: '🚚',  min: 2500,      max: 3500,       cat: 'service',  cooldownMs: 2 * H       },
    { level: 45,   name: 'Landscape Gardener',               emoji: '🌿',  min: 3000,      max: 4000,       cat: 'service',  cooldownMs: 2 * H       },
    // [ CREATIVE & ADMIN ]
    { level: 35,   name: 'Data Entry Clerk',                 emoji: '📊',  min: 2000,      max: 3000,       cat: 'creative', cooldownMs: 2 * H       },
    { level: 55,   name: 'Freelance Writer',                 emoji: '✍️',  min: 4000,      max: 5000,       cat: 'creative', cooldownMs: 2.5 * H     },
    { level: 80,   name: 'Professional Voice Actor',         emoji: '🎙️', min: 8000,      max: 9000,       cat: 'creative', cooldownMs: 3 * H       },
    { level: 85,   name: 'Senior Graphic Designer',          emoji: '🎨',  min: 9000,      max: 10000,      cat: 'creative', cooldownMs: 3 * H       },
    // [ TECH & ANALYTICAL ]
    { level: 65,   name: 'Market Researcher',                emoji: '🔍',  min: 5000,      max: 6000,       cat: 'tech',     cooldownMs: 2.5 * H     },
    { level: 70,   name: 'Social Media Lead',                emoji: '📱',  min: 6000,      max: 7000,       cat: 'tech',     cooldownMs: 3 * H       },
    { level: 90,   name: 'IT Systems Consultant',            emoji: '💻',  min: 10000,     max: 12000,      cat: 'tech',     cooldownMs: 4 * H       },
    { level: 95,   name: 'Full-Stack Web Dev',               emoji: '🖥️', min: 12000,     max: 15000,      cat: 'tech',     cooldownMs: 4 * H       },
    // [ ELITE CORPORATE SECTOR ]
    { level: 500,  name: 'NASA Aerospace Engineer',          emoji: '🚀',  min: 200000,    max: 300000,     cat: 'elite',    cooldownMs: 6 * H       },
    { level: 500,  name: 'Tesla Autopilot Developer',        emoji: '⚡',  min: 250000,    max: 350000,     cat: 'elite',    cooldownMs: 6 * H       },
    { level: 500,  name: 'Wildlife Danger Handler',          emoji: '🦁',  min: 300000,    max: 400000,     cat: 'elite',    cooldownMs: 6 * H       },
    { level: 500,  name: 'Lead Quantum Physicist',           emoji: '⚛️', min: 350000,    max: 450000,     cat: 'elite',    cooldownMs: 6 * H       },
    { level: 500,  name: 'GTA 6 Game Developer',            emoji: '🎮',  min: 500000,    max: 600000,     cat: 'elite',    cooldownMs: 7 * H       },
    { level: 500,  name: 'Rick and Morty Animation Studio',  emoji: '🛸',  min: 600000,    max: 700000,     cat: 'elite',    cooldownMs: 7 * H       },
    { level: 500,  name: 'Colly Novels Publishing Empire',   emoji: '📖',  min: 750000,    max: 950000,     cat: 'elite',    cooldownMs: 8 * H       },
    { level: 750,  name: 'DavidXTech Dev Labs',              emoji: '🧠',  min: 1500000,   max: 2000000,    cat: 'elite',    cooldownMs: 10 * H      },
    // [ LEGENDARY OPERATIONS ]
    { level: 1000, name: 'Animation Studio Head',            emoji: '🎬',  min: 2500000,   max: 3500000,    cat: 'legend',   cooldownMs: 12 * H      },
    { level: 1200, name: 'GTA VI Lead Developer',            emoji: '🎯',  min: 4000000,   max: 6000000,    cat: 'legend',   cooldownMs: 18 * H      },
    { level: 1500, name: 'Colly Bot System Admin',           emoji: '🤖',  min: 10000000,  max: 15000000,   cat: 'legend',   cooldownMs: 24 * H      },
];

function fmtPay(n: number): string {
    if (n >= 1_000_000) {
        const m = n / 1_000_000;
        return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
    }
    if (n >= 10_000) return `$${(n / 1000).toFixed(0)}k`;
    return `$${n.toLocaleString()}`;
}

const ENTRY_JOB: JobEntry = { level: 0, name: 'General Labourer', emoji: '🧹', min: 100, max: 400, cat: 'entry', cooldownMs: 0.5 * H };

function pickJob(level: number): JobEntry {
    const eligible = JOBS.filter(j => level >= j.level);
    if (!eligible.length) return ENTRY_JOB;
    return eligible[Math.floor(Math.random() * eligible.length)];
}

function fmtCooldown(ms: number): string {
    const h = Math.floor(ms / H);
    const m = Math.floor((ms % H) / 60_000);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

function todayStr(): string {
    return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
const ROB_CHANCE   = 0.45;
const GAMBLE_WIN   = 0.47;

export default [
    {
        command: 'balance',
        aliases: ['bal', 'wallet', 'coins', 'money', 'bankbal'],
        category: 'economy',
        description: 'Check your coin balance',
        usage: '.balance [@user]',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            let mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || null;
            if (mentioned?.includes('@lid')) mentioned = await resolveJid(sock, mentioned);
            const target = mentioned || senderId;
            const name = mentioned
                ? (message.message?.extendedTextMessage?.contextInfo?.pushName || cleanJid(target))
                : (message.pushName || cleanJid(senderId));
            const [w, idRecord, loan] = await Promise.all([
                getWallet(target, name),
                getCourtId(target).catch(() => null),
                getLoan(target).catch(() => null),
            ]);
            const xpNeeded = xpForLevel(w.level);
            const displayName = idRecord?.legalName || w.name || cleanJid(target);
            const idLine = idRecord
                ? `🪪 *ID:* ${idRecord.idNumber}${idRecord.expiryDate < Date.now() ? ' ⚠️ EXPIRED' : ''}`
                : `🪪 *ID:* ❌ Not Registered`;
            const loanLine = loan
                ? `💸 *Loan:* ${fmt(loan.amount + loan.interest)} 🪙 owed${loan.dueDate < Date.now() ? ' ⚠️ OVERDUE' : ''}`
                : null;
            let text =
                `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n` +
                `╽  💰 *WALLET*\n` +
                `╽  ─────────────────────────────\n` +
                `╽  👤 *${displayName}*\n` +
                `╽  ${idLine}\n` +
                `╽\n` +
                `╽  💵 *Cash:*  ${fmt(w.balance)} 🪙\n` +
                `╽  🏦 *Bank:*  ${fmt(w.bank)} 🪙\n` +
                `╽  💎 *Total:* ${fmt(w.balance + w.bank)} 🪙\n` +
                `╽\n` +
                `╽  ⭐ *Level:* ${w.level}  •  XP: ${w.xp}/${xpNeeded}\n` +
                `╽  🎒 *Items:* ${w.inventory.length || 'None'}\n`;
            if (loanLine) text += `╽  ${loanLine}\n`;
            if (!idRecord) text += `╽\n╽  _Register: .registeredid <Name>|<DOB>|<Nationality>_\n`;
            text += `┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`;
            await sock.sendMessage(chatId, {
                text,
                mentions: [target],
                ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'daily',
        aliases: ['claim'],
        category: 'economy',
        description: 'Claim your daily coins',
        usage: '.daily',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const now = Date.now();
            const ms24h = 24 * 60 * 60 * 1000;
            if (now - w.lastDaily < ms24h) {
                const rem = ms24h - (now - w.lastDaily);
                const h = Math.floor(rem / 3600000);
                const m = Math.floor((rem % 3600000) / 60000);
                return sock.sendMessage(chatId, { text: `⏳ Daily already claimed!\nCome back in *${h}h ${m}m* ⏰`, ...channelInfo }, { quoted: message });
            }
            const rawEarned = DAILY_BONUS;
            const kept = await garnishFreeze(senderId, chatId, rawEarned);
            const garnished = rawEarned - kept;
            w.balance += kept;
            w.lastDaily = now;
            const lvlUp = addXP(w, 50);
            await saveWallet(w);
            const garnishNote = garnished > 0
                ? `\n💸 *Garnished:* ${fmt(garnished)} 🪙 (credit freeze debt)`
                : '';
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🎁 *DAILY REWARD*
╽  ─────────────────────────────
╽  💰 *Earned:*  +${fmt(rawEarned)} 🪙${garnishNote ? '\n' + garnishNote.replace('\n', '') : ''}
╽  💵 *Balance:* ${fmt(w.balance)} 🪙
╽
╽  ⏰ Next claim: in 24h
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷${lvlUp ? '\n\n' + lvlUp : ''}`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'work',
        aliases: ['earn'],
        category: 'economy',
        description: 'Work to earn coins (level-based jobs)',
        usage: '.work',
        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const now = Date.now();
            const prevCooldown = w.workCooldownMs ?? 7_200_000;
            if (now - w.lastWork < prevCooldown) {
                const rem = prevCooldown - (now - w.lastWork);
                return sock.sendMessage(chatId, {
                    text: `😮‍💨 *Still on Break!*\n\nYou need to rest for *${fmtCooldown(rem)}* before your next shift.\n\n💼 Use *${prefix}jobs* to browse available roles.`,
                    ...channelInfo
                }, { quoted: message });
            }

            const job    = pickJob(w.level);
            const gross  = Math.floor(Math.random() * (job.max - job.min + 1)) + job.min;
            const today  = todayStr();

            // ── FROZEN: Garnished Labor Record ─────────────────────────────────
            const garnish = await garnishWorkFreeze(senderId, chatId, gross);
            if (garnish) {
                const vaultBal = await getEcoVault();
                await setEcoVault(vaultBal + garnish.vaultTax);
                w.balance += garnish.kept;
                w.lastWork = now;
                w.workCooldownMs = job.cooldownMs;
                const lvlUp = addXP(w, 30);
                await saveWallet(w);
                const debtLine = garnish.cleared
                    ? `✅ Debt fully cleared! Freeze has been *lifted*.`
                    : `📉 *Remaining Liability:* ${fmtPay(garnish.debtRemaining)}\n╽  ℹ️ Freeze remains active until $0.`;
                const keptLine = garnish.kept > 0
                    ? `\n╽  💰 *Your Keep:* ${fmtPay(garnish.kept)} (surplus above debt)`
                    : '';
                await sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  💸 *GARNISHED LABOR RECORD*
╽
╽  ❏ *Subject:* @${cleanJid(senderId)}
╽  ❏ *Job Role:* ${job.name} ${job.emoji}
╽  ❏ *Date:* ${today}
╽
╽  ⚖️ *Financial Breakdown:*
╽  ❏ *Gross Pay:* ${fmtPay(gross)}
╽  ❏ *Vault Tax (20%):* -${fmtPay(garnish.vaultTax)} 🏛️
╽  ❏ *Applied to Debt:* ${fmtPay(garnish.appliedToDebt)}${keptLine}
╽
╽  🏛️ Note: The 20% tax has been moved
╽  directly to the Group Vault.
╽
╽  ${debtLine}
╽
╽  ⏳ *Next Shift:* in ${fmtCooldown(job.cooldownMs)}
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [senderId], ...channelInfo
                }, { quoted: message });
                if (lvlUp) await sock.sendMessage(chatId, { text: lvlUp, ...channelInfo }, { quoted: message });
                return;
            }

            // ── NORMAL WORK ─────────────────────────────────────────────────────

            // Energy: regen since last work, then check/drain
            const regenAmt = getEnergyRegen(w.lastWork);
            w.energy = Math.min(100, (w.energy ?? 100) + regenAmt);
            if (w.energy <= 0) {
                return sock.sendMessage(chatId, {
                    text: `😴 *Too Exhausted to Work!*\n\nYour energy is at *0/100*.\n\nRest or use an energy item to recover. Energy regens 1 per 5 minutes.`,
                    ...channelInfo
                }, { quoted: message });
            }
            const energyDrain = Math.min(25, w.energy);
            w.energy -= energyDrain;

            // Health modifier (below 50 = 20% reduction)
            const health = w.health ?? 100;
            const healthMult = health < 50 ? 0.8 : 1.0;
            const afterHealth = Math.round(gross * healthMult);

            // Living expenses
            const exp = getLivingExpenses(w.level);
            const totalExp = exp.wifi + exp.electricity + exp.rent;
            const netPay = Math.max(afterHealth - totalExp, 0);

            w.balance += netPay;
            w.lastWork = now;
            w.workCooldownMs = job.cooldownMs;
            const lvlUp = addXP(w, 30);
            await saveWallet(w);

            const healthNote = health < 50 ? `\n╽  ⚠️ *Low Health (${health}/100):* -20% pay` : '';
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  💼 *WORK COMPLETE*
╽
╽  ❏ *Role:* ${job.name} ${job.emoji}
╽  ❏ *Level:* ${w.level} / Min. ${job.level}
╽  ❏ *Date:* ${today}
╽
╽  💰 *Gross Pay:* +${fmtPay(gross)}${healthNote}
╽  ─────────────────────────
╽  📶 *WiFi Bill:*      -$${fmt(exp.wifi)}
╽  💡 *Electricity:*    -$${fmt(exp.electricity)}
╽  🏠 *Rent:*           -$${fmt(exp.rent)}
╽  ─────────────────────────
╽  💵 *Take-Home:*  +${fmtPay(netPay)}
╽  💳 *Balance:*    $${fmt(w.balance)}
╽  ⚡ *Energy:*     ${w.energy}/100 (-${energyDrain})
╽
╽  ⏳ *Next Shift:* in ${fmtCooldown(job.cooldownMs)}
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷${lvlUp ? '\n\n' + lvlUp : ''}`,
                mentions: [senderId], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── .jobs ───────────────────────────────────────────────────────────────
    {
        command: 'jobs',
        aliases: ['joblist', 'worklist', 'careers'],
        category: 'economy',
        description: 'View all available jobs and level requirements',
        usage: '.jobs',
        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];

            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const lvl = w.level;

            function jobLine(j: JobEntry) {
                const unlock = lvl >= j.level ? '✅' : `🔒`;
                return `${unlock} *${j.name}* (Lv.${j.level}) ◈ ${fmtPay(j.min)} – ${fmtPay(j.max)} ⏳${fmtCooldown(j.cooldownMs)}`;
            }

            const service  = JOBS.filter(j => j.cat === 'service');
            const creative = JOBS.filter(j => j.cat === 'creative');
            const tech     = JOBS.filter(j => j.cat === 'tech');
            const elite    = JOBS.filter(j => j.cat === 'elite');
            const legend   = JOBS.filter(j => j.cat === 'legend');

            const text =
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🏛️ *G L O B A L  R E G I S T R Y*
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷

*[ 📑 MANDATORY CERTIFICATION ]*
_Your Level: ${lvl}_

*[ 🛠️ SERVICE & INFRASTRUCTURE ]*
${service.map(jobLine).join('\n')}

*[ 🖋️ CREATIVE & ADMIN ]*
${creative.map(jobLine).join('\n')}

*[ 💻 TECH & ANALYTICAL ]*
${tech.map(jobLine).join('\n')}

*[ 🚀 ELITE CORPORATE SECTOR ]*
${elite.map(jobLine).join('\n')}

*[ 🌌 LEGENDARY OPERATIONS ]*
${legend.map(jobLine).join('\n')}

*[ 🤝 PRIVATE VACANCIES ]*
🚫 No independent business listings active.
💡 Apply: *${prefix}apply [business] @owner*
ℹ️ Directory: *${prefix}business list*
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`;

            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        }
    },

    {
        command: 'gamble',
        aliases: ['bet', 'dice'],
        category: 'economy',
        description: 'Gamble your coins',
        usage: '.gamble <amount|all|half>',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const age = await getIdAge(senderId, sock);
            if (age !== null && age < 18) {
                return sock.sendMessage(chatId, { text: `🔞 *Age Restricted*\n\nGambling requires age *18+*.\nYour registered age: *${age}*`, ...channelInfo }, { quoted: message });
            }
            if (!args[0]) return sock.sendMessage(chatId, { text: `❌ Usage: .gamble <amount|all|half>`, ...channelInfo }, { quoted: message });
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const amount = parseAmount(args[0], w);
            if (!amount || amount <= 0) return sock.sendMessage(chatId, { text: `❌ Invalid amount.`, ...channelInfo }, { quoted: message });
            if (amount > w.balance) return sock.sendMessage(chatId, { text: `❌ You only have *${fmt(w.balance)} 🪙*`, ...channelInfo }, { quoted: message });
            if (amount < 10) return sock.sendMessage(chatId, { text: `❌ Minimum bet is *10 🪙*`, ...channelInfo }, { quoted: message });
            const hasLucky = w.inventory.includes('lucky');
            const chance = hasLucky ? GAMBLE_WIN + 0.1 : GAMBLE_WIN;
            if (hasLucky) w.inventory.splice(w.inventory.indexOf('lucky'), 1);
            const won = Math.random() < chance;
            const multiplier = parseFloat((Math.random() * 0.5 + 1.5).toFixed(2));
            if (won) {
                const winnings = Math.floor(amount * multiplier);
                w.balance += winnings - amount;
                const lvlUp = addXP(w, 20);
                await saveWallet(w);
                await sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🎰 *WINNER!*
╽  ─────────────────────────────
╽  📊 *Bet:*      ${fmt(amount)} 🪙 × ${multiplier}
╽  💰 *Won:*      +${fmt(winnings)} 🪙
╽  💵 *Balance:*  ${fmt(w.balance)} 🪙
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷${lvlUp ? '\n\n' + lvlUp : ''}`,
                    ...channelInfo
                }, { quoted: message });
            } else {
                w.balance -= amount;
                await saveWallet(w);
                await sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🎰 *BUST!*
╽  ─────────────────────────────
╽  📉 *Lost:*     -${fmt(amount)} 🪙
╽  💵 *Balance:*  ${fmt(w.balance)} 🪙
╽  _Better luck next time 🤞_
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    ...channelInfo
                }, { quoted: message });
            }
        }
    },

    {
        command: 'rob',
        aliases: ['steal', 'heist'],
        category: 'economy',
        description: 'Attempt to rob another user',
        usage: '.rob @user',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            let target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (target?.includes('@lid')) target = await resolveJid(sock, target);
            if (!target) return sock.sendMessage(chatId, { text: `❌ Tag someone to rob. Usage: .rob @user`, ...channelInfo }, { quoted: message });
            if (target === senderId) return sock.sendMessage(chatId, { text: `🤦 You can't rob yourself bruh.`, ...channelInfo }, { quoted: message });
            const [robber, victim] = await Promise.all([
                getWallet(senderId, message.pushName || cleanJid(senderId)),
                getWallet(target, cleanJid(target))
            ]);
            const now = Date.now();
            const cooldown = 3 * 60 * 60 * 1000;
            if (now - robber.lastRob < cooldown) {
                const rem = cooldown - (now - robber.lastRob);
                const h = Math.floor(rem / 3600000);
                const m = Math.floor((rem % 3600000) / 60000);
                return sock.sendMessage(chatId, { text: `😤 Lay low for *${h}h ${m}m* before robbing again.`, ...channelInfo }, { quoted: message });
            }
            if (victim.balance < 100) return sock.sendMessage(chatId, { text: `😂 That person is *dead broke* — not worth it!`, ...channelInfo }, { quoted: message });
            if (victim.inventory.includes('shield')) {
                victim.inventory.splice(victim.inventory.indexOf('shield'), 1);
                robber.lastRob = now;
                await Promise.all([saveWallet(robber), saveWallet(victim)]);
                return sock.sendMessage(chatId, { text: `🛡️ *Rob Failed!*\n\n@${cleanJid(target)} had a *Rob Shield*! It blocked your heist! Shield is now gone.`, mentions: [target], ...channelInfo }, { quoted: message });
            }
            // ── weapon checks ─────────────────────────────────────────────
            let robChance = ROB_CHANCE;
            let hasLockpick    = false;
            let hasBrass       = false;
            let hasBugatti     = false;

            if (robber.inventory.includes('lockpick_set')) {
                hasLockpick = true;
                robber.inventory.splice(robber.inventory.indexOf('lockpick_set'), 1); // consume
            }
            if (robber.inventory.includes('brass_knuckles')) {
                hasBrass = true;
                robber.inventory.splice(robber.inventory.indexOf('brass_knuckles'), 1); // consume
            }
            if (robber.inventory.includes('tate_bugatti_key')) {
                hasBugatti = true; // passive — not consumed
                robChance = Math.min(1, robChance + 0.50);
            }
            if (hasLockpick) robChance = 1; // 100% override

            const success = Math.random() < robChance;

            // ── helpers ──────────────────────────────────────────────────
            const d = new Date();
            const dd   = String(d.getDate()).padStart(2, '0');
            const mm   = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            const hh   = String(d.getHours()).padStart(2, '0');
            const min  = String(d.getMinutes()).padStart(2, '0');
            const dateSlash = `${dd}/${mm}/${yyyy}`;
            const dateTime  = `${dateSlash} ${hh}:${min} AEST`;

            if (success) {
                // 30-min cooldown on clean getaway
                robber.lastRob = now - (3 * 3600000 - 30 * 60000);
                let stolen = Math.floor(victim.balance * (Math.random() * 0.3 + 0.1));
                if (hasBrass) stolen = Math.floor(stolen * 1.10);
                victim.balance -= stolen;
                robber.balance += stolen;
                addXP(robber, 15);
                await Promise.all([saveWallet(robber), saveWallet(victim)]);

                const narratives = [
                    {
                        scene: [`You bumped into @${cleanJid(target)} during the`, `market rush, lifted their wallet from`, `their back pocket, and blended into the`, `crowd before they even noticed.`],
                        notes: [`No witnesses. No evidence.`, `Victim hasn't reported it yet.`],
                    },
                    {
                        scene: [`You waited until @${cleanJid(target)} entered`, `the alley with poor lighting. You wore`, `a mask and gloves, took the cash, and`, `vanished before anyone noticed.`],
                        notes: [`No witnesses. No evidence.`, `Patrols found nothing to report.`],
                    },
                    {
                        scene: [`You tailed @${cleanJid(target)} from the shops,`, `slipped into their blind spot near the`, `car park, and swiped their cash`, `before disappearing into the crowd.`],
                        notes: [`CCTV footage was unusable.`, `Police have no suspects.`],
                    },
                    {
                        scene: [`You distracted @${cleanJid(target)} with`, `a conversation while your free hand`, `slipped into their bag. A classic job.`, `Clean, quick, and untraceable.`],
                        notes: [`Victim unaware until much later.`, `No physical evidence collected.`],
                    },
                ];
                const pick = narratives[Math.floor(Math.random() * narratives.length)];
                const sceneBlock = pick.scene.map(l => `╽ ${l}`).join('\n');

                await sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ 💰 *ROBBERY SUCCESSFUL*
${sceneBlock}
╽ ───────────────────────────────
╽ DATE     :: ${dateTime}
╽ OFFENDER :: @${cleanJid(senderId)}
╽ VICTIM   :: @${cleanJid(target)}
╽ STATUS   :: Clean Getaway
╽ ───────────────────────────────
╽ AMOUNT STOLEN :: ${fmt(stolen)} 🪙
╽ NEW BALANCE   :: ${fmt(robber.balance)} 🪙
╽ COOLDOWN      :: 30 Minutes
╽ ───────────────────────────────
╽ Note: ${pick.notes[0]}
╽ ${pick.notes[1]}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [senderId, target], ...channelInfo
                }, { quoted: message });

            } else {
                // ── caught — court verdict ────────────────────────────────
                robber.lastRob = now; // full 3-hour probation
                const caseSeq    = Math.floor(Math.random() * 9000 + 1000);
                const caseMonth  = Math.floor(Math.random() * 90 + 10);
                const caseNo     = `RB-${caseSeq}-${caseMonth}`;
                const chargeCount = Math.floor(Math.random() * 3) + 1;

                const registryFine = Math.min(
                    Math.max(Math.floor(robber.balance * (0.25 + Math.random() * 0.10)), 500),
                    Math.floor(robber.balance * 0.90)
                );
                const compensation = Math.min(
                    Math.max(Math.floor(registryFine * (0.12 + Math.random() * 0.10)), 200),
                    Math.floor(registryFine * 0.35)
                );
                const totalDeducted = Math.min(registryFine + compensation, robber.balance);
                robber.balance     -= totalDeducted;
                victim.balance     += compensation;

                await Promise.all([
                    saveWallet(robber),
                    saveWallet(victim),
                    addToEcoVault(registryFine),
                ]);

                await sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🚨 *COLLY MD LAW ENFORCEMENT*
╽  You were caught trying to rob @${cleanJid(target)}
╽  and were taken to court.
╽  ───────────────────────────────
╽  CASE NO.      :: ${caseNo} | ${dateSlash}
╽  OFFENDER      :: @${cleanJid(senderId)}
╽  VICTIM        :: @${cleanJid(target)}
╽  VERDICT       :: Guilty — Robbery
╽  CHARGE COUNT  :: ${chargeCount}
╽  ───────────────────────────────
╽  REGISTRY FINE      :: ${fmt(registryFine)} 🪙
╽  VICTIM COMPENSATION :: ${fmt(compensation)} 🪙
╽  TOTAL DEDUCTED      :: ${fmt(totalDeducted)} 🪙
╽  REMAINING BALANCE   :: ${fmt(robber.balance)} 🪙
╽  PROBATION           :: 3 Hours
╽  ───────────────────────────────
╽  Presiding: Collins Author
╽  David [Operations Manager]
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷[Director]`,
                    mentions: [senderId, target], ...channelInfo
                }, { quoted: message });
            }
        }
    },

    {
        command: 'give',
        aliases: ['pay', 'transfer', 'send'],
        category: 'economy',
        description: 'Send coins to another user',
        usage: '.give @user <amount>',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const senderFreeze = await getCreditFreeze(senderId, chatId);
            if (senderFreeze) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🚫 *TRANSFER BLOCKED*
╽
╽  ❏ *Subject:* @${cleanJid(senderId)}
╽  ❏ *Violation:* Asset Evasion
╽  ❏ *Date:* ${todayStr()}
╽
╽  ⚖️ *Security Protocol:*
╽  Outbound transfers are disabled.
╽  To ensure the Group Vault receives
╽  due taxes, all assets are locked
╽  until your balance is cleared.
╽
╽  ⚠️ Note: Your income is being monitored.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [senderId], ...channelInfo
                }, { quoted: message });
            }
            let target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (target?.includes('@lid')) target = await resolveJid(sock, target);
            if (!target || !args[0]) return sock.sendMessage(chatId, { text: `❌ Usage: .give @user <amount>`, ...channelInfo }, { quoted: message });
            if (target === senderId) return sock.sendMessage(chatId, { text: `💀 You can't pay yourself.`, ...channelInfo }, { quoted: message });
            const [sender, receiver] = await Promise.all([
                getWallet(senderId, message.pushName || cleanJid(senderId)),
                getWallet(target, cleanJid(target))
            ]);
            const amountStr = args.find((a: string) => !a.startsWith('@'));
            const amount = parseAmount(amountStr, sender);
            if (!amount || amount <= 0) return sock.sendMessage(chatId, { text: `❌ Invalid amount.`, ...channelInfo }, { quoted: message });
            if (amount > sender.balance) return sock.sendMessage(chatId, { text: `❌ Insufficient funds. You have *${fmt(sender.balance)} 🪙*`, ...channelInfo }, { quoted: message });
            sender.balance -= amount;
            receiver.balance += amount;
            await Promise.all([saveWallet(sender), saveWallet(receiver)]);
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  💸 *TRANSFER COMPLETE*
╽  ─────────────────────────────
╽  📤 *Sent:*    ${fmt(amount)} 🪙
╽  👤 *To:*      @${cleanJid(target)}
╽  💵 *Balance:* ${fmt(sender.balance)} 🪙
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'deposit',
        aliases: ['dep'],
        category: 'economy',
        description: 'Deposit coins into your bank',
        usage: '.deposit <amount|all>',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const amount = parseAmount(args[0], w);
            if (!amount) return sock.sendMessage(chatId, { text: `❌ Usage: .deposit <amount|all>`, ...channelInfo }, { quoted: message });
            if (amount > w.balance) return sock.sendMessage(chatId, { text: `❌ Not enough cash. Balance: *${fmt(w.balance)} 🪙*`, ...channelInfo }, { quoted: message });
            w.balance -= amount;
            w.bank += amount;
            await saveWallet(w);
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🏦 *DEPOSIT COMPLETE*
╽  ─────────────────────────────
╽  📥 *Deposited:* +${fmt(amount)} 🪙
╽  💵 *Cash:*      ${fmt(w.balance)} 🪙
╽  🏦 *Bank:*      ${fmt(w.bank)} 🪙
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'withdraw',
        aliases: ['with'],
        category: 'economy',
        description: 'Withdraw coins from your bank',
        usage: '.withdraw <amount|all>',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const freeze = await getCreditFreeze(senderId, chatId);
            if (freeze) {
                const total = freeze.amount + freeze.tax;
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🚫 *WITHDRAWAL BLOCKED*
╽
╽  ❏ *Subject:* @${cleanJid(senderId)}
╽  ❏ *Violation:* Account Freeze
╽  ❏ *Date:* ${todayStr()}
╽
╽  ⚖️ *Banking Restriction:*
╽  Withdrawals are disabled until your
╽  outstanding debt is fully cleared.
╽
╽  💰 *Total Due:* $${fmt(total)}
╽  ❏ *Reason:* ${freeze.reason}
╽
╽  Use *${prefix}work* to earn and auto-repay.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [senderId], ...channelInfo
                }, { quoted: message });
            }
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const bankWallet = { ...w, balance: w.bank };
            const amount = parseAmount(args[0], bankWallet);
            if (!amount) return sock.sendMessage(chatId, { text: `❌ Usage: .withdraw <amount|all>`, ...channelInfo }, { quoted: message });
            if (amount > w.bank) return sock.sendMessage(chatId, { text: `❌ Not enough in bank. Bank: *${fmt(w.bank)} 🪙*`, ...channelInfo }, { quoted: message });
            w.bank -= amount;
            w.balance += amount;
            await saveWallet(w);
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🏧 *WITHDRAWAL COMPLETE*
╽  ─────────────────────────────
╽  📤 *Withdrawn:* +${fmt(amount)} 🪙
╽  💵 *Cash:*      ${fmt(w.balance)} 🪙
╽  🏦 *Bank:*      ${fmt(w.bank)} 🪙
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'leaderboard',
        aliases: ['lb', 'rich', 'top'],
        category: 'economy',
        description: 'View the richest users',
        usage: '.leaderboard',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const sorted = await getLeaderboard(10);
            if (!sorted.length) return sock.sendMessage(chatId, { text: `📊 No data yet!`, ...channelInfo }, { quoted: message });
            const medals = ['🥇', '🥈', '🥉'];
            let text = `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽  💰 *RICHEST USERS*\n╽  ─────────────────────────────\n`;
            sorted.forEach((u, i) => {
                text += `╽  ${medals[i] || `${i + 1}.`} *${u.name || cleanJid(u.userId)}* — ${fmt(u.total)} 🪙  ·  Lv ${u.level}\n`;
            });
            text += `┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`;
            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        }
    },

    // .shop and .buy moved to plugins/shopsystem.ts (full multi-shop system with VAT/receipts)

    {
        command: 'addcoins',
        aliases: ['givecoins', 'addmoney'],
        category: 'economy',
        description: 'Add coins to a user (owner only). Accepts @tag, reply, or phone number.',
        usage: '.addcoins @user <amount>',
        ownerOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const { resolveTarget } = await import('../lib/targetResolver.js');
            const r = await resolveTarget(sock, message, args);
            const target = r.jid;
            const amountStr = r.args.find((a: string) => !a.startsWith('@') && /^\d+$/.test(a));
            if (!target || !amountStr) return sock.sendMessage(chatId, { text: `❌ Usage: .addcoins <@user|reply|phone> <amount>`, ...channelInfo }, { quoted: message });
            const amount = parseInt(amountStr);
            if (isNaN(amount) || amount <= 0) return sock.sendMessage(chatId, { text: `❌ Invalid amount.`, ...channelInfo }, { quoted: message });
            const w = await getWallet(target, cleanJid(target));
            w.balance += amount;
            await saveWallet(w);
            await sock.sendMessage(chatId, {
                text: `✅ Added *${fmt(amount)} 🪙* to @${cleanJid(target)}\n💵 Their new balance: *${fmt(w.balance)} 🪙*`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'removecoins',
        aliases: ['deductcoins', 'takemoney'],
        category: 'economy',
        description: 'Remove coins from a user (owner only). Accepts @tag, reply, or phone number.',
        usage: '.removecoins @user <amount>',
        ownerOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const { resolveTarget } = await import('../lib/targetResolver.js');
            const r = await resolveTarget(sock, message, args);
            const target = r.jid;
            const amountStr = r.args.find((a: string) => !a.startsWith('@') && /^\d+$/.test(a));
            if (!target || !amountStr) return sock.sendMessage(chatId, { text: `❌ Usage: .removecoins <@user|reply|phone> <amount>`, ...channelInfo }, { quoted: message });
            const amount = parseInt(amountStr);
            if (isNaN(amount) || amount <= 0) return sock.sendMessage(chatId, { text: `❌ Invalid amount.`, ...channelInfo }, { quoted: message });
            const w = await getWallet(target, cleanJid(target));
            w.balance = Math.max(0, w.balance - amount);
            await saveWallet(w);
            await sock.sendMessage(chatId, {
                text: `✅ Removed *${fmt(amount)} 🪙* from @${cleanJid(target)}\n💵 Their balance: *${fmt(w.balance)} 🪙*`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ── .weekly ──────────────────────────────────────────────────────────────
    {
        command: 'weekly',
        aliases: ['weeklyreward', 'claimweekly'],
        category: 'economy',
        description: 'Claim your weekly coin bonus (ID required)',
        usage: '.weekly',
        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const now = Date.now();
            const cooldown = 7 * 24 * 60 * 60 * 1000;
            const lastWeekly: number = (w as any).lastWeekly || 0;
            if (now - lastWeekly < cooldown) {
                const rem = cooldown - (now - lastWeekly);
                const d = Math.floor(rem / 86400000);
                const h = Math.floor((rem % 86400000) / 3600000);
                return sock.sendMessage(chatId, { text: `⏳ Weekly already claimed!\nCome back in *${d}d ${h}h* ⏰`, ...channelInfo }, { quoted: message });
            }
            const WEEKLY = 1500;
            w.balance += WEEKLY;
            (w as any).lastWeekly = now;
            const lvlUp = addXP(w, 150);
            await saveWallet(w);
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🗓️ *WEEKLY REWARD*
╽  ─────────────────────────────
╽  💰 *Earned:*  +${fmt(WEEKLY)} 🪙
╽  💵 *Balance:* ${fmt(w.balance)} 🪙
╽
╽  ⏰ Next claim: in 7 days
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷${lvlUp ? '\n\n' + lvlUp : ''}`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ── .monthly ─────────────────────────────────────────────────────────────
    {
        command: 'monthly',
        aliases: ['monthlyreward', 'claimmonthly'],
        category: 'economy',
        description: 'Claim your monthly coin bonus (ID required)',
        usage: '.monthly',
        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const now = Date.now();
            const cooldown = 30 * 24 * 60 * 60 * 1000;
            const lastMonthly: number = (w as any).lastMonthly || 0;
            if (now - lastMonthly < cooldown) {
                const rem = cooldown - (now - lastMonthly);
                const d = Math.floor(rem / 86400000);
                return sock.sendMessage(chatId, { text: `⏳ Monthly already claimed!\nCome back in *${d}d* ⏰`, ...channelInfo }, { quoted: message });
            }
            const MONTHLY = 5000;
            w.balance += MONTHLY;
            (w as any).lastMonthly = now;
            const lvlUp = addXP(w, 500);
            await saveWallet(w);
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  📅 *MONTHLY REWARD*
╽  ─────────────────────────────
╽  💰 *Earned:*  +${fmt(MONTHLY)} 🪙
╽  💵 *Balance:* ${fmt(w.balance)} 🪙
╽
╽  ⏰ Next claim: in 30 days
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷${lvlUp ? '\n\n' + lvlUp : ''}`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ── .networth ────────────────────────────────────────────────────────────
    {
        command: 'networth',
        aliases: ['nw', 'totalworth'],
        category: 'economy',
        description: 'View your total net worth',
        usage: '.networth [@user]',
        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            let mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (mentioned?.includes('@lid')) mentioned = await resolveJid(sock, mentioned);
            const target = mentioned || senderId;
            const name = mentioned
                ? (message.message?.extendedTextMessage?.contextInfo?.pushName || cleanJid(target))
                : (message.pushName || cleanJid(senderId));
            const w = await getWallet(target, name);
            const total = w.balance + w.bank;
            const rank = total >= 100000 ? '💎 Tycoon' : total >= 50000 ? '🥇 Rich' : total >= 10000 ? '🥈 Comfortable' : total >= 1000 ? '🥉 Getting There' : '💸 Broke';
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  💎 *NET WORTH*
╽  ─────────────────────────────
╽  👤 *${w.name || cleanJid(target)}*
╽
╽  💵 *Cash:*  ${fmt(w.balance)} 🪙
╽  🏦 *Bank:*  ${fmt(w.bank)} 🪙
╽  ─────────────────────────────
╽  💎 *Total:* ${fmt(total)} 🪙
╽  🏷️ *Rank:*  ${rank}
╽  ⭐ *Level:* ${w.level}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [target],
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ── .oddjob ──────────────────────────────────────────────────────────────
    {
        command: 'oddjob',
        aliases: ['quickjob', 'sidejob'],
        category: 'economy',
        description: 'Take a quick odd job for small coins (ID required, 30min cooldown)',
        usage: '.oddjob',
        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const now = Date.now();
            const cooldown = 30 * 60 * 1000;
            const lastOdd: number = (w as any).lastOddJob || 0;
            if (now - lastOdd < cooldown) {
                const rem = cooldown - (now - lastOdd);
                const m = Math.floor(rem / 60000);
                return sock.sendMessage(chatId, { text: `😮‍💨 You're still tired! Rest for *${m}m* before doing another odd job.`, ...channelInfo }, { quoted: message });
            }
            const JOBS = [
                'cleaned a car 🚗', 'helped carry groceries 🛒', 'walked a neighbour\'s dog 🐕',
                'fixed a leaking tap 🔧', 'delivered a parcel 📦', 'helped set up chairs 🪑',
                'painted a fence 🖌️', 'washed dishes at a restaurant 🍽️', 'babysat for an hour 👶',
                'ran errands for the elderly 👴', 'helped move furniture 🛋️', 'swept a shop floor 🧹'
            ];
            const earned = Math.floor(Math.random() * 150) + 50;
            const job = JOBS[Math.floor(Math.random() * JOBS.length)];
            w.balance += earned;
            (w as any).lastOddJob = now;
            const lvlUp = addXP(w, 10);
            await saveWallet(w);
            await sock.sendMessage(chatId, {
                text: `🤝 *Odd Job Done!*\n\nYou ${job} and earned *+${fmt(earned)} 🪙*\n💵 *Balance:* ${fmt(w.balance)} 🪙${lvlUp ? '\n\n' + lvlUp : ''}`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ── .crime ───────────────────────────────────────────────────────────────
    {
        command: 'crime',
        aliases: ['commit', 'heist'],
        category: 'economy',
        description: 'Commit a crime for big money — or get caught (ID required)',
        usage: '.crime',
        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const now = Date.now();
            const cooldown = 4 * 60 * 60 * 1000;
            const lastCrime: number = (w as any).lastCrime || 0;
            if (now - lastCrime < cooldown) {
                const rem = cooldown - (now - lastCrime);
                const h = Math.floor(rem / 3600000);
                const m = Math.floor((rem % 3600000) / 60000);
                return sock.sendMessage(chatId, { text: `🚔 Lay low! Police are looking for you.\nTry again in *${h}h ${m}m*`, ...channelInfo }, { quoted: message });
            }
            const CRIMES = [
                'robbed a convenience store 🏪', 'hacked an ATM 💻', 'ran a street scam 🃏',
                'broke into a warehouse 🏭', 'pickpocketed tourists 👜', 'counterfeited cash 💵',
                'stole a shipment 📦', 'ran an underground casino 🎰', 'fenced stolen goods 🕵️'
            ];
            const SUCCESS_RATE = 0.42;
            const earned = Math.floor(Math.random() * 1200) + 500;
            const fine = Math.floor(Math.random() * 600) + 200;
            const crime = CRIMES[Math.floor(Math.random() * CRIMES.length)];
            (w as any).lastCrime = now;
            if (Math.random() < SUCCESS_RATE) {
                w.balance += earned;
                addXP(w, 25);
                await saveWallet(w);
                await sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🦹 *CRIME SUCCESSFUL*
╽  ─────────────────────────────
╽  🎭 You ${crime}
╽
╽  💰 *Stolen:*   +${fmt(earned)} 🪙
╽  💵 *Balance:*  ${fmt(w.balance)} 🪙
╽
╽  _🚔 The law has eyes. Watch out._
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    ...channelInfo
                }, { quoted: message });
            } else {
                const actualFine = Math.min(fine, w.balance);
                w.balance -= actualFine;
                await saveWallet(w);
                await sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🚨 *BUSTED!*
╽  ─────────────────────────────
╽  👮 You tried to ${crime} but got caught
╽
╽  💸 *Fine:*     -${fmt(actualFine)} 🪙
╽  💵 *Balance:*  ${fmt(w.balance)} 🪙
╽
╽  _Next time, be smarter._
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    ...channelInfo
                }, { quoted: message });
            }
        }
    },

    // ── .slots ───────────────────────────────────────────────────────────────
    {
        command: 'slots',
        aliases: ['slotmachine', 'spin'],
        category: 'economy',
        description: 'Spin the slot machine (ID required, 18+)',
        usage: '.slots <amount|all|half>',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const age = await getIdAge(senderId, sock);
            if (age !== null && age < 18) {
                return sock.sendMessage(chatId, { text: `🔞 *Age Restricted*\n\nSlots require age *18+*.\nYour registered age: *${age}*`, ...channelInfo }, { quoted: message });
            }
            if (!args[0]) return sock.sendMessage(chatId, { text: `❌ Usage: .slots <amount|all|half>`, ...channelInfo }, { quoted: message });
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const amount = parseAmount(args[0], w);
            if (!amount || amount <= 0) return sock.sendMessage(chatId, { text: `❌ Invalid amount.`, ...channelInfo }, { quoted: message });
            if (amount > w.balance) return sock.sendMessage(chatId, { text: `❌ You only have *${fmt(w.balance)} 🪙*`, ...channelInfo }, { quoted: message });
            if (amount < 10) return sock.sendMessage(chatId, { text: `❌ Minimum bet is *10 🪙*`, ...channelInfo }, { quoted: message });

            const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '💎', '🎰', '⭐', '🔔'];
            const roll = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
            const r1 = roll(), r2 = roll(), r3 = roll();

            let multiplier = 0;
            let resultLine = '';

            if (r1 === r2 && r2 === r3) {
                if (r1 === '💎') { multiplier = 10; resultLine = '💎 *DIAMOND JACKPOT!* 💎'; }
                else if (r1 === '🎰') { multiplier = 7; resultLine = '🎰 *MEGA WIN!* 🎰'; }
                else if (r1 === '⭐') { multiplier = 5; resultLine = '⭐ *STAR WIN!* ⭐'; }
                else { multiplier = 3; resultLine = '🎉 *THREE OF A KIND!*'; }
            } else if (r1 === r2 || r2 === r3 || r1 === r3) {
                multiplier = 1.5;
                resultLine = '✨ *PAIR!* Small win!';
            } else {
                multiplier = 0;
                resultLine = '💸 *No match. Better luck next time!*';
            }

            const slotLine = `╔══[ 🎰 SLOT MACHINE ]══╗\n║   ${r1}  ${r2}  ${r3}   ║\n╚═══════════════════════╝`;

            if (multiplier > 0) {
                const winnings = Math.floor(amount * multiplier);
                w.balance += winnings - amount;
                addXP(w, 15);
                await saveWallet(w);
                await sock.sendMessage(chatId, {
                    text: `${slotLine}\n\n${resultLine}\n\n💰 *Won:* +${fmt(winnings)} 🪙 (×${multiplier})\n💵 *Balance:* ${fmt(w.balance)} 🪙`,
                    ...channelInfo
                }, { quoted: message });
            } else {
                w.balance -= amount;
                await saveWallet(w);
                await sock.sendMessage(chatId, {
                    text: `${slotLine}\n\n${resultLine}\n\n💸 *Lost:* -${fmt(amount)} 🪙\n💵 *Balance:* ${fmt(w.balance)} 🪙`,
                    ...channelInfo
                }, { quoted: message });
            }
        }
    },

    // ── .blackjack ───────────────────────────────────────────────────────────
    {
        command: 'blackjack',
        aliases: ['bj', '21'],
        category: 'economy',
        description: 'Play blackjack against the dealer (ID required, 18+)',
        usage: '.blackjack <amount|all|half>',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const age = await getIdAge(senderId, sock);
            if (age !== null && age < 18) {
                return sock.sendMessage(chatId, { text: `🔞 *Age Restricted*\n\nBlackjack requires age *18+*.\nYour registered age: *${age}*`, ...channelInfo }, { quoted: message });
            }
            if (!args[0]) return sock.sendMessage(chatId, { text: `❌ Usage: .blackjack <amount|all|half>`, ...channelInfo }, { quoted: message });
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const amount = parseAmount(args[0], w);
            if (!amount || amount <= 0) return sock.sendMessage(chatId, { text: `❌ Invalid amount.`, ...channelInfo }, { quoted: message });
            if (amount > w.balance) return sock.sendMessage(chatId, { text: `❌ You only have *${fmt(w.balance)} 🪙*`, ...channelInfo }, { quoted: message });
            if (amount < 10) return sock.sendMessage(chatId, { text: `❌ Minimum bet is *10 🪙*`, ...channelInfo }, { quoted: message });

            const SUITS = ['♠️', '♥️', '♦️', '♣️'];
            const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
            const deck: { rank: string; suit: string }[] = [];
            for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });

            const shuffle = (arr: any[]) => arr.sort(() => Math.random() - 0.5);
            shuffle(deck);

            const cardVal = (rank: string) => {
                if (['J', 'Q', 'K'].includes(rank)) return 10;
                if (rank === 'A') return 11;
                return parseInt(rank);
            };
            const handTotal = (hand: { rank: string; suit: string }[]) => {
                let total = hand.reduce((s, c) => s + cardVal(c.rank), 0);
                let aces = hand.filter(c => c.rank === 'A').length;
                while (total > 21 && aces > 0) { total -= 10; aces--; }
                return total;
            };
            const fmtCard = (c: { rank: string; suit: string }) => `${c.rank}${c.suit}`;

            const playerHand = [deck.pop()!, deck.pop()!];
            const dealerHand = [deck.pop()!, deck.pop()!];

            let playerTotal = handTotal(playerHand);

            // Auto-play: player hits until 17+ or bust (strategy-based)
            while (playerTotal < 17) {
                playerHand.push(deck.pop()!);
                playerTotal = handTotal(playerHand);
            }

            // Dealer hits until 17+
            while (handTotal(dealerHand) < 17) {
                dealerHand.push(deck.pop()!);
            }
            const dealerTotal = handTotal(dealerHand);

            const playerCards = playerHand.map(fmtCard).join(' ');
            const dealerCards = dealerHand.map(fmtCard).join(' ');

            let outcome = '';
            let delta = 0;
            const playerBJ = playerHand.length === 2 && playerTotal === 21;
            const dealerBJ = dealerHand.length === 2 && dealerTotal === 21;

            if (playerTotal > 21) {
                outcome = '💥 *BUST!* You went over 21.';
                delta = -amount;
            } else if (dealerTotal > 21) {
                outcome = '🎉 *DEALER BUST!* You win!';
                delta = amount;
            } else if (playerBJ && !dealerBJ) {
                outcome = '🃏 *BLACKJACK!* You win big!';
                delta = Math.floor(amount * 1.5);
            } else if (dealerBJ && !playerBJ) {
                outcome = '🃏 *Dealer Blackjack!* You lose.';
                delta = -amount;
            } else if (playerTotal > dealerTotal) {
                outcome = '🥇 *YOU WIN!*';
                delta = amount;
            } else if (dealerTotal > playerTotal) {
                outcome = '😔 *Dealer wins.*';
                delta = -amount;
            } else {
                outcome = '🤝 *PUSH!* It\'s a tie — bet returned.';
                delta = 0;
            }

            w.balance += delta;
            if (delta > 0) addXP(w, 20);
            await saveWallet(w);

            const sign = delta > 0 ? `+${fmt(delta)}` : delta < 0 ? `-${fmt(Math.abs(delta))}` : '±0';
            await sock.sendMessage(chatId, {
                text:
                    `🃏 *BLACKJACK*\n\n` +
                    `👤 *Your hand:* ${playerCards} → *${playerTotal}*\n` +
                    `🤖 *Dealer hand:* ${dealerCards} → *${dealerTotal}*\n\n` +
                    `${outcome}\n\n` +
                    `💰 *${sign} 🪙*\n` +
                    `💵 *Balance:* ${fmt(w.balance)} 🪙`,
                ...channelInfo
            }, { quoted: message });
        }
    },
];
