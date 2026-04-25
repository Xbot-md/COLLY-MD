import type { BotContext } from '../types.js';
import fs from 'fs';
import store from '../lib/lightweight_store.js';
import { lidToPhone } from '../lib/lidUtils.js';

const MONGO_URL = process.env.MONGO_URL;
const POSTGRES_URL = process.env.POSTGRES_URL;
const MYSQL_URL = process.env.MYSQL_URL;
const SQLITE_URL = process.env.DB_URL;
const HAS_DB = !!(MONGO_URL || POSTGRES_URL || MYSQL_URL || SQLITE_URL);

const bannedFilePath = './data/banned.json';

async function getBannedUsers() {
    if (HAS_DB) {
        const banned = await store.getSetting('global', 'banned');
        return banned || [];
    } else {
        if (fs.existsSync(bannedFilePath)) {
            return JSON.parse(fs.readFileSync(bannedFilePath, "utf-8"));
        }
        return [];
    }
}

async function saveBannedUsers(bannedUsers: any) {
    if (HAS_DB) {
        await store.saveSetting('global', 'banned', bannedUsers);
    } else {
        if (!fs.existsSync('./data')) {
            fs.mkdirSync('./data', { recursive: true });
        }
        fs.writeFileSync(bannedFilePath, JSON.stringify(bannedUsers, null, 2));
    }
}

export default {
  command: 'unban',
  aliases: ['pardon'],
  category: 'admin',
  description: 'Unban a user from using the bot',
  usage: '.unban [@user] or reply to message',
  ownerOnly: false,

  async handler(sock: any, message: any, args: any, context: BotContext) {
    const { chatId, isGroup, channelInfo, senderIsOwnerOrSudo, isSenderAdmin, isBotAdmin } = context;

    if (isGroup) {
      if (!isBotAdmin) {
        await sock.sendMessage(chatId, {
          text: 'Please make the bot an admin to use .unban',
          ...channelInfo
        }, { quoted: message });
        return;
      }
      if (!isSenderAdmin && !message.key.fromMe && !senderIsOwnerOrSudo) {
        await sock.sendMessage(chatId, {
          text: 'Only group admins can use .unban',
          ...channelInfo
        }, { quoted: message });
        return;
      }
    } else {
      if (!message.key.fromMe && !senderIsOwnerOrSudo) {
        await sock.sendMessage(chatId, {
          text: 'Only owner/sudo can use .unban in private chat',
          ...channelInfo
        }, { quoted: message });
        return;
      }
    }

    const { resolveTarget } = await import('../lib/targetResolver.js');
    const r = await resolveTarget(sock, message, args);
    let userToUnban = r.jid;

    if (!userToUnban) {
      await sock.sendMessage(chatId, {
        text: '❌ Usage: .unban <@user|reply|phone>',
        ...channelInfo
      }, { quoted: message });
      return;
    }

    if (userToUnban.includes('@lid')) {
      const resolved = await lidToPhone(sock, userToUnban);
      if (resolved && resolved.includes('@s.whatsapp.net')) userToUnban = resolved;
    }

    // Also remove from court blacklist (unified)
    try {
      const { removeBlacklist, isBlacklisted } = await import('../lib/turso.js');
      if (await isBlacklisted(userToUnban)) await removeBlacklist(userToUnban);
    } catch {}

    try {
      const bannedUsers = await getBannedUsers();
      const index = bannedUsers.indexOf(userToUnban);

      if (index > -1) {
        bannedUsers.splice(index, 1);
        await saveBannedUsers(bannedUsers);

        await sock.sendMessage(chatId, {
          text: `✅ Successfully unbanned @${userToUnban.split('@')[0]}!\n\nStorage: ${HAS_DB ? 'Database' : 'File System'}`,
          mentions: [userToUnban],
          ...channelInfo
        }, { quoted: message });
      } else {
        await sock.sendMessage(chatId, {
          text: `@${userToUnban.split('@')[0]} is not banned!`,
          mentions: [userToUnban],
          ...channelInfo
        }, { quoted: message });
      }
    } catch(error: any) {
      console.error('Error in unban command:', error);
      await sock.sendMessage(chatId, {
        text: 'Failed to unban user!',
        ...channelInfo
      }, { quoted: message });
    }
  }
};

