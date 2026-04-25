import type { BotContext } from '../types.js';
import { cleanJid } from '../lib/isOwner.js';
import {
    SUPER_OWNER_NUMBERS,
    isSuperOwner,
    addOwner,
    removeOwner,
    getOwnerList,
} from '../lib/ownerManager.js';
import { lidToPhone } from '../lib/lidUtils.js';

async function extractNumber(sock: any, message: any, args: string[]): Promise<string | null> {
    const { resolveTarget } = await import('../lib/targetResolver.js');
    const r = await resolveTarget(sock, message, args);
    if (r.jid) return r.jid;

    // legacy fallback for short numbers (7-9 digits — not handled by resolver)
    const text = args.join(' ');
    const match = text.match(/\b(\d{7,15})\b/);
    if (match) return `${match[1]}@s.whatsapp.net`;

    return null;
}

const commands = [

    // ── .listowners ──────────────────────────────────────────────────────────
    {
        command: 'listowners',
        aliases: ['ownerlist', 'owners'],
        category: 'owner',
        description: 'List all owners and super owners',
        usage: '.listowners',
        ownerOnly: true,
        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const list = await getOwnerList();

            const superLines = list
                .filter(o => o.tier === 'super')
                .map((o, i) => `╽  ${i + 1}. 👑 *${o.userId}*  ‹ SUPER OWNER ›`)
                .join('\n');

            const ownerLines = list
                .filter(o => o.tier === 'owner')
                .map((o, i) => `╽  ${i + 1}. 🔑 *${o.userId}*  ‹ Owner ›\n╽      Added by: ${o.addedBy}`)
                .join('\n');

            const body =
                (superLines || '╽  _None_') +
                '\n╽\n╽  ─────────────────────────────\n╽  🔑 *REGULAR OWNERS*\n╽  ─────────────────────────────\n' +
                (ownerLines || '╽  _None yet — use .addosowner <number>_');

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🛡️ *OWNER REGISTRY*
╽  ─────────────────────────────
╽  👑 *SUPER OWNERS*
╽  ─────────────────────────────
${body}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo,
            }, { quoted: message });
        },
    },

    // ── .addosowner ──────────────────────────────────────────────────────────
    {
        command: 'addosowner',
        aliases: ['addowner', 'setowner'],
        category: 'owner',
        description: 'Add a regular owner (super owner only)',
        usage: '.addosowner <number | @mention>',
        superOwnerOnly: true,
        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;

            let targetJid = await extractNumber(sock, message, args);
            if (!targetJid) {
                return sock.sendMessage(chatId, {
                    text: `❌ Usage: .addosowner <@user|reply|phone>\n_Aliases: .setowner, .addowner_`,
                    ...channelInfo,
                }, { quoted: message });
            }

            // Resolve LID if needed
            if (targetJid.includes('@lid')) {
                const resolved = await lidToPhone(sock, targetJid);
                if (resolved && resolved.includes('@s.whatsapp.net')) targetJid = resolved;
            }

            const num = cleanJid(targetJid);
            const result = await addOwner(targetJid, senderId);

            const msgs: Record<string, string> = {
                added:         `✅ *${num}* has been added as a *Regular Owner*.`,
                already_super: `⚠️ *${num}* is already a *Super Owner* — no need to add them.`,
                already_owner: `⚠️ *${num}* is already a *Regular Owner*.`,
            };

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🔑 *ADD OWNER*
╽  ─────────────────────────────
╽  ${msgs[result]}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo,
            }, { quoted: message });
        },
    },

    // ── .removeowner ─────────────────────────────────────────────────────────
    {
        command: 'removeowner',
        aliases: ['delowner', 'deleteowner', 'rmowner'],
        category: 'owner',
        description: 'Remove a regular owner (super owner only)',
        usage: '.removeowner <number | @mention>',
        superOwnerOnly: true,
        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo } = context;

            let targetJid = await extractNumber(sock, message, args);
            if (!targetJid) {
                return sock.sendMessage(chatId, {
                    text: `❌ Usage: .removeowner <@user|reply|phone>`,
                    ...channelInfo,
                }, { quoted: message });
            }

            if (targetJid.includes('@lid')) {
                const resolved = await lidToPhone(sock, targetJid);
                if (resolved && resolved.includes('@s.whatsapp.net')) targetJid = resolved;
            }

            const num = cleanJid(targetJid);
            const result = await removeOwner(targetJid);

            const msgs: Record<string, string> = {
                removed:   `✅ *${num}* has been removed from the owner list.`,
                is_super:  `🚫 *${num}* is a *Super Owner* — they cannot be removed via commands.`,
                not_found: `❌ *${num}* is not in the regular owner list.`,
            };

            return sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  🗑️ *REMOVE OWNER*
╽  ─────────────────────────────
╽  ${msgs[result]}
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo,
            }, { quoted: message });
        },
    },

];

export default commands;
