import type { BotContext } from '../types.js';
import { resolveJid } from '../lib/lidUtils.js';
import {
    getDb,
    getWallet, saveWallet,
    getBizFull, findBizByName, searchBizByName, updateBizSim,
    getOwnerBizCount, getOwnerBizList,
    getBizStaffCount, getBizEmployeesFull, getBizEmployee, updateEmployeeField,
    hireWorker as dbHireWorker, fireWorker as dbFireWorker,
    getBizApplications, applyToBiz, removeApplication, inviteToBiz,
    getDeployedBotsForBiz,
    buyPlot, getPlot, getOwnerPlots, grantPermit, attachBizToPlot,
    registerBiz, logBizTx, getBizTxHistory, getPublicBizList, getBizLeaderboard,
    getBotSetting, setBotSetting,
    getWorkerEmployers,
    addToEcoVault,
} from '../lib/turso.js';

// ─── ODD JOBS (for users without a business) ──────────────────────────────────
const ODD_JOBS = [
    { task: 'You subbed as a teacher for a chaotic kindergarten class and somehow survived',        emoji: '👩‍🏫', min: 120, max: 280 },
    { task: 'You delivered pizza at 2am and got a generous tip from a guy in a bathrobe',           emoji: '🍕',  min: 100, max: 220 },
    { task: 'You babysat triplets for 3 hours. You now understand war.',                            emoji: '👶',  min: 150, max: 300 },
    { task: 'You walked 5 dogs at once and only got tangled in the leash twice',                    emoji: '🐕',  min: 80,  max: 180 },
    { task: 'You helped an old lady move furniture and threw your back out (worth it)',              emoji: '🛋️', min: 140, max: 260 },
    { task: 'You sold homemade snacks outside a mall and made decent bank',                         emoji: '🍱',  min: 100, max: 240 },
    { task: "You fixed someone's WiFi. They thought you were a wizard.",                            emoji: '📶',  min: 80,  max: 160 },
    { task: 'You became a human sign spinner on a busy road. Your arms now hate you.',              emoji: '🪧',  min: 60,  max: 130 },
    { task: 'You drove strangers around for 3 hours and got rated 5 stars',                         emoji: '🚗',  min: 140, max: 280 },
    { task: 'You worked a night shift at a convenience store and survived the weird customers',      emoji: '🏪',  min: 110, max: 210 },
    { task: 'You helped a confused tourist navigate the city and pocketed a sweet tip',             emoji: '🗺️', min: 70,  max: 150 },
    { task: 'You sold old clothes online and made more than expected from that ugly shirt',          emoji: '👕',  min: 90,  max: 200 },
    { task: 'You coached a little league team that lost 12–0 but everyone had fun',                 emoji: '⚾',  min: 100, max: 200 },
    { task: 'You sat in a paid focus group and answered weird questions about soap for an hour',     emoji: '📋',  min: 120, max: 250 },
    { task: 'You busked on the street and people actually stopped to listen',                       emoji: '🎸',  min: 90,  max: 210 },
    { task: "You did someone's grocery run and they overtipped out of guilt",                       emoji: '🛒',  min: 70,  max: 150 },
    { task: 'You assembled IKEA furniture and had exactly 3 bolts left over. Close enough.',        emoji: '🪑',  min: 100, max: 210 },
    { task: "You washed cars in your neighborhood right after it rained. Bold strategy.",           emoji: '🚿',  min: 80,  max: 170 },
    { task: 'You did 2 hours of data entry. Your soul briefly left your body but it came back.',    emoji: '💻',  min: 100, max: 190 },
    { task: 'You were a background actor in a local film shoot. Free food all day. Worth it.',      emoji: '🎬',  min: 150, max: 310 },
    { task: 'You helped set up chairs for a wedding and they slipped you extra cash',               emoji: '💐',  min: 100, max: 220 },
    { task: 'You translated for a lost tourist at the airport and got generously tipped',           emoji: '✈️', min: 80,  max: 170 },
    { task: 'You modeled for a local art class. Clothed. Obviously.',                               emoji: '🎨',  min: 120, max: 250 },
    { task: 'You helped someone move house and they paid you in food + cash',                       emoji: '📦',  min: 130, max: 260 },
    { task: 'You did a mystery shopper gig and got paid to eat at a restaurant',                    emoji: '🕵️', min: 150, max: 290 },
];

const GRIND_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

function fmtGrindCooldown(ms: number): string {
    const m = Math.ceil(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
import { cleanJid } from '../lib/isOwner.js';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const PLOT_COST   = 5_000;
const PERMIT_COST = 2_000;
const INSURE_COST = 3_000;
const TAX_RATE    = 0.15;
const MAX_BIZ     = 2;
const MAX_PLOTS   = 2;
const MAX_EMPLOYERS = 2;

const BIZ_TYPES: Record<string, { cost: number; incomeRate: number; emoji: string }> = {
    restaurant: { cost: 10_000, incomeRate: 500, emoji: '🍽️' },
    cafe:       { cost: 8_000,  incomeRate: 350, emoji: '☕' },
    shop:       { cost: 8_000,  incomeRate: 400, emoji: '🛒' },
    factory:    { cost: 20_000, incomeRate: 800, emoji: '🏭' },
    tech:       { cost: 25_000, incomeRate: 1_000, emoji: '💻' },
    studio:     { cost: 15_000, incomeRate: 700,   emoji: '🎬' },
    farm:       { cost: 12_000, incomeRate: 350,   emoji: '🌾' },
    hotel:      { cost: 18_000, incomeRate: 600,   emoji: '🏨' },
    general:    { cost: 5_000,  incomeRate: 250,   emoji: '🏢' },
};

const UPGRADE_MULTS  = [1.0, 1.5, 2.0, 3.0, 5.0];
const UPGRADE_COSTS  = [0, 20_000, 50_000, 100_000, 250_000];
const SECURITY_COSTS = [0, 10_000, 25_000, 50_000];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const $ = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

async function lookupOwnerBiz(nameOrId: string, ownerId: string) {
    const term = nameOrId.trim();
    let biz = await findBizByName(term, ownerId);
    if (!biz) biz = await searchBizByName(term, ownerId);
    return biz;
}

async function calcIncome(biz: any) {
    // Owners must have at least one asset to generate income
    if (!biz.assets || biz.assets.length === 0) {
        return { gross: 0, tax: 0, net: 0, hours: 0, bots: 0, noAssets: true };
    }
    const bots = await getDeployedBotsForBiz(biz.bizId);
    const now = Date.now();
    const refTime = biz.lastCollected > 0 ? biz.lastCollected : biz.registeredAt;
    const hours = Math.min((now - refTime) / 3_600_000, 24);
    const botBonus = bots.reduce((s: number, b: any) => s + b.incomeBonus, 0);
    const upgMult  = UPGRADE_MULTS[biz.upgradeLevel - 1] ?? 1;
    const repMult  = 0.5 + biz.reputation / 100;
    const grindMult = biz.isGrinding ? 1.5 : 1.0;
    const gross = biz.incomeRate * hours * (1 + botBonus) * upgMult * repMult * grindMult;
    const tax   = gross * TAX_RATE;
    return { gross, tax, net: gross - tax, hours, bots: bots.length, noAssets: false };
}

// ─── SHIFT / OVERTIME HELPERS ─────────────────────────────────────────────────
const SHIFT_TAX_RATE  = 0.15;
const SHIFT_BIZ_RATE  = 0.20;
const SHIFT_MIN_NET   = 1_500;
const SHIFT_CD_MS     = 30 * 60 * 1000;
const OVERTIME_CD_MS  = 60 * 60 * 1000;

async function resolveEmployer(sock: any, message: any, args: any[], senderId: string, chatId: string, channelInfo: any, label: string) {
    const employers = await getWorkerEmployers(senderId);
    if (!employers.length) {
        await sock.sendMessage(chatId, {
            text:
`⚠️ *You are not employed at any business.*

To get a job:
• _.apply <Business Name>_ — apply to a public business
• Ask a business owner to _.hire_ you

You can work at up to *${MAX_EMPLOYERS} businesses*.`,
            ...channelInfo
        }, { quoted: message });
        return null;
    }
    const bizName = args.join(' ').trim().toLowerCase();
    let employer = bizName ? (employers.find((e: any) => e.bizName.toLowerCase().includes(bizName)) ?? null) : null;
    if (!employer) {
        if (employers.length === 1) {
            employer = employers[0];
        } else {
            const lines = employers.map((e: any, i: number) => `╽  ${i + 1}. *${e.bizName}* [${e.bizId}]`).join('\n');
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  💼 *YOUR JOBS*
╽  ─────────────────────────────
${lines}
╽
╽  Use _${label} <Business Name>_
╽  to work there.
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
            return null;
        }
    }
    return employer;
}

async function doWorkShift(
    sock: any, message: any, args: any[], context: BotContext,
    cdMs: number, cdKey: (bizId: string) => string,
    hoursMin: number, hoursMax: number,
    rateMultiplier: number, label: string, isOvertime: boolean
) {
    const { chatId, channelInfo, senderId } = context;
    const employer = await resolveEmployer(sock, message, args, senderId, chatId, channelInfo, `.${label}`);
    if (!employer) return;

    const biz = await getBizFull(employer.bizId);
    if (!biz || biz.status === 'Closed') {
        return sock.sendMessage(chatId, { text: `⚠️ *${employer.bizName}* is currently closed.`, ...channelInfo }, { quoted: message });
    }
    const emp = await getBizEmployee(biz.bizId, senderId);
    if (!emp) {
        return sock.sendMessage(chatId, { text: `❌ You are no longer employed at *${biz.name}*.`, ...channelInfo }, { quoted: message });
    }

    const key = cdKey(biz.bizId);
    const lastRaw = await getBotSetting(key);
    const lastTime = lastRaw ? parseInt(lastRaw, 10) : 0;
    const now = Date.now();
    const elapsed = now - lastTime;

    if (elapsed < cdMs) {
        const rem = cdMs - elapsed;
        const remH = Math.floor(rem / 3_600_000);
        const remM = Math.floor((rem % 3_600_000) / 60_000);
        const remStr = remH > 0 ? `${remH}h ${remM}m` : `${remM}m`;
        return sock.sendMessage(chatId, {
            text: `😮‍💨 *${isOvertime ? 'Still recovering from overtime!' : 'Still on break!'}*\n\nYou can ${isOvertime ? 'do overtime' : 'work a shift'} at *${biz.name}* in *${remStr}*.`,
            ...channelInfo
        }, { quoted: message });
    }

    const hoursWorked = Math.floor(Math.random() * (hoursMax - hoursMin + 1)) + hoursMin;
    const gross = Math.round(emp.salary * hoursWorked * rateMultiplier);
    const taxCut  = Math.round(gross * SHIFT_TAX_RATE);
    const bizCut  = Math.round(gross * SHIFT_BIZ_RATE);
    const netPay  = Math.max(gross - taxCut - bizCut, SHIFT_MIN_NET);

    const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
    w.balance += netPay;
    await saveWallet(w);
    await setBotSetting(key, String(now));
    await addToEcoVault(taxCut);
    await updateBizSim(biz.bizId, { balance: biz.balance + bizCut });
    await logBizTx(biz.bizId, isOvertime ? 'Overtime' : 'Shift', bizCut, `${isOvertime ? 'Overtime' : 'Shift'} by ${message.pushName || cleanJid(senderId)} (${hoursWorked}h)`);

    const cdLabel = isOvertime ? '1h' : '30m';
    return sock.sendMessage(chatId, {
        text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  💼 *${isOvertime ? 'OVERTIME' : 'SHIFT'} COMPLETE!*
╽  ─────────────────────────────
╽  ❏ *Business:*  ${biz.name}
╽  ❏ *Role:*      ${emp.role}
╽  ❏ *Hours:*     ${hoursWorked}h${rateMultiplier > 1 ? ` (×${rateMultiplier} overtime rate)` : ''}
╽  ❏ *Gross:*     ${$(gross)}
╽  ─────────────────────────────
╽  💸 *Tax (15%):*     −${$(taxCut)} → Eco Vault
╽  🏢 *Biz Cut (20%):* −${$(bizCut)} → ${biz.name} Fund
╽  💰 *Your Pay:*      +${$(netPay)}
╽  💵 *Balance:*       ${$(w.balance)}
╽
╽  ⏳ Next ${isOvertime ? 'overtime' : 'shift'} in *${cdLabel}*
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
        ...channelInfo
    }, { quoted: message });
}

// ─── COMMANDS ─────────────────────────────────────────────────────────────────

export default [

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 1 — LAND & SETUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
    command: 'buyland',
    aliases: ['buyplot', 'purchaseland'],
    category: 'business',
    description: `Buy a plot of land (${$(PLOT_COST)})`,
    usage: '.buyland',
    async handler(sock: any, message: any, _args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const w = await getWallet(senderId, message.pushName || '');
        if (w.balance < PLOT_COST) return sock.sendMessage(chatId, { text: `❌ You need ${$(PLOT_COST)} to buy a plot. You have ${$(w.balance)}.`, ...channelInfo }, { quoted: message });
        const existingPlots = await getOwnerPlots(senderId);
        if (existingPlots.length >= MAX_PLOTS) return sock.sendMessage(chatId, { text: `⛔ You already own the maximum of *${MAX_PLOTS} land plots*.`, ...channelInfo }, { quoted: message });
        const plotId = await buyPlot(senderId, message.pushName || cleanJid(senderId));
        w.balance -= PLOT_COST;
        await saveWallet(w);
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🏗️ *LAND PURCHASED!*
╽  ─────────────────────────────
╽  ❏ *Plot ID:* ${plotId}
╽  ❏ *Cost:*    ${$(PLOT_COST)}
╽  ❏ *Balance:* ${$(w.balance)}
╽
╽  Next: _.getpermit ${plotId}_
╽
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'getpermit',
    aliases: ['buypermit', 'permit'],
    category: 'business',
    description: `Get a building permit for a plot (${$(PERMIT_COST)})`,
    usage: '.getpermit <PLT####>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const plotId = args[0]?.toUpperCase();
        if (!plotId) return sock.sendMessage(chatId, { text: `❌ Usage: .getpermit <PLT####>`, ...channelInfo }, { quoted: message });
        const plot = await getPlot(plotId);
        if (!plot || plot.ownerId !== senderId) return sock.sendMessage(chatId, { text: `❌ Plot not found or you don't own it.`, ...channelInfo }, { quoted: message });
        if (plot.hasPermit) return sock.sendMessage(chatId, { text: `⚠️ Plot *${plotId}* already has a permit.`, ...channelInfo }, { quoted: message });
        const w = await getWallet(senderId);
        if (w.balance < PERMIT_COST) return sock.sendMessage(chatId, { text: `❌ You need ${$(PERMIT_COST)} for a permit.`, ...channelInfo }, { quoted: message });
        await grantPermit(plotId);
        w.balance -= PERMIT_COST;
        await saveWallet(w);
        const year = new Date().getFullYear();
        const taxFile = `TF-${plotId}-${year}`;
        const typeList = Object.keys(BIZ_TYPES).map(t => `╽  • _${t}_`).join('\n');
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ✅ *PERMIT APPROVED*
╽  ─────────────────────────────
╽  ❏ *Plot ID:*   ${plotId}
╽  ❏ *Status:*    CLEARED FOR CONSTRUCTION
╽  ❏ *Authority:* COLLY MD REGISTRY
╽  ❏ *Tax File:*  ${taxFile}
╽  ❏ *Balance:*   ${$(w.balance)}
╽
╽  🔨 *NEXT ACTION*
╽  ─────────────────────────────
╽  _.build <type> ${plotId} <Business Name>_
╽
╽  📋 *VALID TYPES:*
${typeList}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'build',
    aliases: ['buildbusiness', 'constructbiz'],
    category: 'business',
    description: 'Build a business on a permitted plot',
    usage: '.build <type> <PLT####> <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const type   = args[0]?.toLowerCase();
        const plotId = args[1]?.toUpperCase();
        const bizName = args.slice(2).join(' ').trim();
        if (!type || !plotId || !bizName) return sock.sendMessage(chatId, {
            text: `❌ Usage: .build <type> <PLT####> <Business Name>\n\nTypes: ${Object.keys(BIZ_TYPES).map(t => `_${t}_`).join(', ')}`,
            ...channelInfo
        }, { quoted: message });

        const tInfo = BIZ_TYPES[type];
        if (!tInfo) return sock.sendMessage(chatId, { text: `❌ Unknown type *${type}*.\nChoose from: ${Object.keys(BIZ_TYPES).join(', ')}`, ...channelInfo }, { quoted: message });

        const plot = await getPlot(plotId);
        if (!plot || plot.ownerId !== senderId) return sock.sendMessage(chatId, { text: `❌ Plot not found or you don't own it.`, ...channelInfo }, { quoted: message });
        if (!plot.hasPermit) return sock.sendMessage(chatId, { text: `❌ You need a permit first: _.getpermit ${plotId}_`, ...channelInfo }, { quoted: message });
        if (plot.bizId) return sock.sendMessage(chatId, { text: `❌ This plot already has a business on it.`, ...channelInfo }, { quoted: message });

        const count = await getOwnerBizCount(senderId);
        if (count >= MAX_BIZ) return sock.sendMessage(chatId, { text: `⛔ You already own the max of *${MAX_BIZ} businesses*.`, ...channelInfo }, { quoted: message });

        const w = await getWallet(senderId);
        if (w.balance < tInfo.cost) return sock.sendMessage(chatId, { text: `❌ You need ${$(tInfo.cost)} to build a *${type}*. You have ${$(w.balance)}.`, ...channelInfo }, { quoted: message });

        const ownerName = message.pushName || cleanJid(senderId);
        const bizId = await registerBiz(senderId, ownerName, bizName);
        await updateBizSim(bizId, {
            type,
            plotId,
            balance: 0,
            incomeRate: tInfo.incomeRate,
            isPublic: 1,
            reputation: 50,
            defaultSalary: 100,
        });
        await attachBizToPlot(plotId, bizId);
        w.balance -= tInfo.cost;
        await saveWallet(w);
        await logBizTx(bizId, 'Build', -tInfo.cost, `Built ${type} on ${plotId}`);

        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ${tInfo.emoji} *BUSINESS BUILT!*
╽  ─────────────────────────────
╽  ❏ *ID:*      ${bizId}
╽  ❏ *Name:*    ${bizName}
╽  ❏ *Type:*    ${type[0].toUpperCase() + type.slice(1)}
╽  ❏ *Plot:*    ${plotId}
╽  ❏ *Income:*  ${$(tInfo.incomeRate)}/hr
╽  ❏ *Cost:*    ${$(tInfo.cost)}
╽  ❏ *Balance:* ${$(w.balance)}
╽
╽  Tip: _.collect_ to collect income
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'plotinfo',
    aliases: ['myplot', 'landinfo'],
    category: 'business',
    description: 'View a plot\'s details',
    usage: '.plotinfo <PLT####> | .plotinfo (lists your plots)',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        if (!args[0]) {
            const plots = await getOwnerPlots(senderId);
            if (!plots.length) return sock.sendMessage(chatId, { text: `🏗️ You own no plots.\n_Use .buyland to purchase one._`, ...channelInfo }, { quoted: message });
            const lines = await Promise.all(plots.map(async (p, i) => {
                const biz = p.bizId ? await getBizFull(p.bizId) : null;
                return `╽  ${i+1}. *${p.plotId}* | Permit: ${p.hasPermit ? '✅' : '❌'} | Business: ${biz ? biz.name : 'Empty'}`;
            }));
            return sock.sendMessage(chatId, { text: `🏗️ *Your Plots*\n${lines.join('\n')}`, ...channelInfo }, { quoted: message });
        }
        const plotId = args[0].toUpperCase();
        const plot = await getPlot(plotId);
        if (!plot) return sock.sendMessage(chatId, { text: `❌ Plot *${plotId}* not found.`, ...channelInfo }, { quoted: message });
        const biz = plot.bizId ? await getBizFull(plot.bizId) : null;
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🏗️ *PLOT INFO*
╽  ❏ *Plot ID:*  ${plot.plotId}
╽  ❏ *Owner:*    ${plot.ownerName}
╽  ❏ *Permit:*   ${plot.hasPermit ? '✅ Granted' : '❌ None'}
╽  ❏ *Business:* ${biz ? `${biz.name} [${biz.bizId}]` : 'Empty'}
╽  ❏ *Bought:*   ${fmtDate(plot.boughtAt)}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'bizasset',
    aliases: ['buybizasset', 'addasset'],
    category: 'business',
    description: 'Buy an asset for your business (boosts income & reputation)',
    usage: '.bizasset <Business Name> <Asset Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        // Find which arg is the biz and which is the asset (biz is first BE#### or known biz name)
        const bizArg  = args[0]; const assetName = args.slice(1).join(' ').trim().toLowerCase();
        if (!bizArg || !assetName) return sock.sendMessage(chatId, { text: `❌ Usage: .bizasset <Business> <Asset Name>`, ...channelInfo }, { quoted: message });

        const BIZ_ASSETS: Record<string, { cost: number; incomeBonus: number; repBonus: number; emoji: string }> = {
            'animation studio':    { cost: 50_000, incomeBonus: 0.10, repBonus: 5,  emoji: '🎨' },
            'security system':     { cost: 8_000,  incomeBonus: 0.02, repBonus: 3,  emoji: '🔒' },
            'solar panels':        { cost: 12_000, incomeBonus: 0.05, repBonus: 3,  emoji: '☀️' },
            'automated checkout':  { cost: 15_000, incomeBonus: 0.08, repBonus: 2,  emoji: '🤖' },
            'website':             { cost: 3_000,  incomeBonus: 0.03, repBonus: 4,  emoji: '🌐' },
            'delivery fleet':      { cost: 20_000, incomeBonus: 0.12, repBonus: 2,  emoji: '🚐' },
            'vip lounge':          { cost: 25_000, incomeBonus: 0.09, repBonus: 6,  emoji: '🛋️' },
            'pos system':          { cost: 5_000,  incomeBonus: 0.04, repBonus: 1,  emoji: '💻' },
        };

        const asset = BIZ_ASSETS[assetName];
        if (!asset) return sock.sendMessage(chatId, {
            text: `❌ Unknown asset. Available:\n${Object.entries(BIZ_ASSETS).map(([n, a]) => `• *${n}* — ${$(a.cost)} | +${(a.incomeBonus*100).toFixed(0)}% income, +${a.repBonus} rep`).join('\n')}`,
            ...channelInfo
        }, { quoted: message });

        const biz = await lookupOwnerBiz(bizArg, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found or you don't own it.`, ...channelInfo }, { quoted: message });

        if (biz.assets.includes(assetName)) return sock.sendMessage(chatId, { text: `⚠️ *${biz.name}* already has "${assetName}".`, ...channelInfo }, { quoted: message });

        const w = await getWallet(senderId);
        if (w.balance < asset.cost) return sock.sendMessage(chatId, { text: `❌ You need ${$(asset.cost)} for this asset.`, ...channelInfo }, { quoted: message });

        const newAssets = [...biz.assets, assetName];
        const newRep = Math.min(100, biz.reputation + asset.repBonus);
        const newRate = biz.incomeRate * (1 + asset.incomeBonus);
        await updateBizSim(biz.bizId, { assets: JSON.stringify(newAssets), reputation: newRep, incomeRate: newRate });
        w.balance -= asset.cost;
        await saveWallet(w);
        await logBizTx(biz.bizId, 'Asset', -asset.cost, `Purchased ${assetName}`);
        return sock.sendMessage(chatId, {
            text: `${asset.emoji} Asset *${assetName}* added to *${biz.name}*!\n+${(asset.incomeBonus*100).toFixed(0)}% income | +${asset.repBonus} reputation`,
            ...channelInfo
        }, { quoted: message });
    }
},

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 2 — MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
    command: 'business',
    aliases: ['bizinfo', 'viewbusiness'],
    category: 'business',
    description: 'View business info card (.business info <name>)',
    usage: '.business info <Business Name or BE####>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const nameOrId = (args[0]?.toLowerCase() === 'info' ? args.slice(1) : args).join(' ').trim();
        if (!nameOrId) return sock.sendMessage(chatId, { text: `❌ Usage: .business info <Name or BE####>`, ...channelInfo }, { quoted: message });

        const biz = await findBizByName(nameOrId) ?? await searchBizByName(nameOrId, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });

        const staff = await getBizStaffCount(biz.bizId);
        const inc = await calcIncome(biz);
        const nextUpgCost = biz.upgradeLevel < 5 ? UPGRADE_COSTS[biz.upgradeLevel] : null;

        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ${BIZ_TYPES[biz.type]?.emoji ?? '🏢'} *BUSINESS INFO*
╽  ─────────────────────────────
╽  ❏ *ID:*         ${biz.bizId}
╽  ❏ *Name:*       ${biz.name}
╽  ❏ *Type:*       ${biz.type[0].toUpperCase() + biz.type.slice(1)}
╽  ❏ *Owner:*      ${biz.ownerName}
╽  ❏ *Plot:*       ${biz.plotId || 'N/A'}
╽  ❏ *Status:*     ${biz.status} | ${biz.isPublic ? '🌐 Public' : '🔒 Private'}
╽
╽  📊 *FINANCES*
╽  ❏ *Fund:*       ${$(biz.balance)}
╽  ❏ *Income:*     ${$(biz.incomeRate)}/hr
╽  ❏ *Pending:*    ${$(Math.round(inc.net))} (${inc.hours.toFixed(1)}h)
╽  ❏ *Tax Due:*    ${$(biz.taxDue)}
╽
╽  📈 *STATUS*
╽  ❏ *Reputation:* ${'⭐'.repeat(Math.ceil(biz.reputation / 20))} ${biz.reputation}/100
╽  ❏ *Upgrade:*    Lv ${biz.upgradeLevel}/5 ${nextUpgCost ? `(next: ${$(nextUpgCost)})` : '(MAX)'}
╽  ❏ *Security:*   Lv ${biz.securityLevel}/3
╽  ❏ *Insured:*    ${biz.isInsured ? '✅' : '❌'}
╽  ❏ *Staff:*      ${staff} | Bots: ${inc.bots}
╽  ❏ *Assets:*     ${biz.assets.length > 0 ? biz.assets.join(', ') : 'None'}
╽  ❏ *Grinding:*   ${biz.isGrinding ? '🔥 Active' : 'Off'}
╽  ❏ *Est:*        ${fmtDate(biz.registeredAt)}
╽
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'businesslist',
    aliases: ['bizlist', 'companies'],
    category: 'business',
    description: 'View all public businesses',
    usage: '.businesslist',
    async handler(sock: any, message: any, _args: any[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const list = await getPublicBizList();
        if (!list.length) return sock.sendMessage(chatId, { text: `📋 No public businesses registered yet.`, ...channelInfo }, { quoted: message });
        const lines = list.map((b, i) => `╽  ${i+1}. *${b.name}* [${b.bizId}] — ${BIZ_TYPES[b.type]?.emoji ?? '🏢'} ${b.type} | ${$(b.incomeRate)}/hr | ${b.status}`).join('\n');
        return sock.sendMessage(chatId, { text: `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽  🌐 *PUBLIC BUSINESSES*\n╽  ─────────────────────────────\n${lines}\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'setpublic',
    aliases: ['publishbiz'],
    category: 'business',
    description: 'Make your business visible to all',
    usage: '.setpublic <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        await updateBizSim(biz.bizId, { isPublic: 1 });
        return sock.sendMessage(chatId, { text: `🌐 *${biz.name}* is now *public*.`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'setprivate',
    aliases: ['hidebiz'],
    category: 'business',
    description: 'Hide your business from the public list',
    usage: '.setprivate <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        await updateBizSim(biz.bizId, { isPublic: 0 });
        return sock.sendMessage(chatId, { text: `🔒 *${biz.name}* is now *private*.`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'setbusinessname',
    aliases: ['renamebiz', 'bizrename'],
    category: 'business',
    description: 'Change your business name',
    usage: '.setbusinessname <BE####> <New Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const bizId  = args[0]?.toUpperCase();
        const newName = args.slice(1).join(' ').trim();
        if (!bizId || !newName) return sock.sendMessage(chatId, { text: `❌ Usage: .setbusinessname <BE####> <New Name>`, ...channelInfo }, { quoted: message });
        const biz = await getBizFull(bizId);
        if (!biz || biz.ownerId !== senderId) return sock.sendMessage(chatId, { text: `❌ Business not found or not yours.`, ...channelInfo }, { quoted: message });
        await updateBizSim(bizId, { name: newName });
        return sock.sendMessage(chatId, { text: `✅ Business renamed to *${newName}*.`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'transferownership',
    aliases: ['biztransfer'],
    category: 'business',
    description: 'Transfer business ownership to another user',
    usage: '.transferownership <Business Name> @user',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (target?.includes('@lid')) target = await resolveJid(sock, target);
        const bizName = args.filter((a: string) => !a.startsWith('@')).join(' ').trim();
        if (!target || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .transferownership <Business Name> @user`, ...channelInfo }, { quoted: message });
        const biz = await lookupOwnerBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found or not yours.`, ...channelInfo }, { quoted: message });
        const newOwnerCount = await getOwnerBizCount(target);
        if (newOwnerCount >= MAX_BIZ) return sock.sendMessage(chatId, { text: `❌ @${cleanJid(target)} already owns the max of ${MAX_BIZ} businesses.`, mentions: [target], ...channelInfo }, { quoted: message });
        const c = getDb();
        await c.execute({ sql: `UPDATE biz_cards SET owner_id = ?, owner_name = ? WHERE biz_id = ?`, args: [target, cleanJid(target), biz.bizId] });
        return sock.sendMessage(chatId, {
            text: `✅ *${biz.name}* transferred to @${cleanJid(target)}.`,
            mentions: [target], ...channelInfo
        }, { quoted: message });
    }
},

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 3 — EMPLOYEE MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
    command: 'invite',
    aliases: ['invitetowork', 'bizinvite'],
    category: 'business',
    description: 'Invite someone to apply to your business',
    usage: '.invite @user <Business Name>',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (target?.includes('@lid')) target = await resolveJid(sock, target);
        const bizName = args.filter((a: string) => !a.startsWith('@')).join(' ').trim();
        if (!target || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .invite @user <Business Name>`, ...channelInfo }, { quoted: message });
        const biz = await lookupOwnerBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found or not yours.`, ...channelInfo }, { quoted: message });
        await inviteToBiz(biz.bizId, target, senderId);
        await applyToBiz(biz.bizId, target, cleanJid(target), true);
        return sock.sendMessage(chatId, {
            text: `📨 @${cleanJid(target)} has been invited to apply to *${biz.name}*!\nThey can _.hire_ accept or the owner can _.hire @them ${biz.name}_`,
            mentions: [target], ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'apply',
    aliases: ['applywork', 'applyjob'],
    category: 'business',
    description: 'Apply for a job at a business',
    usage: '.apply <Business Name or BE####>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const nameOrId = args.join(' ').trim();
        if (!nameOrId) return sock.sendMessage(chatId, { text: `❌ Usage: .apply <Business Name or BE####>`, ...channelInfo }, { quoted: message });
        const biz = await findBizByName(nameOrId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        if (!biz.isPublic) return sock.sendMessage(chatId, { text: `🔒 *${biz.name}* is not accepting public applications.`, ...channelInfo }, { quoted: message });
        const existing = await getBizEmployee(biz.bizId, senderId);
        if (existing) return sock.sendMessage(chatId, { text: `⚠️ You are already employed at *${biz.name}*.`, ...channelInfo }, { quoted: message });
        const myEmployers = await getWorkerEmployers(senderId);
        if (myEmployers.length >= MAX_EMPLOYERS) return sock.sendMessage(chatId, { text: `⛔ You are already working at *${MAX_EMPLOYERS} businesses* (max). Quit one first.`, ...channelInfo }, { quoted: message });
        await applyToBiz(biz.bizId, senderId, message.pushName || cleanJid(senderId));
        return sock.sendMessage(chatId, {
            text: `✅ Application submitted to *${biz.name}* [${biz.bizId}].\nWait for the owner to accept.`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'applicants',
    aliases: ['viewapplicants', 'jobapplicants'],
    category: 'business',
    description: 'View job applicants for your business',
    usage: '.applicants <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found or not yours.`, ...channelInfo }, { quoted: message });
        const apps = await getBizApplications(biz.bizId);
        if (!apps.length) return sock.sendMessage(chatId, { text: `📋 No applicants for *${biz.name}*.`, ...channelInfo }, { quoted: message });
        const lines = apps.map((a, i) => `╽  ${i+1}. ${a.userName} ${a.invited ? '*(Invited)*' : ''} — ${fmtDate(a.appliedAt)}`).join('\n');
        return sock.sendMessage(chatId, {
            text: `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽  📋 *APPLICANTS — ${biz.name}*\n╽  ─────────────────────────────\n${lines}\n╽\n╽  Use _.hire @user ${biz.name}_\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'hire',
    aliases: ['hireemp', 'acceptapplicant'],
    category: 'business',
    description: 'Hire an employee into your business',
    usage: '.hire @user <Business Name>',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let target  = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (target?.includes('@lid')) target = await resolveJid(sock, target);
        const bizName = args.filter((a: string) => !a.startsWith('@')).join(' ').trim();
        if (!target || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .hire @user <Business Name>`, ...channelInfo }, { quoted: message });
        const biz = await lookupOwnerBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found or not yours.`, ...channelInfo }, { quoted: message });
        const existing = await getBizEmployee(biz.bizId, target);
        if (existing) return sock.sendMessage(chatId, { text: `⚠️ @${cleanJid(target)} is already in *${biz.name}*.`, mentions: [target], ...channelInfo }, { quoted: message });
        const targetEmployers = await getWorkerEmployers(target);
        if (targetEmployers.length >= MAX_EMPLOYERS) return sock.sendMessage(chatId, { text: `⛔ @${cleanJid(target)} already works at *${MAX_EMPLOYERS} businesses* (max). They must quit one first.`, mentions: [target], ...channelInfo }, { quoted: message });
        const userName = message.message?.extendedTextMessage?.contextInfo?.participant ? cleanJid(target) : cleanJid(target);
        await dbHireWorker(biz.bizId, target, userName);
        await updateEmployeeField(biz.bizId, target, { salary: biz.defaultSalary, role: 'Employee' });
        await removeApplication(biz.bizId, target);
        const total = await getBizStaffCount(biz.bizId);
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ✅ *EMPLOYEE HIRED*
╽  ❏ *Name:*    @${cleanJid(target)}
╽  ❏ *Business:*${biz.name} [${biz.bizId}]
╽  ❏ *Role:*    Employee
╽  ❏ *Salary:*  ${$(biz.defaultSalary)}/hr
╽  ❏ *Total Staff:* ${total}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            mentions: [target], ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'fire',
    aliases: ['dismissemp', 'terminate'],
    category: 'business',
    description: 'Fire an employee from your business',
    usage: '.fire @user <Business Name>',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let target  = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (target?.includes('@lid')) target = await resolveJid(sock, target);
        const bizName = args.filter((a: string) => !a.startsWith('@')).join(' ').trim();
        if (!target || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .fire @user <Business Name>`, ...channelInfo }, { quoted: message });
        const biz = await lookupOwnerBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found or not yours.`, ...channelInfo }, { quoted: message });
        await dbFireWorker(biz.bizId, target);
        return sock.sendMessage(chatId, {
            text: `🔴 @${cleanJid(target)} has been terminated from *${biz.name}*.`,
            mentions: [target], ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'bpromote',
    aliases: ['promotestaff', 'bizpromote'],
    category: 'business',
    description: 'Promote an employee (+25% salary, new role)',
    usage: '.bpromote @user <Business Name>',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let target  = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (target?.includes('@lid')) target = await resolveJid(sock, target);
        const bizName = args.filter((a: string) => !a.startsWith('@')).join(' ').trim();
        if (!target || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .bpromote @user <Business Name>`, ...channelInfo }, { quoted: message });
        const biz = await lookupOwnerBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        const emp = await getBizEmployee(biz.bizId, target);
        if (!emp) return sock.sendMessage(chatId, { text: `❌ @${cleanJid(target)} is not employed at *${biz.name}*.`, mentions: [target], ...channelInfo }, { quoted: message });
        const ROLES = ['Employee', 'Senior', 'Supervisor', 'Manager', 'Director'];
        const curIdx = ROLES.indexOf(emp.role);
        const newRole = ROLES[Math.min(curIdx + 1, ROLES.length - 1)];
        const newSalary = Math.round(emp.salary * 1.25);
        await updateEmployeeField(biz.bizId, target, { salary: newSalary, role: newRole });
        return sock.sendMessage(chatId, {
            text: `📈 @${cleanJid(target)} promoted to *${newRole}* at *${biz.name}*!\nNew salary: ${$(newSalary)}/hr`,
            mentions: [target], ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'bdemote',
    aliases: ['demotestaff', 'bizdemote'],
    category: 'business',
    description: 'Demote an employee (-25% salary)',
    usage: '.bdemote @user <Business Name>',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let target  = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (target?.includes('@lid')) target = await resolveJid(sock, target);
        const bizName = args.filter((a: string) => !a.startsWith('@')).join(' ').trim();
        if (!target || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .bdemote @user <Business Name>`, ...channelInfo }, { quoted: message });
        const biz = await lookupOwnerBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        const emp = await getBizEmployee(biz.bizId, target);
        if (!emp) return sock.sendMessage(chatId, { text: `❌ @${cleanJid(target)} is not employed at *${biz.name}*.`, mentions: [target], ...channelInfo }, { quoted: message });
        const ROLES = ['Employee', 'Senior', 'Supervisor', 'Manager', 'Director'];
        const curIdx = ROLES.indexOf(emp.role);
        const newRole = ROLES[Math.max(curIdx - 1, 0)];
        const newSalary = Math.round(emp.salary * 0.75);
        await updateEmployeeField(biz.bizId, target, { salary: Math.max(newSalary, 50), role: newRole });
        return sock.sendMessage(chatId, {
            text: `📉 @${cleanJid(target)} demoted to *${newRole}* at *${biz.name}*.\nNew salary: ${$(Math.max(newSalary, 50))}/hr`,
            mentions: [target], ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'employees',
    aliases: ['stafflist2', 'emplist'],
    category: 'business',
    description: 'View employee list for your business',
    usage: '.employees <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found or not yours.`, ...channelInfo }, { quoted: message });
        const staff = await getBizEmployeesFull(biz.bizId);
        if (!staff.length) return sock.sendMessage(chatId, { text: `👥 *${biz.name}* has no employees yet.`, ...channelInfo }, { quoted: message });
        const lines = staff.map((e, i) => `╽  ${i+1}. ${e.userName} — *${e.role}* | ${$(e.salary)}/hr`).join('\n');
        return sock.sendMessage(chatId, { text: `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽  👥 *STAFF — ${biz.name}*\n${lines}\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'employeeinfo',
    aliases: ['empinfo'],
    category: 'business',
    description: 'View an employee\'s details',
    usage: '.employeeinfo @user <Business Name>',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let target  = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (target?.includes('@lid')) target = await resolveJid(sock, target);
        const bizName = args.filter((a: string) => !a.startsWith('@')).join(' ').trim();
        if (!target || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .employeeinfo @user <Business Name>`, ...channelInfo }, { quoted: message });
        const biz = await findBizByName(bizName, senderId) ?? await findBizByName(bizName);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        const emp = await getBizEmployee(biz.bizId, target);
        if (!emp) return sock.sendMessage(chatId, { text: `❌ @${cleanJid(target)} is not in *${biz.name}*.`, mentions: [target], ...channelInfo }, { quoted: message });
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  👤 *EMPLOYEE RECORD*
╽  ❏ *Name:*    ${emp.userName}
╽  ❏ *Business:*${biz.name}
╽  ❏ *Role:*    ${emp.role}
╽  ❏ *Salary:*  ${$(emp.salary)}/hr
╽  ❏ *Hired:*   ${fmtDate(emp.hiredAt)}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            mentions: [target], ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'salary',
    aliases: ['salarylist', 'payroll'],
    category: 'business',
    description: 'View salary sheet for your business',
    usage: '.salary <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found or not yours.`, ...channelInfo }, { quoted: message });
        const staff = await getBizEmployeesFull(biz.bizId);
        const totalPerHr = staff.reduce((s, e) => s + e.salary, 0);
        const lines = staff.length ? staff.map(e => `╽  ${e.userName} (${e.role}): ${$(e.salary)}/hr`).join('\n') : '╽  _No employees._';
        return sock.sendMessage(chatId, { text: `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽  💰 *SALARY SHEET — ${biz.name}*\n${lines}\n╽  ─────────────────────────────\n╽  *Total:* ${$(totalPerHr)}/hr\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'pay',
    aliases: ['payemp', 'paystaff'],
    category: 'business',
    description: 'Pay an employee from business funds',
    usage: '.pay @user <Amount> <Business Name>',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let target  = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (target?.includes('@lid')) target = await resolveJid(sock, target);
        const numIdx  = args.findIndex((a: string) => /^\d+(\.\d+)?$/.test(a));
        const amount  = numIdx >= 0 ? Number(args[numIdx]) : 0;
        const bizName = args.filter((a: string, i: number) => !a.startsWith('@') && i !== numIdx).join(' ').trim();
        if (!target || amount <= 0 || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .pay @user <Amount> <Business Name>`, ...channelInfo }, { quoted: message });
        const biz = await lookupOwnerBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        if (biz.balance < amount) return sock.sendMessage(chatId, { text: `❌ Business fund too low (${$(biz.balance)}).`, ...channelInfo }, { quoted: message });
        await updateBizSim(biz.bizId, { balance: biz.balance - amount });
        const tw = await getWallet(target);
        tw.balance += amount;
        await saveWallet(tw);
        await logBizTx(biz.bizId, 'Pay', -amount, `Paid ${cleanJid(target)} ${$(amount)}`);
        return sock.sendMessage(chatId, { text: `✅ Paid @${cleanJid(target)} ${$(amount)} from *${biz.name}*.`, mentions: [target], ...channelInfo }, { quoted: message });
    }
},

{
    command: 'adjustsalary',
    aliases: ['setsalaryemp', 'empsalary'],
    category: 'business',
    description: 'Set a specific salary for an employee',
    usage: '.adjustsalary @user <Amount> <Business Name>',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let target  = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (target?.includes('@lid')) target = await resolveJid(sock, target);
        const numIdx  = args.findIndex((a: string) => /^\d+(\.\d+)?$/.test(a));
        const amount  = numIdx >= 0 ? Number(args[numIdx]) : 0;
        const bizName = args.filter((a: string, i: number) => !a.startsWith('@') && i !== numIdx).join(' ').trim();
        if (!target || amount <= 0 || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .adjustsalary @user <Amount> <Business Name>`, ...channelInfo }, { quoted: message });
        const biz = await lookupOwnerBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        await updateEmployeeField(biz.bizId, target, { salary: amount });
        return sock.sendMessage(chatId, { text: `💰 Salary for @${cleanJid(target)} set to ${$(amount)}/hr at *${biz.name}*.`, mentions: [target], ...channelInfo }, { quoted: message });
    }
},

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OPERATIONS — collect, grind, paytax, fund, bizdeposit, bizwithdraw
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
    command: 'collect',
    aliases: ['collectincome', 'harvest'],
    category: 'business',
    description: 'Collect passive income from all your businesses',
    usage: '.collect',
    async handler(sock: any, message: any, _args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const bizList = await getOwnerBizList(senderId);
        const activeBizList = bizList.filter(b => b.status !== 'Closed');
        if (!activeBizList.length) return sock.sendMessage(chatId, { text: `🏢 You have no active businesses to collect from.`, ...channelInfo }, { quoted: message });

        let totalNet = 0; let totalTax = 0; const lines: string[] = [];
        for (const b of activeBizList) {
            const biz = await getBizFull(b.bizId);
            if (!biz) continue;
            const { gross, tax, net, hours, noAssets } = await calcIncome(biz);
            if (noAssets) { lines.push(`╽  ${biz.name}: ⚠️ _No assets — buy assets first to earn income_`); continue; }
            if (gross < 0.01) { lines.push(`╽  ${biz.name}: _Nothing yet (< 1 min)_`); continue; }
            // Pay employees
            const staff = await getBizEmployeesFull(biz.bizId);
            const totalEmpPay = staff.reduce((s, e) => s + e.salary * hours, 0);
            const netAfterSalaries = Math.max(0, net - totalEmpPay);
            // Update biz
            await updateBizSim(biz.bizId, {
                balance: biz.balance + netAfterSalaries,
                lastCollected: Date.now(),
                taxDue: biz.taxDue + tax,
                isGrinding: 0, grindStarted: 0,
            });
            await logBizTx(biz.bizId, 'Income', netAfterSalaries, `${hours.toFixed(1)}h collection`);
            totalNet += netAfterSalaries; totalTax += tax;
            lines.push(`╽  ${biz.name}: *+${$(Math.round(netAfterSalaries))}* (${hours.toFixed(1)}h)`);
        }
        const w = await getWallet(senderId);
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  💰 *INCOME COLLECTED*
╽  ─────────────────────────────
${lines.join('\n')}
╽
╽  ❏ *Total Net:*  ${$(Math.round(totalNet))}
╽  ❏ *Tax Accrued:*${$(Math.round(totalTax))}
╽  ❏ *Your Cash:*  ${$(w.balance)}
╽
╽  ⚠️ Income goes to business fund.
╽  Use _.bizwithdraw_ to move to wallet.
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'grind',
    aliases: ['startgrind', 'bizgrind', 'oddjob', 'sidehustle'],
    category: 'business',
    description: 'Grind your business (owners) or pick up a random odd job (no biz)',
    usage: '.grind [Business Name]',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;

        // ── Try biz grind first ───────────────────────────────────────────────
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (biz) {
            if (biz.isGrinding) return sock.sendMessage(chatId, { text: `⚠️ *${biz.name}* is already grinding! Use _.collect_ to stop and collect.`, ...channelInfo }, { quoted: message });
            await updateBizSim(biz.bizId, { isGrinding: 1, grindStarted: Date.now() });
            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🔥 *GRIND STARTED!*
╽  ❏ *Business:* ${biz.name}
╽  ❏ *Boost:*    1.5× income rate
╽  ❏ *Rate:*     ${$(biz.incomeRate * 1.5)}/hr
╽
╽  Use _.collect_ to stop & collect.
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo,
            }, { quoted: message });
        }

        // ── No business → random odd job ──────────────────────────────────────
        const now      = Date.now();
        const cdKey    = `grindcd:${senderId}`;
        const lastRaw  = await getBotSetting(cdKey);
        const lastTime = lastRaw ? parseInt(lastRaw, 10) : 0;
        const elapsed  = now - lastTime;

        if (elapsed < GRIND_COOLDOWN_MS) {
            const rem = GRIND_COOLDOWN_MS - elapsed;
            return sock.sendMessage(chatId, {
                text: `😮‍💨 *Still tired from the last gig!*\n\nYou can hustle again in *${fmtGrindCooldown(rem)}*.\n\n💡 Own a business? Use _.grind <Business Name>_ to start AFK grind instead.`,
                ...channelInfo,
            }, { quoted: message });
        }

        const job  = ODD_JOBS[Math.floor(Math.random() * ODD_JOBS.length)];
        const pay  = Math.floor(Math.random() * (job.max - job.min + 1)) + job.min;
        const w    = await getWallet(senderId, message.pushName || cleanJid(senderId));

        w.balance += pay;
        await saveWallet(w);
        await setBotSetting(cdKey, String(now));

        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ${job.emoji} *ODD JOB COMPLETE!*
╽
╽  ${job.task}
╽
╽  💰 *Earned:* +$${pay.toLocaleString()}
╽  💵 *Balance:* $${w.balance.toLocaleString()}
╽
╽  ⏳ *Next Hustle:* in ${fmtGrindCooldown(GRIND_COOLDOWN_MS)}
╽  💡 Start a business to earn more!
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo,
        }, { quoted: message });
    }
},

{
    command: 'paytax',
    aliases: ['paybiztax', 'settletax'],
    category: 'business',
    description: 'Pay outstanding business taxes from your wallet',
    usage: '.paytax <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        if (biz.taxDue < 0.01) return sock.sendMessage(chatId, { text: `✅ *${biz.name}* has no outstanding tax.`, ...channelInfo }, { quoted: message });
        const w = await getWallet(senderId);
        if (w.balance < biz.taxDue) return sock.sendMessage(chatId, { text: `❌ You need ${$(biz.taxDue)} to pay tax. You have ${$(w.balance)}.`, ...channelInfo }, { quoted: message });
        w.balance -= biz.taxDue;
        await saveWallet(w);
        await logBizTx(biz.bizId, 'Tax', -biz.taxDue, 'Tax payment');
        if (biz.reputation < 100) await updateBizSim(biz.bizId, { taxDue: 0, reputation: Math.min(100, biz.reputation + 2) });
        else await updateBizSim(biz.bizId, { taxDue: 0 });
        return sock.sendMessage(chatId, { text: `✅ Tax of ${$(biz.taxDue)} paid for *${biz.name}*. +2 reputation 📈`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'fund',
    aliases: ['bizfund', 'businessfund'],
    category: 'business',
    description: 'Check business fund balance',
    usage: '.fund <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        const inc = await calcIncome(biz);
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  💳 *BUSINESS FUND — ${biz.name}*
╽  ❏ *Balance:*   ${$(biz.balance)}
╽  ❏ *Pending:*   ${$(Math.round(inc.net))} (${inc.hours.toFixed(1)}h)
╽  ❏ *Tax Due:*   ${$(biz.taxDue)}
╽  ❏ *Net Total:* ${$(biz.balance + Math.round(inc.net))}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'bizwithdraw',
    aliases: ['withdrawbiz', 'withdrawfund'],
    category: 'business',
    description: 'Withdraw from business fund to your wallet',
    usage: '.bizwithdraw <Amount> <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const numIdx  = args.findIndex((a: string) => /^\d+(\.\d+)?$/.test(a));
        const amount  = numIdx >= 0 ? Number(args[numIdx]) : 0;
        const bizName = args.filter((_: any, i: number) => i !== numIdx).join(' ').trim();
        if (amount <= 0 || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .bizwithdraw <Amount> <Business Name>`, ...channelInfo }, { quoted: message });
        const biz = await lookupOwnerBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        if (biz.balance < amount) return sock.sendMessage(chatId, { text: `❌ Business fund too low (${$(biz.balance)}).`, ...channelInfo }, { quoted: message });
        await updateBizSim(biz.bizId, { balance: biz.balance - amount });
        const w = await getWallet(senderId);
        w.balance += amount;
        await saveWallet(w);
        await logBizTx(biz.bizId, 'Withdraw', -amount, 'Owner withdrawal');
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  📤 *BIZ WITHDRAWAL*
╽  ─────────────────────────────
╽  🏢 *From:*    ${biz.name}
╽  💰 *Amount:*  ${$(amount)}
╽  💵 *Wallet:*  ${$(w.balance)}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'bizdeposit',
    aliases: ['depositbiz', 'fundbiz'],
    category: 'business',
    description: 'Deposit money from your wallet to business fund',
    usage: '.bizdeposit <Amount> <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const numIdx  = args.findIndex((a: string) => /^\d+(\.\d+)?$/.test(a));
        const amount  = numIdx >= 0 ? Number(args[numIdx]) : 0;
        const bizName = args.filter((_: any, i: number) => i !== numIdx).join(' ').trim();
        if (amount <= 0 || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .bizdeposit <Amount> <Business Name>`, ...channelInfo }, { quoted: message });
        const biz = await lookupOwnerBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        const w = await getWallet(senderId);
        if (w.balance < amount) return sock.sendMessage(chatId, { text: `❌ Insufficient wallet balance (${$(w.balance)}).`, ...channelInfo }, { quoted: message });
        w.balance -= amount;
        await saveWallet(w);
        await updateBizSim(biz.bizId, { balance: biz.balance + amount });
        await logBizTx(biz.bizId, 'Deposit', amount, 'Owner deposit');
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  📥 *BIZ DEPOSIT*
╽  ─────────────────────────────
╽  🏢 *To:*      ${biz.name}
╽  💰 *Amount:*  ${$(amount)}
╽  💳 *Fund:*    ${$(biz.balance + amount)}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GROWTH — upgrade, security, insure
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
    command: 'upgradebiz',
    aliases: ['bizupgrade', 'levelupbiz'],
    category: 'business',
    description: 'Upgrade business facilities to increase income multiplier',
    usage: '.upgradebiz <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        if (biz.upgradeLevel >= 5) return sock.sendMessage(chatId, { text: `⭐ *${biz.name}* is already at MAX upgrade level (5).`, ...channelInfo }, { quoted: message });
        const cost = UPGRADE_COSTS[biz.upgradeLevel];
        const w = await getWallet(senderId);
        if (w.balance < cost) return sock.sendMessage(chatId, { text: `❌ You need ${$(cost)} to upgrade to level ${biz.upgradeLevel + 1}.`, ...channelInfo }, { quoted: message });
        w.balance -= cost;
        await saveWallet(w);
        const newLevel = biz.upgradeLevel + 1;
        await updateBizSim(biz.bizId, { upgradeLevel: newLevel });
        await logBizTx(biz.bizId, 'Upgrade', -cost, `Upgraded to level ${newLevel}`);
        return sock.sendMessage(chatId, {
            text: `🏗️ *${biz.name}* upgraded to *Level ${newLevel}*!\nIncome multiplier: *${UPGRADE_MULTS[newLevel - 1]}×*`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'buysecurity',
    aliases: ['bizsecurity', 'addsecurity'],
    category: 'business',
    description: 'Buy security for your business (reduces rob risk)',
    usage: '.buysecurity <level 1-3> <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const level   = parseInt(args[0]);
        const bizName = args.slice(1).join(' ').trim();
        if (isNaN(level) || level < 1 || level > 3 || !bizName) return sock.sendMessage(chatId, {
            text: `❌ Usage: .buysecurity <1-3> <Business Name>\n\n• Level 1: ${$(SECURITY_COSTS[1])} — 50% rob reduction\n• Level 2: ${$(SECURITY_COSTS[2])} — 75% rob reduction\n• Level 3: ${$(SECURITY_COSTS[3])} — Immune to rob`,
            ...channelInfo
        }, { quoted: message });
        const biz = await lookupOwnerBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        if (biz.securityLevel >= level) return sock.sendMessage(chatId, { text: `⚠️ *${biz.name}* already has security level ${biz.securityLevel}.`, ...channelInfo }, { quoted: message });
        const cost = SECURITY_COSTS[level];
        const w = await getWallet(senderId);
        if (w.balance < cost) return sock.sendMessage(chatId, { text: `❌ You need ${$(cost)} for this security level.`, ...channelInfo }, { quoted: message });
        w.balance -= cost;
        await saveWallet(w);
        await updateBizSim(biz.bizId, { securityLevel: level });
        return sock.sendMessage(chatId, { text: `🔒 Security upgraded to *Level ${level}* for *${biz.name}*!`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'insure',
    aliases: ['bizinsure', 'getinsurance'],
    category: 'business',
    description: `Insure your business (${$(INSURE_COST)}, protects from random events)`,
    usage: '.insure <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        if (biz.isInsured) return sock.sendMessage(chatId, { text: `✅ *${biz.name}* is already insured.`, ...channelInfo }, { quoted: message });
        const w = await getWallet(senderId);
        if (w.balance < INSURE_COST) return sock.sendMessage(chatId, { text: `❌ You need ${$(INSURE_COST)} to insure your business.`, ...channelInfo }, { quoted: message });
        w.balance -= INSURE_COST;
        await saveWallet(w);
        await updateBizSim(biz.bizId, { isInsured: 1 });
        return sock.sendMessage(chatId, { text: `🛡️ *${biz.name}* is now *insured*!`, ...channelInfo }, { quoted: message });
    }
},

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATS & HISTORY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
    command: 'reputation',
    aliases: ['bizrep', 'bizreputation'],
    category: 'business',
    description: 'View business reputation',
    usage: '.reputation <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await findBizByName(args.join(' ')) ?? await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        const stars = '⭐'.repeat(Math.ceil(biz.reputation / 20));
        const incMult = (0.5 + biz.reputation / 100).toFixed(2);
        return sock.sendMessage(chatId, {
            text: `🌟 *${biz.name}* Reputation\n${stars} ${biz.reputation}/100\n\nIncome multiplier: *${incMult}×*\n_Pay taxes regularly to boost rep._`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'transactions',
    aliases: ['biztx', 'biztransactions'],
    category: 'business',
    description: 'View recent transactions for your business',
    usage: '.transactions <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        const txs = await getBizTxHistory(biz.bizId, 10);
        if (!txs.length) return sock.sendMessage(chatId, { text: `📋 No transactions for *${biz.name}* yet.`, ...channelInfo }, { quoted: message });
        const lines = txs.map(t => `╽  [${t.type}] ${t.amount >= 0 ? '+' : ''}${$(t.amount)} — ${t.description}`).join('\n');
        return sock.sendMessage(chatId, { text: `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽  📊 *TRANSACTIONS — ${biz.name}*\n${lines}\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'bizstats',
    aliases: ['businessstats', 'statsb'],
    category: 'business',
    description: 'View detailed business statistics',
    usage: '.bizstats <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await findBizByName(args.join(' ')) ?? await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        const staff = await getBizStaffCount(biz.bizId);
        const bots  = await getDeployedBotsForBiz(biz.bizId);
        const inc   = await calcIncome(biz);
        const dayEst = biz.incomeRate * 24 * (UPGRADE_MULTS[biz.upgradeLevel - 1] ?? 1) * (0.5 + biz.reputation / 100) * (1 + bots.reduce((s, b) => s + b.incomeBonus, 0));
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  📈 *BUSINESS STATS — ${biz.name}*
╽  ─────────────────────────────
╽  ❏ *Type:*         ${biz.type}
╽  ❏ *Base Rate:*    ${$(biz.incomeRate)}/hr
╽  ❏ *Upgrade Mult:* ${UPGRADE_MULTS[biz.upgradeLevel - 1]}×
╽  ❏ *Rep Mult:*     ${(0.5 + biz.reputation / 100).toFixed(2)}×
╽  ❏ *Bot Bonus:*    +${(bots.reduce((s, b) => s + b.incomeBonus, 0) * 100).toFixed(0)}%
╽  ❏ *Grind Mult:*   ${biz.isGrinding ? '1.5×' : '1.0×'}
╽  ❏ *Est. Daily:*   ${$(Math.round(dayEst * (1 - TAX_RATE)))}
╽  ❏ *Pending Now:*  ${$(Math.round(inc.net))} (${inc.hours.toFixed(1)}h)
╽  ❏ *Staff:*        ${staff} | *Bots:* ${bots.length}
╽  ❏ *Fund:*         ${$(biz.balance)}
╽  ❏ *Assets:*       ${biz.assets.length}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'businesshistory',
    aliases: ['bizhistory'],
    category: 'business',
    description: 'View business transaction history',
    usage: '.businesshistory <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        const txs = await getBizTxHistory(biz.bizId, 15);
        if (!txs.length) return sock.sendMessage(chatId, { text: `📋 No history for *${biz.name}* yet.`, ...channelInfo }, { quoted: message });
        const lines = txs.map(t => `╽  ${new Date(t.createdAt).toLocaleDateString('en-GB')} [${t.type}] ${t.amount >= 0 ? '+' : ''}${$(Math.round(t.amount))}`).join('\n');
        return sock.sendMessage(chatId, { text: `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽  📜 *HISTORY — ${biz.name}*\n${lines}\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'bizleaderboard',
    aliases: ['bitleader', 'topbusiness'],
    category: 'business',
    description: 'View top businesses ranked by fund',
    usage: '.bizleaderboard',
    async handler(sock: any, message: any, _args: any[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const list = await getBizLeaderboard();
        if (!list.length) return sock.sendMessage(chatId, { text: `📊 No businesses ranked yet.`, ...channelInfo }, { quoted: message });
        const medals = ['🥇', '🥈', '🥉'];
        const lines = list.map((b, i) => `╽  ${medals[i] ?? `${i + 1}.`} *${b.name}* — ${$(b.balance)} | Lv${b.upgradeLevel} | Rep ${b.reputation}`).join('\n');
        return sock.sendMessage(chatId, { text: `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽  🏆 *TOP BUSINESSES*\n${lines}\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'bizappeal',
    aliases: ['appealbiz', 'businessappeal'],
    category: 'business',
    description: 'Appeal a business-related fine or penalty',
    usage: '.bizappeal <Case ID or reason>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const reason = args.join(' ').trim() || 'No reason provided';
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  📜 *APPEAL SUBMITTED*
╽  ─────────────────────────────
╽  ❏ *From:*    ${message.pushName || cleanJid(senderId)}
╽  ❏ *Reason:*  ${reason}
╽  ❏ *Status:*  Pending Review ⏳
╽
╽  An Overseer/Governor will review.
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SELL & CLOSE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
    command: 'sellbusiness',
    aliases: ['sellbiz'],
    category: 'business',
    description: 'Sell your business to another player',
    usage: '.sellbusiness <Business Name> <Price> @user',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        let buyer   = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (buyer?.includes('@lid')) buyer = await resolveJid(sock, buyer);
        const numIdx  = args.findIndex((a: string) => /^\d+(\.\d+)?$/.test(a));
        const price   = numIdx >= 0 ? Number(args[numIdx]) : 0;
        const bizName = args.filter((a: string, i: number) => !a.startsWith('@') && i !== numIdx).join(' ').trim();
        if (!buyer || price <= 0 || !bizName) return sock.sendMessage(chatId, { text: `❌ Usage: .sellbusiness <Business Name> <Price> @buyer`, ...channelInfo }, { quoted: message });
        const biz = await lookupOwnerBiz(bizName, senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found or not yours.`, ...channelInfo }, { quoted: message });
        const newOwnerCount = await getOwnerBizCount(buyer);
        if (newOwnerCount >= MAX_BIZ) return sock.sendMessage(chatId, { text: `❌ @${cleanJid(buyer)} already owns max businesses.`, mentions: [buyer], ...channelInfo }, { quoted: message });
        const bw = await getWallet(buyer);
        if (bw.balance < price) return sock.sendMessage(chatId, { text: `❌ @${cleanJid(buyer)} can't afford ${$(price)}.`, mentions: [buyer], ...channelInfo }, { quoted: message });
        bw.balance -= price;
        await saveWallet(bw);
        const sw = await getWallet(senderId);
        sw.balance += price;
        await saveWallet(sw);
        const c = getDb();
        await c.execute({ sql: `UPDATE biz_cards SET owner_id = ?, owner_name = ? WHERE biz_id = ?`, args: [buyer, cleanJid(buyer), biz.bizId] });
        return sock.sendMessage(chatId, {
            text: `💸 *${biz.name}* sold to @${cleanJid(buyer)} for ${$(price)}!\n\nSeller received ${$(price)}. 🎉`,
            mentions: [buyer], ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'closebusiness',
    aliases: ['shutdownbiz', 'closebiz'],
    category: 'business',
    description: 'Permanently close a business',
    usage: '.closebusiness <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const biz = await lookupOwnerBiz(args.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found or not yours.`, ...channelInfo }, { quoted: message });
        if (biz.status === 'Closed') return sock.sendMessage(chatId, { text: `⚠️ *${biz.name}* is already closed.`, ...channelInfo }, { quoted: message });
        await updateBizSim(biz.bizId, { status: 'Closed', isGrinding: 0 });
        return sock.sendMessage(chatId, { text: `🔴 *${biz.name}* has been permanently closed.`, ...channelInfo }, { quoted: message });
    }
},

// ─── .shifts ──────────────────────────────────────────────────────────────────
{
    command: 'shifts',
    aliases: ['doshift', 'workshift'],
    category: 'business',
    description: 'Work a shift at your employer\'s business. Random 1–4h, min $1,500 take-home. 30min cooldown.',
    usage: '.shifts [Business Name]',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        return doWorkShift(
            sock, message, args, context,
            SHIFT_CD_MS,
            (bizId) => `shiftcd:${context.senderId}:${bizId}`,
            1, 4, 1.0, 'shifts', false
        );
    }
},

// ─── .overtime ────────────────────────────────────────────────────────────────
{
    command: 'overtime',
    aliases: ['doovertime', 'workovertime'],
    category: 'business',
    description: 'Work overtime at your employer\'s business. 2× rate, random 1–3h, min $1,500. 1h cooldown.',
    usage: '.overtime [Business Name]',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        return doWorkShift(
            sock, message, args, context,
            OVERTIME_CD_MS,
            (bizId) => `overtimecd:${context.senderId}:${bizId}`,
            1, 3, 2.0, 'overtime', true
        );
    }
},

// ─── .bizhack ─────────────────────────────────────────────────────────────────
{
    command: 'bizhack',
    aliases: ['hackbiz', 'bizsteal'],
    category: 'business',
    description: 'Attempt to hack a business and steal funds. 6h cooldown per target.',
    usage: '.bizhack <Business Name or ID>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const senderName = message.pushName || cleanJid(senderId);
        const HACK_CD_MS = 6 * 60 * 60_000;
        const MIN_BIZ_BALANCE = 5_000;
        const FINE_MIN = 1_500;
        const FINE_MAX = 4_000;

        if (!args.length) {
            return sock.sendMessage(chatId, {
                text: `💻 *BizHack Usage:* .bizhack <Business Name or ID>\n\n_Attempt to steal funds from a rival business. 6h cooldown per target._`,
                ...channelInfo
            }, { quoted: message });
        }

        const term = args.join(' ');
        const biz = await findBizByName(term);
        if (!biz || biz.status === 'Closed') {
            return sock.sendMessage(chatId, {
                text: `❌ Business *"${term}"* not found or is closed.`,
                ...channelInfo
            }, { quoted: message });
        }

        if (biz.ownerId === senderId) {
            return sock.sendMessage(chatId, {
                text: `🤦 You can't hack your own business!`,
                ...channelInfo
            }, { quoted: message });
        }

        if (biz.balance < MIN_BIZ_BALANCE) {
            return sock.sendMessage(chatId, {
                text: `💸 *${biz.name}* only has $${biz.balance.toLocaleString()} in the vault — not worth hacking (min $${MIN_BIZ_BALANCE.toLocaleString()}).`,
                ...channelInfo
            }, { quoted: message });
        }

        // Cooldown check (per hacker per biz)
        const cdKey = `bizhackcd:${senderId}:${biz.bizId}`;
        const lastHack = Number(await getBotSetting(cdKey) || '0');
        const remaining = HACK_CD_MS - (Date.now() - lastHack);
        if (remaining > 0) {
            const h = Math.floor(remaining / 3_600_000);
            const m = Math.floor((remaining % 3_600_000) / 60_000);
            return sock.sendMessage(chatId, {
                text: `⏳ *BizHack on cooldown!*\n\nYou can target *${biz.name}* again in *${h}h ${m}m*.`,
                ...channelInfo
            }, { quoted: message });
        }

        const w = await getWallet(senderId, senderName);

        // Success rate: 70% - 15% per security level, minimum 5%
        const successRate = Math.max(0.05, 0.70 - biz.securityLevel * 0.15);
        const success = Math.random() < successRate;

        await setBotSetting(cdKey, String(Date.now()));

        if (success) {
            const pct = 0.10 + Math.random() * 0.10; // 10–20%
            const stolen = Math.floor(biz.balance * pct);
            await updateBizSim(biz.bizId, { balance: biz.balance - stolen });
            w.balance += stolen;
            await saveWallet(w);
            await logBizTx(biz.bizId, 'hack', -stolen, `💻 Hacked by ${senderName}`);

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  💻 *BIZHACK — SUCCESS*
╽
╽  🎯 *Target:*   ${biz.name}
╽  🔐 *Security:* Level ${biz.securityLevel}
╽  💰 *Stolen:*   +$${stolen.toLocaleString()}
╽  💳 *Balance:*  $${w.balance.toLocaleString()}
╽
╽  ⏳ *Next hack in:* 6h
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        } else {
            const fine = FINE_MIN + Math.floor(Math.random() * (FINE_MAX - FINE_MIN));
            w.balance = Math.max(0, w.balance - fine);
            w.health = Math.max(0, (w.health ?? 100) - 15);
            await saveWallet(w);

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  💻 *BIZHACK — BUSTED!*
╽
╽  🎯 *Target:*   ${biz.name}
╽  🔐 *Security:* Level ${biz.securityLevel}  
╽  🚨 *Security caught you!*
╽  💸 *Fine:*     -$${fine.toLocaleString()}
╽  ❤️ *Health:*   ${w.health}/100 (-15)
╽  💳 *Balance:*  $${w.balance.toLocaleString()}
╽
╽  ⏳ *Next attempt in:* 6h
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    }
},

];
