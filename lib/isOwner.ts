import { isSudo } from './index.js';
import { lidToPhone } from './lidUtils.js';
import { isSuperOwner, isRegularOwner } from './ownerManager.js';

export function cleanJid(jid: string): string {
    if (!jid) return '';
    return jid.split(':')[0].split('@')[0];
}

/**
 * TIER 1 — Super owner check (Collins + David only).
 * Used by strictOwnerOnly / superOwnerOnly commands.
 */
function isSuperOwnerJid(jid: string): boolean {
    return isSuperOwner(jid);
}

/**
 * Check if a user has any owner-level access:
 *   Super owners + regular owners (DB) + sudo users + bot itself.
 * Used by ownerOnly commands.
 * Handles LID JID resolution automatically.
 */
async function isOwnerOrSudo(
    senderId: string,
    sock: any = null,
    chatId: string | null = null
): Promise<boolean> {
    // Super owner always passes
    if (isSuperOwnerJid(senderId)) return true;

    // Bot's own JID
    const botJid: string | undefined = (global as any)?.botJid;
    if (botJid && cleanJid(senderId) === cleanJid(botJid)) return true;

    // Regular owner (DB)
    if (await isRegularOwner(senderId)) return true;

    // Sudo list (legacy / group mods)
    if (await isSudo(senderId)) return true;

    // LID resolution — newer WhatsApp versions use @lid JIDs
    if (senderId?.includes('@lid') && sock) {
        const resolved = await lidToPhone(sock, senderId);
        if (resolved && resolved !== senderId) {
            if (isSuperOwnerJid(resolved)) return true;
            if (await isRegularOwner(resolved)) return true;
            if (await isSudo(resolved)) return true;
        }
    }

    // Group fallback — cross-ref participant list
    if (sock && chatId && chatId.endsWith('@g.us')) {
        try {
            const metadata = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];
            const participant = participants.find(
                (p: any) => p.lid === senderId || p.id === senderId
            );
            if (participant) {
                const pid = participant.id || participant.lid;
                if (isSuperOwnerJid(pid) || await isRegularOwner(pid) || await isSudo(pid)) return true;
                if (pid?.includes('@lid') && sock) {
                    const resolvedPid = await lidToPhone(sock, pid);
                    if (resolvedPid && resolvedPid !== pid) {
                        if (isSuperOwnerJid(resolvedPid) || await isRegularOwner(resolvedPid) || await isSudo(resolvedPid)) return true;
                    }
                }
            }
        } catch (_) {}
    }

    return false;
}

/**
 * Synchronous super-owner-only check.
 * Used by strictOwnerOnly / superOwnerOnly guards (sync path in messageHandler).
 */
function isOwnerOnly(senderId: string): boolean {
    return isSuperOwnerJid(senderId);
}

async function getCleanName(jid: string, sock: any) {
    if (!jid) return 'Unknown';
    const cleanNumber = cleanJid(jid);
    try {
        if (sock) {
            const contact = await sock.onWhatsApp(jid);
            if (contact && contact[0] && contact[0].exists) return cleanNumber;
        }
    } catch (_) {}
    return cleanNumber;
}

export default isOwnerOrSudo;
export { isOwnerOnly, getCleanName, isSuperOwnerJid };
