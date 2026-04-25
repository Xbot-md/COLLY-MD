import type { BotContext } from '../types.js';
import {
    setSocialLink, delSocialLink, getSocialLinks,
    SOCIAL_PLATFORMS,
} from '../lib/premiumDb.js';

const PLATFORM_EMOJI: Record<string, string> = {
    whatsapp:  '💬',
    telegram:  '✈️',
    facebook:  '📘',
    instagram: '📸',
    youtube:   '▶️',
    website:   '🌐',
};

const PLATFORM_LABEL: Record<string, string> = {
    whatsapp:  'WhatsApp Group',
    telegram:  'Telegram',
    facebook:  'Facebook',
    instagram: 'Instagram',
    youtube:   'YouTube',
    website:   'Website',
};

const setlink = {
    command:   'setlink',
    aliases:   ['addlink'],
    category:  'premium',
    ownerOnly: true,
    description: 'Save a social link for the premium locked message',
    usage: '.setlink <platform> <url>\nPlatforms: whatsapp, telegram, facebook, instagram, youtube, website',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;

        const platform = args[0]?.toLowerCase().trim();
        const url      = args[1]?.trim();

        if (!platform || !url) {
            return sock.sendMessage(chatId, {
                text:
`❌ *Usage:* .setlink <platform> <url>

*Platforms:*
${(SOCIAL_PLATFORMS as readonly string[]).map(p => `• \`${p}\``).join('\n')}

*Example:*
\`.setlink telegram https://t.me/yourgroup\`
\`.setlink whatsapp https://chat.whatsapp.com/xxx\``,
                ...channelInfo
            }, { quoted: message });
        }

        if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) {
            return sock.sendMessage(chatId, {
                text: `❌ Unknown platform *"${platform}"*.\n\nValid: ${(SOCIAL_PLATFORMS as readonly string[]).map(p => `\`${p}\``).join(', ')}`,
                ...channelInfo
            }, { quoted: message });
        }

        await setSocialLink(platform, url, senderId);

        await sock.sendMessage(chatId, {
            text:
`✅ *Link saved!*

${PLATFORM_EMOJI[platform] || '🔗'} *${PLATFORM_LABEL[platform] || platform}*
🔗 ${url}

This link now appears in the premium locked message.`,
            ...channelInfo
        }, { quoted: message });
    },
};

const dellink = {
    command:   'dellink',
    aliases:   ['removelink'],
    category:  'premium',
    ownerOnly: true,
    description: 'Remove a social link from the premium locked message',
    usage: '.dellink <platform>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const platform = args[0]?.toLowerCase().trim();
        if (!platform) {
            return sock.sendMessage(chatId, {
                text: `❌ *Usage:* .dellink <platform>\n\nExample: \`.dellink telegram\``,
                ...channelInfo
            }, { quoted: message });
        }

        const removed = await delSocialLink(platform);
        await sock.sendMessage(chatId, {
            text: removed
                ? `🗑️ *${PLATFORM_LABEL[platform] || platform}* link removed.`
                : `⚠️ No link found for *"${platform}"*.`,
            ...channelInfo
        }, { quoted: message });
    },
};

const listlinks = {
    command:   'listlinks',
    aliases:   ['sociallinks', 'mylinks'],
    category:  'premium',
    ownerOnly: true,
    description: 'List all saved social links',
    usage: '.listlinks',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const links = await getSocialLinks();

        if (!links.length) {
            return sock.sendMessage(chatId, {
                text:
`🔗 *Social Links*

_No links saved yet._

Use \`.setlink <platform> <url>\` to add one.`,
                ...channelInfo
            }, { quoted: message });
        }

        const rows = links.map(l =>
            `${PLATFORM_EMOJI[l.platform] || '🔗'} *${PLATFORM_LABEL[l.platform] || l.platform}*\n   ${l.url}`
        );

        await sock.sendMessage(chatId, {
            text:
`╔══════════════════════╗
║  🔗 *SOCIAL LINKS*   (${links.length})
╚══════════════════════╝

${rows.join('\n\n')}

_Edit with .setlink / .dellink_`,
            ...channelInfo
        }, { quoted: message });
    },
};

export default [setlink, dellink, listlinks];
