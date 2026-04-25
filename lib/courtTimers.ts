const D = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
const S = `══════════════════════════════`;

function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }
function fmt(n: number) { return n.toLocaleString(); }

interface CaseTimers {
    pleaTimer?: ReturnType<typeof setTimeout>;
    evidenceTimer?: ReturnType<typeof setTimeout>;
}

const activeTimers = new Map<string, CaseTimers>();

export function cancelCaseTimers(caseId: string) {
    const t = activeTimers.get(caseId);
    if (t) {
        if (t.pleaTimer) clearTimeout(t.pleaTimer);
        if (t.evidenceTimer) clearTimeout(t.evidenceTimer);
        activeTimers.delete(caseId);
    }
}

export function hasPleaTimer(caseId: string): boolean {
    return !!(activeTimers.get(caseId)?.pleaTimer);
}

export async function triggerJury(
    sock: any,
    caseId: string,
    chatId: string,
    accuserId: string,
    defendantId: string,
    charge: string,
    contempt: boolean
) {
    const allMembers: string[] = [];
    try { const m = await sock.groupMetadata(chatId); m.participants.forEach((p: any) => allMembers.push(p.id)); } catch {}
    await sock.sendMessage(chatId, {
        text:
            `🗳️ *JURY TRIAL CALLED* ⚖️\n${D}\n\n` +
            `📋 *Case:* ${caseId}\n` +
            `👤 *Defendant:* @${cleanJid(defendantId)}\n` +
            `📜 *Charge:* ${charge}\n\n` +
            (contempt ? `⚠️ *CONTEMPT MULTIPLIER ACTIVE* — Defendant ignored the plea deadline. If found guilty, punishment is *DOUBLED.*\n\n` : '') +
            `${S}\n🗳️ *ALL MEMBERS — CAST YOUR VOTE:*\n${S}\n\n` +
            `• *.guilty ${caseId}* — Vote Guilty\n` +
            `• *.innocent ${caseId}* — Vote Innocent\n\n` +
            `_Admin closes the trial with_ *.verdict ${caseId} guilty/innocent*\n${D}`,
        mentions: [defendantId, accuserId, ...allMembers]
    });
}

export async function startPleaTimer(
    sock: any,
    caseId: string,
    chatId: string,
    defendantId: string,
    accuserId: string,
    charge: string
) {
    cancelCaseTimers(caseId);

    const pleaTimer = setTimeout(async () => {
        try {
            const { getCase } = await import('./turso.js');
            const courtCase = await getCase(caseId);
            if (!courtCase || courtCase.status !== 'voting') return;

            const { getPlead, setCaseMeta } = await import('./turso2.js');
            const plea = await getPlead(caseId);
            if (plea) return;

            await Promise.all([
                setCaseMeta(caseId, 'contempt', 'true'),
                setCaseMeta(caseId, 'auto_plea', 'innocent')
            ]);

            const allMembers: string[] = [];
            try { const m = await sock.groupMetadata(chatId); m.participants.forEach((p: any) => allMembers.push(p.id)); } catch {}

            await sock.sendMessage(chatId, {
                text:
                    `⚠️ *CONTEMPT OF COURT* ⚠️\n${D}\n\n` +
                    `@${cleanJid(defendantId)} *failed* to enter a plea within 2 minutes!\n\n` +
                    `⚖️ *Automatic NOT GUILTY plea entered.*\n` +
                    `🔴 *CONTEMPT MULTIPLIER ACTIVE* — If found guilty, punishment is *DOUBLED.*\n\n` +
                    `📤 *Plaintiff @${cleanJid(accuserId)}:*\n` +
                    `You have *2 minutes* to submit *.evidence ${caseId}*.\n` +
                    `Fail to provide proof → case *DISMISSED* and you are *FINED* (§40 False Indictment).`,
                mentions: [defendantId, accuserId, ...allMembers]
            });

            startEvidenceTimer(sock, caseId, chatId, accuserId, defendantId, charge, true);
        } catch (e) {
            console.error('[CourtTimer] Plea timer error:', e);
        }
    }, 2 * 60 * 1000);

    activeTimers.set(caseId, { pleaTimer });
}

export async function startEvidenceTimer(
    sock: any,
    caseId: string,
    chatId: string,
    accuserId: string,
    defendantId: string,
    charge: string,
    contempt = false
) {
    const existing = activeTimers.get(caseId) || {};
    if (existing.evidenceTimer) clearTimeout(existing.evidenceTimer);

    const evidenceTimer = setTimeout(async () => {
        try {
            const { getCase, updateCase, getWallet, saveWallet, getCourtVault, setCourtVault } = await import('./turso.js');
            const courtCase = await getCase(caseId);
            if (!courtCase || courtCase.status !== 'voting') return;

            const { getCaseMeta, addCriminalRecord } = await import('./turso2.js');
            const evidenceSubmitted = await getCaseMeta(caseId, 'evidence_submitted');
            if (evidenceSubmitted === 'true') return;

            courtCase.status = 'innocent';
            await updateCase(courtCase);

            const [accuserWallet, vault] = await Promise.all([
                getWallet(accuserId, cleanJid(accuserId)),
                getCourtVault()
            ]);
            const fine = Math.min(accuserWallet.balance, 300);
            accuserWallet.balance -= fine;
            await Promise.all([
                saveWallet(accuserWallet),
                setCourtVault(vault + fine),
                addCriminalRecord(accuserId, chatId, caseId, 'guilty', 'False Indictment (§40) — No evidence provided', `Fined ${fine} coins`, 'BOT', 'COLLY COURT')
            ]);

            cancelCaseTimers(caseId);

            const allMembers: string[] = [];
            try { const m = await sock.groupMetadata(chatId); m.participants.forEach((p: any) => allMembers.push(p.id)); } catch {}

            await sock.sendMessage(chatId, {
                text:
                    `📁 *CASE DISMISSED — FALSE INDICTMENT* 📁\n${D}\n\n` +
                    `📋 *Case:* ${caseId}\n\n` +
                    `❌ *Plaintiff @${cleanJid(accuserId)} failed to provide evidence in time.*\n\n` +
                    `${S}\n⚖️ RULING\n${S}\n\n` +
                    `@${cleanJid(defendantId)} is fully *EXONERATED.* ✅\n\n` +
                    `🔴 *Plaintiff Penalty (§40 — False Indictment):*\n` +
                    `• Fine: *${fmt(fine)} 🪙* seized to vault\n` +
                    `• Case filed in plaintiff's criminal record\n\n${D}`,
                mentions: [accuserId, defendantId, ...allMembers]
            });
        } catch (e) {
            console.error('[CourtTimer] Evidence timer error:', e);
        }
    }, 2 * 60 * 1000);

    activeTimers.set(caseId, { ...existing, evidenceTimer });
}
