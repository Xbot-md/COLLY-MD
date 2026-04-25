import type { BotContext } from '../types.js';
import {
    getDb,
    getWallet, saveWallet,
    buyBot, getBot, getOwnerBots, updateBot, deleteBot as dbDeleteBot, getDeployedBotsForBiz,
    getBizFull, findBizByName, searchBizByName, updateBizSim,
} from '../lib/turso.js';
import { cleanJid } from '../lib/isOwner.js';

const BOT_COST          = 15_000;
const BOT_UPGRADE_BASE  = 8_000;
const FOOTER            = '_🔖 Colly novels | 👨‍💻 DavidXTech_';
const $ = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

async function findOwnedBiz(nameOrId: string, ownerId: string) {
    const biz = await findBizByName(nameOrId, ownerId);
    return biz ?? await searchBizByName(nameOrId, ownerId);
}

export default [

{
    command: 'buyteslabot',
    aliases: ['buybot', 'purchasebot'],
    category: 'business',
    description: `Buy a Tesla bot for your business (${$(BOT_COST)})`,
    usage: '.buyteslabot <Bot Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const botName = args.join(' ').trim();
        if (!botName) return sock.sendMessage(chatId, { text: `❌ Usage: .buyteslabot <Bot Name>`, ...channelInfo }, { quoted: message });

        const w = await getWallet(senderId);
        if (w.balance < BOT_COST) return sock.sendMessage(chatId, { text: `❌ You need ${$(BOT_COST)} to buy a Tesla bot. You have ${$(w.balance)}.`, ...channelInfo }, { quoted: message });

        let botId: string;
        try {
            botId = await buyBot(senderId, botName);
        } catch (e: any) {
            return sock.sendMessage(chatId, { text: `❌ ${e.message}`, ...channelInfo }, { quoted: message });
        }

        w.balance -= BOT_COST;
        await saveWallet(w);

        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🤖 *TESLA BOT PURCHASED!*
╽  ─────────────────────────────
╽  ❏ *Bot ID:*  ${botId}
╽  ❏ *Name:*    ${botName}
╽  ❏ *Level:*   1
╽  ❏ *Bonus:*   +15% income when deployed
╽  ❏ *Status:*  Idle
╽  ❏ *Cost:*    ${$(BOT_COST)}
╽
╽  Deploy: _.deploybot ${botName} <Business>_
╽  ${FOOTER}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'deploybot',
    aliases: ['activatebot', 'setbot'],
    category: 'business',
    description: 'Deploy a Tesla bot to work at your business',
    usage: '.deploybot <Bot Name> <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        if (args.length < 2) return sock.sendMessage(chatId, { text: `❌ Usage: .deploybot <Bot Name> <Business Name>`, ...channelInfo }, { quoted: message });

        // Try to match bot name (could be one or two words) against owned bots
        const ownedBots = await getOwnerBots(senderId);
        if (!ownedBots.length) return sock.sendMessage(chatId, { text: `❌ You don't own any Tesla bots.`, ...channelInfo }, { quoted: message });

        let bot = null; let bizArgs: string[] = [];
        for (let i = args.length; i > 0; i--) {
            const candidate = args.slice(0, i).join(' ');
            const found = ownedBots.find(b => b.name.toLowerCase() === candidate.toLowerCase());
            if (found) { bot = found; bizArgs = args.slice(i); break; }
        }
        if (!bot) return sock.sendMessage(chatId, { text: `❌ Bot not found. Use _.botlist_ to see your bots.`, ...channelInfo }, { quoted: message });

        const biz = await findOwnedBiz(bizArgs.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found or not yours.`, ...channelInfo }, { quoted: message });

        // Recall from previous biz
        if (bot.bizId && bot.bizId !== biz.bizId) {
            const oldBiz = await getBizFull(bot.bizId);
            if (oldBiz) await sock.sendMessage(chatId, { text: `⚠️ *${bot.name}* recalled from *${oldBiz.name}* and redeployed.`, ...channelInfo });
        }

        await updateBot(bot.botId, { bizId: biz.bizId, plotId: biz.plotId || null, status: 'Working' });
        return sock.sendMessage(chatId, {
            text: `🤖 *${bot.name}* deployed to *${biz.name}*!\nIncome boost: +${(bot.incomeBonus * 100).toFixed(0)}%`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'upgradebot',
    aliases: ['botupgrade', 'levelupbot'],
    category: 'business',
    description: 'Upgrade your Tesla bot\'s capabilities',
    usage: '.upgradebot <Bot Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const botName = args.join(' ').trim();
        const bot = await getBot(botName, senderId);
        if (!bot) return sock.sendMessage(chatId, { text: `❌ Bot not found.`, ...channelInfo }, { quoted: message });

        const cost = BOT_UPGRADE_BASE * bot.level;
        const w = await getWallet(senderId);
        if (w.balance < cost) return sock.sendMessage(chatId, { text: `❌ You need ${$(cost)} to upgrade *${bot.name}* to level ${bot.level + 1}.`, ...channelInfo }, { quoted: message });

        w.balance -= cost;
        await saveWallet(w);
        const newLevel  = bot.level + 1;
        const newBonus  = newLevel * 0.15;
        await updateBot(bot.botId, { level: newLevel, incomeBonus: newBonus });

        return sock.sendMessage(chatId, {
            text: `🤖⬆️ *${bot.name}* upgraded to *Level ${newLevel}*!\nIncome bonus: *+${(newBonus * 100).toFixed(0)}%*`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'sellbot',
    aliases: ['tradebot'],
    category: 'business',
    description: 'Sell your Tesla bot to another player',
    usage: '.sellbot <Bot Name> <Price> @user',
    groupOnly: true,
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const buyer  = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        const numIdx = args.findIndex((a: string) => /^\d+(\.\d+)?$/.test(a));
        const price  = numIdx >= 0 ? Number(args[numIdx]) : 0;
        const botName = args.filter((a: string, i: number) => !a.startsWith('@') && i !== numIdx).join(' ').trim();

        if (!buyer || price <= 0 || !botName) return sock.sendMessage(chatId, { text: `❌ Usage: .sellbot <Bot Name> <Price> @buyer`, ...channelInfo }, { quoted: message });

        const bot = await getBot(botName, senderId);
        if (!bot) return sock.sendMessage(chatId, { text: `❌ Bot not found or not yours.`, ...channelInfo }, { quoted: message });

        const bw = await getWallet(buyer);
        if (bw.balance < price) return sock.sendMessage(chatId, { text: `❌ @${cleanJid(buyer)} can't afford ${$(price)}.`, mentions: [buyer], ...channelInfo }, { quoted: message });

        bw.balance -= price;
        await saveWallet(bw);
        const sw = await getWallet(senderId);
        sw.balance += price;
        await saveWallet(sw);
        await updateBot(bot.botId, { bizId: null, plotId: null, status: 'Idle' });
        const c = getDb();
        await c.execute({ sql: `UPDATE tesla_bots SET owner_id = ? WHERE bot_id = ?`, args: [buyer, bot.botId] });

        return sock.sendMessage(chatId, {
            text: `🤖💸 *${bot.name}* sold to @${cleanJid(buyer)} for ${$(price)}!`,
            mentions: [buyer], ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'movebot',
    aliases: ['relocatebot'],
    category: 'business',
    description: 'Move a Tesla bot to a new business',
    usage: '.movebot <Bot Name> <Business Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        if (args.length < 2) return sock.sendMessage(chatId, { text: `❌ Usage: .movebot <Bot Name> <Business Name>`, ...channelInfo }, { quoted: message });
        const ownedBots = await getOwnerBots(senderId);
        let bot = null; let bizArgs: string[] = [];
        for (let i = args.length; i > 0; i--) {
            const cand = args.slice(0, i).join(' ');
            const found = ownedBots.find(b => b.name.toLowerCase() === cand.toLowerCase());
            if (found) { bot = found; bizArgs = args.slice(i); break; }
        }
        if (!bot) return sock.sendMessage(chatId, { text: `❌ Bot not found.`, ...channelInfo }, { quoted: message });
        const biz = await findOwnedBiz(bizArgs.join(' '), senderId);
        if (!biz) return sock.sendMessage(chatId, { text: `❌ Business not found.`, ...channelInfo }, { quoted: message });
        await updateBot(bot.botId, { bizId: biz.bizId, plotId: biz.plotId || null });
        return sock.sendMessage(chatId, { text: `🤖 *${bot.name}* moved to *${biz.name}*.`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'renamebot',
    aliases: ['botname'],
    category: 'business',
    description: 'Rename your Tesla bot',
    usage: '.renamebot <Old Name> <New Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        if (args.length < 2) return sock.sendMessage(chatId, { text: `❌ Usage: .renamebot <Old Name> <New Name>`, ...channelInfo }, { quoted: message });
        const ownedBots = await getOwnerBots(senderId);
        let bot = null; let newNameArgs: string[] = [];
        for (let i = args.length - 1; i > 0; i--) {
            const cand = args.slice(0, i).join(' ');
            const found = ownedBots.find(b => b.name.toLowerCase() === cand.toLowerCase());
            if (found) { bot = found; newNameArgs = args.slice(i); break; }
        }
        if (!bot) return sock.sendMessage(chatId, { text: `❌ Bot not found.`, ...channelInfo }, { quoted: message });
        const newName = newNameArgs.join(' ').trim();
        if (!newName) return sock.sendMessage(chatId, { text: `❌ Provide a new name.`, ...channelInfo }, { quoted: message });
        await updateBot(bot.botId, { name: newName });
        return sock.sendMessage(chatId, { text: `🤖 *${bot.name}* renamed to *${newName}*.`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'deletebot',
    aliases: ['destroybot', 'removebot'],
    category: 'business',
    description: 'Permanently delete a Tesla bot',
    usage: '.deletebot <Bot Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const botName = args.join(' ').trim();
        const bot = await getBot(botName, senderId);
        if (!bot) return sock.sendMessage(chatId, { text: `❌ Bot not found.`, ...channelInfo }, { quoted: message });
        await dbDeleteBot(bot.botId);
        return sock.sendMessage(chatId, { text: `🗑️ Tesla bot *${bot.name}* has been permanently deleted.`, ...channelInfo }, { quoted: message });
    }
},

{
    command: 'botinfo',
    aliases: ['mybot', 'viewbot'],
    category: 'business',
    description: 'View Tesla bot stats',
    usage: '.botinfo <Bot Name>',
    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const botName = args.join(' ').trim();
        if (!botName) {
            // List all bots
            const bots = await getOwnerBots(senderId);
            if (!bots.length) return sock.sendMessage(chatId, { text: `🤖 You own no Tesla bots.\n_Use .buyteslabot <name> to get one._`, ...channelInfo }, { quoted: message });
            const lines = bots.map((b, i) => `╽  ${i+1}. *${b.name}* [${b.botId}] — Lv${b.level} | ${b.status} | +${(b.incomeBonus*100).toFixed(0)}%`).join('\n');
            return sock.sendMessage(chatId, { text: `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽  🤖 *MY TESLA BOTS*\n${lines}\n╽  ${FOOTER}\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`, ...channelInfo }, { quoted: message });
        }
        const bot = await getBot(botName, senderId);
        if (!bot) return sock.sendMessage(chatId, { text: `❌ Bot *${botName}* not found.`, ...channelInfo }, { quoted: message });
        const deployedBiz = bot.bizId ? await getBizFull(bot.bizId) : null;
        const upgCost = BOT_UPGRADE_BASE * bot.level;
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🤖 *TESLA BOT INFO*
╽  ─────────────────────────────
╽  ❏ *ID:*       ${bot.botId}
╽  ❏ *Name:*     ${bot.name}
╽  ❏ *Level:*    ${bot.level}
╽  ❏ *Bonus:*    +${(bot.incomeBonus * 100).toFixed(0)}% income
╽  ❏ *Status:*   ${bot.status}
╽  ❏ *Deployed:* ${deployedBiz ? deployedBiz.name : 'Idle — not deployed'}
╽  ❏ *Upgrade:*  ${$(upgCost)} → Level ${bot.level + 1} (+${((bot.level + 1) * 15)}% bonus)
╽  ❏ *Bought:*   ${fmtDate(bot.boughtAt)}
╽  ${FOOTER}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

{
    command: 'botlist',
    aliases: ['mybots', 'teslabots'],
    category: 'business',
    description: 'List all your Tesla bots',
    usage: '.botlist',
    async handler(sock: any, message: any, _args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const bots = await getOwnerBots(senderId);
        if (!bots.length) return sock.sendMessage(chatId, { text: `🤖 You own no Tesla bots.\n_Use .buyteslabot <name> to get one._`, ...channelInfo }, { quoted: message });
        const lines = await Promise.all(bots.map(async (b, i) => {
            const deployedBiz = b.bizId ? await getBizFull(b.bizId) : null;
            return `╽  ${i+1}. *${b.name}* — Lv${b.level} | ${b.status} | ${deployedBiz ? `At: ${deployedBiz.name}` : 'Idle'}`;
        }));
        return sock.sendMessage(chatId, {
            text: `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽  🤖 *MY TESLA BOTS (${bots.length})*\n${lines.join('\n')}\n╽  ${FOOTER}\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            ...channelInfo
        }, { quoted: message });
    }
},

];
