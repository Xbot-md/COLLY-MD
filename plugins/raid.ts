import type { BotContext } from '../types.js';

export default {
    command:   'raid',
    aliases:   ['lockdown', 'raidswipe'],
    category:  'owner',
    ownerOnly: true,
    groupOnly: true,
    description: 'Emergency raid-defense commands for a group',
    usage: '.raid lock | .raid unlock | .raid kick | .raid kick+lock',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, isBotAdmin } = context;
        const sub = args[0]?.toLowerCase();

        if (!sub) {
            return sock.sendMessage(chatId, {
                text:
`🚨 *RAID DEFENSE COMMANDS*
_(Owner only — use in a group)_

• \`.raid lock\` — Set group to admins-only mode
• \`.raid unlock\` — Open group back to all members
• \`.raid kick\` — Kick ALL non-admin members
• \`.raid kick+lock\` — Kick + lock in one step

⚠️ *These are emergency commands. Use with caution.*`,
                ...channelInfo
            }, { quoted: message });
        }

        if (!isBotAdmin) {
            return sock.sendMessage(chatId, {
                text: '❌ Bot must be an *admin* to use raid commands.',
                ...channelInfo
            }, { quoted: message });
        }

        // ── LOCK ────────────────────────────────────────────────────────────────
        if (sub === 'lock') {
            try {
                await sock.groupSettingUpdate(chatId, 'announcement');
                return sock.sendMessage(chatId, {
                    text: '🔒 *Group locked!*\nOnly admins can send messages now.',
                    ...channelInfo
                }, { quoted: message });
            } catch (e: any) {
                return sock.sendMessage(chatId, { text: `❌ Failed to lock: ${e.message}`, ...channelInfo }, { quoted: message });
            }
        }

        // ── UNLOCK ──────────────────────────────────────────────────────────────
        if (sub === 'unlock') {
            try {
                await sock.groupSettingUpdate(chatId, 'not_announcement');
                return sock.sendMessage(chatId, {
                    text: '🔓 *Group unlocked!*\nAll members can send messages again.',
                    ...channelInfo
                }, { quoted: message });
            } catch (e: any) {
                return sock.sendMessage(chatId, { text: `❌ Failed to unlock: ${e.message}`, ...channelInfo }, { quoted: message });
            }
        }

        // ── KICK (+ optional lock) ───────────────────────────────────────────────
        if (sub === 'kick' || sub === 'kick+lock') {
            try {
                const meta   = await sock.groupMetadata(chatId);
                const botNum = (sock.user?.id || '').split('@')[0].split(':')[0];

                const toKick = meta.participants.filter((p: any) => {
                    if (p.admin) return false;
                    const pNum = (p.id || '').split('@')[0].split(':')[0];
                    return pNum !== botNum;
                }).map((p: any) => p.id);

                if (!toKick.length) {
                    return sock.sendMessage(chatId, {
                        text: '⚠️ No non-admin members to kick.',
                        ...channelInfo
                    }, { quoted: message });
                }

                await sock.sendMessage(chatId, {
                    text: `🚨 *RAID SWEEP INITIATED*\nKicking *${toKick.length}* non-admin member${toKick.length !== 1 ? 's' : ''}...`,
                    ...channelInfo
                }, { quoted: message });

                // Kick in chunks of 10 to avoid rate-limit
                for (let i = 0; i < toKick.length; i += 10) {
                    try {
                        await sock.groupParticipantsUpdate(chatId, toKick.slice(i, i + 10), 'remove');
                    } catch {}
                    if (i + 10 < toKick.length) await new Promise(r => setTimeout(r, 800));
                }

                if (sub === 'kick+lock') {
                    try { await sock.groupSettingUpdate(chatId, 'announcement'); } catch {}
                }

                return sock.sendMessage(chatId, {
                    text:
`✅ *Raid sweep complete!*

👥 Removed: *${toKick.length}* member${toKick.length !== 1 ? 's' : ''}
${sub === 'kick+lock' ? '🔒 Group is now *locked* (admins only).' : ''}`,
                    ...channelInfo
                }, { quoted: message });
            } catch (e: any) {
                return sock.sendMessage(chatId, { text: `❌ Error during sweep: ${e.message}`, ...channelInfo }, { quoted: message });
            }
        }

        return sock.sendMessage(chatId, {
            text: '❌ Unknown subcommand. Use `.raid` to see options.',
            ...channelInfo
        }, { quoted: message });
    },
};
