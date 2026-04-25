import { getDb } from './turso.js';

function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }

// ─── CASE META ────────────────────────────────────────────────────────────────

export async function setCaseMeta(caseId: string, key: string, value: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO case_meta (case_id, key, value) VALUES (?, ?, ?)
              ON CONFLICT(case_id, key) DO UPDATE SET value = excluded.value`,
        args: [caseId, key, value]
    });
}

export async function getCaseMeta(caseId: string, key: string): Promise<string | null> {
    const c = getDb();
    const r = await c.execute({ sql: `SELECT value FROM case_meta WHERE case_id = ? AND key = ?`, args: [caseId, key] });
    return r.rows[0] ? String(r.rows[0].value) : null;
}

export async function deleteCaseMeta(caseId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `DELETE FROM case_meta WHERE case_id = ?`, args: [caseId] });
}

// ─── GROUP RULES ─────────────────────────────────────────────────────────────

export async function getRules(groupId: string): Promise<{ rule_num: number; text: string }[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT rule_num, text FROM group_rules WHERE group_id = ? ORDER BY rule_num ASC`, args: [groupId] });
    return res.rows.map(r => ({ rule_num: Number(r.rule_num), text: r.text as string }));
}

export async function addRule(groupId: string, text: string): Promise<number> {
    const c = getDb();
    const maxRes = await c.execute({ sql: `SELECT COALESCE(MAX(rule_num), 70) as m FROM group_rules WHERE group_id = ?`, args: [groupId] });
    const nextNum = Number(maxRes.rows[0].m) + 1;
    await c.execute({ sql: `INSERT INTO group_rules (group_id, rule_num, text) VALUES (?, ?, ?)`, args: [groupId, nextNum, text] });
    return nextNum;
}

export async function deleteRule(groupId: string, ruleNum: number): Promise<boolean> {
    const c = getDb();
    const res = await c.execute({ sql: `DELETE FROM group_rules WHERE group_id = ? AND rule_num = ?`, args: [groupId, ruleNum] });
    if (res.rowsAffected === 0) return false;
    await c.execute({ sql: `UPDATE group_rules SET rule_num = rule_num - 1 WHERE group_id = ? AND rule_num > ?`, args: [groupId, ruleNum] });
    return true;
}

// ─── RULE PROPOSALS ──────────────────────────────────────────────────────────

export async function addProposal(groupId: string, proposer: string, proposerName: string, text: string): Promise<number> {
    const c = getDb();
    const res = await c.execute({
        sql: `INSERT INTO rule_proposals (group_id, proposer, proposer_name, text, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`,
        args: [groupId, proposer, proposerName, text, Date.now()]
    });
    return Number(res.lastInsertRowid);
}

export async function getPendingProposals(groupId: string): Promise<{ id: number; proposer_name: string; text: string }[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT id, proposer_name, text FROM rule_proposals WHERE group_id = ? AND status = 'pending' ORDER BY created_at ASC`, args: [groupId] });
    return res.rows.map(r => ({ id: Number(r.id), proposer_name: r.proposer_name as string, text: r.text as string }));
}

export async function resolveProposal(id: number, status: 'approved' | 'rejected'): Promise<{ groupId: string; text: string } | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT group_id, text FROM rule_proposals WHERE id = ? AND status = 'pending'`, args: [id] });
    if (!res.rows.length) return null;
    const row = res.rows[0];
    await c.execute({ sql: `UPDATE rule_proposals SET status = ? WHERE id = ?`, args: [status, id] });
    if (status === 'approved') {
        await addRule(row.group_id as string, row.text as string);
    }
    return { groupId: row.group_id as string, text: row.text as string };
}

// ─── PLEAD RESPONSES ─────────────────────────────────────────────────────────

export async function recordPlead(caseId: string, defendant: string, response: 'guilty' | 'innocent'): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO plead_responses (case_id, defendant, response, timestamp) VALUES (?, ?, ?, ?) ON CONFLICT(case_id) DO UPDATE SET response = excluded.response, timestamp = excluded.timestamp`,
        args: [caseId, defendant, response, Date.now()]
    });
}

export async function getPlead(caseId: string): Promise<{ response: 'guilty' | 'innocent'; defendant: string } | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT response, defendant FROM plead_responses WHERE case_id = ?`, args: [caseId] });
    if (!res.rows.length) return null;
    return { response: res.rows[0].response as 'guilty' | 'innocent', defendant: res.rows[0].defendant as string };
}

// ─── COURT MUTES ─────────────────────────────────────────────────────────────

export async function addMute(userId: string, groupId: string, mutedBy: string, mutedUntil = 0, reason = ''): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO court_mutes (user_id, group_id, msg_count, muted_by, muted_at, muted_until, reason)
              VALUES (?, ?, 0, ?, ?, ?, ?)
              ON CONFLICT(user_id, group_id) DO UPDATE SET
                msg_count = 0, muted_by = excluded.muted_by, muted_at = excluded.muted_at,
                muted_until = excluded.muted_until, reason = excluded.reason`,
        args: [userId, groupId, mutedBy, Date.now(), mutedUntil, reason]
    });
}

export async function getMute(userId: string, groupId: string): Promise<{ msg_count: number; muted_by: string; muted_until: number; reason: string } | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT msg_count, muted_by, muted_until, reason FROM court_mutes WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
    if (!res.rows.length) return null;
    const row = res.rows[0];
    const mutedUntil = Number(row.muted_until ?? 0);
    // Auto-expire timed court mutes
    if (mutedUntil > 0 && Date.now() > mutedUntil) {
        const { getDb: db2 } = await import('./turso.js');
        await db2().execute({ sql: `DELETE FROM court_mutes WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
        return null;
    }
    return { msg_count: Number(row.msg_count), muted_by: row.muted_by as string, muted_until: mutedUntil, reason: row.reason as string };
}

export async function incrementMuteCount(userId: string, groupId: string): Promise<number> {
    const c = getDb();
    await c.execute({ sql: `UPDATE court_mutes SET msg_count = msg_count + 1 WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
    const res = await c.execute({ sql: `SELECT msg_count FROM court_mutes WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
    return Number(res.rows[0]?.msg_count ?? 0);
}

export async function removeMute(userId: string, groupId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `DELETE FROM court_mutes WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
}

export async function getMutedUsers(groupId: string): Promise<{ user_id: string; msg_count: number }[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT user_id, msg_count FROM court_mutes WHERE group_id = ?`, args: [groupId] });
    return res.rows.map(r => ({ user_id: r.user_id as string, msg_count: Number(r.msg_count) }));
}

// ─── GROUP MUTES (regular admin mute) ────────────────────────────────────────

export async function addGroupMute(userId: string, groupId: string, mutedBy: string, mutedUntil = 0, reason = ''): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO group_mutes (user_id, group_id, muted_by, muted_at, muted_until, reason)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, group_id) DO UPDATE SET
                muted_by = excluded.muted_by, muted_at = excluded.muted_at,
                muted_until = excluded.muted_until, reason = excluded.reason`,
        args: [userId, groupId, mutedBy, Date.now(), mutedUntil, reason]
    });
}

export async function getGroupMute(userId: string, groupId: string): Promise<{ muted_by: string; muted_until: number; reason: string } | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT muted_by, muted_until, reason FROM group_mutes WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
    if (!res.rows.length) return null;
    const row = res.rows[0];
    const mutedUntil = Number(row.muted_until ?? 0);
    // Auto-expire timed group mutes
    if (mutedUntil > 0 && Date.now() > mutedUntil) {
        const { getDb: db2 } = await import('./turso.js');
        await db2().execute({ sql: `DELETE FROM group_mutes WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
        return null;
    }
    return { muted_by: row.muted_by as string, muted_until: mutedUntil, reason: row.reason as string };
}

export async function removeGroupMute(userId: string, groupId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `DELETE FROM group_mutes WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
}

// ─── LABOR & DARE ────────────────────────────────────────────────────────────

export async function assignLabor(userId: string, groupId: string, task: string, assignedBy: string, durationMs: number): Promise<void> {
    const c = getDb();
    const expiresAt = Date.now() + durationMs;
    await c.execute({
        sql: `INSERT INTO court_labor (user_id, group_id, task, assigned_by, expires_at, verified, verifier) VALUES (?, ?, ?, ?, ?, 0, NULL) ON CONFLICT(user_id, group_id) DO UPDATE SET task = excluded.task, assigned_by = excluded.assigned_by, expires_at = excluded.expires_at, verified = 0, verifier = NULL`,
        args: [userId, groupId, task, assignedBy, expiresAt]
    });
}

export async function getLabor(userId: string, groupId: string): Promise<{ task: string; expires_at: number; verified: boolean; verifier: string | null } | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT task, expires_at, verified, verifier FROM court_labor WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
    if (!res.rows.length) return null;
    return { task: res.rows[0].task as string, expires_at: Number(res.rows[0].expires_at), verified: Boolean(res.rows[0].verified), verifier: res.rows[0].verifier as string | null };
}

export async function assignDare(userId: string, groupId: string, task: string, assignedBy: string, durationMs: number): Promise<void> {
    const c = getDb();
    const expiresAt = Date.now() + durationMs;
    await c.execute({
        sql: `INSERT INTO court_dare (user_id, group_id, task, assigned_by, expires_at, verified, verifier) VALUES (?, ?, ?, ?, ?, 0, NULL) ON CONFLICT(user_id, group_id) DO UPDATE SET task = excluded.task, assigned_by = excluded.assigned_by, expires_at = excluded.expires_at, verified = 0, verifier = NULL`,
        args: [userId, groupId, task, assignedBy, expiresAt]
    });
}

export async function getDare(userId: string, groupId: string): Promise<{ task: string; expires_at: number; verified: boolean; verifier: string | null } | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT task, expires_at, verified, verifier FROM court_dare WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
    if (!res.rows.length) return null;
    return { task: res.rows[0].task as string, expires_at: Number(res.rows[0].expires_at), verified: Boolean(res.rows[0].verified), verifier: res.rows[0].verifier as string | null };
}

export async function verifyTask(userId: string, groupId: string, type: 'labor' | 'dare', verifier: string): Promise<boolean> {
    const c = getDb();
    const table = type === 'labor' ? 'court_labor' : 'court_dare';
    const res = await c.execute({ sql: `UPDATE ${table} SET verified = 1, verifier = ? WHERE user_id = ? AND group_id = ? AND verified = 0`, args: [verifier, userId, groupId] });
    return res.rowsAffected > 0;
}

export async function clearTask(userId: string, groupId: string, type: 'labor' | 'dare'): Promise<void> {
    const c = getDb();
    const table = type === 'labor' ? 'court_labor' : 'court_dare';
    await c.execute({ sql: `DELETE FROM ${table} WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
}

export async function getPendingTasks(groupId: string): Promise<{ user_id: string; type: string; task: string; expires_at: number }[]> {
    const c = getDb();
    const [labor, dare] = await Promise.all([
        c.execute({ sql: `SELECT user_id, task, expires_at FROM court_labor WHERE group_id = ? AND verified = 0`, args: [groupId] }),
        c.execute({ sql: `SELECT user_id, task, expires_at FROM court_dare WHERE group_id = ? AND verified = 0`, args: [groupId] })
    ]);
    const results: { user_id: string; type: string; task: string; expires_at: number }[] = [];
    labor.rows.forEach(r => results.push({ user_id: r.user_id as string, type: '🏗️ Labor', task: r.task as string, expires_at: Number(r.expires_at) }));
    dare.rows.forEach(r => results.push({ user_id: r.user_id as string, type: '😳 Dare', task: r.task as string, expires_at: Number(r.expires_at) }));
    return results;
}

// ─── CRIMINAL RECORDS ────────────────────────────────────────────────────────

export async function addCriminalRecord(userId: string, groupId: string, caseId: string, verdict: string, charge: string, punishment: string | null, judge: string, judgeName: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO criminal_records (user_id, group_id, case_id, verdict, charge, punishment, judge, judge_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [userId, groupId, caseId, verdict, charge, punishment, judge, judgeName, Date.now()]
    });
}

export async function getCriminalRecord(userId: string, groupId: string): Promise<{ case_id: string; verdict: string; charge: string; punishment: string | null; judge_name: string; timestamp: number }[]> {
    const c = getDb();
    const res = await c.execute({
        sql: `SELECT case_id, verdict, charge, punishment, judge_name, timestamp FROM criminal_records WHERE user_id = ? AND group_id = ? ORDER BY timestamp DESC LIMIT 10`,
        args: [userId, groupId]
    });
    return res.rows.map(r => ({
        case_id: r.case_id as string, verdict: r.verdict as string, charge: r.charge as string,
        punishment: r.punishment as string | null, judge_name: r.judge_name as string, timestamp: Number(r.timestamp)
    }));
}

export async function clearCriminalRecord(userId: string, groupId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `DELETE FROM criminal_records WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
}

export async function getRecentTrials(groupId: string, limit = 5): Promise<{ case_id: string; verdict: string; charge: string; judge_name: string; timestamp: number }[]> {
    const c = getDb();
    const res = await c.execute({
        sql: `SELECT case_id, verdict, charge, judge_name, timestamp FROM criminal_records WHERE group_id = ? ORDER BY timestamp DESC LIMIT ?`,
        args: [groupId, limit]
    });
    return res.rows.map(r => ({
        case_id: r.case_id as string, verdict: r.verdict as string, charge: r.charge as string,
        judge_name: r.judge_name as string, timestamp: Number(r.timestamp)
    }));
}

// ─── CITIZENS ────────────────────────────────────────────────────────────────

export async function grantCitizenship(userId: string, groupId: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT OR IGNORE INTO citizens (user_id, group_id, alias, granted_at) VALUES (?, ?, NULL, ?)`,
        args: [userId, groupId, Date.now()]
    });
}

export async function revokeCitizenship(userId: string, groupId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `DELETE FROM citizens WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
}

export async function isCitizen(userId: string, groupId: string): Promise<boolean> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT 1 FROM citizens WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
    return res.rows.length > 0;
}

export async function setAlias(userId: string, groupId: string, alias: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO citizens (user_id, group_id, alias, granted_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, group_id) DO UPDATE SET alias = excluded.alias`,
        args: [userId, groupId, alias, Date.now()]
    });
}

export async function getCitizen(userId: string, groupId: string): Promise<{ alias: string | null; granted_at: number } | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT alias, granted_at FROM citizens WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
    if (!res.rows.length) return null;
    return { alias: res.rows[0].alias as string | null, granted_at: Number(res.rows[0].granted_at) };
}

export async function getCitizenCount(groupId: string): Promise<number> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT COUNT(*) as cnt FROM citizens WHERE group_id = ?`, args: [groupId] });
    return Number(res.rows[0].cnt);
}

// ─── MARRIAGES ───────────────────────────────────────────────────────────────

export async function proposeMarriage(proposer: string, proposerName: string, target: string, groupId: string): Promise<number> {
    const c = getDb();
    const res = await c.execute({
        sql: `INSERT INTO marriage_proposals (proposer, proposer_name, target, group_id, created_at, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
        args: [proposer, proposerName, target, groupId, Date.now()]
    });
    return Number(res.lastInsertRowid);
}

export async function getPendingProposal(target: string, groupId: string): Promise<{ id: number; proposer: string; proposer_name: string } | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT id, proposer, proposer_name FROM marriage_proposals WHERE target = ? AND group_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, args: [target, groupId] });
    if (!res.rows.length) return null;
    return { id: Number(res.rows[0].id), proposer: res.rows[0].proposer as string, proposer_name: res.rows[0].proposer_name as string };
}

export async function acceptMarriage(proposalId: number, groupId: string): Promise<{ user1: string; user2: string } | null> {
    const c = getDb();
    const propRes = await c.execute({ sql: `SELECT proposer, target FROM marriage_proposals WHERE id = ? AND status = 'pending'`, args: [proposalId] });
    if (!propRes.rows.length) return null;
    const { proposer, target } = propRes.rows[0] as unknown as { proposer: string; target: string };
    await c.execute({ sql: `UPDATE marriage_proposals SET status = 'accepted' WHERE id = ?`, args: [proposalId] });
    await c.execute({ sql: `INSERT INTO marriages (user1, user2, married_at, status, group_id) VALUES (?, ?, ?, 'active', ?)`, args: [proposer, target, Date.now(), groupId] });
    return { user1: proposer, user2: target };
}

export async function getMarriage(userId: string, groupId: string): Promise<{ partner: string; married_at: number } | null> {
    const c = getDb();
    const res = await c.execute({
        sql: `SELECT user1, user2, married_at FROM marriages WHERE (user1 = ? OR user2 = ?) AND group_id = ? AND status = 'active'`,
        args: [userId, userId, groupId]
    });
    if (!res.rows.length) return null;
    const row = res.rows[0];
    const partner = (row.user1 as string) === userId ? (row.user2 as string) : (row.user1 as string);
    return { partner, married_at: Number(row.married_at) };
}

export async function divorce(userId: string, groupId: string): Promise<boolean> {
    const c = getDb();
    const res = await c.execute({
        sql: `UPDATE marriages SET status = 'divorced' WHERE (user1 = ? OR user2 = ?) AND group_id = ? AND status = 'active'`,
        args: [userId, userId, groupId]
    });
    return res.rowsAffected > 0;
}

// ─── FAMILY TREE ─────────────────────────────────────────────────────────────

export async function adopt(parentId: string, childId: string, groupId: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT OR IGNORE INTO family_tree (parent_id, child_id, group_id, adopted_at) VALUES (?, ?, ?, ?)`,
        args: [parentId, childId, groupId, Date.now()]
    });
}

export async function disown(parentId: string, childId: string, groupId: string): Promise<boolean> {
    const c = getDb();
    const res = await c.execute({ sql: `DELETE FROM family_tree WHERE parent_id = ? AND child_id = ? AND group_id = ?`, args: [parentId, childId, groupId] });
    return res.rowsAffected > 0;
}

export async function getFamily(userId: string, groupId: string): Promise<{ children: string[]; parents: string[] }> {
    const c = getDb();
    const [childRes, parentRes] = await Promise.all([
        c.execute({ sql: `SELECT child_id FROM family_tree WHERE parent_id = ? AND group_id = ?`, args: [userId, groupId] }),
        c.execute({ sql: `SELECT parent_id FROM family_tree WHERE child_id = ? AND group_id = ?`, args: [userId, groupId] })
    ]);
    return {
        children: childRes.rows.map(r => r.child_id as string),
        parents: parentRes.rows.map(r => r.parent_id as string)
    };
}

// ─── PENDING ADOPTIONS ────────────────────────────────────────────────────────

export async function createAdoptionRequest(parentId: string, childId: string, groupId: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT OR REPLACE INTO pending_adoptions (parent_id, child_id, group_id, created_at) VALUES (?, ?, ?, ?)`,
        args: [parentId, childId, groupId, Date.now()]
    });
}

export async function getAdoptionRequest(childId: string, groupId: string): Promise<{ parent_id: string; child_id: string; group_id: string; created_at: number } | null> {
    const c = getDb();
    const res = await c.execute({
        sql: `SELECT * FROM pending_adoptions WHERE child_id = ? AND group_id = ?`,
        args: [childId, groupId]
    });
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return { parent_id: r.parent_id as string, child_id: r.child_id as string, group_id: r.group_id as string, created_at: r.created_at as number };
}

export async function deleteAdoptionRequest(childId: string, groupId: string): Promise<boolean> {
    const c = getDb();
    const res = await c.execute({
        sql: `DELETE FROM pending_adoptions WHERE child_id = ? AND group_id = ?`,
        args: [childId, groupId]
    });
    return res.rowsAffected > 0;
}

// ─── DEPORTATIONS ────────────────────────────────────────────────────────────

export async function deport(userId: string, groupId: string, deportedBy: string, durationMs: number): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO deportations (user_id, group_id, expires_at, deported_by) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, group_id) DO UPDATE SET expires_at = excluded.expires_at, deported_by = excluded.deported_by`,
        args: [userId, groupId, Date.now() + durationMs, deportedBy]
    });
}

export async function isDeported(userId: string, groupId: string): Promise<boolean> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT expires_at FROM deportations WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
    if (!res.rows.length) return false;
    if (Number(res.rows[0].expires_at) < Date.now()) {
        await c.execute({ sql: `DELETE FROM deportations WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
        return false;
    }
    return true;
}

// ─── APPEALS ─────────────────────────────────────────────────────────────────

export async function submitAppeal(caseId: string, appellant: string, groupId: string, reason: string): Promise<boolean> {
    const c = getDb();
    const existing = await c.execute({ sql: `SELECT id FROM appeals WHERE appellant = ? AND group_id = ?`, args: [appellant, groupId] });
    if (existing.rows.length) return false;
    await c.execute({
        sql: `INSERT INTO appeals (case_id, appellant, group_id, reason, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`,
        args: [caseId, appellant, groupId, reason, Date.now()]
    });
    return true;
}

export async function getPendingAppeals(groupId?: string): Promise<{ id: number; case_id: string; group_id: string; reason: string; created_at: number }[]> {
    const c = getDb();
    const res = groupId
        ? await c.execute({ sql: `SELECT id, case_id, group_id, reason, created_at FROM appeals WHERE group_id = ? AND status = 'pending'`, args: [groupId] })
        : await c.execute(`SELECT id, case_id, group_id, reason, created_at FROM appeals WHERE status = 'pending'`);
    return res.rows.map(r => ({ id: Number(r.id), case_id: r.case_id as string, group_id: r.group_id as string, reason: r.reason as string, created_at: Number(r.created_at) }));
}

// ─── BRIBE ───────────────────────────────────────────────────────────────────

export async function submitBribe(caseId: string, defendant: string, adminId: string, amount: number): Promise<number> {
    const c = getDb();
    const res = await c.execute({
        sql: `INSERT INTO bribe_log (case_id, defendant, admin_id, amount, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`,
        args: [caseId, defendant, adminId, amount, Date.now()]
    });
    return Number(res.lastInsertRowid);
}

export async function getPendingBribe(caseId: string, adminId: string): Promise<{ id: number; amount: number; defendant: string } | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT id, amount, defendant FROM bribe_log WHERE case_id = ? AND admin_id = ? AND status = 'pending' LIMIT 1`, args: [caseId, adminId] });
    if (!res.rows.length) return null;
    return { id: Number(res.rows[0].id), amount: Number(res.rows[0].amount), defendant: res.rows[0].defendant as string };
}

export async function resolveBribe(id: number, status: 'accepted' | 'reported'): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `UPDATE bribe_log SET status = ? WHERE id = ?`, args: [status, id] });
}

// ─── ADMIN DUTY / PAYROLL ────────────────────────────────────────────────────

export async function addDutyPoints(userId: string, groupId: string, points: number): Promise<void> {
    const c = getDb();
    const salaryRes = await c.execute({ sql: `SELECT value FROM group_settings WHERE group_id = ? AND key = 'salary_per_point'`, args: [groupId] });
    const coinsPerPoint = salaryRes.rows.length ? Number(salaryRes.rows[0].value) : 10;
    const coins = points * coinsPerPoint;
    await c.execute({
        sql: `INSERT INTO admin_duty (user_id, group_id, duty_points, pending_coins) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, group_id) DO UPDATE SET duty_points = duty_points + ?, pending_coins = pending_coins + ?`,
        args: [userId, groupId, points, coins, points, coins]
    });
}

export async function getPayroll(groupId: string): Promise<{ user_id: string; duty_points: number; pending_coins: number }[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT user_id, duty_points, pending_coins FROM admin_duty WHERE group_id = ? AND duty_points > 0 ORDER BY duty_points DESC`, args: [groupId] });
    return res.rows.map(r => ({ user_id: r.user_id as string, duty_points: Number(r.duty_points), pending_coins: Number(r.pending_coins) }));
}

export async function claimDuty(userId: string, groupId: string): Promise<number> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT pending_coins FROM admin_duty WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
    if (!res.rows.length || Number(res.rows[0].pending_coins) === 0) return 0;
    const coins = Number(res.rows[0].pending_coins);
    await c.execute({ sql: `UPDATE admin_duty SET duty_points = 0, pending_coins = 0 WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
    return coins;
}

export async function logAudit(adminId: string, adminName: string, groupId: string, action: string, amount: number): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO audit_log (admin_id, admin_name, group_id, action, amount, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [adminId, adminName, groupId, action, amount, Date.now()]
    });
}

export async function getAuditLog(groupId: string, limit = 20): Promise<{ admin_name: string; action: string; amount: number; timestamp: number }[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT admin_name, action, amount, timestamp FROM audit_log WHERE group_id = ? ORDER BY timestamp DESC LIMIT ?`, args: [groupId, limit] });
    return res.rows.map(r => ({ admin_name: r.admin_name as string, action: r.action as string, amount: Number(r.amount), timestamp: Number(r.timestamp) }));
}

// ─── GROUP SETTINGS ──────────────────────────────────────────────────────────

export async function getGroupSetting(groupId: string, key: string): Promise<string | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT value FROM group_settings WHERE group_id = ? AND key = ?`, args: [groupId, key] });
    return res.rows.length ? res.rows[0].value as string : null;
}

export async function setGroupSetting(groupId: string, key: string, value: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO group_settings (group_id, key, value) VALUES (?, ?, ?) ON CONFLICT(group_id, key) DO UPDATE SET value = excluded.value`,
        args: [groupId, key, value]
    });
}

// ─── ADMIN VOTES ─────────────────────────────────────────────────────────────

export async function startAdminVote(groupId: string, candidate: string, candidateName: string, startedBy: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO admin_votes (group_id, candidate, candidate_name, votes, started_by, started_at, status) VALUES (?, ?, ?, '[]', ?, ?, 'active')`,
        args: [groupId, candidate, candidateName, startedBy, Date.now()]
    });
}

export async function getAdminVote(groupId: string, candidate: string): Promise<{ id: number; candidate_name: string; votes: string[]; started_at: number } | null> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT id, candidate_name, votes, started_at FROM admin_votes WHERE group_id = ? AND candidate = ? AND status = 'active' LIMIT 1`, args: [groupId, candidate] });
    if (!res.rows.length) return null;
    return { id: Number(res.rows[0].id), candidate_name: res.rows[0].candidate_name as string, votes: JSON.parse(res.rows[0].votes as string), started_at: Number(res.rows[0].started_at) };
}

export async function castAdminVote(id: number, voterId: string): Promise<string[]> {
    const c = getDb();
    const res = await c.execute({ sql: `SELECT votes FROM admin_votes WHERE id = ?`, args: [id] });
    const votes: string[] = JSON.parse(res.rows[0].votes as string);
    if (!votes.includes(voterId)) votes.push(voterId);
    await c.execute({ sql: `UPDATE admin_votes SET votes = ? WHERE id = ?`, args: [JSON.stringify(votes), id] });
    return votes;
}

export async function closeAdminVote(id: number): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `UPDATE admin_votes SET status = 'closed' WHERE id = ?`, args: [id] });
}

// ─── COURT IDS ────────────────────────────────────────────────────────────────

export interface CourtIdRecord {
    userId: string;
    groupId: string;
    legalName: string;
    dob: string;
    nationality: string;
    idNumber: string;
    issueDate: number;
    expiryDate: number;
    citizenSince: number;
}

export async function getCourtId(userId: string): Promise<CourtIdRecord | null> {
    const c = getDb();
    const r = await c.execute({ sql: `SELECT * FROM court_ids WHERE user_id = ?`, args: [userId] });
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return {
        userId:       row.user_id as string,
        groupId:      row.group_id as string,
        legalName:    row.legal_name as string,
        dob:          row.dob as string,
        nationality:  row.nationality as string,
        idNumber:     row.id_number as string,
        issueDate:    Number(row.issue_date),
        expiryDate:   Number(row.expiry_date),
        citizenSince: Number(row.citizen_since),
    };
}

export async function createCourtId(data: CourtIdRecord): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO court_ids (user_id, group_id, legal_name, dob, nationality, id_number, issue_date, expiry_date, citizen_since)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [data.userId, data.groupId, data.legalName, data.dob, data.nationality, data.idNumber, data.issueDate, data.expiryDate, data.citizenSince]
    });
}

export async function updateCourtIdName(userId: string, newName: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `UPDATE court_ids SET legal_name = ? WHERE user_id = ?`, args: [newName, userId] });
}

export async function renewCourtId(userId: string, newExpiry: number): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `UPDATE court_ids SET expiry_date = ? WHERE user_id = ?`, args: [newExpiry, userId] });
}

export async function deleteCourtId(userId: string): Promise<boolean> {
    const c = getDb();
    const res = await c.execute({ sql: `DELETE FROM court_ids WHERE user_id = ?`, args: [userId] });
    return res.rowsAffected > 0;
}

// ─── ID SUSPENSIONS ───────────────────────────────────────────────────────────

export interface IdSuspension {
    userId: string;
    groupId: string;
    suspendedBy: string;
    suspendedByName: string;
    suspendedUntil: number;
    reason: string;
}

export async function suspendCourtId(
    userId: string,
    groupId: string,
    suspendedBy: string,
    suspendedByName: string,
    days: number,
    reason = ''
): Promise<void> {
    const c = getDb();
    const until = Date.now() + days * 24 * 60 * 60 * 1000;
    await c.execute({
        sql: `INSERT OR REPLACE INTO suspended_ids (user_id, group_id, suspended_by, suspended_by_name, suspended_until, reason) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [userId, groupId, suspendedBy, suspendedByName, until, reason]
    });
}

export async function getIdSuspension(userId: string, groupId: string): Promise<IdSuspension | null> {
    const c = getDb();
    const res = await c.execute({
        sql: `SELECT * FROM suspended_ids WHERE user_id = ? AND group_id = ? AND suspended_until > ?`,
        args: [userId, groupId, Date.now()]
    });
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
        userId:          r.user_id as string,
        groupId:         r.group_id as string,
        suspendedBy:     r.suspended_by as string,
        suspendedByName: r.suspended_by_name as string,
        suspendedUntil:  Number(r.suspended_until),
        reason:          r.reason as string,
    };
}

export async function isIdSuspended(userId: string, groupId: string): Promise<boolean> {
    const s = await getIdSuspension(userId, groupId);
    return s !== null;
}

export async function liftIdSuspension(userId: string, groupId: string): Promise<boolean> {
    const c = getDb();
    const res = await c.execute({
        sql: `DELETE FROM suspended_ids WHERE user_id = ? AND group_id = ?`,
        args: [userId, groupId]
    });
    return res.rowsAffected > 0;
}

// ─── CITIZEN LOANS ────────────────────────────────────────────────────────────

export interface LoanRecord {
    userId:   string;
    amount:   number;
    interest: number;
    issuedAt: number;
    dueDate:  number;
    reason:   string;
    hours:    number;
}

export async function getLoan(userId: string): Promise<LoanRecord | null> {
    const c = getDb();
    const r = await c.execute({ sql: `SELECT * FROM citizen_loans WHERE user_id = ?`, args: [userId] });
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return {
        userId:   row.user_id as string,
        amount:   Number(row.amount),
        interest: Number(row.interest),
        issuedAt: Number(row.issued_at),
        dueDate:  Number(row.due_date),
        reason:   (row.reason as string) || '',
        hours:    Number(row.hours) || 168,
    };
}

export async function createLoan(
    userId: string,
    amount: number,
    interest: number,
    reason = '',
    hours = 168
): Promise<void> {
    const c = getDb();
    const now = Date.now();
    const dueDate = now + hours * 60 * 60 * 1000;
    await c.execute({
        sql: `INSERT OR REPLACE INTO citizen_loans (user_id, amount, interest, issued_at, due_date, reason, hours) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [userId, amount, interest, now, dueDate, reason, hours]
    });
}

export async function hasActiveCases(userId: string, groupId: string): Promise<boolean> {
    const c = getDb();
    const res = await c.execute({
        sql: `SELECT id FROM court_cases WHERE (defendant = ? OR plaintiff = ?) AND group_id = ? AND status IN ('pending','voting') LIMIT 1`,
        args: [userId, userId, groupId]
    });
    return res.rows.length > 0;
}

export async function repayLoan(userId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `DELETE FROM citizen_loans WHERE user_id = ?`, args: [userId] });
}

// ─── LOTTERY POOL ─────────────────────────────────────────────────────────────

export async function addLotteryTicket(userId: string, userName: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT INTO lottery_pool (user_id, user_name, purchased_at) VALUES (?, ?, ?)`,
        args: [userId, userName, Date.now()]
    });
}

export async function getLotteryPool(): Promise<{ userId: string; userName: string }[]> {
    const c = getDb();
    const r = await c.execute(`SELECT user_id, user_name FROM lottery_pool`);
    return r.rows.map(row => ({ userId: row.user_id as string, userName: row.user_name as string }));
}

export async function clearLotteryPool(): Promise<void> {
    const c = getDb();
    await c.execute(`DELETE FROM lottery_pool`);
}

// ─── CREDIT FREEZES ───────────────────────────────────────────────────────────

export interface CreditFreeze {
    userId:   string;
    groupId:  string;
    amount:   number;
    tax:      number;
    reason:   string;
    issuedBy: string;
    issuedAt: number;
}

export async function getCreditFreeze(userId: string, groupId: string): Promise<CreditFreeze | null> {
    const c = getDb();
    const r = await c.execute({
        sql: `SELECT * FROM credit_freezes WHERE user_id = ? AND group_id = ?`,
        args: [userId, groupId]
    });
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return {
        userId:   row.user_id as string,
        groupId:  row.group_id as string,
        amount:   Number(row.amount),
        tax:      Number(row.tax),
        reason:   row.reason as string,
        issuedBy: row.issued_by as string,
        issuedAt: Number(row.issued_at),
    };
}

export async function freezeCredit(
    userId: string, groupId: string,
    amount: number, tax: number,
    reason: string, issuedBy: string
): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT OR REPLACE INTO credit_freezes (user_id, group_id, amount, tax, reason, issued_by, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [userId, groupId, amount, tax, reason, issuedBy, Date.now()]
    });
}

export async function unfreezeCredit(userId: string, groupId: string): Promise<void> {
    const c = getDb();
    await c.execute({ sql: `DELETE FROM credit_freezes WHERE user_id = ? AND group_id = ?`, args: [userId, groupId] });
}

export async function garnishFreeze(userId: string, groupId: string, earned: number): Promise<number> {
    const freeze = await getCreditFreeze(userId, groupId);
    if (!freeze) return earned;
    const total = freeze.amount + freeze.tax;
    const garnish = Math.min(earned, total);
    const remaining = total - garnish;
    if (remaining <= 0) {
        await unfreezeCredit(userId, groupId);
    } else {
        const c = getDb();
        await c.execute({
            sql: `UPDATE credit_freezes SET amount = ?, tax = 0 WHERE user_id = ? AND group_id = ?`,
            args: [remaining, userId, groupId]
        });
    }
    return earned - garnish;
}

export async function garnishWorkFreeze(
    userId: string, groupId: string, gross: number
): Promise<{ vaultTax: number; appliedToDebt: number; kept: number; debtRemaining: number; cleared: boolean } | null> {
    const freeze = await getCreditFreeze(userId, groupId);
    if (!freeze) return null;
    const total = freeze.amount + freeze.tax;
    const vaultTax = Math.ceil(gross * 0.20);
    const towardDebt = gross - vaultTax;
    const appliedToDebt = Math.min(towardDebt, total);
    const kept = towardDebt > total ? towardDebt - total : 0;
    const debtRemaining = Math.max(0, total - appliedToDebt);
    if (debtRemaining <= 0) {
        await unfreezeCredit(userId, groupId);
    } else {
        const c = getDb();
        await c.execute({
            sql: `UPDATE credit_freezes SET amount = ?, tax = 0 WHERE user_id = ? AND group_id = ?`,
            args: [debtRemaining, userId, groupId]
        });
    }
    return { vaultTax, appliedToDebt, kept, debtRemaining, cleared: debtRemaining <= 0 };
}

// ─── ADMIN BANNED COMMANDS ────────────────────────────────────────────────────

export async function banAdminCmd(adminId: string, groupId: string, command: string, bannedBy: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `INSERT OR REPLACE INTO admin_banned_cmds (admin_id, group_id, command, banned_by, banned_at) VALUES (?, ?, ?, ?, ?)`,
        args: [adminId, groupId, command.toLowerCase().replace(/^\./, ''), bannedBy, Date.now()]
    });
}

export async function unbanAdminCmd(adminId: string, groupId: string, command: string): Promise<void> {
    const c = getDb();
    await c.execute({
        sql: `DELETE FROM admin_banned_cmds WHERE admin_id = ? AND group_id = ? AND command = ?`,
        args: [adminId, groupId, command.toLowerCase().replace(/^\./, '')]
    });
}

export async function isAdminCmdBanned(adminId: string, groupId: string, command: string): Promise<boolean> {
    const c = getDb();
    const r = await c.execute({
        sql: `SELECT 1 FROM admin_banned_cmds WHERE admin_id = ? AND group_id = ? AND command = ? LIMIT 1`,
        args: [adminId, groupId, command.toLowerCase().replace(/^\./, '')]
    });
    return r.rows.length > 0;
}
