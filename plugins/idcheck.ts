import type { BotContext } from '../types.js';
import { getWallet, saveWallet, isBlacklisted } from '../lib/turso.js';
import {
    getCourtId, getCriminalRecord, getMarriage,
    getLoan, createLoan, repayLoan, hasActiveCases, isDeported,
    addLotteryTicket, getLotteryPool, clearLotteryPool,
} from '../lib/turso2.js';
import { requireId, getIdAge } from '../lib/idGate.js';
import config from '../config.js';
import isOwnerOrSudo, { isOwnerOnly } from '../lib/isOwner.js';

function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }
function fmt(n: number) { return n.toLocaleString(); }
function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function msToCountdown(ms: number): string {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

const begCooldowns = new Map<string, number>();
const BEG_COOLDOWN = 3 * 60 * 60 * 1000;

export default [
    // ─── .idcheck [@user] ───────────────────────────────────────────────────
    {
        command: 'idcheck',
        aliases: ['profile', 'citizencheck', 'whois'],
        category: 'court',
        description: 'View full citizen profile & status',
        usage: '.idcheck [@user]',
        groupOnly: true,
        async handler(sock: any, message: any, _args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const target = mentioned || senderId;
            const isSelf = target === senderId;

            const [record, wallet, crime, marriage, loan] = await Promise.all([
                getCourtId(target),
                getWallet(target, cleanJid(target)),
                getCriminalRecord(target, chatId).catch(() => [] as any[]),
                getMarriage(target, chatId).catch(() => null),
                getLoan(target).catch(() => null),
            ]);

            const displayName = record?.legalName || wallet.name || cleanJid(target);

            if (!record) {
                return sock.sendMessage(chatId, {
                    text:
                        `┌─〔 🪪 𝐂𝐈𝐓𝐈𝐙𝐄𝐍 𝐋𝐎𝐎𝐊𝐔𝐏 〕──────────┈⊷\n` +
                        `┆  👤 *User:* @${cleanJid(target)}\n` +
                        `┆  🆔 *Status:* ❌ NOT REGISTERED\n` +
                        `┆  💵 *Balance:* ${fmt(wallet.balance)} 🪙\n` +
                        `┆  ⭐ *Level:* ${wallet.level}\n` +
                        `└──────────────────────────────────┈⊷\n` +
                        `_Register with: .registeredid <Name> | <DOB> | <Nationality>_`,
                    mentions: [target],
                    ...channelInfo
                }, { quoted: message });
            }

            const now = Date.now();
            const age = (() => {
                if (!record.dob) return '?';
                const [dd, mm, yyyy] = record.dob.split('/').map(Number);
                const dob = new Date(yyyy, mm - 1, dd);
                let a = new Date().getFullYear() - dob.getFullYear();
                const mo = new Date().getMonth() - dob.getMonth();
                if (mo < 0 || (mo === 0 && new Date().getDate() < dob.getDate())) a--;
                return a;
            })();

            const expired = record.expiryDate < now;
            const daysLeft = Math.ceil((record.expiryDate - now) / (24 * 60 * 60 * 1000));

            let statusLabel = 'Citizen';
            if (isOwnerOnly(target)) statusLabel = '👑 Bot Owner';
            else if (await isOwnerOrSudo(target, sock, chatId)) statusLabel = '🛡️ Sudo Admin';
            else if (chatId.endsWith('@g.us')) {
                try {
                    const meta = await sock.groupMetadata(chatId);
                    const p = meta.participants.find((x: any) => x.id === target || x.lid === target);
                    if (p?.admin) statusLabel = '🔰 Group Admin';
                } catch {}
            }

            const guiltyCount = crime.filter((c: any) => c.verdict === 'guilty').length;
            const maritalLine = marriage
                ? `💍 Married to @${cleanJid(marriage.partner)} (since ${fmtDate(marriage.married_at)})`
                : '💔 Single';

            let loanLine = '🏦 No active loan';
            if (loan) {
                const overdue = loan.dueDate < now;
                const total = loan.amount + loan.interest;
                loanLine = overdue
                    ? `⚠️ *OVERDUE LOAN* — ${fmt(total)} 🪙 (was due ${fmtDate(loan.dueDate)})`
                    : `💸 Active loan: ${fmt(loan.amount)} 🪙 + ${fmt(loan.interest)} interest (due ${fmtDate(loan.dueDate)})`;
            }

            const idStatusLine = expired
                ? `❌ EXPIRED (${Math.abs(daysLeft)}d ago)`
                : `✅ Valid — ${daysLeft}d remaining`;

            const lines = [
                `┌─〔 🪪 𝐂𝐈𝐓𝐈𝐙𝐄𝐍 𝐏𝐑𝐎𝐅𝐈𝐋𝐄 〕────────────┈⊷`,
                `┆`,
                `┆  👤 *${displayName}* ${isSelf ? '(you)' : ''}`,
                `┆  🆔 *ID#:* ${record.idNumber}`,
                `┆  📅 *DOB:* ${record.dob} (Age ${age})`,
                `┆  🌍 *Nationality:* ${record.nationality}`,
                `┆  🏷️ *Status:* ${statusLabel}`,
                `┆`,
                `┆  ── 💰 𝐅𝐈𝐍𝐀𝐍𝐂𝐄𝐒 ──`,
                `┆  💵 *Cash:* ${fmt(wallet.balance)} 🪙`,
                `┆  🏦 *Bank:* ${fmt(wallet.bank)} 🪙`,
                `┆  💎 *Total:* ${fmt(wallet.balance + wallet.bank)} 🪙`,
                `┆  ⭐ *Level:* ${wallet.level} (${wallet.xp} XP)`,
                `┆  ${loanLine}`,
                `┆`,
                `┆  ── ⚖️ 𝐋𝐄𝐆𝐀𝐋 𝐒𝐓𝐀𝐓𝐔𝐒 ──`,
                `┆  ⚖️ *Convictions:* ${guiltyCount} guilty verdict${guiltyCount !== 1 ? 's' : ''}`,
                `┆  ${maritalLine}`,
                `┆`,
                `┆  ── 🪪 𝐈𝐃 𝐂𝐀𝐑𝐃 ──`,
                `┆  📋 *Issue Date:* ${fmtDate(record.issueDate)}`,
                `┆  🗓️ *Expiry:* ${fmtDate(record.expiryDate)}`,
                `┆  🔖 *ID Status:* ${idStatusLine}`,
                `┆  🏛️ *Citizen Since:* ${fmtDate(record.citizenSince)}`,
                `┆`,
                `└──────────────────────────────────────┈⊷`,
                `_🔖 Colly novels | 👨‍💻 DavidXTech_`,
            ];

            await sock.sendMessage(chatId, {
                text: lines.join('\n'),
                mentions: [target, ...(marriage ? [marriage.partner] : [])],
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── .beg ───────────────────────────────────────────────────────────────
    {
        command: 'beg',
        aliases: ['askforcoins', 'panhandle'],
        category: 'economy',
        description: 'Beg for a few coins (no ID required)',
        usage: '.beg',
        async handler(sock: any, message: any, _args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const now = Date.now();
            const last = begCooldowns.get(senderId) || 0;
            const remaining = BEG_COOLDOWN - (now - last);
            if (remaining > 0) {
                return sock.sendMessage(chatId, {
                    text: `🙏 You already begged recently! Try again in *${msToCountdown(remaining)}*`,
                    ...channelInfo
                }, { quoted: message });
            }
            const earned = Math.floor(Math.random() * 40) + 10;
            const name = message.pushName || cleanJid(senderId);
            const w = await getWallet(senderId, name);
            w.balance += earned;
            await saveWallet(w);
            begCooldowns.set(senderId, now);

            const lines = [
                '😔 You held out your hand...',
                '🙏 You begged outside the market...',
                '😢 You sang for spare coins...',
                '🥺 You knocked on doors...',
                '👋 You asked around the group...',
            ];
            const line = lines[Math.floor(Math.random() * lines.length)];
            await sock.sendMessage(chatId, {
                text: `${line}\n\nSomeone felt pity and gave you *${fmt(earned)} 🪙*\n💵 Balance: ${fmt(w.balance)} 🪙\n\n_💡 To earn more, register a citizen ID and use .work, .daily_`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── .lottery ───────────────────────────────────────────────────────────
    {
        command: 'lottery',
        aliases: ['lotto', 'jackpot'],
        category: 'economy',
        description: 'Buy a lottery ticket — 25% chance to win the pool (18+, ID required)',
        usage: '.lottery',
        groupOnly: true,
        async handler(sock: any, message: any, _args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const age = await getIdAge(senderId, sock);
            if (age !== null && age < 18) {
                return sock.sendMessage(chatId, {
                    text: `🔞 *Age Restricted*\n\nLottery requires age *18+*.\nYour registered age: *${age}*`,
                    ...channelInfo
                }, { quoted: message });
            }

            const TICKET_PRICE = 100;
            const WIN_CHANCE  = 0.25;

            const name = message.pushName || cleanJid(senderId);
            const w = await getWallet(senderId, name);

            if (w.balance < TICKET_PRICE) {
                return sock.sendMessage(chatId, {
                    text: `❌ A lottery ticket costs *${TICKET_PRICE} 🪙*.\nYour balance: *${fmt(w.balance)} 🪙*`,
                    ...channelInfo
                }, { quoted: message });
            }

            w.balance -= TICKET_PRICE;
            await saveWallet(w);
            await addLotteryTicket(senderId, name);

            const pool = await getLotteryPool();
            const poolTotal = pool.length * TICKET_PRICE;

            if (Math.random() < WIN_CHANCE) {
                const winnings = poolTotal;
                w.balance += winnings;
                await saveWallet(w);
                await clearLotteryPool();

                await sock.sendMessage(chatId, {
                    text:
                        `🎰 *JACKPOT!*\n\n` +
                        `@${cleanJid(senderId)} just won the lottery!\n\n` +
                        `🎟️ *Tickets in pool:* ${pool.length}\n` +
                        `💰 *Prize:* ${fmt(winnings)} 🪙\n\n` +
                        `_Pool reset. New round starts now!_\n` +
                        `_💵 ${name}'s balance: ${fmt(w.balance)} 🪙_`,
                    mentions: [senderId],
                    ...channelInfo
                }, { quoted: message });
            } else {
                await sock.sendMessage(chatId, {
                    text:
                        `🎟️ *Ticket Purchased!*\n\n` +
                        `You bought a ticket for *${TICKET_PRICE} 🪙*\n` +
                        `🎰 *Current pool:* ${fmt(poolTotal)} 🪙 (${pool.length} tickets)\n` +
                        `📊 *Win chance per draw:* 25%\n\n` +
                        `_Good luck! Anyone who buys a ticket may trigger the draw!_\n` +
                        `_💵 Balance: ${fmt(w.balance)} 🪙_`,
                    ...channelInfo
                }, { quoted: message });
            }
        }
    },

    // ─── .loan ──────────────────────────────────────────────────────────────
    {
        command: 'loan',
        aliases: ['borrow', 'getloan'],
        category: 'economy',
        description: 'Take out a loan (ID + Level 5 required, 15% interest, 48–168h term)',
        usage: '.loan [amount] [reason] [hours]',
        groupOnly: true,
        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
            const MIN_LOAN = 100, MAX_LOAN = 50000, INTEREST_RATE = 0.15, MIN_HOURS = 48, MAX_HOURS = 168, REQ_LEVEL = 5;

            function denialCard(status: string, reason: string, action: string) {
                return (
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ❌ *LOAN REJECTED*
╽
╽  ❏ *Recipient:* @${cleanJid(senderId)}
╽  ❏ *Status:* ${status}
╽  ❏ *Date:* ${today}
╽
╽  ⚖️ *Reason for Denial:*
╽  ${reason.split('\n').join('\n╽  ')}
╽
╽  ${action}
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`
                );
            }

            // Show info if no args
            if (!args[0]) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🏦 *CITIZEN LOAN OFFICE*
╽
╽  ❏ *Min Loan:* $${fmt(MIN_LOAN)}
╽  ❏ *Max Loan:* $${fmt(MAX_LOAN)}
╽  ❏ *Interest:* 15% (fixed)
╽  ❏ *Term:* 48h – 168h
╽  ❏ *Level Required:* ${REQ_LEVEL}+
╽
╽  📝 *Usage:*
╽  ${prefix}loan [amount] [reason] [hours]
╽
╽  💡 *Example:*
╽  ${prefix}loan 5000 Business startup 72
╽
╽  ℹ️ Hours is optional (default 168h).
╽  A valid reason is mandatory.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [senderId], ...channelInfo
                }, { quoted: message });
            }

            // ── Parse arguments: .loan [amount] [reason...] [hours?] ────────
            const firstNum = parseInt((args[0] || '').replace(/[^0-9]/g, ''), 10);
            const lastArg  = args[args.length - 1];
            const lastIsHours = args.length > 1 && /^\d+$/.test(lastArg) && args.length > 1;
            const hours    = lastIsHours ? Math.min(MAX_HOURS, Math.max(MIN_HOURS, parseInt(lastArg, 10))) : MAX_HOURS;
            const reasonArgs = lastIsHours ? args.slice(1, -1) : args.slice(1);
            const reason   = reasonArgs.join(' ').trim();
            const amount   = isNaN(firstNum) ? 0 : firstNum;

            // ── CHECK 1: Verified Identity ───────────────────────────────────
            const idRecord = await getCourtId(senderId);
            if (!idRecord) {
                return sock.sendMessage(chatId, {
                    text: denialCard(
                        'Unverified Identity',
                        'The bank cannot issue credit to\nanonymous entities. A valid *Citizen ID*\nis required to finalize this contract.',
                        `📝 _Action: Use *${prefix}registeredid* first._`
                    ), mentions: [senderId], ...channelInfo
                }, { quoted: message });
            }

            // ── CHECK 2: Level 5+ ────────────────────────────────────────────
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            if (w.level < REQ_LEVEL) {
                return sock.sendMessage(chatId, {
                    text: denialCard(
                        'Low Credit Maturity',
                        `Your social standing is insufficient.\nAccounts must reach *Level ${REQ_LEVEL}* to\ndemonstrate financial stability.`,
                        `📈 _Action: Work jobs to level up._`
                    ), mentions: [senderId], ...channelInfo
                }, { quoted: message });
            }

            // ── CHECK 3: Existing Loan ───────────────────────────────────────
            const existing = await getLoan(senderId);
            if (existing) {
                return sock.sendMessage(chatId, {
                    text: denialCard(
                        'Existing Liability',
                        'You have an active outstanding balance.\nBank policy prohibits "Debt Stacking."\nClear your current loan to re-apply.',
                        `💰 _Action: Use *${prefix}repayloan*._`
                    ), mentions: [senderId], ...channelInfo
                }, { quoted: message });
            }

            // ── CHECK 4: Legal Risk ──────────────────────────────────────────
            const [banned, deported, openCase] = await Promise.all([
                isBlacklisted(senderId),
                isDeported(senderId, chatId),
                hasActiveCases(senderId, chatId)
            ]);
            if (banned || deported || openCase) {
                return sock.sendMessage(chatId, {
                    text: denialCard(
                        'Legal Risk',
                        'Financial services are suspended for\ncitizens with active bounties or\npending court violations.',
                        `⚖️ _Action: Clear your record first._`
                    ), mentions: [senderId], ...channelInfo
                }, { quoted: message });
            }

            // ── CHECK 5: Reason required ─────────────────────────────────────
            if (!reason) {
                return sock.sendMessage(chatId, {
                    text: denialCard(
                        'Inadequate Justification',
                        `You must provide a valid and detailed\nreason for requesting bank funds.\nExample: *${prefix}loan 5000 Business startup*`,
                        `🚫 _Status: Application Void._`
                    ), mentions: [senderId], ...channelInfo
                }, { quoted: message });
            }

            // ── CHECK 6: Amount bounds ───────────────────────────────────────
            if (amount < MIN_LOAN) {
                return sock.sendMessage(chatId, {
                    text: denialCard(
                        'Insufficient Amount',
                        `The minimum loan amount is *$${fmt(MIN_LOAN)}*.\nYour request does not meet this threshold.`,
                        `💵 _Action: Request at least $${fmt(MIN_LOAN)}._`
                    ), mentions: [senderId], ...channelInfo
                }, { quoted: message });
            }
            if (amount > MAX_LOAN) {
                return sock.sendMessage(chatId, {
                    text: denialCard(
                        'Limit Exceeded',
                        `The requested principal exceeds the\nunsecured maximum of *$${fmt(MAX_LOAN)}*.`,
                        `⚠️ _Action: Reduce amount and resubmit._`
                    ), mentions: [senderId], ...channelInfo
                }, { quoted: message });
            }

            // ── APPROVED ─────────────────────────────────────────────────────
            const interest  = Math.ceil(amount * INTEREST_RATE);
            const total     = amount + interest;
            const dueMs     = Date.now() + hours * 60 * 60 * 1000;

            await createLoan(senderId, amount, interest, reason, hours);
            w.bank += amount;
            await saveWallet(w);

            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  📑 *LOAN AGREEMENT*
╽
╽  ❏ *Recipient:* @${cleanJid(senderId)} (ID: ${idRecord.idNumber})
╽  ❏ *Principal:* $${fmt(amount)}
╽  ❏ *Purpose:* "${reason}"
╽  ❏ *Date:* ${today}
╽
╽  ⚖️ *Terms & Conditions:*
╽  By accepting, you agree to repay *$${fmt(total)}*
╽  within ${hours}h. Failure to comply
╽  authorizes the Bank to seize all assets.
╽
╽  ✅ *Status:* Approved & Disbursed
╽  Check your bank balance 💰
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [senderId], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── .repayloan ─────────────────────────────────────────────────────────
    {
        command: 'repayloan',
        aliases: ['payloan', 'repaydept', 'clearloan', 'repay'],
        category: 'economy',
        description: 'Repay your active citizen loan',
        usage: '.repayloan',
        groupOnly: true,
        async handler(sock: any, message: any, _args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;

            const loan = await getLoan(senderId);
            if (!loan) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ✅ *NO ACTIVE LOAN*
╽
╽  Your credit record is clean.
╽  You are eligible to take a new loan.
╽
╽  💰 Use *${prefix}loan* to apply.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    ...channelInfo
                }, { quoted: message });
            }

            const total    = loan.amount + loan.interest;
            const overdue  = loan.dueDate < Date.now();
            const w        = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const bankBal  = w.bank;

            if (bankBal < total) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ❌ *REPAYMENT FAILED*
╽
╽  ❏ *Amount Owed:* $${fmt(total)}
╽  ❏ *Your Bank:* $${fmt(bankBal)}
╽  ❏ *Shortfall:* $${fmt(total - bankBal)}${overdue ? '\n╽  ⚠️ *Status: OVERDUE*' : ''}
╽
╽  Earn more with *${prefix}work*, *${prefix}daily*,
╽  or *${prefix}beg*.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    ...channelInfo
                }, { quoted: message });
            }

            w.bank -= total;
            await saveWallet(w);
            await repayLoan(senderId);

            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ✅ *LOAN CLEARED*
╽
╽  ❏ *Principal:* $${fmt(loan.amount)}
╽  ❏ *Interest:* $${fmt(loan.interest)} (15%)
╽  ❏ *Total Paid:* $${fmt(total)}
╽  ❏ *Bank Balance:* $${fmt(w.bank)}
╽
╽  Your credit record is clear.
╽  You may apply for a new loan anytime.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    },
];
