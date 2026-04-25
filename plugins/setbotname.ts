import type { BotContext } from '../types.js';
import config from '../config.js';

export default [
    {
        command: 'setbotname',
        aliases: ['botname', 'renameme'],
        category: 'owner',
        description: "Change the bot's WhatsApp display name",
        usage: '.setbotname <new name>',
        ownerOnly: true,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            if (!args.length) return sock.sendMessage(chatId, {
                text: `❌ Usage: .setbotname <new name>\n\nCurrent name: *${sock.user?.name || 'Unknown'}*`,
                ...channelInfo
            }, { quoted: message });
            const newName = args.join(' ').trim();
            if (newName.length > 25) return sock.sendMessage(chatId, { text: `❌ Name too long. Max 25 characters.`, ...channelInfo }, { quoted: message });
            try {
                await sock.updateProfileName(newName);
                await sock.sendMessage(chatId, {
                    text: `✅ *Bot name changed!*\n\nNew name: *${newName}*`,
                    ...channelInfo
                }, { quoted: message });
            } catch (err: any) {
                await sock.sendMessage(chatId, {
                    text: `❌ Failed to change name: ${err.message}`,
                    ...channelInfo
                }, { quoted: message });
            }
        }
    },

    {
        command: 'setbotpp',
        aliases: ['botpp', 'setbotpic', 'changebotpic'],
        category: 'owner',
        description: "Change the bot's WhatsApp profile picture",
        usage: '.setbotpp [reply to image]',
        ownerOnly: true,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const directImage = message.message?.imageMessage;
            const imgMsg = directImage || quoted?.imageMessage;
            if (!imgMsg) return sock.sendMessage(chatId, {
                text: `❌ Reply to an image or send one with this command.`,
                ...channelInfo
            }, { quoted: message });
            try {
                const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
                const buffer = await downloadMediaMessage(
                    directImage ? message : { ...message, message: quoted },
                    'buffer', {}
                );
                await sock.updateProfilePicture(sock.user.id, buffer as Buffer);
                await sock.sendMessage(chatId, { text: `✅ Bot profile picture updated!`, ...channelInfo }, { quoted: message });
            } catch (err: any) {
                await sock.sendMessage(chatId, { text: `❌ Failed to update picture: ${err.message}`, ...channelInfo }, { quoted: message });
            }
        }
    },

    {
        command: 'setbotstatus',
        aliases: ['botstatus', 'setbotbio'],
        category: 'owner',
        description: "Change the bot's WhatsApp about/status",
        usage: '.setbotstatus <text>',
        ownerOnly: true,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            if (!args.length) return sock.sendMessage(chatId, { text: `❌ Usage: .setbotstatus <text>`, ...channelInfo }, { quoted: message });
            const status = args.join(' ');
            try {
                await sock.updateProfileStatus(status);
                await sock.sendMessage(chatId, { text: `✅ *Bot status updated!*\n\n"${status}"`, ...channelInfo }, { quoted: message });
            } catch (err: any) {
                await sock.sendMessage(chatId, { text: `❌ Failed to update status: ${err.message}`, ...channelInfo }, { quoted: message });
            }
        }
    }
];
