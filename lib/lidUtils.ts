import { isLidUser, jidNormalizedUser } from '@whiskeysockets/baileys';

/**
 * Normalizes a phone JID by removing device information.
 * Only call this on @s.whatsapp.net JIDs — NOT on @lid JIDs.
 */
export function cleanPN(pn: string): string {
  if (!pn) return pn;
  if (isLidUser(pn)) return pn;
  try {
    return jidNormalizedUser(pn);
  } catch (_) {
    return pn;
  }
}

/**
 * Converts a LID (Linked Identity) to a Phone Number JID.
 * Returns the resolved @s.whatsapp.net JID, or the original JID as fallback.
 * @param sock The Baileys socket instance
 * @param jid The JID to convert (can be LID or PN)
 */
export async function lidToPhone(sock: any, jid: string): Promise<string> {
  try {
    if (!jid) return jid;

    if (!isLidUser(jid)) {
      return cleanPN(jid);
    }

    // Attempt 1: signal repository LID→PN mapping
    if (sock?.signalRepository?.lidMapping) {
      try {
        const pn = await sock.signalRepository.lidMapping.getPNForLID(jid);
        if (pn) return cleanPN(pn);
      } catch (_) {}
    }

    // Attempt 2: contacts store — direct lookup by LID key
    if (sock?.contacts) {
      const direct = sock.contacts[jid];
      if (direct?.id && !isLidUser(direct.id)) {
        return cleanPN(direct.id);
      }

      // Attempt 3: scan contacts for a matching .lid field
      for (const [id, c] of Object.entries(sock.contacts as Record<string, any>)) {
        if (!isLidUser(id) && (c as any)?.lid === jid) {
          return cleanPN(id);
        }
      }
    }

    // Attempt 4: store contacts fallback
    if (sock?.store?.contacts) {
      const storeContacts = sock.store.contacts as Record<string, any>;
      const direct = storeContacts[jid];
      if (direct?.id && !isLidUser(direct.id)) {
        return cleanPN(direct.id);
      }
      for (const [id, c] of Object.entries(storeContacts)) {
        if (!isLidUser(id) && c?.lid === jid) {
          return cleanPN(id);
        }
      }
    }

    // Could not resolve — return the original LID as-is
    return jid;
  } catch (_) {
    return jid ?? '';
  }
}

/**
 * Resolves any JID (LID or phone) to a stable phone number JID.
 * Safe to call on any JID — non-LIDs pass through cleanPN unchanged.
 */
export async function resolveJid(sock: any, jid: string): Promise<string> {
  if (!jid) return jid;
  if (!isLidUser(jid)) return cleanPN(jid);
  return lidToPhone(sock, jid);
}
