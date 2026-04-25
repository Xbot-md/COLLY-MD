import type { BotContext } from '../types.js';
import {
    isBlacklisted, addBlacklist, removeBlacklist,
    createCase, updateCase, getCase, getActiveCases,
    getCourtVault, setCourtVault, getWallet, saveWallet,
    type CourtCase
} from '../lib/turso.js';
import {
    getRules, getPlead, recordPlead,
    addCriminalRecord, clearCriminalRecord, addDutyPoints,
    setCaseMeta, getCaseMeta, deleteCaseMeta
} from '../lib/turso2.js';
import {
    startPleaTimer, startEvidenceTimer, cancelCaseTimers, triggerJury
} from '../lib/courtTimers.js';
import { DEFAULT_RULES } from '../lib/defaultRules.js';
import { requireIdForBoth } from '../lib/idGate.js';
import config from '../config.js';

function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }
function fmt(n: number) { return n.toLocaleString(); }
function genCaseId() { return `CASE-${Date.now().toString(36).toUpperCase()}`; }

const D = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
const S = `══════════════════════════════`;

const VIOLATIONS = [
    'Disturbing the Peace', 'Spreading Misinformation', 'Insulting Group Members',
    'Spamming', 'Posting NSFW without consent', 'Harassment', 'Impersonation',
    'Leaking Private Information', 'Threatening Behavior', 'Trolling Excessively'
];

export default [

    // ─── SUE ─────────────────────────────────────────────────────────────────
    {
        command: 'sue',
        aliases: ['court', 'charge', 'accuse'],
        category: 'court',
        description: 'File charges against a user in court',
        usage: '.sue @user [reason | brk <rule#> | §<rule#>]',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const prefix = config.prefixes[0];
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Tag the person you want to sue!\nUsage: .sue @user [reason]`, ...channelInfo }, { quoted: message });
            if (target === senderId) return sock.sendMessage(chatId, { text: `😂 Can't sue yourself.`, ...channelInfo }, { quoted: message });
            if (!await requireIdForBoth(sock, message, senderId, target, chatId, channelInfo, prefix)) return;
            if (await isBlacklisted(senderId)) {
                return sock.sendMessage(chatId, { text: `⛔ You are *blacklisted* and cannot use court functions.`, ...channelInfo }, { quoted: message });
            }
            const rawReason = args.filter((a: string) => !a.startsWith('@')).join(' ').trim();
            let reason = rawReason;

            // Resolve rule-number references: "brk 2", "broke 5", "rule 3", "§10", "r7"
            const ruleRefMatch = rawReason.match(/^(?:brk|broke|rule|r|§)\s*(\d+)$/i);
            if (ruleRefMatch) {
                const ruleNum = parseInt(ruleRefMatch[1]);
                const groupRules = await getRules(chatId);
                const hasSeeded = groupRules.some((r: any) => r.rule_num <= 70);
                const allRules: { rule_num: number; text: string }[] = hasSeeded
                    ? groupRules
                    : [
                        ...DEFAULT_RULES.map(r => ({ rule_num: r.num, text: r.text })),
                        ...groupRules.filter((r: any) => r.rule_num > 70)
                      ];
                const foundRule = allRules.find(r => r.rule_num === ruleNum);
                if (!foundRule) {
                    return sock.sendMessage(chatId, {
                        text: `❌ *Rule §${ruleNum} not found* in the constitution.\n\nRun *.rules* to see all active laws.`,
                        ...channelInfo
                    }, { quoted: message });
                }
                reason = `§${ruleNum} — ${foundRule.text}`;
            }

            if (!reason) {
                const groupRules = await getRules(chatId);
                // Use DB rules if seeded, otherwise fall back to the default constitution
                const hasSeeded = groupRules.some(r => r.rule_num <= 70);
                const displayRules = hasSeeded
                    ? groupRules
                    : [
                        ...DEFAULT_RULES.map(r => ({ rule_num: r.num, text: r.text })),
                        ...groupRules.filter(r => r.rule_num > 70)
                      ];
                if (displayRules.length) {
                    const PAGE_SIZE = 20;
                    let rulesText = `📜 *SELECT A CHARGE (§1–§${Math.min(PAGE_SIZE, displayRules.length)})*\n\nTag the defendant and cite a rule:\n\n`;
                    displayRules.slice(0, PAGE_SIZE).forEach(r => { rulesText += `*§${r.rule_num}.* ${r.text}\n`; });
                    if (displayRules.length > PAGE_SIZE) rulesText += `\n_…and ${displayRules.length - PAGE_SIZE} more. Run .rules to view all._`;
                    rulesText += `\n\n_Usage: .sue @user brk <num>  •  .sue @user §<num>  •  .sue @user <free text>_`;
                    return sock.sendMessage(chatId, { text: rulesText, ...channelInfo }, { quoted: message });
                }
                reason = VIOLATIONS[Math.floor(Math.random() * VIOLATIONS.length)];
            }
            const accuserName = message.pushName || cleanJid(senderId);
            const defendantName = cleanJid(target);
            const caseId = genCaseId();
            const newCase: CourtCase = {
                id: caseId, groupId: chatId, accuser: senderId, accuserName,
                defendant: target, defendantName, reason,
                status: 'voting', votesGuilty: [], votesInnocent: [], startTime: Date.now()
            };
            await createCase(newCase);
            const fileNum = (Date.now() % 9000 + 1000);
            const allMembers: string[] = [];
            try { const meta = await sock.groupMetadata(chatId); meta.participants.forEach((p: any) => allMembers.push(p.id)); } catch {}

            await sock.sendMessage(chatId, {
                text:
                    `⚖️ *COLLY COURT OF JUSTICE* ⚖️\n${D}\n` +
                    `📜 *CASE FILE: #${fileNum}*\n` +
                    `Attention @all! The Court is now *IN SESSION.*\n` +
                    `${S}\n🏛️ *THE ARRAIGNMENT* 🏛️\n${S}\n\n` +
                    `📍 *PLAINTIFF (Accuser):* @${cleanJid(senderId)}\n` +
                    `👤 *DEFENDANT (Accused):* @${cleanJid(target)}\n\n` +
                    `🔴 *THE CHARGE:*\n${reason}\n\n` +
                    `${S}\n⚖️ *LEGAL ORDERS* ⚖️\n${S}\n\n` +
                    `📥 *FOR THE DEFENDANT (@${cleanJid(target)}):*\n\n` +
                    `You are summoned to enter a plea within *2 minutes.*\n` +
                    `• *.plead guilty* — Confess (50% fine reduction, case closed immediately)\n` +
                    `• *.plead innocent* — Contest the charges (evidence + jury trial)\n` +
                    `⚠️ *No plea = Contempt of Court + punishment DOUBLED.*\n\n` +
                    `📤 *FOR THE PLAINTIFF (@${cleanJid(senderId)}):*\n\n` +
                    `Reply to the violation with *.evidence ${caseId}*\n` +
                    `No evidence after innocent plea = case *DISMISSED* + you are *FINED.*\n\n` +
                    `${S}\n` +
                    `📋 *Case Reference:* \`${caseId}\`\n` +
                    `⏳ *Status:* Awaiting Plea — Timer started\n${D}`,
                mentions: [senderId, target], ...channelInfo
            }, { quoted: message });

            startPleaTimer(sock, caseId, chatId, target, senderId, reason);
        }
    },

    // ─── EVIDENCE ────────────────────────────────────────────────────────────
    {
        command: 'evidence',
        aliases: ['proof', 'exhibit'],
        category: 'court',
        description: 'Submit evidence for an active case (reply to the violation)',
        usage: '.evidence <case-id>',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (!args[0]) return sock.sendMessage(chatId, { text: `❌ Reply to the violation message and type *.evidence <CASE-ID>*`, ...channelInfo }, { quoted: message });
            const caseId = args[0].toUpperCase();
            const courtCase = await getCase(caseId);
            if (!courtCase || courtCase.groupId !== chatId || courtCase.status !== 'voting') {
                return sock.sendMessage(chatId, { text: `❌ Case *${caseId}* not found or already closed.`, ...channelInfo }, { quoted: message });
            }
            if (courtCase.accuser !== senderId) {
                return sock.sendMessage(chatId, { text: `⛔ Only the *plaintiff* can submit evidence.`, ...channelInfo }, { quoted: message });
            }
            const alreadySubmitted = await getCaseMeta(caseId, 'evidence_submitted');
            if (alreadySubmitted === 'true') {
                return sock.sendMessage(chatId, { text: `✅ Evidence already on file for *${caseId}*.`, ...channelInfo }, { quoted: message });
            }
            const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMsg) {
                return sock.sendMessage(chatId, { text: `❌ You must *reply* to the violation message to submit it as evidence.\n\nQuote/reply to the specific message, then type *.evidence ${caseId}*`, ...channelInfo }, { quoted: message });
            }

            await setCaseMeta(caseId, 'evidence_submitted', 'true');
            cancelCaseTimers(caseId);

            const contempt = (await getCaseMeta(caseId, 'contempt')) === 'true';

            await sock.sendMessage(chatId, {
                text:
                    `📁 *EXHIBIT A LOGGED* ✅\n${D}\n\n` +
                    `📋 *Case:* ${caseId}\n` +
                    `👨‍⚖️ *Plaintiff:* @${cleanJid(senderId)}\n\n` +
                    `${S}\n📎 *EVIDENCE — The quoted message above is the exhibit.*\n${S}\n\n` +
                    `Evidence accepted by the Court.\nJury trial now commencing... 🗳️`,
                mentions: [senderId], ...channelInfo
            }, { quoted: message });

            await triggerJury(sock, caseId, chatId, courtCase.accuser, courtCase.defendant, courtCase.reason, contempt);
        }
    },

    // ─── GUILTY VOTE ─────────────────────────────────────────────────────────
    {
        command: 'guilty',
        aliases: [],
        category: 'court',
        description: 'Vote guilty in a court case',
        usage: '.guilty <case-id>',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (!args[0]) return sock.sendMessage(chatId, { text: `❌ Usage: .guilty <CASE-ID>`, ...channelInfo }, { quoted: message });
            const courtCase = await getCase(args[0].toUpperCase());
            if (!courtCase || courtCase.groupId !== chatId || courtCase.status !== 'voting') {
                return sock.sendMessage(chatId, { text: `❌ Case not found or already closed.`, ...channelInfo }, { quoted: message });
            }
            if (courtCase.votesGuilty.includes(senderId) || courtCase.votesInnocent.includes(senderId)) {
                return sock.sendMessage(chatId, { text: `⚖️ You already voted in this case!`, ...channelInfo }, { quoted: message });
            }
            if (senderId === courtCase.defendant) return sock.sendMessage(chatId, { text: `😅 The defendant can't vote in their own trial!`, ...channelInfo }, { quoted: message });
            courtCase.votesGuilty.push(senderId);
            await updateCase(courtCase);
            await sock.sendMessage(chatId, {
                text: `🔴 *Vote Cast: GUILTY*\n\nCase: ${courtCase.id}\nGuilty: ${courtCase.votesGuilty.length} | Innocent: ${courtCase.votesInnocent.length}\n\n_Admin closes with_ *.verdict ${courtCase.id} guilty/innocent*`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── INNOCENT VOTE ───────────────────────────────────────────────────────
    {
        command: 'innocent',
        aliases: ['notguilty'],
        category: 'court',
        description: 'Vote innocent in a court case',
        usage: '.innocent <case-id>',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (!args[0]) return sock.sendMessage(chatId, { text: `❌ Usage: .innocent <CASE-ID>`, ...channelInfo }, { quoted: message });
            const courtCase = await getCase(args[0].toUpperCase());
            if (!courtCase || courtCase.groupId !== chatId || courtCase.status !== 'voting') {
                return sock.sendMessage(chatId, { text: `❌ Case not found or already closed.`, ...channelInfo }, { quoted: message });
            }
            if (courtCase.votesGuilty.includes(senderId) || courtCase.votesInnocent.includes(senderId)) {
                return sock.sendMessage(chatId, { text: `⚖️ You already voted in this case!`, ...channelInfo }, { quoted: message });
            }
            courtCase.votesInnocent.push(senderId);
            await updateCase(courtCase);
            await sock.sendMessage(chatId, {
                text: `🟢 *Vote Cast: INNOCENT*\n\nCase: ${courtCase.id}\nGuilty: ${courtCase.votesGuilty.length} | Innocent: ${courtCase.votesInnocent.length}`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── VERDICT ─────────────────────────────────────────────────────────────
    {
        command: 'verdict',
        aliases: ['judge', 'sentence'],
        category: 'court',
        description: 'Deliver final verdict on a case (admin only)',
        usage: '.verdict <case-id> <guilty|innocent>',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (!args[0] || !args[1]) return sock.sendMessage(chatId, { text: `❌ Usage: .verdict <CASE-ID> <guilty|innocent>`, ...channelInfo }, { quoted: message });
            const courtCase = await getCase(args[0].toUpperCase());
            if (!courtCase) return sock.sendMessage(chatId, { text: `❌ Case not found.`, ...channelInfo }, { quoted: message });
            if (courtCase.groupId !== chatId) return sock.sendMessage(chatId, { text: `❌ This case belongs to a different group.`, ...channelInfo }, { quoted: message });
            if (courtCase.status !== 'voting') return sock.sendMessage(chatId, { text: `⚖️ Case already closed (${courtCase.status}).`, ...channelInfo }, { quoted: message });
            const decision = args[1].toLowerCase();
            if (!['guilty', 'innocent'].includes(decision)) return sock.sendMessage(chatId, { text: `❌ Decision must be *guilty* or *innocent*.`, ...channelInfo }, { quoted: message });

            cancelCaseTimers(courtCase.id);

            const judgeId = senderId;
            const judgeName = message.pushName || cleanJid(senderId);
            const plea = await getPlead(courtCase.id);
            const pleaResponse = plea?.response ?? null;
            const isGuiltyPlea = pleaResponse === 'guilty';
            const isInnocentPlea = pleaResponse === 'innocent';
            const isContempt = (await getCaseMeta(courtCase.id, 'contempt')) === 'true';

            const g = courtCase.votesGuilty.length;
            const i = courtCase.votesInnocent.length;

            courtCase.status = decision as CourtCase['status'];
            const allMembers: string[] = [];
            try { const m = await sock.groupMetadata(chatId); m.participants.forEach((p: any) => allMembers.push(p.id)); } catch {}

            if (decision === 'guilty') {
                const [defWallet, accuserWallet, vault] = await Promise.all([
                    getWallet(courtCase.defendant, cleanJid(courtCase.defendant)),
                    getWallet(courtCase.accuser, cleanJid(courtCase.accuser)),
                    getCourtVault()
                ]);

                let baseSeizable = defWallet.balance;
                let notes: string[] = [];

                if (isGuiltyPlea) {
                    baseSeizable = Math.floor(baseSeizable * 0.5);
                    notes.push(`💡 *Guilty plea — 50% fine reduction applied*`);
                } else if (isInnocentPlea) {
                    notes.push(`🔴 *Innocent plea + Guilty verdict = PERJURY FEE*`);
                } else if (isContempt) {
                    baseSeizable = Math.floor(baseSeizable * 2);
                    if (baseSeizable > defWallet.balance) baseSeizable = defWallet.balance;
                    notes.push(`⚠️ *Contempt of Court — punishment DOUBLED*`);
                }

                const seized = Math.max(0, Math.min(baseSeizable, defWallet.balance));
                defWallet.balance -= seized;
                if (defWallet.balance < 0) defWallet.balance = 0;

                const accuserShare = Math.floor(seized * 0.5);
                const juryShare = seized - accuserShare;
                accuserWallet.balance += accuserShare;

                const saves: Promise<void>[] = [saveWallet(defWallet), saveWallet(accuserWallet)];
                if (g > 0) {
                    const perJuror = Math.floor(juryShare / g);
                    for (const jId of courtCase.votesGuilty) {
                        saves.push(getWallet(jId, cleanJid(jId)).then(jw => { jw.balance += perJuror; return saveWallet(jw); }));
                    }
                }
                const overflow = juryShare - (g > 0 ? Math.floor(juryShare / g) * g : 0);
                await Promise.all([...saves, setCourtVault(vault + overflow)]);

                let perjuryFine = 0;
                if (isInnocentPlea) {
                    const defW2 = await getWallet(courtCase.defendant, cleanJid(courtCase.defendant));
                    perjuryFine = Math.min(defW2.balance, Math.floor(seized * 0.3));
                    defW2.balance -= perjuryFine;
                    if (defW2.balance < 0) defW2.balance = 0;
                    const vaultNow = await getCourtVault();
                    await Promise.all([saveWallet(defW2), setCourtVault(vaultNow + perjuryFine)]);
                }

                await Promise.all([
                    updateCase(courtCase),
                    addCriminalRecord(courtCase.defendant, chatId, courtCase.id, 'guilty', courtCase.reason,
                        `Seized ${fmt(seized)} coins${perjuryFine ? ` + Perjury fine ${fmt(perjuryFine)}` : ''}`,
                        judgeId, judgeName),
                    addDutyPoints(judgeId, chatId, 3),
                    deleteCaseMeta(courtCase.id)
                ]);

                await sock.sendMessage(chatId, {
                    text:
                        `⚖️ *VERDICT: GUILTY* 🔴\n${D}\n\n` +
                        `📋 *Case:* ${courtCase.id}\n` +
                        `🧑‍💼 *Defendant:* @${cleanJid(courtCase.defendant)}\n` +
                        `📜 *Charge:* ${courtCase.reason}\n\n` +
                        `📊 *Jury Votes:* Guilty ${g} | Innocent ${i}\n\n` +
                        `${S}\n💰 *SENTENCING*\n${S}\n\n` +
                        notes.map(n => n + '\n').join('') +
                        `• *Coins Seized:* ${fmt(seized)} 🪙\n` +
                        `  └ 50% → Plaintiff | 50% → Jury\n` +
                        (perjuryFine ? `• *Perjury Fee:* ${fmt(perjuryFine)} 🪙 → Vault\n` : '') +
                        `\n⚠️ *Additional Punishment Options:*\n` +
                        `• *.mute @user* — Silence defendant\n` +
                        `• *.labor @user <mins>* — Community service\n` +
                        `• *.blacklistuser @user* — Bot ban\n\n` +
                        `👨‍⚖️ *Judge:* ${judgeName}\n` +
                        `📋 Criminal record filed.\n${D}\n` +
                        `_🔖 Colly novels | 👨‍💻 DavidXTech_`,
                    mentions: [courtCase.defendant, courtCase.accuser], ...channelInfo
                }, { quoted: message });

            } else {
                // INNOCENT VERDICT
                const accuserPunished = isInnocentPlea || isContempt;
                let damagesPaid = 0;
                let accuserFine = 0;

                if (accuserPunished) {
                    const [accuserW, defW, vault] = await Promise.all([
                        getWallet(courtCase.accuser, cleanJid(courtCase.accuser)),
                        getWallet(courtCase.defendant, cleanJid(courtCase.defendant)),
                        getCourtVault()
                    ]);
                    accuserFine = Math.min(accuserW.balance, 300);
                    damagesPaid = Math.min(accuserW.balance - accuserFine, 200);
                    accuserW.balance -= (accuserFine + damagesPaid);
                    if (accuserW.balance < 0) accuserW.balance = 0;
                    defW.balance += damagesPaid;
                    await Promise.all([
                        saveWallet(accuserW),
                        saveWallet(defW),
                        setCourtVault(vault + accuserFine),
                        addCriminalRecord(courtCase.accuser, chatId, courtCase.id, 'guilty',
                            'False Indictment (§40) — Defendant found innocent',
                            `Fined ${fmt(accuserFine)} coins + ${fmt(damagesPaid)} damages paid to defendant`,
                            judgeId, judgeName)
                    ]);
                }

                await Promise.all([
                    updateCase(courtCase),
                    addCriminalRecord(courtCase.defendant, chatId, courtCase.id, 'innocent', courtCase.reason, null, judgeId, judgeName),
                    addDutyPoints(judgeId, chatId, 2),
                    deleteCaseMeta(courtCase.id)
                ]);

                await sock.sendMessage(chatId, {
                    text:
                        `⚖️ *VERDICT: INNOCENT* 🟢\n${D}\n\n` +
                        `📋 *Case:* ${courtCase.id}\n` +
                        `🧑‍💼 *Defendant:* @${cleanJid(courtCase.defendant)}\n` +
                        `📜 *Charge:* ${courtCase.reason}\n\n` +
                        `📊 *Jury Votes:* Guilty ${g} | Innocent ${i}\n\n` +
                        `${S}\n✅ *ACQUITTED — FULLY EXONERATED*\n${S}\n\n` +
                        `@${cleanJid(courtCase.defendant)} is *innocent* of all charges!\n` +
                        (accuserPunished
                            ? `\n🔴 *Plaintiff Penalty (§40 — False Indictment):*\n` +
                              `• Fine: *${fmt(accuserFine)} 🪙* seized from @${cleanJid(courtCase.accuser)}\n` +
                              (damagesPaid ? `• Legal Damages: *${fmt(damagesPaid)} 🪙* awarded to defendant\n` : '')
                            : '') +
                        `\n👨‍⚖️ *Judge:* ${judgeName}\n${D}\n` +
                        `_🔖 Colly novels | 👨‍💻 DavidXTech_`,
                    mentions: [courtCase.defendant, courtCase.accuser], ...channelInfo
                }, { quoted: message });
            }
        }
    },

    // ─── SEIZE ───────────────────────────────────────────────────────────────
    {
        command: 'seize',
        aliases: ['confiscate', 'drain'],
        category: 'court',
        description: 'Seize all coins from a user (admin)',
        usage: '.seize @user',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const { resolveTarget } = await import('../lib/targetResolver.js');
            const r = await resolveTarget(sock, message, args);
            const target = r.jid;
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .seize <@user|reply|phone>`, ...channelInfo }, { quoted: message });
            const [w, vault] = await Promise.all([getWallet(target, cleanJid(target)), getCourtVault()]);
            if (!w || w.balance === 0) return sock.sendMessage(chatId, { text: `⚖️ @${cleanJid(target)} has no coins to seize.`, mentions: [target], ...channelInfo }, { quoted: message });
            const seized = w.balance;
            w.balance = 0;
            await Promise.all([saveWallet(w), setCourtVault(vault + seized)]);
            await sock.sendMessage(chatId, {
                text: `💰 *COINS SEIZED!*\n\nTook *${fmt(seized)} 🪙* from @${cleanJid(target)}\n🏦 Vault total: *${fmt(vault + seized)} 🪙*`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── BLACKLIST USER ───────────────────────────────────────────────────────
    {
        command: 'blacklistuser',
        aliases: ['botban', 'courtban'],
        category: 'court',
        description: 'Blacklist a user from using bot commands',
        usage: '.blacklistuser @user',
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const { resolveTarget } = await import('../lib/targetResolver.js');
            const r = await resolveTarget(sock, message, args);
            const target = r.jid;
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .blacklistuser <@user|reply|phone>`, ...channelInfo }, { quoted: message });
            if (await isBlacklisted(target)) return sock.sendMessage(chatId, { text: `⚠️ @${cleanJid(target)} is already blacklisted.`, mentions: [target], ...channelInfo }, { quoted: message });
            const [w, vault] = await Promise.all([getWallet(target, cleanJid(target)), getCourtVault()]);
            const seized = w.balance;
            w.balance = 0;
            const judgeName = message.pushName || cleanJid(senderId);
            await Promise.all([
                addBlacklist(target),
                saveWallet(w),
                setCourtVault(vault + seized),
                addCriminalRecord(target, chatId, `BL-${Date.now()}`, 'blacklisted', 'Bot-banned by admin', `Seized ${fmt(seized)} coins`, senderId, judgeName),
                addDutyPoints(senderId, chatId, 2)
            ]);
            await sock.sendMessage(chatId, {
                text: `⛔ *OUTLAW STATUS DECLARED*\n\n@${cleanJid(target)} has been *blacklisted.*\n` +
                      `• All bot commands revoked\n• *${fmt(seized)} 🪙* seized to vault\n• Criminal record filed 📋`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── PARDON ───────────────────────────────────────────────────────────────
    {
        command: 'pardon',
        aliases: ['unblacklist', 'acquit'],
        category: 'court',
        description: 'Pardon a blacklisted user (admin)',
        usage: '.pardon @user',
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return sock.sendMessage(chatId, { text: `❌ Usage: .pardon @user`, ...channelInfo }, { quoted: message });
            if (!await isBlacklisted(target)) return sock.sendMessage(chatId, { text: `✅ @${cleanJid(target)} is not blacklisted.`, mentions: [target], ...channelInfo }, { quoted: message });
            const pardonName = message.pushName || cleanJid(senderId);
            await Promise.all([
                removeBlacklist(target),
                clearCriminalRecord(target, chatId),
                addDutyPoints(senderId, chatId, 2)
            ]);
            await sock.sendMessage(chatId, {
                text: `🕊️ *FULL PARDON GRANTED*\n\n@${cleanJid(target)} officially pardoned by ${pardonName}.\n\n` +
                      `✅ Blacklist removed\n✅ Criminal record wiped\n✅ Bot access restored\n\n_🔖 Colly novels | 👨‍💻 DavidXTech_`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── DISTRIBUTE ───────────────────────────────────────────────────────────
    {
        command: 'distribute',
        aliases: ['vaultpay', 'fund'],
        category: 'court',
        description: 'Distribute vault coins to a user (admin)',
        usage: '.distribute @user <amount>',
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const amountStr = args.find((a: string) => !a.startsWith('@'));
            if (!target || !amountStr) return sock.sendMessage(chatId, { text: `❌ Usage: .distribute @user <amount>`, ...channelInfo }, { quoted: message });
            if (target === senderId) return sock.sendMessage(chatId, { text: `❌ Can't distribute vault coins to yourself.`, ...channelInfo }, { quoted: message });
            const amount = parseInt(amountStr);
            if (isNaN(amount) || amount <= 0) return sock.sendMessage(chatId, { text: `❌ Invalid amount.`, ...channelInfo }, { quoted: message });
            const [vault, w] = await Promise.all([getCourtVault(), getWallet(target, cleanJid(target))]);
            if (vault < amount) return sock.sendMessage(chatId, { text: `❌ Vault only has *${fmt(vault)} 🪙*`, ...channelInfo }, { quoted: message });
            w.balance += amount;
            await Promise.all([saveWallet(w), setCourtVault(vault - amount)]);
            await sock.sendMessage(chatId, {
                text: `💰 *Vault Distribution*\n\nSent *${fmt(amount)} 🪙* to @${cleanJid(target)}\n🏦 Vault remaining: *${fmt(vault - amount)} 🪙*`,
                mentions: [target], ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── VAULT ───────────────────────────────────────────────────────────────
    {
        command: 'courtvault',
        aliases: ['vaultbal', 'vaultbalance', 'courttreasury'],
        category: 'court',
        description: 'Check the court vault balance',
        usage: '.courtvault',
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const amount = await getCourtVault();
            await sock.sendMessage(chatId, {
                text: `⚖️ *Court Vault Balance:* ${fmt(amount)} 🪙\n\nUse *.distribute @user <amount>* to pay out.`,
                ...channelInfo
            }, { quoted: message });
        }
    },

    // ─── CASES ───────────────────────────────────────────────────────────────
    {
        command: 'cases',
        aliases: ['courtcases', 'opencase'],
        category: 'court',
        description: 'List active court cases in this group',
        usage: '.cases',
        groupOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const active = await getActiveCases(chatId);
            if (!active.length) return sock.sendMessage(chatId, { text: `⚖️ No active court cases in this group.`, ...channelInfo }, { quoted: message });
            let text = `⚖️ *Active Court Cases*\n${D}\n\n`;
            active.forEach(c => {
                text += `📋 *${c.id}*\n👨‍⚖️ ${c.accuserName} vs 🧑‍💼 ${c.defendantName}\n📜 ${c.reason}\n🗳️ Guilty: ${c.votesGuilty.length} | Innocent: ${c.votesInnocent.length}\n\n`;
            });
            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        }
    },

    // ─── SETUP COURT ─────────────────────────────────────────────────────────
    {
        command: 'setupcourt',
        aliases: ['seedrules', 'initcourt', 'courtreset'],
        category: 'court',
        description: 'Seed the group with the full 70-rule Colly Constitution (admin only)',
        usage: '.setupcourt',
        groupOnly: true,
        adminOnly: true,
        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const db = (await import('../lib/turso.js')).getDb();
            const t2 = await import('../lib/turso2.js');

            const existingRules = await t2.getRules(chatId);
            if (existingRules.length > 0 && args[0]?.toLowerCase() !== 'force') {
                return sock.sendMessage(chatId, {
                    text:
                        `⚖️ *This group already has ${existingRules.length} rules.*\n\n` +
                        `Running *.setupcourt force* will *replace all rules* with the official 70-rule Colly Constitution.\n\n` +
                        `⚠️ This action cannot be undone.`,
                    ...channelInfo
                }, { quoted: message });
            }

            await sock.sendMessage(chatId, {
                text: `⏳ Seeding the *Colly Constitution* (70 rules)…`,
                ...channelInfo
            });

            await db.execute({ sql: `DELETE FROM group_rules WHERE group_id = ?`, args: [chatId] });
            for (const rule of DEFAULT_RULES) {
                await db.execute({
                    sql: `INSERT INTO group_rules (group_id, rule_num, text) VALUES (?, ?, ?)`,
                    args: [chatId, rule.num, `${rule.text} | Penalty: ${rule.penalty}`]
                });
            }

            await sock.sendMessage(chatId, {
                text:
                    `⚖️ *COLLY CONSTITUTION INSTALLED* ⚖️\n${D}\n\n` +
                    `✅ *70 Laws* have been seeded into this group.\n\n` +
                    `📜 Use *.rules* to view all articles.\n` +
                    `📋 Use *.sue @user §<num>* to cite a specific law.\n\n` +
                    `${S}\n` +
                    `🏛️ This group is now governed by the *Colly Court of Justice.*\n` +
                    `All offences are subject to bot-enforced penalties.\n${D}\n` +
                    `_🔖 Colly novels | 👨‍💻 DavidXTech_`,
                ...channelInfo
            }, { quoted: message });
        }
    },
];
