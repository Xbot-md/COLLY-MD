import type { BotContext } from '../types.js';
import isOwnerOrSudo from '../lib/isOwner.js';
import { getDb, getWallet, saveWallet, removeBlacklist } from '../lib/turso.js';

const FLUID_BARS = ['[ | ] 1/5', '[ || ] 2/5', '[ ||| ] 3/5', '[ |||| ] 4/5', '[ ||||| ] 5/5'];

export default [
    {
        command: 'portal',
        aliases: ['rickportal', 'dimension', 'c137'],
        category: 'owner',
        description: 'Open a portal to erase tax debt, cooldowns, lawsuits & violations for a user',
        usage: `.portal @user`,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;

            const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
            if (!isOwner) {
                return sock.sendMessage(chatId, {
                    text: `❌ Only Rick can operate the portal gun.`,
                    ...channelInfo
                }, { quoted: message });
            }

            const mentioned =
                message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
                message.message?.extendedTextMessage?.contextInfo?.participant;
            const targetJid = mentioned || senderId;
            const targetTag = `@${targetJid.split(':')[0].split('@')[0]}`;

            const db   = getDb();
            const results: Record<string, boolean> = {
                tax: false, cooldowns: false, lawsuits: false, violations: false,
            };

            // 1 — Erase tax debt (business card)
            try {
                await db.execute({ sql: `UPDATE biz_cards SET tax_due = 0 WHERE owner_id = ?`, args: [targetJid] });
                results.tax = true;
            } catch { /* non-fatal */ }

            // 2 — Hack all cooldowns (DB fields + dynamic wallet props)
            try {
                await db.execute({
                    sql: `UPDATE eco_wallets SET last_work = 0, last_rob = 0, last_daily = 0 WHERE user_id = ?`,
                    args: [targetJid],
                });
                const w = await getWallet(targetJid, '');
                (w as any).lastOddJob   = 0;
                (w as any).lastCrime    = 0;
                (w as any).lastWeekly   = 0;
                (w as any).lastMonthly  = 0;
                w.lastWork  = 0;
                w.lastRob   = 0;
                w.lastDaily = 0;
                await saveWallet(w);
                results.cooldowns = true;
            } catch { /* non-fatal */ }

            // 3 — Purge court cases (lawsuits)
            try {
                await db.execute({
                    sql: `DELETE FROM court_cases WHERE defendant = ? OR accuser = ?`,
                    args: [targetJid, targetJid],
                });
                await db.execute({
                    sql: `DELETE FROM criminal_records WHERE user_id = ?`,
                    args: [targetJid],
                });
                results.lawsuits = true;
            } catch { /* non-fatal */ }

            // 4 — Incinerate violations (mutes, labor, dare, blacklist)
            try {
                await db.execute({ sql: `DELETE FROM court_mutes WHERE user_id = ?`,  args: [targetJid] });
                await db.execute({ sql: `DELETE FROM court_labor WHERE user_id = ?`,   args: [targetJid] });
                await db.execute({ sql: `DELETE FROM court_dare  WHERE user_id = ?`,   args: [targetJid] });
                await removeBlacklist(targetJid);
                results.violations = true;
            } catch { /* non-fatal */ }

            const fluid = FLUID_BARS[Math.floor(Math.random() * FLUID_BARS.length)];

            const taxLine        = results.tax        ? `✅ *TAX DEBT:* Erased. _(Don't spend it all on Glarble-fleck seeds)._`               : `⚠️ *TAX DEBT:* No business on file.`;
            const cooldownLine   = results.cooldowns  ? `✅ *COOLDOWNS:* Timers Hacked. _(Go do something productive for once)._`              : `⚠️ *COOLDOWNS:* Wallet not found.`;
            const lawsuitLine    = results.lawsuits   ? `✅ *LAWSUITS:* Files Purged. _(You're 'Innocent' now. Burp Technically)._`            : `⚠️ *LAWSUITS:* Nothing on file.`;
            const violationLine  = results.violations ? `✅ *VIOLATIONS:* History Incinerated. _(The police here don't even know you exist)._`  : `⚠️ *VIOLATIONS:* Nothing to clear.`;

            const panel =
`🌀 *PORTAL OPENED — DIMENSION C-137* 🌀
━━━━━━━━━━━━━━━━━━━━━━━━
🧪 *FLUID LEVEL:* ${fluid} CHARGES
_"Look, Morty, I—I—I did it. We're in a dimension where ${targetTag} isn't a total financial failure. It's—it's a statistical anomaly, Morty! A world where they didn't screw up their taxes or get sued for being an idiot. I've synced their biometric signature to this timeline's version of them. A boring nobody with a clean record, and now, so are they. Just—just don't get used to it. I'm not a cosmic janitor, Morty. I've got better things to do than wipe pathetic digital footprints every time someone gets a 'Lawsuit' notification. Move! Before the Chronicons track the portal leak!"_
━━━━━━━━━━━━━━━━━━━━━━━━
${taxLine}
${cooldownLine}
${lawsuitLine}
${violationLine}
━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ *WARNING:* Dimensional drift may cause temporary dizziness or an existential crisis. Side effects are not my problem.
━━━━━━━━━━━━━━━━━━━━━━━━
_Target: ${targetTag}_`;

            await sock.sendMessage(chatId, {
                text: panel,
                mentions: [targetJid],
                ...channelInfo
            }, { quoted: message });
        },
    },
];
