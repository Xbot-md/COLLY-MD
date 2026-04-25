import type { BotContext } from '../types.js';
import { getLawId, setLawId, getLawList, deleteLawId, type LawIdEntry } from '../lib/turso.js';
import { isOwnerOnly, cleanJid } from '../lib/isOwner.js';
import { isSudo } from '../lib/index.js';
import isAdmin from '../lib/isAdmin.js';
import crypto from 'crypto';

// ─── Constants ───────────────────────────────────────────────────────────────

const RANK_ORDER = ['Governor', 'Supreme Commander', 'Overseer', 'Judge', 'Law Enforcement Officer'];

const RANK_EMOJI: Record<string, string> = {
    'Governor':               '🏛️',
    'Supreme Commander':      '⚔️',
    'Overseer':               '🛡️',
    'Judge':                  '⚖️',
    'Law Enforcement Officer':'🚔',
};

const RANK_PREFIX: Record<string, string> = {
    'Governor':               'GOV',
    'Supreme Commander':      'SC',
    'Overseer':               'OV',
    'Judge':                  'JDG',
    'Law Enforcement Officer':'LEO',
};

const RANK_GROUP: Record<string, string> = {
    'Governor':               'Administration',
    'Supreme Commander':      'Administration',
    'Overseer':               'Administration',
    'Judge':                  'Court',
    'Law Enforcement Officer':'Law Enforcement',
};

const RANK_PERMISSIONS: Record<string, string[]> = {
    'Governor':               ['.sudo', '.appoint', '.remove', '.ban', '.unban', '.setrank', '.taxrate', '.seize'],
    'Supreme Commander':      ['.sudo', '.appoint', '.remove'],
    'Overseer':               ['.setrule', '.propose'],
    'Judge':                  ['.verdict', '.sentence', '.seize', '.jury'],
    'Law Enforcement Officer':['.arrest', '.fine', '.enforce'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function genIdNumber(rank: string): string {
    const prefix = RANK_PREFIX[rank] || 'LEO';
    const digits = String(Math.floor(1000 + Math.random() * 9000));
    return `${prefix}${digits}`;
}

function todayDate(): string {
    return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function detectRank(senderId: string, sock: any, chatId: string, isGroup: boolean): Promise<string> {
    if (isOwnerOnly(senderId)) return 'Governor';
    if (await isSudo(senderId)) return 'Supreme Commander';
    if (isGroup) {
        const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
        if (isSenderAdmin) return 'Overseer';
    }
    return 'Law Enforcement Officer';
}

function buildCard(entry: LawIdEntry): string {
    const emoji = RANK_EMOJI[entry.rank] || '🪪';
    return (
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ${emoji} *LAW ENFORCEMENT ID*
╽  ─────────────────────────────
╽  ❏ *ID Number:*         ${entry.idNumber}
╽  ❏ *Name:*              ${entry.name}
╽  ❏ *Rank:*              ${entry.rank}
╽  ❏ *Group:*             ${entry.lawGroup}
╽  ❏ *Age:*               ${entry.age}
╽  ❏ *Registered:*        ${entry.registrationDate}
╽
╽  🔑 *Permissions:*
╽  ${entry.permissions.join(', ')}
╽
╽  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
╽  _🔖 Colly novels | 👨‍💻 DavidXTech_
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`
    );
}

// ─── Commands ─────────────────────────────────────────────────────────────────

const registerlawid = {
    command: 'registerlawid',
    aliases: ['lawregister', 'getlawid', 'applylawid'],
    category: 'law',
    description: 'Register a Law Enforcement ID (rank auto-detected by role)',
    usage: '.registerlawid <age> | .registerlawid @user <age> judge',

    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId, isGroup } = context;

        const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
            || message.message?.extendedTextMessage?.contextInfo?.participant;
        const isOwnerSender = isOwnerOnly(senderId);
        const isSudoSender  = await isSudo(senderId);

        // ── Appoint someone as Judge (owner or SC only) ──────────────────────
        if (mentioned && (isOwnerSender || isSudoSender)) {
            const ageArg  = args.find(a => /^\d{1,3}$/.test(a));
            const rankArg = args.find(a => ['judge', 'leo', 'overseer', 'officer'].includes(a.toLowerCase()));

            const targetAge = ageArg ? Number(ageArg) : 30;
            let targetRank = 'Law Enforcement Officer';
            if (rankArg) {
                const r = rankArg.toLowerCase();
                if (r === 'judge')                     targetRank = 'Judge';
                else if (r === 'overseer')              targetRank = 'Overseer';
                else if (r === 'leo' || r === 'officer') targetRank = 'Law Enforcement Officer';
            } else {
                targetRank = await detectRank(mentioned, sock, chatId, !!isGroup);
                // Don't let target claim Governor or SC via appointment
                if (targetRank === 'Governor' || targetRank === 'Supreme Commander') targetRank = 'Overseer';
            }

            const existing = await getLawId(mentioned);
            const idNum = existing?.idNumber || genIdNumber(targetRank);
            const targetName = message.message?.extendedTextMessage?.contextInfo?.pushName || cleanJid(mentioned);

            const entry: LawIdEntry = {
                userId: mentioned,
                idNumber: idNum,
                name: targetName,
                rank: targetRank,
                lawGroup: RANK_GROUP[targetRank],
                age: targetAge,
                registrationDate: todayDate(),
                permissions: RANK_PERMISSIONS[targetRank],
            };
            await setLawId(entry);

            return sock.sendMessage(chatId, {
                text: `✅ *@${cleanJid(mentioned)}* has been registered as *${targetRank}*.\n\n` + buildCard(entry),
                mentions: [mentioned],
                ...channelInfo
            }, { quoted: message });
        }

        // ── Self-registration ────────────────────────────────────────────────
        const ageArg = args[0];
        if (!ageArg || !/^\d{1,3}$/.test(ageArg)) {
            return sock.sendMessage(chatId, {
                text: `❌ *Usage:* .registerlawid <age>\n_Example:_ .registerlawid 28`,
                ...channelInfo
            }, { quoted: message });
        }

        const age = Number(ageArg);
        if (age < 16 || age > 100) {
            return sock.sendMessage(chatId, {
                text: `❌ Age must be between *16* and *100*.`,
                ...channelInfo
            }, { quoted: message });
        }

        const rank = await detectRank(senderId, sock, chatId, !!isGroup);
        const existing = await getLawId(senderId);
        const idNum = existing?.idNumber || genIdNumber(rank);
        const senderName = message.pushName || cleanJid(senderId);

        const entry: LawIdEntry = {
            userId: senderId,
            idNumber: idNum,
            name: senderName,
            rank,
            lawGroup: RANK_GROUP[rank],
            age,
            registrationDate: todayDate(),
            permissions: RANK_PERMISSIONS[rank],
        };
        await setLawId(entry);

        return sock.sendMessage(chatId, {
            text: existing
                ? `🔄 *Law ID updated.*\n\n` + buildCard(entry)
                : `✅ *Law ID registered.*\n\n` + buildCard(entry),
            ...channelInfo
        }, { quoted: message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────

const mylawid = {
    command: 'mylawid',
    aliases: ['myid2', 'lawid'],
    category: 'law',
    description: 'View your Law Enforcement ID',
    usage: '.mylawid',

    async handler(sock: any, message: any, _args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        const entry = await getLawId(senderId);
        if (!entry) {
            return sock.sendMessage(chatId, {
                text: `🪪 You don't have a Law Enforcement ID yet.\nUse *.registerlawid <age>* to register.`,
                ...channelInfo
            }, { quoted: message });
        }
        return sock.sendMessage(chatId, { text: buildCard(entry), ...channelInfo }, { quoted: message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────

const viewlawid = {
    command: 'viewlawid',
    aliases: ['checklawid', 'officerinfo'],
    category: 'law',
    description: "View another officer's Law Enforcement ID",
    usage: '.viewlawid @user',

    async handler(sock: any, message: any, _args: any[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
            || message.message?.extendedTextMessage?.contextInfo?.participant;

        if (!target) {
            return sock.sendMessage(chatId, {
                text: `❌ Please *@mention* the officer you want to look up.`,
                ...channelInfo
            }, { quoted: message });
        }

        const entry = await getLawId(target);
        if (!entry) {
            return sock.sendMessage(chatId, {
                text: `🪪 @${cleanJid(target)} does not have a registered Law Enforcement ID.`,
                mentions: [target],
                ...channelInfo
            }, { quoted: message });
        }
        return sock.sendMessage(chatId, { text: buildCard(entry), mentions: [target], ...channelInfo }, { quoted: message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────

const lawlist = {
    command: 'lawlist',
    aliases: ['officers', 'lawforce', 'lawregistry'],
    category: 'law',
    description: 'View all registered law enforcement officers',
    usage: '.lawlist',

    async handler(sock: any, message: any, _args: any[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const all = await getLawList();

        if (!all.length) {
            return sock.sendMessage(chatId, {
                text: `🪪 No officers are registered yet. Use *.registerlawid <age>* to be the first.`,
                ...channelInfo
            }, { quoted: message });
        }

        const grouped: Record<string, LawIdEntry[]> = {};
        for (const rank of RANK_ORDER) grouped[rank] = [];
        for (const e of all) {
            if (!grouped[e.rank]) grouped[e.rank] = [];
            grouped[e.rank].push(e);
        }

        let body = `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽  🏛️ *LAW ENFORCEMENT REGISTRY*\n╽  Total Officers: ${all.length}\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n`;

        for (const rank of RANK_ORDER) {
            const list = grouped[rank];
            if (!list.length) continue;
            const emoji = RANK_EMOJI[rank] || '🪪';
            body += `\n*[ ${emoji} ${rank.toUpperCase()} ]*\n`;
            for (const e of list) {
                body += `╽  ❏ *${e.name}* — ${e.idNumber}\n`;
            }
        }

        body += `\n_🔖 Colly novels | 👨‍💻 DavidXTech_`;

        return sock.sendMessage(chatId, { text: body, ...channelInfo }, { quoted: message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────

const revokelawid = {
    command: 'revokelawid',
    aliases: ['removelawid', 'striplawid'],
    category: 'law',
    description: 'Revoke a law enforcement ID (owner/sudo only)',
    usage: '.revokelawid @user',

    async handler(sock: any, message: any, _args: any[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;
        if (!isOwnerOnly(senderId) && !(await isSudo(senderId))) {
            return sock.sendMessage(chatId, {
                text: `⛔ Only the *Governor* or *Supreme Commanders* can revoke law IDs.`,
                ...channelInfo
            }, { quoted: message });
        }

        const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
            || message.message?.extendedTextMessage?.contextInfo?.participant;

        if (!target) {
            return sock.sendMessage(chatId, {
                text: `❌ Please *@mention* the officer whose ID you want to revoke.`,
                ...channelInfo
            }, { quoted: message });
        }

        const entry = await getLawId(target);
        if (!entry) {
            return sock.sendMessage(chatId, {
                text: `🪪 @${cleanJid(target)} has no registered Law Enforcement ID.`,
                mentions: [target],
                ...channelInfo
            }, { quoted: message });
        }

        // Cannot revoke a Governor's ID
        if (entry.rank === 'Governor' && !isOwnerOnly(senderId)) {
            return sock.sendMessage(chatId, {
                text: `⛔ You cannot revoke a *Governor's* ID.`,
                ...channelInfo
            }, { quoted: message });
        }

        await deleteLawId(target);
        return sock.sendMessage(chatId, {
            text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🗑️ *ID REVOKED*
╽
╽  ❏ *Officer:* @${cleanJid(target)}
╽  ❏ *ID:* ${entry.idNumber}
╽  ❏ *Rank:* ${entry.rank}
╽  ❏ *Revoked by:* ${message.pushName || cleanJid(senderId)}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
            mentions: [target],
            ...channelInfo
        }, { quoted: message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────

export default [registerlawid, mylawid, viewlawid, lawlist, revokelawid];
