import type { BotContext } from '../types.js';
import {
    grantCitizenship, revokeCitizenship, isCitizen, setAlias, getCitizen, getCitizenCount,
    proposeMarriage, getPendingProposal, acceptMarriage, getMarriage, divorce,
    adopt, disown, getFamily,
    createAdoptionRequest, getAdoptionRequest, deleteAdoptionRequest,
    getPayroll, claimDuty, addDutyPoints, logAudit, getAuditLog,
    getGroupSetting, setGroupSetting,
    startAdminVote, getAdminVote, castAdminVote, closeAdminVote,
    submitAppeal, getPendingAppeals,
    getCriminalRecord, clearCriminalRecord, getCourtId, isDeported
} from '../lib/turso2.js';
import { getWallet, saveWallet, getCourtVault, setCourtVault, isBlacklisted } from '../lib/turso.js';
import isOwnerOrSudo from '../lib/isOwner.js';
import { requireId, requireIdForBoth, getIdAge } from '../lib/idGate.js';
import config from '../config.js';

function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }
function fmt(n: number) { return n.toLocaleString(); }
function timeSince(ms: number) {
    const days = Math.floor(ms / 86400000);
    if (days > 365) return `${Math.floor(days / 365)}y`;
    if (days > 30) return `${Math.floor(days / 30)}mo`;
    if (days > 0) return `${days}d`;
    return `${Math.floor(ms / 3600000)}h`;
}

export default [

    // ─── CITIZENSHIP ──────────────────────────────────────────────────────────

    {
        command: 'citizen',
        aliases: ['makecitizen', 'grantcitizen'],
        category: 'court',
        description: 'Grant full citizenship to a user',
        usage: '.citizen @user',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .citizen @user`, ...channelInfo }, { quoted: message });
            if (await isCitizen(target, chatId)) return sock.sendMessage(chatId, { text: `⚠️ @${cleanJid(target)} is already a citizen.`, mentions: [target], ...channelInfo }, { quoted: message });
            await grantCitizenship(target, chatId);
            await addDutyPoints(senderId, chatId, 1);
            await sock.sendMessage(chatId, {
                text: `🏛️ *CITIZENSHIP GRANTED*\n\n@${cleanJid(target)} is now an *Official Citizen* of this group!\n\n` +
                      `✅ Full voting rights\n✅ Trial protections\n✅ Access to exclusive citizen commands\n\n` +
                      `_Set your legal name with_ *.alias [name]*`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'renounce',
        aliases: ['giveupcitizen', 'removecitizen'],
        category: 'court',
        description: 'Give up your citizenship voluntarily',
        usage: '.renounce',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (!await isCitizen(senderId, chatId)) return sock.sendMessage(chatId, { text: `❌ You are not a citizen.`, ...channelInfo }, { quoted: message });
            await revokeCitizenship(senderId, chatId);
            await sock.sendMessage(chatId, {
                text: `🏳️ @${cleanJid(senderId)} has *renounced their citizenship*.\n\n` +
                      `⚠️ You have lost:\n• Voting rights\n• Trial protections\n• Rob shield immunity\n\n_You can be re-granted citizenship by an admin._`,
                mentions: [senderId], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'alias',
        aliases: ['legalname', 'setname'],
        category: 'court',
        description: 'Set your legal name for court proceedings',
        usage: '.alias [name]',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const name = args.join(' ').trim();
            if (!name) return sock.sendMessage(chatId, { text: `❌ Usage: .alias [your legal name]`, ...channelInfo }, { quoted: message });
            if (name.length > 30) return sock.sendMessage(chatId, { text: `❌ Name too long (max 30 characters).`, ...channelInfo }, { quoted: message });
            await setAlias(senderId, chatId, name);
            await sock.sendMessage(chatId, { text: `✅ *Legal Name Set!*\n\nYour court identity is now: *"${name}"*\nThis will be used in all future trials and records.`, ...channelInfo }, { quoted: message });
        }
    },

    {
        command: 'id',
        aliases: ['passport', 'socialcard', 'profile'],
        category: 'court',
        description: 'View your social passport',
        usage: '.id [@user]',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || senderId;
            const [wallet, citizen, marriage, family, records, blacklisted] = await Promise.all([
                getWallet(target, cleanJid(target)),
                getCitizen(target, chatId),
                getMarriage(target, chatId),
                getFamily(target, chatId),
                getCriminalRecord(target, chatId),
                isBlacklisted(target)
            ]);
            const name = citizen?.alias || wallet.name || cleanJid(target);
            const status = blacklisted ? '🔴 OUTLAW' : citizen ? '🟢 CITIZEN' : '⚪ RESIDENT';
            let text = `┌─〔 🪪 𝐒𝐎𝐂𝐈𝐀𝐋 𝐏𝐀𝐒𝐒𝐏𝐎𝐑𝐓 〕──────┈⊷\n`;
            text += `┆  👤 *Name:* ${name}\n`;
            text += `┆  🆔 *ID:* ${cleanJid(target)}\n`;
            text += `┆  🏛️ *Status:* ${status}\n`;
            text += `┆  💰 *Balance:* ${fmt(wallet.balance + wallet.bank)} 🪙 (Lvl ${wallet.level})\n`;
            text += `┆  💍 *Marriage:* ${marriage ? `Married to @${cleanJid(marriage.partner)}` : 'Single'}\n`;
            text += `┆  👨‍👩‍👧 *Family:* ${family.children.length} child(ren), ${family.parents.length} parent(s)\n`;
            text += `┆  ⚖️ *Cases:* ${records.length} conviction(s)\n`;
            if (citizen) text += `┆  📅 *Citizen Since:* ${timeSince(Date.now() - citizen.granted_at)} ago\n`;
            text += `└──────────────────────────────────┈⊷`;
            await sock.sendMessage(chatId, { text, mentions: target !== senderId ? [target] : [], ...channelInfo }, { quoted: message });
        }
    },

    // ─── MARRIAGE & FAMILY ────────────────────────────────────────────────────

    {
        command: 'marry',
        aliases: ['propose', 'wed'],
        category: 'court',
        description: 'Propose a formal marriage',
        usage: '.marry @user',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .marry @user`, ...channelInfo }, { quoted: message });
            if (target === senderId) return sock.sendMessage(chatId, { text: `😭 You can't marry yourself.`, ...channelInfo }, { quoted: message });
            if (!await requireIdForBoth(sock, message, senderId, target, chatId, channelInfo, prefix)) return;
            const senderAge = await getIdAge(senderId, sock);
            const targetAge = await getIdAge(target, sock);
            if (senderAge !== null && senderAge < 16) {
                return sock.sendMessage(chatId, { text: `🔞 *Age Restricted*\n\nMarriage requires age *16+*. Your registered age: *${senderAge}*`, ...channelInfo }, { quoted: message });
            }
            if (targetAge !== null && targetAge < 16) {
                return sock.sendMessage(chatId, { text: `🔞 *Age Restricted*\n\n@${cleanJid(target)} is under 16 — marriage not permitted.`, mentions: [target], ...channelInfo }, { quoted: message });
            }
            if (await getMarriage(senderId, chatId)) return sock.sendMessage(chatId, { text: `💍 You are already married! Use *.divorce* first.`, ...channelInfo }, { quoted: message });
            if (await getMarriage(target, chatId)) return sock.sendMessage(chatId, { text: `💔 @${cleanJid(target)} is already married.`, mentions: [target], ...channelInfo }, { quoted: message });
            const id = await proposeMarriage(senderId, message.pushName || cleanJid(senderId), target, chatId);
            await sock.sendMessage(chatId, {
                text: `💍 *MARRIAGE PROPOSAL*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `@${cleanJid(senderId)} has proposed to @${cleanJid(target)}! 💕\n\n` +
                      `@${cleanJid(target)}: Reply with *.accept* to say YES 💒\n` +
                      `Or *.reject* to break their heart 💔\n\n_Proposal ID: #${id}_`,
                mentions: [senderId, target], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'accept',
        aliases: ['yes', 'ido'],
        category: 'court',
        description: 'Accept a marriage proposal',
        usage: '.accept',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const proposal = await getPendingProposal(senderId, chatId);
            if (!proposal) return sock.sendMessage(chatId, { text: `❌ You have no pending marriage proposal.`, ...channelInfo }, { quoted: message });
            if (await getMarriage(senderId, chatId)) return sock.sendMessage(chatId, { text: `💍 You are already married!`, ...channelInfo }, { quoted: message });
            const result = await acceptMarriage(proposal.id, chatId);
            if (!result) return sock.sendMessage(chatId, { text: `❌ Something went wrong. Try again.`, ...channelInfo }, { quoted: message });
            const allMembers: string[] = [];
            try { const m = await sock.groupMetadata(chatId); m.participants.forEach((p: any) => allMembers.push(p.id)); } catch {}
            await sock.sendMessage(chatId, {
                text: `🎊 *MARRIAGE ANNOUNCEMENT* 🎊\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `💒 @${cleanJid(result.user1)} and @${cleanJid(result.user2)} are now *OFFICIALLY MARRIED!* 💍\n\n` +
                      `May your union be blessed! 🥂✨`,
                mentions: [result.user1, result.user2, ...allMembers], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'reject',
        aliases: ['no', 'idont'],
        category: 'court',
        description: 'Reject a marriage proposal',
        usage: '.reject',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const proposal = await getPendingProposal(senderId, chatId);
            if (!proposal) return sock.sendMessage(chatId, { text: `❌ You have no pending marriage proposal.`, ...channelInfo }, { quoted: message });
            const c = (await import('../lib/turso.js')).getDb();
            await c.execute({ sql: `UPDATE marriage_proposals SET status = 'rejected' WHERE id = ?`, args: [proposal.id] });
            await sock.sendMessage(chatId, {
                text: `💔 @${cleanJid(senderId)} has *rejected* @${cleanJid(proposal.proposer)}'s proposal.\n\n_That one hurt different... 😢_`,
                mentions: [senderId, proposal.proposer], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'divorce',
        aliases: ['splitup', 'breakup'],
        category: 'court',
        description: 'End your marriage and split assets',
        usage: '.divorce',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            if (!await requireId(sock, message, senderId, chatId, channelInfo, prefix)) return;
            const marriage = await getMarriage(senderId, chatId);
            if (!marriage) return sock.sendMessage(chatId, { text: `❌ You are not married.`, ...channelInfo }, { quoted: message });
            await divorce(senderId, chatId);
            const [myWallet, partnerWallet] = await Promise.all([
                getWallet(senderId, message.pushName || cleanJid(senderId)),
                getWallet(marriage.partner, cleanJid(marriage.partner))
            ]);
            const alimony = Math.floor(myWallet.balance * 0.1);
            myWallet.balance -= alimony;
            partnerWallet.balance += alimony;
            await Promise.all([saveWallet(myWallet), saveWallet(partnerWallet)]);
            await sock.sendMessage(chatId, {
                text: `💔 *DIVORCE FINALIZED*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `@${cleanJid(senderId)} and @${cleanJid(marriage.partner)} are now *divorced*.\n\n` +
                      `💸 *Alimony paid:* ${fmt(alimony)} 🪙 to @${cleanJid(marriage.partner)}\n` +
                      `_It's not you, it's me. Actually it's you. 🚪_`,
                mentions: [senderId, marriage.partner], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'adopt',
        aliases: ['adoptchild', 'parentup'],
        category: 'court',
        description: 'Adopt a user into your family',
        usage: '.adopt @user',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: ${prefix}adopt @user`, ...channelInfo }, { quoted: message });
            if (target === senderId) return sock.sendMessage(chatId, { text: `🤦 You can't adopt yourself.`, ...channelInfo }, { quoted: message });

            // ── 1. PARENT ELIGIBILITY ───────────────────────────────────────
            const parentId = await getCourtId(senderId);
            if (!parentId) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ❌ *ADOPTION DENIED*
╽
╽  ❏ *Status:* Identity Not Verified
╽  ℹ️ You cannot adopt a child without a
╽  registered Citizen ID and Bank Card.
╽
╽  📝 Use *${prefix}registeredid* to fix this.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    ...channelInfo
                }, { quoted: message });
            }

            const parentWallet = await getWallet(senderId, message.pushName || cleanJid(senderId));
            if (parentWallet.bank < 5000) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ❌ *ADOPTION DENIED*
╽
╽  ❏ *Status:* Insufficient Funds
╽  ℹ️ You must have at least *5,000* coins in
╽  your bank account to cover legal fees
╽  and initial support for a new child.
╽
╽  💰 Current Balance too low.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    ...channelInfo
                }, { quoted: message });
            }

            const [parentBanned, parentDeported] = await Promise.all([
                isBlacklisted(senderId),
                isDeported(senderId, chatId)
            ]);
            if (parentBanned || parentDeported) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ❌ *ADOPTION DENIED*
╽
╽  ❏ *Status:* Judicial Blacklist
╽  ℹ️ Your application is blocked due to
╽  active court violations or banishment status.
╽  Criminals cannot be legal guardians.
╽
╽  ⚖️ Resolve your legal standing first.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    ...channelInfo
                }, { quoted: message });
            }

            const { children: existingKids } = await getFamily(senderId, chatId);
            if (existingKids.length >= 5) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ❌ *ADOPTION DENIED*
╽
╽  ❏ *Status:* Maximum Capacity Reached
╽  ℹ️ You already have *5* children registered.
╽  The law prevents further adoptions until a
╽  slot becomes available.
╽
╽  🗑️ Use *${prefix}unadopt* to remove a dependent.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    ...channelInfo
                }, { quoted: message });
            }

            // ── 2. CHILD ELIGIBILITY ────────────────────────────────────────
            if (existingKids.includes(target)) {
                return sock.sendMessage(chatId, { text: `⚠️ @${cleanJid(target)} is already in your family.`, mentions: [target], ...channelInfo }, { quoted: message });
            }

            const { parents: childParents } = await getFamily(target, chatId);
            if (childParents.length >= 2) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ❌ *ADOPTION DENIED*
╽
╽  ❏ *Status:* Full Household
╽  ℹ️ @${cleanJid(target)} already has *2* registered
╽  parents and cannot be adopted by
╽  another guardian.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }

            // ── 3. AGE / ID ROUTING ─────────────────────────────────────────
            const childAge = await getIdAge(target, sock);

            // Scenario 3 — No child ID: instant adopt, warn parent to register
            if (childAge === null) {
                await adopt(senderId, target, chatId);
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🎊 *ADOPTION FINALIZED* 🎊
╽
╽  ❏ *Parent:* @${cleanJid(senderId)}
╽  ❏ *Child:* @${cleanJid(target)}
╽
╽  @${cleanJid(target)} has officially joined the family!
╽  You now receive a *+5% Income Bonus*.
╽
╽  ⚠️ *ID REGISTRATION REQUIRED*
╽  This child does not have a registered ID.
╽  @${cleanJid(senderId)}, you must purchase their ID
╽  within the next *24 hours*.
╽
╽  📝 *Command:*
╽  ${prefix}registerchild @${cleanJid(target)} <Name> | <DOB> | <Nationality>
╽
╽  🏠 Welcome to the family, @${cleanJid(target)}!
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [senderId, target], ...channelInfo
                }, { quoted: message });
            }

            // Age >= 20 → Legal Adult denial
            if (childAge >= 20) {
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ❌ *ADOPTION DENIED*
╽
╽  ❏ *Status:* Legal Adult
╽  ℹ️ @${cleanJid(target)} is *${childAge} years old* and is
╽  considered a legal adult. They can
╽  no longer be adopted as a dependent.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }

            // Age < 15 → Scenario 1: Instant adoption
            if (childAge < 15) {
                await adopt(senderId, target, chatId);
                return sock.sendMessage(chatId, {
                    text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ✨ *ADOPTION CONFIRMED* ✨
╽
╽  ❏ *Guardian:* @${cleanJid(senderId)}
╽  ❏ *Dependent:* @${cleanJid(target)}
╽
╽  🎊 The paperwork is finalized!
╽  @${cleanJid(senderId)}, you are now officially responsible
╽  for @${cleanJid(target)}'s growth and well-being.
╽
╽  💳 *Financial Support:*
╽  Start their legacy by setting an allowance:
╽  ${prefix}allowance @${cleanJid(target)} [amount] [daily/weekly]
╽
╽  🏠💕 Welcome to the family, @${cleanJid(target)}!
╽  May your stay be long and prosperous.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                    mentions: [senderId, target], ...channelInfo
                }, { quoted: message });
            }

            // Age 15-19 → Scenario 2: Consent required
            await createAdoptionRequest(senderId, target, chatId);
            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ✨ *ADOPTION REQUESTED* ✨
╽
╽  ❏ *Guardian:* @${cleanJid(senderId)}
╽  ❏ *Dependent:* @${cleanJid(target)}
╽
╽  ⚖️ *Legal Consent Required*
╽  @${cleanJid(target)}, as you are above the age of 15,
╽  your formal consent is required to
╽  finalize this bond.
╽
╽  📩 *Action Required:*
╽  @${cleanJid(target)}, please use the following:
╽  Type *${prefix}acceptp* to join the family.
╽  Type *${prefix}denyp* to remain independent.
╽
╽  ⏳ Pending @${cleanJid(target)}'s decision...
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [senderId, target], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'acceptp',
        aliases: ['acceptparent', 'acceptadopt'],
        category: 'court',
        description: 'Accept a pending adoption request',
        usage: '.acceptp',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            const ok = await requireId(sock, message, senderId, chatId, channelInfo, prefix);
            if (!ok) return;

            const request = await getAdoptionRequest(senderId, chatId);
            if (!request) {
                return sock.sendMessage(chatId, {
                    text: `❌ You have no pending adoption request in this group.`,
                    ...channelInfo
                }, { quoted: message });
            }

            await deleteAdoptionRequest(senderId, chatId);
            await adopt(request.parent_id, senderId, chatId);

            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ✨ *ADOPTION CONFIRMED* ✨
╽
╽  ❏ *Guardian:* @${cleanJid(request.parent_id)}
╽  ❏ *Dependent:* @${cleanJid(senderId)}
╽
╽  🎊 The paperwork is finalized!
╽  @${cleanJid(request.parent_id)}, you are now officially responsible
╽  for @${cleanJid(senderId)}'s growth and well-being.
╽
╽  💳 *Financial Support:*
╽  Start their legacy by setting an allowance:
╽  ${prefix}allowance @${cleanJid(senderId)} [amount] [daily/weekly]
╽
╽  🏠💕 Welcome to the family, @${cleanJid(senderId)}!
╽  May your stay be long and prosperous.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [request.parent_id, senderId], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'denyp',
        aliases: ['denyparent', 'denyadopt', 'rejectp'],
        category: 'court',
        description: 'Deny a pending adoption request',
        usage: '.denyp',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            const ok = await requireId(sock, message, senderId, chatId, channelInfo, prefix);
            if (!ok) return;

            const request = await getAdoptionRequest(senderId, chatId);
            if (!request) {
                return sock.sendMessage(chatId, {
                    text: `❌ You have no pending adoption request in this group.`,
                    ...channelInfo
                }, { quoted: message });
            }

            await deleteAdoptionRequest(senderId, chatId);
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ❌ *ADOPTION DECLINED*
╽
╽  ❏ *Status:* Rejected by Dependent
╽  ℹ️ @${cleanJid(senderId)} has declined the adoption offer.
╽  They wish to remain independent.
╽
╽  😔 Respect their decision.
┕━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [request.parent_id, senderId], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'disown',
        aliases: ['unadopt', 'disownchild'],
        category: 'court',
        description: 'Remove a user from your family',
        usage: '.disown @user',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .disown @user`, ...channelInfo }, { quoted: message });
            const removed = await disown(senderId, target, chatId);
            if (!removed) return sock.sendMessage(chatId, { text: `❌ @${cleanJid(target)} is not in your family.`, mentions: [target], ...channelInfo }, { quoted: message });
            await sock.sendMessage(chatId, {
                text: `🏚️ @${cleanJid(senderId)} has *disowned* @${cleanJid(target)}.\n_This is not a light decision. 😔_`,
                mentions: [senderId, target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── ADMIN GOVERNANCE ─────────────────────────────────────────────────────

    {
        command: 'adminreq',
        aliases: ['adminapply', 'requestadmin'],
        category: 'court',
        description: 'Request to be considered for admin promotion',
        usage: '.adminreq',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const allMembers: string[] = [];
            try {
                const m = await sock.groupMetadata(chatId);
                m.participants.filter((p: any) => p.admin).forEach((p: any) => allMembers.push(p.id));
            } catch {}
            await sock.sendMessage(chatId, {
                text: `📋 *ADMIN PROMOTION REQUEST*\n\n@${cleanJid(senderId)} (*${message.pushName || cleanJid(senderId)}*) has formally requested to be considered for admin promotion.\n\n` +
                      `Admins: Use *.adminvote @${cleanJid(senderId)}* to start the voting process.`,
                mentions: [senderId, ...allMembers], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'adminvote',
        aliases: ['voteadmin', 'adminpoll'],
        category: 'court',
        description: 'Start an admin vote for user promotion (admin only)',
        usage: '.adminvote @user',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .adminvote @user`, ...channelInfo }, { quoted: message });
            const existing = await getAdminVote(chatId, target);
            if (existing) return sock.sendMessage(chatId, { text: `⚠️ A vote for @${cleanJid(target)} is already in progress.`, mentions: [target], ...channelInfo }, { quoted: message });
            await startAdminVote(chatId, target, message.message?.extendedTextMessage?.contextInfo?.pushName || cleanJid(target), senderId);
            const adminMembers: string[] = [];
            try { const m = await sock.groupMetadata(chatId); m.participants.filter((p: any) => p.admin).forEach((p: any) => adminMembers.push(p.id)); } catch {}
            await sock.sendMessage(chatId, {
                text: `🗳️ *ADMIN PROMOTION VOTE*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `*Candidate:* @${cleanJid(target)}\n\n` +
                      `All admins cast your vote:\n• *.castadminvote @${cleanJid(target)}* — Vote YES\n\n` +
                      `Started by @${cleanJid(senderId)} | Requires majority of admins to pass.`,
                mentions: [target, senderId, ...adminMembers], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'castadminvote',
        aliases: ['yesadmin', 'voteyes'],
        category: 'court',
        description: 'Cast your vote in an admin promotion poll',
        usage: '.castadminvote @user',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .castadminvote @user`, ...channelInfo }, { quoted: message });
            const vote = await getAdminVote(chatId, target);
            if (!vote) return sock.sendMessage(chatId, { text: `❌ No active admin vote for @${cleanJid(target)}.`, mentions: [target], ...channelInfo }, { quoted: message });
            const newVotes = await castAdminVote(vote.id, senderId);
            let adminCount = 2;
            try { const m = await sock.groupMetadata(chatId); adminCount = m.participants.filter((p: any) => p.admin).length; } catch {}
            const majority = Math.ceil(adminCount / 2);
            if (newVotes.length >= majority) {
                await closeAdminVote(vote.id);
                try { await sock.groupParticipantsUpdate(chatId, [target], 'promote'); } catch {}
                await addDutyPoints(senderId, chatId, 5);
                await sock.sendMessage(chatId, {
                    text: `🎉 *PROMOTION APPROVED!*\n\n@${cleanJid(target)} has been *promoted to admin!* 👑\n_${newVotes.length}/${adminCount} admins voted YES._`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            } else {
                await sock.sendMessage(chatId, { text: `✅ Vote recorded! *${newVotes.length}/${majority}* votes needed for majority.`, ...channelInfo }, { quoted: message });
            }
        }
    },

    {
        command: 'promote',
        aliases: ['makeadmin'],
        category: 'court',
        description: 'Manually promote a user to admin (admin only)',
        usage: '.promote @user',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .promote @user`, ...channelInfo }, { quoted: message });
            try {
                await sock.groupParticipantsUpdate(chatId, [target], 'promote');
                await addDutyPoints(senderId, chatId, 3);
                await sock.sendMessage(chatId, {
                    text: `👑 @${cleanJid(target)} has been *manually promoted to admin* by @${cleanJid(senderId)}! 🎖️`,
                    mentions: [target, senderId], ...channelInfo
                }, { quoted: message });
            } catch (e: any) {
                await sock.sendMessage(chatId, { text: `❌ Failed to promote: ${e.message}`, ...channelInfo }, { quoted: message });
            }
        }
    },

    {
        command: 'impeach',
        aliases: ['removeadmin', 'demote'],
        category: 'court',
        description: 'Start a vote to remove an admin\'s authority (admin only)',
        usage: '.impeach @admin',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .impeach @admin`, ...channelInfo }, { quoted: message });
            if (target === senderId) return sock.sendMessage(chatId, { text: `😂 You can't impeach yourself.`, ...channelInfo }, { quoted: message });
            if (await isOwnerOrSudo(target)) return sock.sendMessage(chatId, { text: `❌ The bot owner cannot be impeached.`, ...channelInfo }, { quoted: message });
            let adminMembers: string[] = [];
            try { const m = await sock.groupMetadata(chatId); adminMembers = m.participants.filter((p: any) => p.admin && p.id !== target).map((p: any) => p.id); } catch {}
            await sock.sendMessage(chatId, {
                text: `⚠️ *IMPEACHMENT MOTION*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `@${cleanJid(senderId)} has moved to *impeach* @${cleanJid(target)}!\n\n` +
                      `Admins: Use *.castimpeach @${cleanJid(target)}* to vote for removal.\nMajority required to proceed.`,
                mentions: [target, senderId, ...adminMembers], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── ECONOMY GOVERNANCE ───────────────────────────────────────────────────

    {
        command: 'tax',
        aliases: ['settax', 'taxrate'],
        category: 'court',
        description: 'Set transaction tax rate for the group (owner only)',
        usage: '.tax [0-20]',
        ownerOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const rate = parseInt(args[0]);
            if (isNaN(rate) || rate < 0 || rate > 20) return sock.sendMessage(chatId, { text: `❌ Usage: .tax [0-20]\n\nSets transaction tax percentage (0 = off, max 20%)`, ...channelInfo }, { quoted: message });
            await setGroupSetting(chatId, 'tax_rate', String(rate));
            await sock.sendMessage(chatId, {
                text: `💸 *Tax Rate ${rate === 0 ? 'Disabled' : 'Updated'}!*\n\n${rate === 0 ? '✅ Transactions are now tax-free.' : `*${rate}%* will be collected from all coin transactions into the group vault.`}`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'payout',
        aliases: ['stimulus', 'distribute'],
        category: 'court',
        description: 'Distribute vault coins to all citizens (admin only)',
        usage: '.payout [amount per person]',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const amount = parseInt(args[0]);
            if (isNaN(amount) || amount <= 0) return sock.sendMessage(chatId, { text: `❌ Usage: .payout [amount per citizen]`, ...channelInfo }, { quoted: message });
            const c = (await import('../lib/turso.js')).getDb();
            const citizenRes = await c.execute({ sql: `SELECT user_id FROM citizens WHERE group_id = ?`, args: [chatId] });
            const citizens = citizenRes.rows.map(r => r.user_id as string);
            if (!citizens.length) return sock.sendMessage(chatId, { text: `❌ No citizens in this group yet.`, ...channelInfo }, { quoted: message });
            const total = amount * citizens.length;
            const vault = await getCourtVault();
            if (vault < total) return sock.sendMessage(chatId, { text: `❌ Vault only has *${fmt(vault)} 🪙* but needs *${fmt(total)} 🪙* for ${citizens.length} citizens.`, ...channelInfo }, { quoted: message });
            await Promise.all(citizens.map(async (uid) => {
                const w = await getWallet(uid, cleanJid(uid));
                w.balance += amount;
                return saveWallet(w);
            }));
            await setCourtVault(vault - total);
            await logAudit(senderId, message.pushName || cleanJid(senderId), chatId, 'payout', total);
            await addDutyPoints(senderId, chatId, 5);
            await sock.sendMessage(chatId, {
                text: `💰 *STIMULUS PAYOUT!*\n\nDistributed *${fmt(amount)} 🪙* to each of *${citizens.length} citizens*!\n` +
                      `💸 *Total distributed:* ${fmt(total)} 🪙\n🏦 *Vault remaining:* ${fmt(vault - total)} 🪙`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'payroll',
        aliases: ['dutyreport', 'adminpay'],
        category: 'court',
        description: 'View admin duty points and earnings (owner only)',
        usage: '.payroll',
        ownerOnly: true,
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const list = await getPayroll(chatId);
            if (!list.length) return sock.sendMessage(chatId, { text: `📊 No duty points recorded yet.`, ...channelInfo }, { quoted: message });
            let text = `📊 *ADMIN PAYROLL REPORT*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            list.forEach((a, i) => {
                text += `*${i + 1}.* @${cleanJid(a.user_id)}\n`;
                text += `   ⭐ Duty Points: ${a.duty_points} | 💰 Pending: ${fmt(a.pending_coins)} 🪙\n\n`;
            });
            text += `_Admins use *.claim* to collect earnings_`;
            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        }
    },

    {
        command: 'claim',
        aliases: ['collectpay', 'claimduty'],
        category: 'court',
        description: 'Claim your admin duty earnings from the vault',
        usage: '.claim',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const coins = await claimDuty(senderId, chatId);
            if (!coins) return sock.sendMessage(chatId, { text: `❌ You have no pending duty earnings to claim.`, ...channelInfo }, { quoted: message });
            const vault = await getCourtVault();
            if (vault < coins) return sock.sendMessage(chatId, { text: `❌ Vault only has *${fmt(vault)} 🪙*. Not enough for your claim of *${fmt(coins)} 🪙*.`, ...channelInfo }, { quoted: message });
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            w.balance += coins;
            await Promise.all([saveWallet(w), setCourtVault(vault - coins)]);
            await logAudit(senderId, message.pushName || cleanJid(senderId), chatId, 'claim', coins);
            await sock.sendMessage(chatId, {
                text: `💵 *Duty Pay Claimed!*\n\n+${fmt(coins)} 🪙 transferred to your wallet.\n💵 *New balance:* ${fmt(w.balance)} 🪙\n_Duty points reset to 0. Keep serving! 💪_`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'salaryset',
        aliases: ['setpay', 'setsalary'],
        category: 'court',
        description: 'Set coins per duty point (owner only)',
        usage: '.salaryset [amount]',
        ownerOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const amount = parseInt(args[0]);
            if (isNaN(amount) || amount < 1) return sock.sendMessage(chatId, { text: `❌ Usage: .salaryset [coins per duty point]\n\nDefault is 10 🪙 per point.`, ...channelInfo }, { quoted: message });
            await setGroupSetting(chatId, 'salary_per_point', String(amount));
            await sock.sendMessage(chatId, {
                text: `💰 *Salary Set!*\n\nAdmins now earn *${fmt(amount)} 🪙* per duty point.\n_Applies to new points earned going forward._`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'audit',
        aliases: ['auditlog', 'vaultlog'],
        category: 'court',
        description: 'View vault transaction audit log (owner only)',
        usage: '.audit',
        ownerOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const logs = await getAuditLog(chatId, 20);
            if (!logs.length) return sock.sendMessage(chatId, { text: `📋 No audit records yet.`, ...channelInfo }, { quoted: message });
            let text = `🔍 *VAULT AUDIT LOG*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            logs.slice(0, 15).forEach(l => {
                const date = new Date(l.timestamp).toLocaleString();
                text += `• *${l.admin_name}* — ${l.action} — ${fmt(l.amount)} 🪙\n  📅 ${date}\n\n`;
            });
            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        }
    },

    // ─── APPEALS (OWNER VIEW) ─────────────────────────────────────────────────

    {
        command: 'viewappeals',
        aliases: ['appeals', 'pendingappeals'],
        category: 'court',
        description: 'View all pending anonymous appeals (owner only)',
        usage: '.viewappeals',
        ownerOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const appeals = await getPendingAppeals();
            if (!appeals.length) return sock.sendMessage(chatId, { text: `✅ No pending appeals.`, ...channelInfo }, { quoted: message });
            let text = `📬 *ANONYMOUS APPEALS*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            appeals.forEach((a, i) => {
                text += `*#${a.id}* — Case: *${a.case_id}*\n📜 Reason: ${a.reason}\n\n`;
            });
            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        }
    },

    // ─── VISA ─────────────────────────────────────────────────────────────────

    {
        command: 'visa',
        aliases: ['getpassport', 'travelpass'],
        category: 'economy',
        description: 'Purchase a travel visa to visit other group countries',
        usage: '.visa',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const VISA_COST = 500;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            if (w.balance < VISA_COST) return sock.sendMessage(chatId, { text: `❌ A visa costs *${fmt(VISA_COST)} 🪙*.\nYou only have *${fmt(w.balance)} 🪙*.`, ...channelInfo }, { quoted: message });
            if (w.inventory.includes('visa')) return sock.sendMessage(chatId, { text: `🛂 You already have an active *Visa*! It's stored in your inventory.`, ...channelInfo }, { quoted: message });
            w.balance -= VISA_COST;
            w.inventory.push('visa');
            await saveWallet(w);
            const vaultAmt = await getCourtVault();
            await setCourtVault(vaultAmt + Math.floor(VISA_COST * 0.2));
            await sock.sendMessage(chatId, {
                text: `🛂 *VISA ISSUED!*\n\nYou've purchased an *Official Group Visa* for ${fmt(VISA_COST)} 🪙!\n\n` +
                      `✅ You can now visit partner groups and access cross-group features.\n` +
                      `📋 Visa stored in your _.inventory_`,
                ...channelInfo
            }, { quoted: message });
        }
    },
];
