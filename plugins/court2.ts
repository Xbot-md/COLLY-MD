import type { BotContext } from '../types.js';
import {
    getRules, addRule, deleteRule, addProposal, getPendingProposals, resolveProposal,
    recordPlead, getPlead,
    addMute, getMute, removeMute, getMutedUsers,
    assignLabor, getLabor, assignDare, getDare, verifyTask, clearTask, getPendingTasks,
    addCriminalRecord, getCriminalRecord, clearCriminalRecord, getRecentTrials,
    addDutyPoints, submitBribe, getPendingBribe, resolveBribe, submitAppeal,
    setCaseMeta, getCaseMeta, deleteCaseMeta
} from '../lib/turso2.js';
import { isBlacklisted, getCase, getBlacklist, getActiveCases, getWallet, saveWallet, getCourtVault, setCourtVault, updateCase } from '../lib/turso.js';
import { cancelCaseTimers, startEvidenceTimer } from '../lib/courtTimers.js';
import { DEFAULT_RULES } from '../lib/defaultRules.js';

function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }
function fmt(n: number) { return n.toLocaleString(); }
function timeLeft(ms: number) {
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    return `${m}m`;
}

const LABOR_TASKS = [
    'Type the national anthem of your country (full version)',
    'Count to 100 in a language you don\'t speak',
    'Write a 5-sentence apology to the group',
    'Spell out 20 group members\' usernames without copy-paste',
    'Type a full motivational speech (at least 10 lines)',
    'Recite the alphabet backwards',
    'List 15 capital cities of the world',
    'Write a poem about the group (4 stanzas minimum)',
    'Type out 50 emojis, each on a new line, with their meaning',
    'Summarize the last 10 group conversations in 1 sentence each',
];

const DARE_TASKS = [
    'Change your WhatsApp name to "Court Criminal" for 30 minutes and send proof',
    'Send a voice note saying "I am guilty, please have mercy on me" 🙏',
    'Send a selfie making the most embarrassing face you can',
    'Post your current Spotify/music playing or admit you have no taste',
    'Write "I am a clown 🤡" as your WhatsApp status and send a screenshot',
    'Tag 5 people and tell each one something positive about them',
    'Voice note: introduce yourself as if you\'re applying for a job in this group',
    'Share the most embarrassing photo from 2+ years ago in your gallery',
    'Send a 30-second voice note in an accent that isn\'t yours',
    'Type your deepest unpopular opinion about this group (no soft-pedalling)',
];

export default [

    // ─── RULES ────────────────────────────────────────────────────────────────

    {
        command: 'rules',
        aliases: ['statutes', 'laws', 'constitution'],
        category: 'court',
        description: 'View the group\'s legal rules',
        usage: '.rules [page]',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const D = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

            const dbRules = await getRules(chatId);
            // Build merged list: DEFAULT_RULES §1-70 (or DB overrides if seeded) + any custom DB rules §71+
            const hasSeeded = dbRules.some(r => r.rule_num <= 70);
            const customRules = dbRules.filter(r => r.rule_num > 70);

            type RuleEntry = { rule_num: number; text: string };
            let allRules: RuleEntry[];
            if (hasSeeded) {
                // Group ran .setupcourt — use full DB (may have edits/overrides)
                allRules = dbRules;
            } else {
                // Use default constitution + any custom additions
                allRules = [
                    ...DEFAULT_RULES.map(r => ({ rule_num: r.num, text: `${r.text} | _Penalty: ${r.penalty}_` })),
                    ...customRules
                ];
            }

            const PAGE_SIZE = 15;
            const page = Math.max(1, parseInt(args[0] ?? '1') || 1);
            const totalPages = Math.ceil(allRules.length / PAGE_SIZE);
            const slice = allRules.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

            let text = `⚖️ *COLLY CONSTITUTION* ⚖️\n${D}\n`;
            text += `📄 Page ${page}/${totalPages} • ${allRules.length} Laws Total\n${D}\n\n`;
            slice.forEach(r => { text += `*§${r.rule_num}.* ${r.text}\n\n`; });
            text += `${D}\n`;
            if (totalPages > 1) text += `_Type *.rules ${page < totalPages ? page + 1 : 1}* for next page_\n`;
            text += `_Use *.sue @user §<number>* to cite a law_\n`;
            if (!hasSeeded && customRules.length === 0) {
                text += `\n💡 _Run *.setupcourt* to seed these rules into this group's DB_`;
            }
            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        }
    },

    {
        command: 'addrule',
        aliases: ['newlaw', 'addlaw'],
        category: 'court',
        description: 'Add a new group law (admin only)',
        usage: '.addrule [text]',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const text = args.join(' ').trim();
            if (!text) return sock.sendMessage(chatId, { text: `❌ Usage: .addrule [law text]`, ...channelInfo }, { quoted: message });
            const num = await addRule(chatId, text);
            await sock.sendMessage(chatId, {
                text: `⚖️ *Law Added!*\n\n*§${num}.* ${text}\n\n_Law is now active. Violations can be charged using_ *.sue @user §${num}*`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'delrule',
        aliases: ['removelaw', 'deletelaw'],
        category: 'court',
        description: 'Remove a law by number (admin only)',
        usage: '.delrule [number]',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const num = parseInt(args[0]);
            if (isNaN(num)) return sock.sendMessage(chatId, { text: `❌ Usage: .delrule [rule number]`, ...channelInfo }, { quoted: message });
            const removed = await deleteRule(chatId, num);
            if (!removed) return sock.sendMessage(chatId, { text: `❌ Rule §${num} not found.`, ...channelInfo }, { quoted: message });
            await sock.sendMessage(chatId, { text: `✅ *Law §${num} has been repealed.*\nAll remaining laws renumbered.`, ...channelInfo }, { quoted: message });
        }
    },

    {
        command: 'request',
        aliases: ['proposerule', 'suggestrule'],
        category: 'court',
        description: 'Propose a new rule for admin approval',
        usage: '.request [text]',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const text = args.join(' ').trim();
            if (!text) return sock.sendMessage(chatId, { text: `❌ Usage: .request [proposed rule text]`, ...channelInfo }, { quoted: message });
            const id = await addProposal(chatId, senderId, message.pushName || cleanJid(senderId), text);
            await sock.sendMessage(chatId, {
                text: `📝 *Rule Proposal Submitted!*\n\nProposal #${id}: _"${text}"_\n\nAdmins can use *.approve ${id}* or *.rejectrule ${id}*`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'approve',
        aliases: ['approveprop'],
        category: 'court',
        description: 'Approve a rule proposal (admin only)',
        usage: '.approve [proposal-id]',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const id = parseInt(args[0]);
            if (isNaN(id)) return sock.sendMessage(chatId, { text: `❌ Usage: .approve [proposal-id]\n\nUse *.proposals* to see pending proposals.`, ...channelInfo }, { quoted: message });
            const result = await resolveProposal(id, 'approved');
            if (!result) return sock.sendMessage(chatId, { text: `❌ Proposal #${id} not found or already resolved.`, ...channelInfo }, { quoted: message });
            const rules = await getRules(chatId);
            const num = rules.length;
            await sock.sendMessage(chatId, {
                text: `✅ *Proposal #${id} Approved!*\n\nAdded as *§${num}:* _"${result.text}"_\n\n_The group constitution has been updated._`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'rejectrule',
        aliases: ['rejectprop', 'denyproposal'],
        category: 'court',
        description: 'Reject a rule proposal (admin only)',
        usage: '.rejectrule [proposal-id]',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const id = parseInt(args[0]);
            if (isNaN(id)) return sock.sendMessage(chatId, { text: `❌ Usage: .rejectrule [proposal-id]`, ...channelInfo }, { quoted: message });
            const result = await resolveProposal(id, 'rejected');
            if (!result) return sock.sendMessage(chatId, { text: `❌ Proposal #${id} not found or already resolved.`, ...channelInfo }, { quoted: message });
            await sock.sendMessage(chatId, { text: `❌ *Proposal #${id} Rejected.*\n_"${result.text}"_ has been dismissed.`, ...channelInfo }, { quoted: message });
        }
    },

    {
        command: 'proposals',
        aliases: ['pendingproposals', 'viewproposals'],
        category: 'court',
        description: 'View pending rule proposals',
        usage: '.proposals',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const list = await getPendingProposals(chatId);
            if (!list.length) return sock.sendMessage(chatId, { text: `📋 No pending rule proposals.`, ...channelInfo }, { quoted: message });
            let text = `📋 *Pending Rule Proposals*\n━━━━━━━━━━━━━━━━\n\n`;
            list.forEach(p => { text += `*#${p.id}* by ${p.proposer_name}:\n_"${p.text}"_\n\n`; });
            text += `Use *.approve [id]* or *.rejectrule [id]*`;
            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        }
    },

    {
        command: 'rulepropose',
        aliases: ['referendum', 'groupvote'],
        category: 'court',
        description: 'Start a democratic referendum for a major change',
        usage: '.rulepropose [text]',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const text = args.join(' ').trim();
            if (!text) return sock.sendMessage(chatId, { text: `❌ Usage: .rulepropose [proposed change]`, ...channelInfo }, { quoted: message });
            const id = await addProposal(chatId, senderId, message.pushName || cleanJid(senderId), `[REFERENDUM] ${text}`);
            const allMembers: string[] = [];
            try {
                const meta = await sock.groupMetadata(chatId);
                meta.participants.forEach((p: any) => allMembers.push(p.id));
            } catch {}
            await sock.sendMessage(chatId, {
                text: `🗳️ *DEMOCRATIC REFERENDUM #${id}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `📜 *Proposal:* "${text}"\n` +
                      `👤 *Proposed by:* ${message.pushName || cleanJid(senderId)}\n\n` +
                      `_Admins will review and vote. Use_ *.approve ${id}* _to ratify._`,
                mentions: allMembers, ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── PLEAD ────────────────────────────────────────────────────────────────

    {
        command: 'plead',
        aliases: ['plea'],
        category: 'court',
        description: 'Respond to your trial charge',
        usage: '.plead [guilty/innocent]',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const response = args[0]?.toLowerCase();
            if (!['guilty', 'innocent'].includes(response)) {
                return sock.sendMessage(chatId, { text: `❌ Usage: .plead guilty OR .plead innocent`, ...channelInfo }, { quoted: message });
            }
            const activeCase = (await getActiveCases(chatId)).find((c: any) => c.defendant === senderId);
            if (!activeCase) return sock.sendMessage(chatId, { text: `❌ You have no active case to plead to.`, ...channelInfo }, { quoted: message });

            const existing = await getPlead(activeCase.id);
            if (existing) return sock.sendMessage(chatId, { text: `⚖️ You already entered a plea for *${activeCase.id}*.`, ...channelInfo }, { quoted: message });

            const D = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
            const S = `══════════════════════════════`;

            await recordPlead(activeCase.id, senderId, response as 'guilty' | 'innocent');
            cancelCaseTimers(activeCase.id);

            if (response === 'guilty') {
                // AUTO-CLOSE: guilty plea closes the case immediately with 50% fine reduction
                const [defWallet, accuserWallet, vault] = await Promise.all([
                    getWallet(activeCase.defendant, cleanJid(activeCase.defendant)),
                    getWallet(activeCase.accuser, cleanJid(activeCase.accuser)),
                    getCourtVault()
                ]);
                const seized = Math.floor(defWallet.balance * 0.5);
                const accuserShare = Math.floor(seized * 0.5);
                const vaultShare = seized - accuserShare;
                defWallet.balance -= seized;
                if (defWallet.balance < 0) defWallet.balance = 0;
                accuserWallet.balance += accuserShare;

                activeCase.status = 'guilty';
                await Promise.all([
                    updateCase(activeCase),
                    saveWallet(defWallet),
                    saveWallet(accuserWallet),
                    setCourtVault(vault + vaultShare),
                    addCriminalRecord(activeCase.defendant, chatId, activeCase.id, 'guilty',
                        activeCase.reason, `Confessed — Fined ${fmt(seized)} coins (50% reduction)`,
                        'BOT', 'COLLY COURT'),
                    deleteCaseMeta(activeCase.id)
                ]);

                const allMembers: string[] = [];
                try { const m = await sock.groupMetadata(chatId); m.participants.forEach((p: any) => allMembers.push(p.id)); } catch {}

                await sock.sendMessage(chatId, {
                    text:
                        `⚖️ *GUILTY PLEA — CASE CLOSED* 🔴\n${D}\n\n` +
                        `📋 *Case:* ${activeCase.id}\n` +
                        `🧑‍💼 *Defendant:* @${cleanJid(senderId)}\n` +
                        `📜 *Charge:* ${activeCase.reason}\n\n` +
                        `${S}\n💰 *SENTENCE (50% MERCY REDUCTION)*\n${S}\n\n` +
                        `• *Coins Seized:* ${fmt(seized)} 🪙 (half of full penalty)\n` +
                        `  └ ${fmt(accuserShare)} 🪙 → Plaintiff | ${fmt(vaultShare)} 🪙 → Vault\n\n` +
                        `📋 Status: *Convicted (Confessed)* — on criminal record\n\n${D}\n` +
                        `_🔖 Colly novels | 👨‍💻 DavidXTech_`,
                    mentions: [senderId, activeCase.accuser, ...allMembers], ...channelInfo
                }, { quoted: message });

            } else {
                // INNOCENT PLEA → start 2-min evidence window for plaintiff
                await startEvidenceTimer(sock, activeCase.id, chatId, activeCase.accuser, activeCase.defendant, activeCase.reason, false);

                const allMembers: string[] = [];
                try { const m = await sock.groupMetadata(chatId); m.participants.forEach((p: any) => allMembers.push(p.id)); } catch {}

                await sock.sendMessage(chatId, {
                    text:
                        `⚖️ *NOT GUILTY PLEA ENTERED* 🟢\n${D}\n\n` +
                        `@${cleanJid(senderId)} *DENIES* all charges.\n\n` +
                        `${S}\n📤 *PLAINTIFF @${cleanJid(activeCase.accuser)}:*\n${S}\n\n` +
                        `You have *2 minutes* to submit evidence.\n` +
                        `Reply to the violation message and type *.evidence ${activeCase.id}*\n\n` +
                        `⚠️ *If you fail:*\n` +
                        `• Case is *DISMISSED*\n` +
                        `• You are *FINED* for False Indictment (§40)\n\n` +
                        `🎯 *If you submit evidence:*\n` +
                        `• Jury trial begins (*.guilty / .innocent ${activeCase.id}*)\n` +
                        `• If defendant is found guilty → *FULL penalty + Perjury Fee*\n` +
                        `• If defendant is found innocent → *You are fined + pay damages*\n\n${D}\n` +
                        `_🔖 Colly novels | 👨‍💻 DavidXTech_`,
                    mentions: [senderId, activeCase.accuser, ...allMembers], ...channelInfo
                }, { quoted: message });
            }
        }
    },

    // ─── COURT MUTE ───────────────────────────────────────────────────────────

    {
        command: 'courtmute',
        aliases: ['cmute', 'judicialsilence'],
        category: 'court',
        description: 'Court-order a timed mute — messages auto-deleted, 3 strikes = kick',
        usage: '.courtmute @user <amount> [min|hour] [reason]',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .courtmute @user <amount> [min|hour] [reason]`, ...channelInfo }, { quoted: message });

            // Parse time: look for a numeric arg and a unit arg
            const numIdx = args.findIndex((a: string) => /^\d+$/.test(a));
            const amount  = numIdx >= 0 ? Number(args[numIdx]) : 0;
            const unitArg = numIdx >= 0 ? (args[numIdx + 1] || '') : '';
            const isHour  = /^h(ou?r?s?)?$/i.test(unitArg);
            const isMin   = /^m(in(ute)?s?)?$/i.test(unitArg);
            const durationMs = amount > 0
                ? (isHour ? amount * 3600_000 : amount * 60_000)
                : 0;
            const reasonStart = numIdx >= 0 ? (isHour || isMin ? numIdx + 2 : numIdx + 1) : 0;
            const reason = args.slice(reasonStart).join(' ').trim() || 'Court order';

            const mutedUntil = durationMs > 0 ? Date.now() + durationMs : 0;
            await addMute(target, chatId, senderId, mutedUntil, reason);

            const durationLabel = durationMs > 0
                ? (isHour ? `${amount} hour${amount !== 1 ? 's' : ''}` : `${amount} minute${amount !== 1 ? 's' : ''}`)
                : 'Indefinite';
            const expiresLabel  = mutedUntil > 0
                ? new Date(mutedUntil).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                : 'Until manually lifted';

            const allMembers: string[] = [];
            try { const m = await sock.groupMetadata(chatId); m.participants.forEach((p: any) => allMembers.push(p.id)); } catch {}

            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  ⚖️ *COURT MUTE ORDER*
╽  ─────────────────────────────
╽  ❏ *Subject:*  @${cleanJid(target)}
╽  ❏ *Issued by:* ${message.pushName || cleanJid(senderId)}
╽  ❏ *Duration:* ${durationLabel}
╽  ❏ *Expires:*  ${expiresLabel}
╽  ❏ *Reason:*   ${reason}
╽
╽  ⚠️ Messages will be auto-deleted.
╽  3 strikes while muted = *Contempt*
╽  *of Court* (auto-kick). ⚖️
╽
╽  _🔖 Colly novels | 👨‍💻 DavidXTech_
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                mentions: [target, ...allMembers], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'courtunmute',
        aliases: ['cunmute', 'liftcourtmute'],
        category: 'court',
        description: 'Lift a court mute order from a user',
        usage: '.courtunmute @user',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .courtunmute @user`, ...channelInfo }, { quoted: message });
            const mute = await getMute(target, chatId);
            if (!mute) return sock.sendMessage(chatId, {
                text: `⚠️ @${cleanJid(target)} has no active court mute.`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
            await removeMute(target, chatId);
            await sock.sendMessage(chatId, {
                text: `✅ Court mute on *@${cleanJid(target)}* has been lifted. ⚖️`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── LABOR & DARE ─────────────────────────────────────────────────────────

    {
        command: 'labor',
        aliases: ['communityservice', 'task'],
        category: 'court',
        description: 'Assign a labor task to a user with a timer',
        usage: '.labor @user [minutes]',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .labor @user [minutes]`, ...channelInfo }, { quoted: message });
            const minutes = parseInt(args.find((a: string) => !a.startsWith('@') && !isNaN(parseInt(a))) || '30');
            const task = LABOR_TASKS[Math.floor(Math.random() * LABOR_TASKS.length)];
            await assignLabor(target, chatId, task, senderId, minutes * 60 * 1000);
            await addDutyPoints(senderId, chatId, 1);
            await sock.sendMessage(chatId, {
                text: `🏗️ *COMMUNITY LABOR ASSIGNED*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `👤 *Defendant:* @${cleanJid(target)}\n` +
                      `📋 *Task:* ${task}\n` +
                      `⏳ *Time Limit:* ${minutes} minutes\n\n` +
                      `✅ Complete it and have an admin use *.verify @${cleanJid(target)}*\n` +
                      `❌ Failure to complete = automatic kick ⚠️`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'dare',
        aliases: ['socialdare', 'humiliation'],
        category: 'court',
        description: 'Assign a dare task to a user with a timer',
        usage: '.dare @user [minutes]',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .dare @user [minutes]`, ...channelInfo }, { quoted: message });
            const minutes = parseInt(args.find((a: string) => !a.startsWith('@') && !isNaN(parseInt(a))) || '20');
            const task = DARE_TASKS[Math.floor(Math.random() * DARE_TASKS.length)];
            await assignDare(target, chatId, task, senderId, minutes * 60 * 1000);
            await addDutyPoints(senderId, chatId, 1);
            await sock.sendMessage(chatId, {
                text: `😳 *DARE ISSUED BY THE COURT*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `👤 *Defendant:* @${cleanJid(target)}\n` +
                      `🎲 *Dare:* ${task}\n` +
                      `⏳ *Time Limit:* ${minutes} minutes\n\n` +
                      `✅ Complete it publicly and have an admin use *.verify @${cleanJid(target)}*\n` +
                      `❌ Failure = automatic exile ⚠️`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'verify',
        aliases: ['confirm', 'verified'],
        category: 'court',
        description: 'Verify a user\'s labor or dare task completion',
        usage: '.verify @user',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .verify @user`, ...channelInfo }, { quoted: message });
            const [labor, dare] = await Promise.all([getLabor(target, chatId), getDare(target, chatId)]);
            if (!labor && !dare) return sock.sendMessage(chatId, { text: `⚠️ @${cleanJid(target)} has no active labor or dare task.`, mentions: [target], ...channelInfo }, { quoted: message });
            if (labor && !labor.verified) {
                await verifyTask(target, chatId, 'labor', senderId);
                await clearTask(target, chatId, 'labor');
                await addDutyPoints(senderId, chatId, 2);
                return sock.sendMessage(chatId, {
                    text: `✅ *Labor Task Verified!*\n\n@${cleanJid(target)} has completed their community service.\nThey are now free. Case closed. 🏁`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }
            if (dare && !dare.verified) {
                await verifyTask(target, chatId, 'dare', senderId);
                await clearTask(target, chatId, 'dare');
                await addDutyPoints(senderId, chatId, 2);
                return sock.sendMessage(chatId, {
                    text: `✅ *Dare Completed & Verified!*\n\n@${cleanJid(target)} has fulfilled the court's dare. Sentence served. 🏁`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }
            await sock.sendMessage(chatId, { text: `⚠️ No pending unverified tasks found for @${cleanJid(target)}.`, mentions: [target], ...channelInfo }, { quoted: message });
        }
    },

    // ─── PENDING / HISTORY / BLIST / COURTLOG ────────────────────────────────

    {
        command: 'pending',
        aliases: ['activepunishments', 'punishments'],
        category: 'court',
        description: 'Show all active punishments in the group',
        usage: '.pending',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const [tasks, muted, blacklisted] = await Promise.all([
                getPendingTasks(chatId),
                getMutedUsers(chatId),
                getBlacklist()
            ]);
            if (!tasks.length && !muted.length) return sock.sendMessage(chatId, { text: `✅ No active punishments. Group is clean!`, ...channelInfo }, { quoted: message });
            let text = `⚖️ *ACTIVE PUNISHMENTS*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            if (muted.length) {
                text += `🔇 *Court-Muted Users (${muted.length}):*\n`;
                muted.forEach(m => { text += `  • @${cleanJid(m.user_id)} (${m.msg_count}/3 strikes)\n`; });
                text += `\n`;
            }
            if (tasks.length) {
                text += `📋 *Active Tasks:*\n`;
                tasks.forEach(t => {
                    const rem = t.expires_at - Date.now();
                    text += `  ${t.type} | @${cleanJid(t.user_id)}\n  ⏳ ${rem > 0 ? timeLeft(rem) : '⛔ EXPIRED'} remaining\n  📝 ${t.task.substring(0, 60)}...\n\n`;
                });
            }
            await sock.sendMessage(chatId, { text: text.trim(), ...channelInfo }, { quoted: message });
        }
    },

    {
        command: 'history',
        aliases: ['record', 'criminalrecord', 'rap'],
        category: 'court',
        description: 'View a user\'s criminal record',
        usage: '.history [@user]',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || senderId;
            const name = target === senderId ? (message.pushName || cleanJid(senderId)) : cleanJid(target);
            const [records, blacklisted] = await Promise.all([
                getCriminalRecord(target, chatId),
                isBlacklisted(target)
            ]);
            if (!records.length && !blacklisted) {
                return sock.sendMessage(chatId, {
                    text: `✅ *Clean Record*\n\n@${cleanJid(target)} has no criminal history in this group. 😇`,
                    mentions: [target], ...channelInfo
                }, { quoted: message });
            }
            let text = `⚖️ *CRIMINAL RECORD: ${name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            if (blacklisted) text += `🔴 *STATUS: BLACKLISTED OUTLAW*\n\n`;
            records.forEach((r, i) => {
                const date = new Date(r.timestamp).toLocaleDateString();
                text += `*${i + 1}.* [${r.verdict.toUpperCase()}] ${r.charge}\n`;
                text += `   📅 ${date} | 👨‍⚖️ Judge: ${r.judge_name}\n`;
                if (r.punishment) text += `   ⚠️ Punishment: ${r.punishment}\n`;
                text += `\n`;
            });
            await sock.sendMessage(chatId, { text: text.trim(), mentions: [target], ...channelInfo }, { quoted: message });
        }
    },

    {
        command: 'blist',
        aliases: ['outlaws', 'blacklisted', 'banned', 'listban', 'listbans', 'banlist'],
        category: 'court',
        description: 'List all blacklisted outlaws',
        usage: '.blist',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const list = await getBlacklist();
            if (!list.length) return sock.sendMessage(chatId, { text: `✅ No outlaws. The group is at peace! ☮️`, ...channelInfo }, { quoted: message });
            let text = `🔴 *BLACKLISTED OUTLAWS*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            list.forEach((id, i) => { text += `*${i + 1}.* @${cleanJid(id)}\n`; });
            text += `\n_Total Outlaws: ${list.length}_\n_Use .pardon @user to restore access_`;
            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        }
    },

    {
        command: 'courtlog',
        aliases: ['triallog', 'recenttrials'],
        category: 'court',
        description: 'View the last 5 completed trials',
        usage: '.courtlog',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const trials = await getRecentTrials(chatId, 5);
            if (!trials.length) return sock.sendMessage(chatId, { text: `📋 No completed trials yet.`, ...channelInfo }, { quoted: message });
            let text = `📋 *COURT RECORDS — LAST ${trials.length} TRIALS*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            trials.forEach((t, i) => {
                const date = new Date(t.timestamp).toLocaleDateString();
                const emoji = t.verdict === 'guilty' ? '🔴' : '🟢';
                text += `${emoji} *${t.case_id}*\n`;
                text += `   📜 ${t.charge}\n`;
                text += `   👨‍⚖️ Judge: ${t.judge_name} | 📅 ${date}\n\n`;
            });
            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        }
    },

    // ─── DEPORT ───────────────────────────────────────────────────────────────

    {
        command: 'deport',
        aliases: ['exile', 'bantemp'],
        category: 'court',
        description: 'Kick and block a user for a duration (admin only)',
        usage: '.deport @user [hours]',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .deport @user [hours]`, ...channelInfo }, { quoted: message });
            const hours = parseInt(args.find((a: string) => !a.startsWith('@') && !isNaN(parseInt(a))) || '24');
            const { deport: deportFn } = await import('../lib/turso2.js');
            await deportFn(target, chatId, senderId, hours * 3600 * 1000);
            await addDutyPoints(senderId, chatId, 2);
            const allMembers: string[] = [];
            try { const m = await sock.groupMetadata(chatId); m.participants.forEach((p: any) => allMembers.push(p.id)); } catch {}
            await sock.sendMessage(chatId, {
                text: `🛂 *DEPORTATION ORDER*\n\n@${cleanJid(target)} has been *deported* for *${hours} hour(s)*.\nThey are blocked from rejoining until the ban expires.`,
                mentions: [target, ...allMembers], ...channelInfo
            }, { quoted: message });
            try { await sock.groupParticipantsUpdate(chatId, [target], 'remove'); } catch {}
        }
    },

    // ─── BRIBE ────────────────────────────────────────────────────────────────

    {
        command: 'bribe',
        aliases: ['payoff', 'corrupt'],
        category: 'court',
        description: 'Offer a bribe to an admin to dismiss your case',
        usage: '.bribe @admin [amount]',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const amountStr = args.find((a: string) => !a.startsWith('@'));
            if (!target || !amountStr) return sock.sendMessage(chatId, { text: `❌ Usage: .bribe @admin [amount]`, ...channelInfo }, { quoted: message });
            const amount = parseInt(amountStr);
            if (isNaN(amount) || amount <= 0) return sock.sendMessage(chatId, { text: `❌ Invalid amount.`, ...channelInfo }, { quoted: message });
            const wallet = await getWallet(senderId, message.pushName || cleanJid(senderId));
            if (wallet.balance < amount) return sock.sendMessage(chatId, { text: `❌ Insufficient funds. You only have *${fmt(wallet.balance)} 🪙*`, ...channelInfo }, { quoted: message });
            const cases = await getActiveCases(chatId);
            const courtCase = cases.find(c => c.defendant === senderId);
            if (!courtCase) return sock.sendMessage(chatId, { text: `❌ You have no active court case to bribe for.`, ...channelInfo }, { quoted: message });
            wallet.balance -= amount;
            await saveWallet(wallet);
            const brideId = await submitBribe(courtCase.id, senderId, target, amount);
            await sock.sendMessage(chatId, {
                text: `💰 *BRIBE OFFERED*\n\n@${cleanJid(senderId)} has offered *${fmt(amount)} 🪙* to @${cleanJid(target)} to dismiss *${courtCase.id}*.\n\n` +
                      `@${cleanJid(target)}: Use *.acceptbribe ${brideId}* to accept (coins transfer)\n` +
                      `Or *.reportbribe ${brideId}* to report it (+penalties for the defendant)`,
                mentions: [senderId, target], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'acceptbribe',
        aliases: [],
        category: 'court',
        description: 'Accept a bribe offer',
        usage: '.acceptbribe [bribe-id]',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const id = parseInt(args[0]);
            if (isNaN(id)) return sock.sendMessage(chatId, { text: `❌ Usage: .acceptbribe [bribe-id]`, ...channelInfo }, { quoted: message });
            const bribe = await getPendingBribe(String(id), senderId);
            if (!bribe) return sock.sendMessage(chatId, { text: `❌ No pending bribe found for you with ID ${id}.`, ...channelInfo }, { quoted: message });
            const adminWallet = await getWallet(senderId, message.pushName || cleanJid(senderId));
            adminWallet.balance += bribe.amount;
            await saveWallet(adminWallet);
            await resolveBribe(id, 'accepted');
            await sock.sendMessage(chatId, {
                text: `💰 *Bribe Accepted!*\n\n${message.pushName || cleanJid(senderId)} accepted *${fmt(bribe.amount)} 🪙* from @${cleanJid(bribe.defendant)}.\n_The case may be reviewed at admin discretion._`,
                mentions: [bribe.defendant], ...channelInfo
            }, { quoted: message });
        }
    },

    {
        command: 'reportbribe',
        aliases: [],
        category: 'court',
        description: 'Report a bribe offer for extra penalties',
        usage: '.reportbribe [bribe-id]',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const id = parseInt(args[0]);
            if (isNaN(id)) return sock.sendMessage(chatId, { text: `❌ Usage: .reportbribe [bribe-id]`, ...channelInfo }, { quoted: message });
            const bribe = await getPendingBribe(String(id), senderId);
            if (!bribe) return sock.sendMessage(chatId, { text: `❌ No pending bribe found.`, ...channelInfo }, { quoted: message });
            const defWallet = await getWallet(bribe.defendant, cleanJid(bribe.defendant));
            const penalty = Math.floor(bribe.amount * 0.5);
            defWallet.balance = Math.max(0, defWallet.balance - penalty);
            await saveWallet(defWallet);
            await resolveBribe(id, 'reported');
            await addDutyPoints(senderId, chatId, 3);
            await sock.sendMessage(chatId, {
                text: `🚔 *BRIBE REPORTED!*\n\n@${cleanJid(bribe.defendant)} attempted to bribe an admin!\n` +
                      `*Additional fine:* -${fmt(penalty)} 🪙 (50% of bribe)\n` +
                      `The admin has been commended for their integrity. 🏅`,
                mentions: [bribe.defendant], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── APPEAL ───────────────────────────────────────────────────────────────

    {
        command: 'appeal',
        aliases: ['retrial', 'contest'],
        category: 'court',
        description: 'Submit an anonymous appeal for a one-time retrial',
        usage: '.appeal [case-id] [reason]',
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (!args[0] || !args[1]) return sock.sendMessage(chatId, { text: `❌ Usage: .appeal [CASE-ID] [reason for appeal]`, ...channelInfo }, { quoted: message });
            const caseId = args[0].toUpperCase();
            const reason = args.slice(1).join(' ');
            const success = await submitAppeal(caseId, senderId, chatId, reason);
            if (!success) {
                return sock.sendMessage(chatId, {
                    text: `❌ You have already submitted an appeal in this group.\n_Each user is only allowed one appeal._`,
                    ...channelInfo
                }, { quoted: message });
            }
            await sock.sendMessage(message.key.remoteJid, {
                text: `✅ *Appeal Submitted Anonymously*\n\nYour appeal for case *${caseId}* has been forwarded to the bot owner for review.\nYou will be notified of the decision. ⚖️`,
                ...channelInfo
            }, { quoted: message });
            const config = (await import('../config.js')).default;
            const ownerJid = `${config.ownerNumber}@s.whatsapp.net`;
            await sock.sendMessage(ownerJid, {
                text: `📬 *ANONYMOUS APPEAL RECEIVED*\n\n📋 *Case:* ${caseId}\n🏠 *Group:* ${chatId}\n📜 *Reason:* ${reason}\n\nThis appeal is anonymous. Use *.verdict* commands to override if warranted.`
            });
        }
    },
];
