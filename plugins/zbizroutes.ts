/**
 * zbizroutes.ts — business-specific command routes.
 *
 * Covers: .bizwork, .bizdeposit, .bizwithdraw, .bizpromote, .bizdemote,
 *         .upgradebiz, .bizbuyasset, .bizappeal, .stats, .bizleaderboard,
 *         .employeehistory
 */

import type { BotContext } from '../types.js';
import { resolveJid } from '../lib/lidUtils.js';
import {
    getWallet, saveWallet,
    findBizByName, searchBizByName, updateBizSim,
    getBizEmployee, updateEmployeeField,
    getDeployedBotsForBiz, getBizLeaderboard,
    getBizTxHistory, logBizTx,
    getLeaderboard,
} from '../lib/turso.js';
import { cleanJid } from '../lib/isOwner.js';
import config from '../config.js';

// ─── RE-EXPORT CONSTANTS (turso may not export them directly) ──────────────────
const UPGRADE_MULTS  = [1.0, 1.5, 2.0, 3.0, 5.0];
const UPGRADE_COSTS  = [0, 20_000, 50_000, 100_000, 250_000];
const TAX_RATE       = 0.15;
const $ = (n: number) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// ─── In-memory work cooldown (per user+biz, resets on restart) ────────────────
const workCooldowns = new Map<string, number>(); // `${userId}:${bizId}` → lastWorked ms
const WORK_CD_MS = 4 * 3_600_000; // 4 hours

async function findBiz(nameOrId: string, ownerId?: string) {
    const t = nameOrId.trim();
    let b = ownerId ? await findBizByName(t, ownerId) : await findBizByName(t);
    if (!b && ownerId) b = await searchBizByName(t, ownerId);
    return b;
}

async function calcPendingIncome(biz: any) {
    const bots = await getDeployedBotsForBiz(biz.bizId);
    const now = Date.now();
    const refTime = biz.lastCollected > 0 ? biz.lastCollected : biz.registeredAt;
    const hours = Math.min((now - refTime) / 3_600_000, 24);
    const botBonus = bots.reduce((s: number, b: any) => s + b.incomeBonus, 0);
    const upgMult  = UPGRADE_MULTS[biz.upgradeLevel - 1] ?? 1;
    const repMult  = 0.5 + biz.reputation / 100;
    const grindMult = biz.isGrinding ? 1.5 : 1.0;
    const gross = biz.incomeRate * hours * (1 + botBonus) * upgMult * repMult * grindMult;
    const tax = gross * TAX_RATE;
    return { gross, tax, net: gross - tax, hours };
}

// ─── BIZ ASSET CATALOGUE ──────────────────────────────────────────────────────
const BIZ_ASSETS: Record<string, { cost: number; incomeBonus: number; repBonus: number; emoji: string }> = {
    'animation studio':   { cost: 50_000, incomeBonus: 0.10, repBonus: 5, emoji: '🎨' },
    'rick and morty animation studio': { cost: 50_000, incomeBonus: 0.10, repBonus: 5, emoji: '🎨' },
    'security system':    { cost: 8_000,  incomeBonus: 0.02, repBonus: 3, emoji: '🔒' },
    'solar panels':       { cost: 12_000, incomeBonus: 0.05, repBonus: 3, emoji: '☀️' },
    'automated checkout': { cost: 15_000, incomeBonus: 0.08, repBonus: 2, emoji: '🤖' },
    'website':            { cost: 3_000,  incomeBonus: 0.03, repBonus: 4, emoji: '🌐' },
    'delivery fleet':     { cost: 20_000, incomeBonus: 0.12, repBonus: 2, emoji: '🚐' },
    'vip lounge':         { cost: 25_000, incomeBonus: 0.09, repBonus: 6, emoji: '🛋️' },
    'pos system':         { cost: 5_000,  incomeBonus: 0.04, repBonus: 1, emoji: '💻' },
};

// ─── ECONOMY ASSET CATALOGUE (for smart routing) ──────────────────────────────
const ECO_ASSETS = ['laptop', 'truck', 'farm', 'factory', 'server', 'studio', 'mine'];

export default [

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// .work — no args = economy work (simplified), args = business work
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
    command: 'bizwork',
    aliases: ['bizshift', 'workbiz'],
    category: 'business',
    description: 'Work a shift at your business or as an employee (.bizwork [Business Name])',
    usage: '.bizwork | .bizwork <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;

        if (!args.length) {
            // ── Economy work (simplified, preserves cooldown) ────────────────
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const now = Date.now();
            const cooldown = w.workCooldownMs ?? 7_200_000;
            if (now - w.lastWork < cooldown) {
                const rem = cooldown - (now - w.lastWork);
                const h = Math.floor(rem / 3_600_000);
                const m = Math.floor((rem % 3_600_000) / 60_000);
                return sock.sendMessage(chatId, {
                    text: `😮‍💨 *Still on Break!* ⏳ ${h}h ${m}m remaining.\n\n💡 Tip: _.work [Business Name]_ to earn wages at your business.`,
                    ...channelInfo
                }, { quoted: message });
            }
            const JOBS = [
                { title: 'Delivery Driver', min: 120, max: 250 },
                { title: 'Freelancer',      min: 80,  max: 180 },
                { title: 'Street Vendor',   min: 60,  max: 130 },
                { title: 'Chef',            min: 150, max: 300 },
                { title: 'Programmer',      min: 200, max: 400 },
                { title: 'Security Guard',  min: 100, max: 200 },
                { title: 'Nurse',           min: 180, max: 350 },
            ];
            const job  = JOBS[Math.floor(Math.random() * JOBS.length)];
            const earn = Math.floor(job.min + Math.random() * (job.max - job.min));
            w.balance  += earn;
            w.lastWork  = now;
            await saveWallet(w);
            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  💼 *WORK SHIFT COMPLETE!*
╽  ─────────────────────────────
╽  ❏ *Job:*      ${job.title}
╽  ❏ *Earned:*   ${$(earn)}
╽  ❏ *Balance:*  ${$(w.balance)}
╽
╽  💡 _.work [Business Name]_ for wages.
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }

        // ── Business work ────────────────────────────────────────────────────
        const bizName = args.join(' ').trim();
        // Check ownership first, then employee
        let biz = await findBiz(bizName, senderId);
        let isOwner = !!biz;
        if (!biz) biz = await findBizByName(bizName); // could be an employee

        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business *${bizName}* not found. Check _.businesslist_ for public businesses.`, ...channelInfo }, { quoted: message });

        const cdKey = `${senderId}:${biz.bizId}`;
        const lastW = workCooldowns.get(cdKey) ?? 0;
        const now2  = Date.now();
        if (now2 - lastW < WORK_CD_MS) {
            const rem  = WORK_CD_MS - (now2 - lastW);
            const h    = Math.floor(rem / 3_600_000);
            const m    = Math.floor((rem % 3_600_000) / 60_000);
            return sock.sendMessage(chatId, { text: `⏳ You worked at *${biz.name}* recently. Rest for *${h}h ${m}m* more.`, ...channelInfo }, { quoted: message });
        }

        const emp = await getBizEmployee(biz.bizId, senderId);
        if (!isOwner && !emp) return sock.sendMessage(chatId, { text: `❌ You are not employed at *${biz.name}*.`, ...channelInfo }, { quoted: message });

        let earned = 0; let desc = '';
        if (emp) {
            // Employee: earn 1 hour of salary from biz fund
            const hourPay = emp.salary;
            if (biz.balance < hourPay) return sock.sendMessage(chatId, { text: `❌ *${biz.name}* fund is too low to pay wages right now.`, ...channelInfo }, { quoted: message });
            earned = hourPay;
            await updateBizSim(biz.bizId, { balance: biz.balance - hourPay });
            await logBizTx(biz.bizId, 'Wages', -hourPay, `Wages: ${message.pushName || cleanJid(senderId)}`);
            desc = `1hr wages as ${emp.role}`;
        } else {
            // Owner: earn 10% of base income rate as bonus into biz fund
            earned = Math.round(biz.incomeRate * 0.1);
            await updateBizSim(biz.bizId, { balance: biz.balance + earned });
            await logBizTx(biz.bizId, 'OwnerWork', earned, 'Owner personal shift');
            desc = 'Owner work bonus → biz fund';
        }

        workCooldowns.set(cdKey, now2);
        const w = await getWallet(senderId);
        if (emp) { w.balance += earned; await saveWallet(w); }

        // Slight rep boost for working
        await updateBizSim(biz.bizId, { reputation: Math.min(100, biz.reputation + 1) });

        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  💼 *SHIFT COMPLETE!*
╽  ─────────────────────────────
╽  ❏ *Business:* ${biz.name}
╽  ❏ *Role:*     ${emp ? emp.role : 'Owner'}
╽  ❏ *Earned:*   ${$(earned)}
╽  ❏ *Desc:*     ${desc}
╽  ❏ *Cooldown:* 4 hours
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// .promote — has business name arg = biz promote; else = group admin promote
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
    command: 'bizpromote',
    aliases: ['bizemployeepromote', 'promotebizemployee'],
    category: 'business',
    description: 'Promote a biz employee OR promote to group admin (no biz name = group admin)',
    usage: '.bizpromote @user | .bizpromote @user <Business Name>',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let target   = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (target?.includes('@lid')) target = await resolveJid(sock, target);
        if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .promote @user [Business Name to promote in biz, or omit for group admin]`, ...channelInfo }, { quoted: message });

        const textArgs = args.filter((a: string) => !a.startsWith('@'));
        const bizName  = textArgs.join(' ').trim();

        // If a business name is provided → business employee promotion
        if (bizName) {
            const biz = await findBiz(bizName, senderId);
            if (!biz) return sock.sendMessage(chatId, { text: `❌ Business *${bizName}* not found or not yours.`, ...channelInfo }, { quoted: message });
            const emp = await getBizEmployee(biz.bizId, target);
            if (!emp) return sock.sendMessage(chatId, { text: `❌ @${cleanJid(target)} is not employed at *${biz.name}*.`, mentions: [target], ...channelInfo }, { quoted: message });
            const ROLES = ['Employee', 'Senior', 'Supervisor', 'Manager', 'Director'];
            const curIdx  = ROLES.indexOf(emp.role);
            const newRole = ROLES[Math.min(curIdx + 1, ROLES.length - 1)];
            const newSal  = Math.round(emp.salary * 1.25);
            await updateEmployeeField(biz.bizId, target, { salary: newSal, role: newRole });
            return sock.sendMessage(chatId, {
                text: `📈 @${cleanJid(target)} promoted to *${newRole}* at *${biz.name}*!\nNew salary: ${$(newSal)}/hr`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }

        // No business name → group admin promotion
        try {
            await sock.groupParticipantsUpdate(chatId, [target], 'promote');
            return sock.sendMessage(chatId, {
                text: `👑 @${cleanJid(target)} has been *promoted to group admin*!`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            return sock.sendMessage(chatId, { text: `❌ Failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    }
},

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// .demote — has business name arg = biz demote; else = group admin demote
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
    command: 'bizdemote',
    aliases: ['bizemployeedemote', 'demotebizemployee'],
    category: 'business',
    description: 'Demote a biz employee OR demote group admin (no biz name = group admin)',
    usage: '.bizdemote @user | .bizdemote @user <Business Name>',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let target   = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (target?.includes('@lid')) target = await resolveJid(sock, target);
        if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .demote @user [Business Name to demote in biz, or omit for group admin]`, ...channelInfo }, { quoted: message });

        const textArgs = args.filter((a: string) => !a.startsWith('@'));
        const bizName  = textArgs.join(' ').trim();

        if (bizName) {
            const biz = await findBiz(bizName, senderId);
            if (!biz) return sock.sendMessage(chatId, { text: `❌ Business *${bizName}* not found or not yours.`, ...channelInfo }, { quoted: message });
            const emp = await getBizEmployee(biz.bizId, target);
            if (!emp) return sock.sendMessage(chatId, { text: `❌ @${cleanJid(target)} is not employed at *${biz.name}*.`, mentions: [target], ...channelInfo }, { quoted: message });
            const ROLES = ['Employee', 'Senior', 'Supervisor', 'Manager', 'Director'];
            const curIdx  = ROLES.indexOf(emp.role);
            const newRole = ROLES[Math.max(curIdx - 1, 0)];
            const newSal  = Math.round(Math.max(emp.salary * 0.75, 50));
            await updateEmployeeField(biz.bizId, target, { salary: newSal, role: newRole });
            return sock.sendMessage(chatId, {
                text: `📉 @${cleanJid(target)} demoted to *${newRole}* at *${biz.name}*.\nNew salary: ${$(newSal)}/hr`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }

        // Group admin demotion
        try {
            await sock.groupParticipantsUpdate(chatId, [target], 'demote');
            return sock.sendMessage(chatId, {
                text: `👇 @${cleanJid(target)} has been *demoted from group admin*.`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        } catch (e: any) {
            return sock.sendMessage(chatId, { text: `❌ Failed: ${e.message}`, ...channelInfo }, { quoted: message });
        }
    }
},

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// .buyasset — biz asset purchase (smart asset+biz name splitting)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
    command: 'bizbuyasset',
    aliases: ['purchasebizasset'],
    category: 'business',
    description: 'Buy a business asset (.bizbuyasset "Asset Name" BizName/BE####)',
    usage: '.bizbuyasset <Asset Name> <Business Name or BE####>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        if (args.length < 2) return sock.sendMessage(chatId, {
            text: `❌ Usage: .buyasset <Asset Name> <Business Name>\n\nAvailable assets:\n` +
                  Object.entries(BIZ_ASSETS).filter(([k]) => k !== 'rick and morty animation studio')
                    .map(([n, a]) => `• *${n}* — ${$(a.cost)} | +${(a.incomeBonus*100).toFixed(0)}% income`).join('\n'),
            ...channelInfo
        }, { quoted: message });

        // Split: try to find a biz match from the end, and asset from the beginning
        // Strategy: last 1-3 args could be a business name, rest is asset name
        let biz = null; let assetName = '';
        for (let split = args.length - 1; split >= 1; split--) {
            const bizCandidate  = args.slice(split).join(' ').trim();
            const assetCandidate = args.slice(0, split).join(' ').toLowerCase().trim();
            const found = await findBiz(bizCandidate, senderId);
            if (found && BIZ_ASSETS[assetCandidate]) {
                biz = found; assetName = assetCandidate; break;
            }
        }

        if (!biz || !assetName) return sock.sendMessage(chatId, {
            text: `❌ Could not match asset + business. Usage:\n.buyasset <Asset Name> <Business Name>\n\nAssets: ${Object.keys(BIZ_ASSETS).filter(k => k !== 'rick and morty animation studio').join(', ')}`,
            ...channelInfo
        }, { quoted: message });

        const asset = BIZ_ASSETS[assetName]!;
        if (biz.assets.includes(assetName)) return sock.sendMessage(chatId, { text: `⚠️ *${biz.name}* already has "${assetName}".`, ...channelInfo }, { quoted: message });

        const w = await getWallet(senderId);
        if (w.balance < asset.cost) return sock.sendMessage(chatId, { text: `❌ You need ${$(asset.cost)} for this asset. You have ${$(w.balance)}.`, ...channelInfo }, { quoted: message });

        const newAssets = [...biz.assets, assetName];
        const newRep    = Math.min(100, biz.reputation + asset.repBonus);
        const newRate   = biz.incomeRate * (1 + asset.incomeBonus);
        await updateBizSim(biz.bizId, { assets: JSON.stringify(newAssets), reputation: newRep, incomeRate: newRate });
        w.balance -= asset.cost;
        await saveWallet(w);
        await logBizTx(biz.bizId, 'Asset', -asset.cost, `Purchased: ${assetName}`);

        return sock.sendMessage(chatId, {
            text: `${asset.emoji} *${assetName}* added to *${biz.name}*!\n+${(asset.incomeBonus*100).toFixed(0)}% income | +${asset.repBonus} rep\nNew rate: ${$(Math.round(newRate))}/hr`,
            ...channelInfo
        }, { quoted: message });
    }
},

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// .employeehistory — view transaction history filtered for an employee
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
    command: 'employeehistory',
    aliases: ['emphistory', 'workhistory'],
    category: 'business',
    description: 'View transaction history related to an employee',
    usage: '.employeehistory @user <Business Name>',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let target  = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (target?.includes('@lid')) target = await resolveJid(sock, target);
        const bizName = args.filter((a: string) => !a.startsWith('@')).join(' ').trim();

        if (!target || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .employeehistory @user <Business Name>`, ...channelInfo }, { quoted: message });

        const biz = await findBiz(bizName, senderId) ?? await findBizByName(bizName);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });

        const emp = await getBizEmployee(biz.bizId, target);
        if (!emp) return sock.sendMessage(chatId, { text: `❌ @${cleanJid(target)} is not employed at *${biz.name}*.`, mentions: [target], ...channelInfo }, { quoted: message });

        const allTx = await getBizTxHistory(biz.bizId, 50);
        const empTx = allTx.filter(t =>
            (t.type === 'Wages' || t.type === 'Pay') &&
            t.description.toLowerCase().includes(cleanJid(target).toLowerCase())
        ).slice(0, 10);

        if (!empTx.length) return sock.sendMessage(chatId, { text: `📋 No wage history found for @${cleanJid(target)} at *${biz.name}*.`, mentions: [target], ...channelInfo }, { quoted: message });

        const lines = empTx.map(t => `╽  ${fmtDate(t.createdAt)} [${t.type}] ${$(Math.abs(t.amount))}`).join('\n');
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  📜 *EMPLOYEE HISTORY*
╽  ❏ *Name:*    ${emp.userName}
╽  ❏ *Role:*    ${emp.role}
╽  ❏ *Business:*${biz.name}
╽  ─────────────────────────────
${lines}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            mentions: [target], ...channelInfo
        }, { quoted: message });
    }
},

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// .setsalary — smart: "asset type + amount" or "business name + amount"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
    command: 'setsalary',
    aliases: ['setdefaultsalary', 'defaultsalary'],
    category: 'business',
    description: 'Set the default salary for new hires at a business',
    usage: '.setsalary <Business Name> <Amount>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const amount  = Number(args[args.length - 1]);
        const bizName = args.slice(0, -1).join(' ').trim();
        if (!bizName || isNaN(amount) || amount <= 0) return sock.sendMessage(chatId, { text: `❌ Usage: .setsalary <Business Name> <Amount>`, ...channelInfo }, { quoted: message });
        const biz = await findBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        await updateBizSim(biz.bizId, { defaultSalary: amount });
        return sock.sendMessage(chatId, { text: `💰 Default salary for *${biz.name}* set to ${$(amount)}/hr.`, ...channelInfo }, { quoted: message });
    }
},

];
