import { resolveJid } from './lidUtils.js';

/**
 * Universal target resolver. Accepts:
 *   1. Tagged user (@mention)
 *   2. Quoted/replied message
 *   3. Raw phone number in args (e.g. 27782888166)
 *
 * Returns resolved JID (PN format when possible) or null.
 * Also returns args with the phone number stripped, so the caller can keep parsing.
 */
export async function resolveTarget(
  sock: any,
  message: any,
  args: string[]
): Promise<{ jid: string | null; args: string[] }> {
  // 1) explicit @mention
  const mentioned = message?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (mentioned) return { jid: await resolveJid(sock, mentioned), args };

  // 2) quoted / reply
  const ctx = message?.message?.extendedTextMessage?.contextInfo;
  const quotedParticipant = ctx?.participant || ctx?.remoteJid;
  if (quotedParticipant && !quotedParticipant.endsWith('@g.us')) {
    return { jid: await resolveJid(sock, quotedParticipant), args };
  }

  // 3) raw phone number in args. Two safe modes only:
  //    (a) any token explicitly prefixed with "+" (always a phone)
  //    (b) first token is 10–15 digits AND there is at least one OTHER numeric token
  //        (i.e. a second arg that could be the amount). This prevents .addcoins 1000 50
  //        from treating "1000" as a phone target.
  const explicitIdx = args.findIndex(a => /^\+\d{8,15}$/.test(a.replace(/[\s\-]/g, '')));
  if (explicitIdx >= 0) {
    const digits = args[explicitIdx].replace(/[\s\-+]/g, '');
    const cleaned = args.slice(0, explicitIdx).concat(args.slice(explicitIdx + 1));
    return { jid: `${digits}@s.whatsapp.net`, args: cleaned };
  }
  if (args.length >= 2 && /^\d{10,15}$/.test(args[0])) {
    // need at least one more numeric token elsewhere (the amount)
    const hasAmount = args.slice(1).some(a => /^\d+$/.test(a));
    if (hasAmount) {
      return { jid: `${args[0]}@s.whatsapp.net`, args: args.slice(1) };
    }
  }
  // single-arg phone command (e.g. .seize 27782888166)
  if (args.length === 1 && /^\d{10,15}$/.test(args[0])) {
    return { jid: `${args[0]}@s.whatsapp.net`, args: [] };
  }

  return { jid: null, args };
}
