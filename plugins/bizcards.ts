import type { BotContext } from '../types.js';
import {
    registerBiz, getOwnerBizCount, getOwnerBizList, getBizById,
    updateBizContact, updateBizStatus, getBizStaffCount, getBizStaffList,
    hireWorker, fireWorker, getWorkerEmployers, getWorkerBizIds,
    registerWorkerCard, getWorkerCard, getWorkerCardById
} from '../lib/turso.js';
import { getLawId } from '../lib/turso.js';
import { getWallet } from '../lib/turso.js';
import { cleanJid } from '../lib/isOwner.js';

const MAX_BUSINESSES = 5;
const MAX_EMPLOYERS  = 2;
const FOOTER = '_🔖 Colly novels | 👨‍💻 DavidXTech_';

function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default [

    // ────────────────────────────────────────────────────────────────────────
    // .registerbusiness <name>
    // ────────────────────────────────────────────────────────────────────────
    {
        command: 'registerbusiness',
        aliases: ['regbiz', 'openbusiness'],
        category: 'business',
        description: 'Register a new business (max 5 per owner)',
        usage: '.registerbusiness <Business Name>',
        groupOnly: false,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const name = args.join(' ').trim();
            if (!name) return sock.sendMessage(chatId, {
                text: `❌ Usage: .registerbusiness <Business Name>\n_Example: .registerbusiness Doe's Diner Ltd_`,
                ...channelInfo
            }, { quoted: message });

            const count = await getOwnerBizCount(senderId);
            if (count >= MAX_BUSINESSES) return sock.sendMessage(chatId, {
                text: `⛔ You have reached the *maximum of ${MAX_BUSINESSES} businesses*.\nSell or close an existing one before registering a new one.`,
                ...channelInfo
            }, { quoted: message });

            const ownerName = message.pushName || cleanJid(senderId);
            const bizId = await registerBiz(senderId, ownerName, name);

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🏢 *BUSINESS REGISTERED!*
╽  ─────────────────────────────
╽  ❏ *ID:*     ${bizId}
╽  ❏ *Name:*   ${name}
╽  ❏ *Owner:*  ${ownerName}
╽  ❏ *Owned:*  ${count + 1} of ${MAX_BUSINESSES} businesses
╽  ❏ *Status:* Registered
╽  ❏ *Est:*    ${fmtDate(Date.now())}
╽
╽  💡 Set your contact:
╽  _.bizcontact ${bizId} <number>_
╽
╽  ${FOOTER}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ────────────────────────────────────────────────────────────────────────
    // .mybusinesses
    // ────────────────────────────────────────────────────────────────────────
    {
        command: 'mybusinesses',
        aliases: ['mybiz', 'mycompanies'],
        category: 'business',
        description: 'List all your registered businesses',
        usage: '.mybusinesses',
        groupOnly: false,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const list = await getOwnerBizList(senderId);
            if (!list.length) return sock.sendMessage(chatId, {
                text: `🏢 You have no registered businesses.\n_Use .registerbusiness <name> to open one._`,
                ...channelInfo
            }, { quoted: message });

            const lines = await Promise.all(list.map(async (b, i) => {
                const staff = await getBizStaffCount(b.bizId);
                return `╽  ${i + 1}. *[${b.bizId}]* ${b.name}\n╽     Staff: ${staff} | Status: ${b.status} | Est: ${fmtDate(b.registeredAt)}`;
            }));

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🏢 *MY BUSINESSES (${list.length}/${MAX_BUSINESSES})*
╽  ─────────────────────────────
${lines.join('\n')}
╽
╽  _Use .businesscard <ID> to view_
╽  ${FOOTER}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ────────────────────────────────────────────────────────────────────────
    // .businesscard [BE####]
    // ────────────────────────────────────────────────────────────────────────
    {
        command: 'businesscard',
        aliases: ['bizcard', 'viewbiz'],
        category: 'business',
        description: 'View a business card by ID',
        usage: '.businesscard <BE####>',
        groupOnly: false,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;

            let biz;
            if (args[0]?.toUpperCase().startsWith('BE')) {
                biz = await getBizById(args[0]);
            } else {
                // default: show first business of sender
                const list = await getOwnerBizList(senderId);
                biz = list[0] || null;
            }

            if (!biz) return sock.sendMessage(chatId, {
                text: `❌ Business not found.\n_Use .mybusinesses to see your IDs._`,
                ...channelInfo
            }, { quoted: message });

            const staff      = await getBizStaffCount(biz.bizId);
            const ownerCount = await getOwnerBizCount(biz.ownerId);
            const lawId      = await getLawId(biz.ownerId);
            const badgeLine  = lawId ? `╽  🪪 *[${lawId.idNumber}]*` : '';

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🏢 *BUSINESS CARD*
╽  ─────────────────────────────
╽  ❏ *ID:*      ${biz.bizId}
╽  ❏ *Name:*    ${biz.name}
╽  ❏ *Owner:*   ${biz.ownerName}
╽  ❏ *Contact:* ${biz.contact || 'Not set'}
╽  ❏ *Staff:*   ${staff}
╽  ❏ *Owned:*   ${ownerCount} of ${MAX_BUSINESSES} businesses
╽  ❏ *Status:*  ${biz.status}
╽  ❏ *Est:*     ${fmtDate(biz.registeredAt)}
╽
${badgeLine}
╽  ${FOOTER}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ────────────────────────────────────────────────────────────────────────
    // .bizcontact <BE####> <number>
    // ────────────────────────────────────────────────────────────────────────
    {
        command: 'bizcontact',
        aliases: ['setbizcontact'],
        category: 'business',
        description: 'Set the contact number for your business',
        usage: '.bizcontact <BE####> <number>',
        groupOnly: false,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const bizId   = args[0]?.toUpperCase();
            const contact = args.slice(1).join(' ').trim();
            if (!bizId || !contact) return sock.sendMessage(chatId, {
                text: `❌ Usage: .bizcontact <BE####> <contact number>`,
                ...channelInfo
            }, { quoted: message });

            const biz = await getBizById(bizId);
            if (!biz || biz.ownerId !== senderId) return sock.sendMessage(chatId, {
                text: `❌ Business not found or you are not the owner.`,
                ...channelInfo
            }, { quoted: message });

            await updateBizContact(bizId, contact);
            return sock.sendMessage(chatId, { text: `✅ Contact for *${biz.name}* updated to: ${contact}`, ...channelInfo }, { quoted: message });
        }
    },

    // ────────────────────────────────────────────────────────────────────────
    // .bizstatus <BE####> <status>
    // ────────────────────────────────────────────────────────────────────────
    {
        command: 'bizstatus',
        aliases: ['updatebizstatus'],
        category: 'business',
        description: 'Update the status of your business',
        usage: '.bizstatus <BE####> <Hiring|Closed|Registered|Paused>',
        groupOnly: false,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const bizId  = args[0]?.toUpperCase();
            const status = args.slice(1).join(' ').trim();
            if (!bizId || !status) return sock.sendMessage(chatId, {
                text: `❌ Usage: .bizstatus <BE####> <status>`,
                ...channelInfo
            }, { quoted: message });

            const biz = await getBizById(bizId);
            if (!biz || biz.ownerId !== senderId) return sock.sendMessage(chatId, {
                text: `❌ Business not found or you are not the owner.`,
                ...channelInfo
            }, { quoted: message });

            await updateBizStatus(bizId, status);
            return sock.sendMessage(chatId, { text: `✅ Status of *${biz.name}* set to: ${status}`, ...channelInfo }, { quoted: message });
        }
    },

    // ────────────────────────────────────────────────────────────────────────
    // .hireworker @user <BE####>
    // ────────────────────────────────────────────────────────────────────────
    {
        command: 'hireworker',
        aliases: ['hirebiz'],
        category: 'business',
        description: 'Hire a worker into your business (worker max: 2 employers)',
        usage: '.hireworker @user <BE####>',
        groupOnly: true,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const bizId  = args.find((a: string) => /^BE\d{4}$/i.test(a))?.toUpperCase();

            if (!target || !bizId) return sock.sendMessage(chatId, {
                text: `❌ Usage: .hireworker @user <BE####>`,
                ...channelInfo
            }, { quoted: message });

            const biz = await getBizById(bizId);
            if (!biz || biz.ownerId !== senderId) return sock.sendMessage(chatId, {
                text: `❌ Business not found or you are not the owner.`,
                ...channelInfo
            }, { quoted: message });

            // Check worker's employer count
            const workerBizIds = await getWorkerBizIds(target);
            if (workerBizIds.includes(bizId)) return sock.sendMessage(chatId, {
                text: `⚠️ @${cleanJid(target)} is already employed at *${biz.name}*.`,
                mentions: [target], ...channelInfo
            }, { quoted: message });

            if (workerBizIds.length >= MAX_EMPLOYERS) return sock.sendMessage(chatId, {
                text: `⛔ @${cleanJid(target)} already works at *${MAX_EMPLOYERS} businesses* (the maximum).\nThey must resign from one before joining another.`,
                mentions: [target], ...channelInfo
            }, { quoted: message });

            const workerName = (await getWorkerCard(target))?.userName || cleanJid(target);
            await hireWorker(bizId, target, workerName);
            const newStaff = await getBizStaffCount(bizId);

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ✅ *WORKER HIRED*
╽  ─────────────────────────────
╽  ❏ *Employee:* @${cleanJid(target)}
╽  ❏ *Business:* ${biz.name} [${bizId}]
╽  ❏ *Staff now:* ${newStaff}
╽
╽  ${FOOTER}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ────────────────────────────────────────────────────────────────────────
    // .fireworker @user <BE####>
    // ────────────────────────────────────────────────────────────────────────
    {
        command: 'fireworker',
        aliases: ['dismissworker', 'letgo'],
        category: 'business',
        description: 'Remove a worker from your business',
        usage: '.fireworker @user <BE####>',
        groupOnly: true,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const bizId  = args.find((a: string) => /^BE\d{4}$/i.test(a))?.toUpperCase();

            if (!target || !bizId) return sock.sendMessage(chatId, {
                text: `❌ Usage: .fireworker @user <BE####>`,
                ...channelInfo
            }, { quoted: message });

            const biz = await getBizById(bizId);
            if (!biz || biz.ownerId !== senderId) return sock.sendMessage(chatId, {
                text: `❌ Business not found or you are not the owner.`,
                ...channelInfo
            }, { quoted: message });

            await fireWorker(bizId, target);
            return sock.sendMessage(chatId, {
                text: `🔴 @${cleanJid(target)} has been removed from *${biz.name}* [${bizId}].`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ────────────────────────────────────────────────────────────────────────
    // .bizstaff <BE####>
    // ────────────────────────────────────────────────────────────────────────
    {
        command: 'bizstaff',
        aliases: ['stafflist'],
        category: 'business',
        description: 'View the staff list for a business',
        usage: '.bizstaff <BE####>',
        groupOnly: false,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const bizId = args[0]?.toUpperCase();
            if (!bizId) return sock.sendMessage(chatId, { text: `❌ Usage: .bizstaff <BE####>`, ...channelInfo }, { quoted: message });

            const biz = await getBizById(bizId);
            if (!biz) return sock.sendMessage(chatId, { text: `❌ Business [${bizId}] not found.`, ...channelInfo }, { quoted: message });

            const staff = await getBizStaffList(bizId);
            const lines = staff.length
                ? staff.map((s, i) => `╽  ${i + 1}. ${s.userName || cleanJid(s.userId)} — Hired: ${fmtDate(s.hiredAt)}`).join('\n')
                : '╽  _No staff on record._';

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  👔 *STAFF LIST — ${biz.name}*
╽  ❏ *ID:* ${bizId} | *Total:* ${staff.length}
╽  ─────────────────────────────
${lines}
╽
╽  ${FOOTER}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ────────────────────────────────────────────────────────────────────────
    // .registerworker
    // ────────────────────────────────────────────────────────────────────────
    {
        command: 'registerworker',
        aliases: ['regworker', 'getworkerid'],
        category: 'business',
        description: 'Register as a worker and get your WK#### ID',
        usage: '.registerworker',
        groupOnly: false,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const existing = await getWorkerCard(senderId);
            if (existing) return sock.sendMessage(chatId, {
                text: `🪪 You already have a Worker ID: *${existing.workerId}*\n_Use .myworkercard to view your full card._`,
                ...channelInfo
            }, { quoted: message });

            const userName = message.pushName || cleanJid(senderId);
            const workerId = await registerWorkerCard(senderId, userName);

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  👷 *WORKER ID ISSUED*
╽  ─────────────────────────────
╽  ❏ *ID:*      ${workerId}
╽  ❏ *Name:*    ${userName}
╽  ❏ *Issued:*  ${fmtDate(Date.now())}
╽
╽  Share your ID with employers.
╽  A business owner can hire you
╽  with: _.hireworker @you <BE####>_
╽
╽  ${FOOTER}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ────────────────────────────────────────────────────────────────────────
    // .myworkercard
    // ────────────────────────────────────────────────────────────────────────
    {
        command: 'myworkercard',
        aliases: ['workercard', 'myemployeecard'],
        category: 'business',
        description: 'View your employee/worker card',
        usage: '.myworkercard',
        groupOnly: false,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const card = await getWorkerCard(senderId);
            if (!card) return sock.sendMessage(chatId, {
                text: `❌ You don't have a Worker ID yet.\n_Use .registerworker to get one._`,
                ...channelInfo
            }, { quoted: message });

            const wallet    = await getWallet(senderId);
            const employers = await getWorkerEmployers(senderId);
            const empLines  = employers.length
                ? employers.map((e, i) => `╽  ${i + 1}. ${e.bizName} [${e.bizId}]`).join('\n')
                : '╽  _Not employed anywhere._';

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  👷 *EMPLOYEE CARD*
╽  ─────────────────────────────
╽  ❏ *ID:*      ${card.workerId}
╽  ❏ *Name:*    ${card.userName}
╽  ❏ *Level:*   ${wallet.level}
╽  ❏ *Hired:*   ${fmtDate(card.registeredAt)}
╽  ❏ *Status:*  Active
╽
╽  📋 *Employers (${employers.length}/${MAX_EMPLOYERS}):*
${empLines}
╽
╽  ${FOOTER}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ────────────────────────────────────────────────────────────────────────
    // .viewworkercard @user  OR  .viewworkercard WK####
    // ────────────────────────────────────────────────────────────────────────
    {
        command: 'viewworkercard',
        aliases: ['lookupworker', 'workerinfo'],
        category: 'business',
        description: 'View another user\'s worker card by mention or WK ID',
        usage: '.viewworkercard @user | .viewworkercard WK####',
        groupOnly: false,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const idArg     = args.find((a: string) => /^WK\d{4}$/i.test(a))?.toUpperCase();

            let card;
            let targetId: string;
            if (mentioned) {
                card = await getWorkerCard(mentioned);
                targetId = mentioned;
            } else if (idArg) {
                card = await getWorkerCardById(idArg);
                targetId = card?.userId || '';
            } else {
                return sock.sendMessage(chatId, { text: `❌ Usage: .viewworkercard @user  OR  .viewworkercard WK####`, ...channelInfo }, { quoted: message });
            }

            if (!card || !targetId) return sock.sendMessage(chatId, { text: `❌ Worker card not found.`, ...channelInfo }, { quoted: message });

            const wallet    = await getWallet(targetId);
            const employers = await getWorkerEmployers(targetId);
            const empLines  = employers.length
                ? employers.map((e, i) => `╽  ${i + 1}. ${e.bizName} [${e.bizId}]`).join('\n')
                : '╽  _Not employed anywhere._';

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  👷 *EMPLOYEE CARD*
╽  ─────────────────────────────
╽  ❏ *ID:*      ${card.workerId}
╽  ❏ *Name:*    ${card.userName}
╽  ❏ *Level:*   ${wallet.level}
╽  ❏ *Hired:*   ${fmtDate(card.registeredAt)}
╽  ❏ *Status:*  Active
╽
╽  📋 *Employers (${employers.length}/${MAX_EMPLOYERS}):*
${empLines}
╽
╽  ${FOOTER}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    }
];
