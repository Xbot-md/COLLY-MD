import { getCourtId, getIdSuspension } from './turso2.js';
import { resolveJid } from './lidUtils.js';

const NO_ID_MSG = (prefix: string) =>
    `🪪 *No Citizen ID Found*\n\n` +
    `You need a registered ID to use this command.\n\n` +
    `Register with:\n*${prefix}registeredid <Full Name> | <DD/MM/YYYY> | <Nationality>*\n\n` +
    `_Cost: 100 coins — one-time registration_`;

function fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export async function requireId(
    sock: any,
    message: any,
    userId: string,
    chatId: string,
    channelInfo: any,
    prefix = '.'
): Promise<boolean> {
    userId = await resolveJid(sock, userId);
    const record = await getCourtId(userId);
    if (!record) {
        await sock.sendMessage(chatId, {
            text: NO_ID_MSG(prefix),
            ...channelInfo
        }, { quoted: message });
        return false;
    }
    const suspension = await getIdSuspension(userId, chatId);
    if (suspension) {
        await sock.sendMessage(chatId, {
            text:
`🚫 *ID SUSPENDED*

Your citizen ID has been suspended and all privileges are frozen.

❏ *Suspended by:* ${suspension.suspendedByName || 'Authority'}
❏ *Expires:* ${fmtDate(suspension.suspendedUntil)}${suspension.reason ? `\n❏ *Reason:* ${suspension.reason}` : ''}

_Contact a judge or admin to appeal._`,
            ...channelInfo
        }, { quoted: message });
        return false;
    }
    return true;
}

export async function requireIdForBoth(
    sock: any,
    message: any,
    user1: string,
    user2: string,
    chatId: string,
    channelInfo: any,
    prefix = '.'
): Promise<boolean> {
    [user1, user2] = await Promise.all([resolveJid(sock, user1), resolveJid(sock, user2)]);
    const [id1, id2] = await Promise.all([getCourtId(user1), getCourtId(user2)]);
    if (!id1) {
        await sock.sendMessage(chatId, {
            text: `🪪 *You* don't have a registered citizen ID.\n\n${NO_ID_MSG(prefix)}`,
            ...channelInfo
        }, { quoted: message });
        return false;
    }
    if (!id2) {
        await sock.sendMessage(chatId, {
            text: `🪪 The *tagged user* doesn't have a registered citizen ID. Both parties need one.\n\n_They can register with *${prefix}registeredid*_`,
            ...channelInfo
        }, { quoted: message });
        return false;
    }
    return true;
}

function cleanJid(jid: string) { return jid.split(':')[0].split('@')[0]; }

export async function getIdAge(userId: string, sock?: any): Promise<number | null> {
    if (sock) userId = await resolveJid(sock, userId);
    const record = await getCourtId(userId);
    if (!record || !record.dob) return null;
    const [dd, mm, yyyy] = record.dob.split('/').map(Number);
    const dob = new Date(yyyy, mm - 1, dd);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    return age;
}
