import type { BotContext } from '../types.js';
import { getWallet, saveWallet } from '../lib/turso.js';
import { resolveJid } from '../lib/lidUtils.js';
import {
    getCourtId, createCourtId, updateCourtIdName, renewCourtId, deleteCourtId,
    getCriminalRecord, getMarriage, getFamily,
    CourtIdRecord
} from '../lib/turso2.js';
import { buildIdCard, fmtDate, IdCardData } from '../lib/idCard.js';
import isOwnerOrSudo, { isOwnerOnly } from '../lib/isOwner.js';

const REGISTER_COST = 100;
const UPDATE_COST   = 500;
const RENEW_COST    = 150;

function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }

function genIdNumber(): string {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(2);
    const hex = Math.random().toString(16).slice(2, 6).toUpperCase();
    return `ID-${dd}${mm}${yy}-${hex}`;
}

function parseArgs(raw: string): { name: string; dob: string; nationality: string } | null {
    const parts = raw.split('|').map(p => p.trim());
    if (parts.length < 2) return null;
    const name = parts[0];
    const dob  = parts[1];
    if (!name || !dob) return null;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) return null;
    const nationality = parts[2] || 'N/A';
    return { name, dob, nationality };
}

function validateDob(dob: string): boolean {
    const [dd, mm, yyyy] = dob.split('/').map(Number);
    if (!dd || !mm || !yyyy) return false;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
    if (yyyy < 1900 || yyyy > new Date().getFullYear()) return false;
    return true;
}

async function resolveStatus(senderId: string, sock: any, chatId: string): Promise<string> {
    if (await isOwnerOrSudo(senderId, sock, chatId)) {
        if (isOwnerOnly(senderId)) return 'Bot Owner';
        return 'Sudo Admin';
    }
    if (chatId.endsWith('@g.us')) {
        try {
            const meta = await sock.groupMetadata(chatId);
            const me = meta.participants.find((p: any) => p.id === senderId || p.lid === senderId);
            if (me && (me.admin === 'admin' || me.admin === 'superadmin')) return 'Group Admin';
        } catch {}
    }
    return 'Citizen';
}

async function fetchProfilePic(sock: any, jid: string): Promise<Buffer | null> {
    try {
        const url = await sock.profilePictureUrl(jid, 'image');
        if (!url) return null;
        const res = await fetch(url);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    } catch {
        return null;
    }
}

async function buildCard(sock: any, userId: string, chatId: string, record: CourtIdRecord): Promise<Buffer> {
    const [violations, marriage, ppBuf] = await Promise.all([
        getCriminalRecord(userId, chatId).then(r => r.length).catch(() => 0),
        getMarriage(userId, chatId).catch(() => null),
        fetchProfilePic(sock, userId),
    ]);

    let maritalStatus = 'Single';
    if (marriage) {
        maritalStatus = `Married to @${cleanJid(marriage.partner)}`;
    }

    const status = await resolveStatus(userId, sock, chatId);

    const cardData: IdCardData = {
        legalName:     record.legalName,
        dob:           record.dob,
        nationality:   record.nationality,
        idNumber:      record.idNumber,
        issueDate:     record.issueDate,
        expiryDate:    record.expiryDate,
        citizenSince:  record.citizenSince,
        status,
        maritalStatus,
        violations,
    };

    return buildIdCard(cardData, ppBuf);
}

export default [
    // ── .registeredid ────────────────────────────────────────────────────────
    {
        command: 'registeredid',
        aliases: ['regid', 'myid', 'getid'],
        category: 'court',
        description: 'Register or view your official Colly Court citizen ID card',
        usage: '.registeredid <Full Name> | <DD/MM/YYYY> | <Nationality>',
        groupOnly: true,

        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const rawArgs = args.join(' ').trim();

            const existing = await getCourtId(senderId);

            // No args → show existing card or prompt to register
            if (!rawArgs) {
                if (!existing) {
                    return sock.sendMessage(chatId, {
                        text:
                            `🪪 *COLLY COURT ID*\n\n` +
                            `You don't have a citizen ID yet.\n\n` +
                            `*Registration costs ${REGISTER_COST} coins.*\n\n` +
                            `Usage:\n*.registeredid <Full Name> | <DD/MM/YYYY> | <Nationality>*\n\n` +
                            `Example:\n*.registeredid Sarah Cole | 22/08/2003 | Nigerian*\n\n` +
                            `_⚠️ Citizens without IDs may be taxed heavily by the court._`,
                        ...channelInfo
                    }, { quoted: message });
                }
                const img = await buildCard(sock, senderId, chatId, existing);
                return sock.sendMessage(chatId, { image: img, caption: `🪪 *${existing.legalName}* — ${existing.idNumber}`, ...channelInfo }, { quoted: message });
            }

            // Has args — registering or updating
            const parsed = parseArgs(rawArgs);
            if (!parsed) {
                return sock.sendMessage(chatId, {
                    text:
                        `❌ *Invalid format.*\n\n` +
                        `Usage: *.registeredid <Full Name> | <DD/MM/YYYY> | <Nationality>*\n` +
                        `Example: *.registeredid Sarah Cole | 22/08/2003 | Nigerian*\n\n` +
                        `_Date must be in DD/MM/YYYY format._`,
                    ...channelInfo
                }, { quoted: message });
            }
            if (!validateDob(parsed.dob)) {
                return sock.sendMessage(chatId, {
                    text: `❌ Invalid date of birth *${parsed.dob}*.\n\nUse format *DD/MM/YYYY* (e.g. 22/08/2003).`,
                    ...channelInfo
                }, { quoted: message });
            }

            const wallet = await getWallet(senderId, message.pushName || cleanJid(senderId));

            if (!existing) {
                // First-time registration
                if (wallet.balance < REGISTER_COST) {
                    return sock.sendMessage(chatId, {
                        text: `❌ You need *${REGISTER_COST} coins* to register.\nYour balance: *${wallet.balance} coins*.\n\nEarn more with *.daily*, *.work*, or *.beg*.`,
                        ...channelInfo
                    }, { quoted: message });
                }

                wallet.balance -= REGISTER_COST;
                await saveWallet(wallet);

                const now = Date.now();
                const record: CourtIdRecord = {
                    userId:       senderId,
                    groupId:      chatId,
                    legalName:    parsed.name,
                    dob:          parsed.dob,
                    nationality:  parsed.nationality,
                    idNumber:     genIdNumber(),
                    issueDate:    now,
                    expiryDate:   now + 365 * 24 * 60 * 60 * 1000,
                    citizenSince: now,
                };
                await createCourtId(record);

                await sock.sendMessage(chatId, {
                    text:
                        `✅ *ID Registration Successful!*\n\n` +
                        `*${REGISTER_COST} coins* deducted.\n` +
                        `Generating your card...`,
                    ...channelInfo
                }, { quoted: message });

                const img = await buildCard(sock, senderId, chatId, record);
                return sock.sendMessage(chatId, {
                    image: img,
                    caption: `🪪 *${record.legalName}* — ${record.idNumber}\n_Expires: ${fmtDate(record.expiryDate)}_`,
                    ...channelInfo
                }, { quoted: message });

            } else {
                // Name/info update (500 coins)
                if (wallet.balance < UPDATE_COST) {
                    return sock.sendMessage(chatId, {
                        text: `❌ Changing your ID name costs *${UPDATE_COST} coins*.\nYour balance: *${wallet.balance} coins*.`,
                        ...channelInfo
                    }, { quoted: message });
                }
                wallet.balance -= UPDATE_COST;
                await saveWallet(wallet);
                await updateCourtIdName(senderId, parsed.name);

                const updated = { ...existing, legalName: parsed.name };
                await sock.sendMessage(chatId, {
                    text: `✅ Name updated to *${parsed.name}*. *${UPDATE_COST} coins* deducted.\nGenerating updated card...`,
                    ...channelInfo
                }, { quoted: message });

                const img = await buildCard(sock, senderId, chatId, updated);
                return sock.sendMessage(chatId, {
                    image: img,
                    caption: `🪪 *${updated.legalName}* — ${updated.idNumber}`,
                    ...channelInfo
                }, { quoted: message });
            }
        }
    },

    // ── .viewid ───────────────────────────────────────────────────────────────
    {
        command: 'viewid',
        aliases: ['checkid', 'idcard'],
        category: 'court',
        description: 'View a citizen\'s ID card',
        usage: '.viewid [@user]',
        groupOnly: true,

        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;

            let mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (mentioned?.includes('@lid')) mentioned = await resolveJid(sock, mentioned);
            const target = mentioned || senderId;

            const record = await getCourtId(target);
            if (!record) {
                const who = target === senderId ? 'You don\'t' : `@${cleanJid(target)} doesn't`;
                return sock.sendMessage(chatId, {
                    text: `🪪 ${who} have a registered citizen ID.\n\nRegister with *.registeredid <name> | <DOB> | <nationality>*`,
                    ...channelInfo
                }, { quoted: message });
            }

            const img = await buildCard(sock, target, chatId, record);
            return sock.sendMessage(chatId, {
                image: img,
                caption: `🪪 *${record.legalName}* — ${record.idNumber}`,
                mentions: mentioned ? [mentioned] : [],
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ── .registerchild ───────────────────────────────────────────────────────
    {
        command: 'registerchild',
        aliases: ['regchild', 'childid'],
        category: 'court',
        description: 'Register a citizen ID for your adopted child (150 coins)',
        usage: '.registerchild @child <Full Name> | <DD/MM/YYYY> | <Nationality>',
        groupOnly: true,

        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const CHILD_REG_COST = 150;

            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) {
                return sock.sendMessage(chatId, {
                    text: `❌ *Usage:* .registerchild @child <Name> | <DD/MM/YYYY> | <Nationality>\n\n_Example: .registerchild @child Sarah Cole | 14/03/2015 | Nigerian_`,
                    ...channelInfo
                }, { quoted: message });
            }

            if (target === senderId) {
                return sock.sendMessage(chatId, {
                    text: `❌ You cannot register yourself with this command. Use *.registeredid* instead.`,
                    ...channelInfo
                }, { quoted: message });
            }

            const parentRecord = await getCourtId(senderId);
            if (!parentRecord) {
                return sock.sendMessage(chatId, {
                    text: `❌ You need a registered citizen ID first. Use *.registeredid* to get yours.`,
                    ...channelInfo
                }, { quoted: message });
            }

            const { children } = await getFamily(senderId, chatId);
            if (!children.includes(target)) {
                return sock.sendMessage(chatId, {
                    text: `❌ @${cleanJid(target)} is not your adopted child. You can only register IDs for children in your family.`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }

            const existing = await getCourtId(target);
            if (existing) {
                return sock.sendMessage(chatId, {
                    text: `⚠️ @${cleanJid(target)} already has a registered citizen ID (*${existing.idNumber}*). No action needed.`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }

            const rawArgs = args.join(' ').replace(/^@\S+\s*/, '').trim();
            if (!rawArgs) {
                return sock.sendMessage(chatId, {
                    text: `❌ Please provide the child's details after the mention.\n\n*Usage:* .registerchild @child <Name> | <DD/MM/YYYY> | <Nationality>`,
                    ...channelInfo
                }, { quoted: message });
            }

            const parsed = parseArgs(rawArgs);
            if (!parsed) {
                return sock.sendMessage(chatId, {
                    text: `❌ *Invalid format.*\n\nUsage: *.registerchild @child <Full Name> | <DD/MM/YYYY> | <Nationality>*\nExample: *.registerchild @child Sarah Cole | 14/03/2015 | Nigerian*\n\n_Date must be in DD/MM/YYYY format._`,
                    ...channelInfo
                }, { quoted: message });
            }
            if (!validateDob(parsed.dob)) {
                return sock.sendMessage(chatId, {
                    text: `❌ Invalid date of birth *${parsed.dob}*. Use format *DD/MM/YYYY* (e.g. 14/03/2015).`,
                    ...channelInfo
                }, { quoted: message });
            }

            const wallet = await getWallet(senderId, message.pushName || cleanJid(senderId));
            if (wallet.balance < CHILD_REG_COST) {
                return sock.sendMessage(chatId, {
                    text: `❌ Registering a child's ID costs *${CHILD_REG_COST} coins*.\nYour balance: *${wallet.balance} coins*.`,
                    ...channelInfo
                }, { quoted: message });
            }

            wallet.balance -= CHILD_REG_COST;
            await saveWallet(wallet);

            const now = Date.now();
            const record: CourtIdRecord = {
                userId:       target,
                groupId:      chatId,
                legalName:    parsed.name,
                dob:          parsed.dob,
                nationality:  parsed.nationality,
                idNumber:     genIdNumber(),
                issueDate:    now,
                expiryDate:   now + 365 * 24 * 60 * 60 * 1000,
                citizenSince: now,
            };
            await createCourtId(record);

            await sock.sendMessage(chatId, {
                text:
`✅ *Child ID Registered!*

*${CHILD_REG_COST} coins* deducted from @${cleanJid(senderId)}'s wallet.
Generating @${cleanJid(target)}'s ID card...`,
                mentions: [senderId, target], ...channelInfo
            }, { quoted: message });

            const img = await buildCard(sock, target, chatId, record);
            return sock.sendMessage(chatId, {
                image: img,
                caption: `🪪 *${record.legalName}* — ${record.idNumber}\n_Guardian: @${cleanJid(senderId)} | Expires: ${fmtDate(record.expiryDate)}_`,
                mentions: [senderId], ...channelInfo
            }, { quoted: message });
        }
    },

    // ── .destroyid ────────────────────────────────────────────────────────────
    {
        command: 'destroyid',
        aliases: ['deletemyid', 'resetid', 'wipeid'],
        category: 'court',
        description: 'Permanently destroy your citizen ID so you can start fresh (300 coins)',
        usage: '.destroyid',
        groupOnly: true,

        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const DESTROY_COST = 300;

            const record = await getCourtId(senderId);
            if (!record) {
                return sock.sendMessage(chatId, {
                    text: `❌ You don't have a citizen ID to destroy.\n\nRegister one with *.registeredid*`,
                    ...channelInfo
                }, { quoted: message });
            }

            const wallet = await getWallet(senderId, message.pushName || cleanJid(senderId));
            if (wallet.balance < DESTROY_COST) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ❌ *DESTRUCTION FAILED*
╽
╽  ❏ *Reason:* Insufficient Funds
╽  ℹ️ Destroying your ID requires *${DESTROY_COST} coins*
╽  to cover the administrative processing fee.
╽
╽  💰 Your balance: *${wallet.balance} coins*
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    ...channelInfo
                }, { quoted: message });
            }

            const confirm = (args[0] || '').toLowerCase();
            if (confirm !== 'confirm') {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ⚠️ *ID DESTRUCTION WARNING*
╽
╽  ❏ *ID:* ${record.idNumber}
╽  ❏ *Name:* ${record.legalName}
╽  ❏ *Cost:* ${DESTROY_COST} coins (non-refundable)
╽
╽  This will *permanently delete* your citizen ID.
╽  All court records, memberships, and ID-linked
╽  privileges will be wiped.
╽
╽  You may re-register fresh afterwards.
╽
╽  📝 To confirm, type:
╽  *.destroyid confirm*
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    ...channelInfo
                }, { quoted: message });
            }

            wallet.balance -= DESTROY_COST;
            await saveWallet(wallet);
            await deleteCourtId(senderId);

            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🗑️ *ID DESTROYED*
╽
╽  ❏ *Destroyed:* ${record.idNumber}
╽  ❏ *Name:* ${record.legalName}
╽  ❏ *Fee Paid:* ${DESTROY_COST} coins
╽
╽  Your citizen ID has been permanently deleted.
╽  You are now a blank slate.
╽
╽  📝 Re-register anytime with:
╽  *.registeredid <Name> | <DOB> | <Nationality>*
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ── .renewid ──────────────────────────────────────────────────────────────
    {
        command: 'renewid',
        aliases: ['renewcard', 'extendid'],
        category: 'court',
        description: `Renew your citizen ID for another year (${RENEW_COST} coins)`,
        usage: '.renewid',
        groupOnly: true,

        async handler(sock: any, message: any, _args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;

            const record = await getCourtId(senderId);
            if (!record) {
                return sock.sendMessage(chatId, {
                    text: `❌ You don't have a citizen ID to renew.\n\nRegister first with *.registeredid*`,
                    ...channelInfo
                }, { quoted: message });
            }

            const wallet = await getWallet(senderId, message.pushName || cleanJid(senderId));
            if (wallet.balance < RENEW_COST) {
                return sock.sendMessage(chatId, {
                    text: `❌ Renewal costs *${RENEW_COST} coins*.\nYour balance: *${wallet.balance} coins*.`,
                    ...channelInfo
                }, { quoted: message });
            }

            wallet.balance -= RENEW_COST;
            await saveWallet(wallet);

            const newExpiry = Math.max(record.expiryDate, Date.now()) + 365 * 24 * 60 * 60 * 1000;
            await renewCourtId(senderId, newExpiry);

            const updated = { ...record, expiryDate: newExpiry };
            await sock.sendMessage(chatId, {
                text: `✅ ID renewed! *${RENEW_COST} coins* deducted.\nNew expiry: *${fmtDate(newExpiry)}*\nGenerating card...`,
                ...channelInfo
            }, { quoted: message });

            const img = await buildCard(sock, senderId, chatId, updated);
            return sock.sendMessage(chatId, {
                image: img,
                caption: `🪪 *${record.legalName}* — ${record.idNumber}\n_Valid until: ${fmtDate(newExpiry)}_`,
                ...channelInfo
            }, { quoted: message });
        }
    }
];
