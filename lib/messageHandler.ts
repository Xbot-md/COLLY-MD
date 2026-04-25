import { fileURLToPath} from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { lidToPhone } from './lidUtils.js';

import fs from 'fs';
import { dataFile } from './paths.js';
import config from '../config.js';
import store from './lightweight_store.js';
import commandHandler from './commandHandler.js';
import { printMessage, printLog } from './print.js';
import { isBanned } from './isBanned.js';
import { isBlacklisted, getDb, incrementRankCount } from './turso.js';
import { getMute, incrementMuteCount, removeMute, getGroupMute } from './turso2.js';
import { isSudo } from './index.js';
import isOwnerOrSudo from './isOwner.js';
import isAdmin from './isAdmin.js';
import { handleAutoread } from '../plugins/autoread.js';
import { handleAutotypingForMessage, showTypingAfterCommand } from '../plugins/autotyping.js';
import { storeMessage, handleMessageRevocation } from '../plugins/antidelete.js';

import { handleBadwordDetection } from './antibadword.js';
import { handleLinkDetection } from '../plugins/antilink.js';
import { handleTagDetection } from '../plugins/antitag.js';
import { handleMentionDetection } from '../plugins/mention.js';
import { handleTicTacToeMove } from '../plugins/tictactoe.js';
import { handleAutoReply } from '../plugins/autoreply.js';
import { handleAntiSpam, invalidateGroupCache } from '../plugins/antispam.js';
import { startSchedulerEngine } from '../plugins/schedule.js';
import { addCommandReaction } from './reactions.js';
import { writeErrorLog } from './logger.js';

import { channelInfo } from './messageConfig.js';

const MONGO_URL = process.env.MONGO_URL;
const POSTGRES_URL = process.env.POSTGRES_URL;
const MYSQL_URL = process.env.MYSQL_URL;
const SQLITE_URL = process.env.DB_URL;
const HAS_DB = !!(MONGO_URL || POSTGRES_URL || MYSQL_URL || SQLITE_URL);
const STICKER_FILE = dataFile('sticker_commands.json');

async function getStickerCommands() {
    if (HAS_DB) {
        const data = await store.getSetting('global', 'stickerCommands');
        return data || {};
    } else {
        try {
            if (!fs.existsSync(STICKER_FILE)) {
                return {};
            }
            return JSON.parse(fs.readFileSync(STICKER_FILE, 'utf8'));
        } catch {
            return {};
        }
    }
}

async function handleMessages(sock: any, messageUpdate: any) {
    try {
        const { messages, type } = messageUpdate;
        if (type !== 'notify') return;

        const message = messages[0];
        if (!message?.message) return;

        await printMessage(message, sock);

        try {
            const ghostMode = await store.getSetting('global', 'stealthMode');
            if (!ghostMode || !ghostMode.enabled) {
                await handleAutoread(sock, message);
            } else {
                printLog('info', '👻 Stealth mode active');
            }
        } catch(err: any) {
            await handleAutoread(sock, message);
        }

        const chatId = message.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');

        if (message.message?.protocolMessage?.type === 0) {
            printLog('info', 'Message deletion detected');
            await handleMessageRevocation(sock, message);
            return;
        }

        await storeMessage(sock, message);

        // Store pushName in contacts for name resolution (store under both lid and real JID)
        if (message.pushName && (sock as any).store?.contacts) {
            const pid = message.key.participant || message.key.remoteJid;
            if (pid) {
                (sock as any).store.contacts[pid] = {
                    ...(sock as any).store.contacts[pid],
                    id: pid,
                    notify: message.pushName,
                    name: message.pushName
                };
                // Also store under decoded JID
                const decoded = (sock as any).decodeJid?.(pid);
                if (decoded && decoded !== pid) {
                    (sock as any).store.contacts[decoded] = {
                        ...(sock as any).store.contacts[decoded],
                        id: decoded,
                        notify: message.pushName,
                        name: message.pushName
                    };
                }
            }
        }

        const rawSenderId = message.key.participant || message.key.remoteJid;
        // Resolve @lid to real phone JID — use full lidToPhone for signal repo + contact scan
        let senderId = rawSenderId;
        if (rawSenderId?.includes('@lid')) {
            const resolved = await lidToPhone(sock, rawSenderId);
            if (resolved && resolved.includes('@s.whatsapp.net')) senderId = resolved;
        }

        // ── Non-blocking group activity tracking ───────────────────────────────
        if (isGroup && senderId && !message.key.fromMe) {
            (async () => {
                try {
                    const db = getDb();
                    const now = Date.now();
                    const hour = new Date(now).getHours();
                    await db.execute({
                        sql: `INSERT INTO msg_activity (group_id, user_id, last_seen, msg_count)
                              VALUES (?, ?, ?, 1)
                              ON CONFLICT(group_id, user_id) DO UPDATE
                              SET last_seen=excluded.last_seen, msg_count=msg_count+1`,
                        args: [chatId, senderId, now],
                    });
                    await db.execute({
                        sql: `INSERT INTO msg_hourly (group_id, hour_of_day, msg_count)
                              VALUES (?, ?, 1)
                              ON CONFLICT(group_id, hour_of_day) DO UPDATE
                              SET msg_count=msg_count+1`,
                        args: [chatId, hour],
                    });
                } catch {}
            })();
        }

        if (message.message?.stickerMessage) {
            const fileSha256 = message.message.stickerMessage.fileSha256;
            if (fileSha256) {
                const hash = Buffer.from(fileSha256).toString('base64');
                const stickers = await getStickerCommands();

                if (stickers[hash]) {
                    const commandText = stickers[hash].text;
                    const [cmdName, ...cmdArgs] = commandText.split(' ');

                    let foundCommand = null;
                    let usedPrefix = '';

                    for (const prefix of config.prefixes) {
                        const testCmd = (prefix + cmdName).toLowerCase();
                        foundCommand = commandHandler.getCommand(testCmd, config.prefixes);
                        if (foundCommand) {
                            usedPrefix = prefix;
                            break;
                        }
                    }

                    if (foundCommand) {
                        const _senderIsSudo = await isSudo(senderId);
                        const senderIsOwnerOrSudo = await isOwnerOrSudo(senderId, sock, chatId);
                        const isOwnerOrSudoCheck = message.key.fromMe || senderIsOwnerOrSudo;

                        const botMode = await store.getBotMode();
                        const isAllowed = (() => {
                            if (isOwnerOrSudoCheck) return true;

                            switch (botMode) {
                                case 'public':
                                    return true;
                                case 'private':
                                case 'self':
                                    return false;
                                case 'groups':
                                    return isGroup;
                                case 'inbox':
                                    return !isGroup;
                                default:
                                    return true;
                            }
                        })();

                        if (!isAllowed) return;

                        const userBanned = await isBanned(senderId);
                        if (userBanned) return;

                        if (foundCommand.strictOwnerOnly || foundCommand.superOwnerOnly) {
                            const { isOwnerOnly } = await import('./isOwner.js');
                            if (!message.key.fromMe && !isOwnerOnly(senderId)) {
                                return await sock.sendMessage(chatId, {
                                    text: '🔐 *This command is reserved for super owners only.*',
                                    ...channelInfo
                                }, { quoted: message });
                            }
                        }

                        if (foundCommand.ownerOnly && !message.key.fromMe && !senderIsOwnerOrSudo) {
                            return await sock.sendMessage(chatId, {
                                text: 'ℹ️ *This command is only available for the owner or sudo users!*',
                                ...channelInfo
                            }, { quoted: message });
                        }

                        if (foundCommand.groupOnly && !isGroup) {
                            return await sock.sendMessage(chatId, {
                                text: 'ℹ️ *This command can only be used in groups!*',
                                ...channelInfo
                            }, { quoted: message });
                        }

                        let isSenderAdmin = false;
                        let isBotAdmin = false;

                        if (foundCommand.adminOnly && isGroup) {
                            const adminStatus = await isAdmin(sock, chatId, senderId);
                            isSenderAdmin = adminStatus.isSenderAdmin;
                            isBotAdmin = adminStatus.isBotAdmin;

                            if (!isBotAdmin) {
                                return await sock.sendMessage(chatId, {
                                    text: 'ℹ️ *Please make the bot an admin to use this command.*',
                                    ...channelInfo
                                }, { quoted: message });
                            }

                            if (!isSenderAdmin && !message.key.fromMe && !senderIsOwnerOrSudo) {
                                return await sock.sendMessage(chatId, {
                                    text: 'ℹ️ *Sorry, only group admins can use this command.*',
                                    ...channelInfo
                                }, { quoted: message });
                            }
                        }

                        const syntheticMessage = {
                            key: message.key,
                            message: {
                                extendedTextMessage: {
                                    text: usedPrefix + commandText,
                                    contextInfo: message.message.stickerMessage.contextInfo || {}
                                }
                            },
                            messageTimestamp: message.messageTimestamp,
                            pushName: message.pushName,
                            broadcast: message.broadcast
                        };


        const context = {
                            chatId,
                            senderId,
                            isGroup,
                            isSenderAdmin,
                            isBotAdmin,
                            senderIsOwnerOrSudo,
                            isOwnerOrSudoCheck,
                            channelInfo,
                            rawText: usedPrefix + commandText,
                            userMessage: (usedPrefix + commandText).toLowerCase(),
                            messageText: usedPrefix + commandText,
                            config
                        };

                        try {
                            await foundCommand.handler(sock, syntheticMessage, cmdArgs, context);
                            await addCommandReaction(sock, message);
                            await showTypingAfterCommand(sock, chatId);
                            printLog('success', `✅ Sticker command executed: ${commandText}`);
                        } catch(error: any) {
                            printLog('error', `❌ Sticker command error [${commandText}]: ${error.message}`);
                            console.error(error.stack);
                            await sock.sendMessage(chatId, {
                                text: `❌ Error executing sticker command: ${error.message}`,
                                ...channelInfo
                            }, { quoted: message });
                        }
                    } else {
                        printLog('warning', `⚠️ Sticker command not found: ${commandText}`);
                    }

                    return;
                }
            }
        }

        const rawText =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption ||
            message.message?.buttonsResponseMessage?.selectedButtonId ||
            '';

        const messageText = rawText.trim();
        const userMessage = messageText.toLowerCase();

        const senderIsSudo = await isSudo(senderId);
        startSchedulerEngine(sock);

        if (!message.key.fromMe && chatId.endsWith('@g.us')) {
            // ── Court mute (3-strike / timed) ──────────────────────────────
            const muteEntry = await getMute(senderId, chatId);
            if (muteEntry) {
                try { await sock.sendMessage(chatId, { delete: message.key }); } catch {}
                const count = await incrementMuteCount(senderId, chatId);
                if (count >= 3) {
                    await removeMute(senderId, chatId);
                    const allMembers: string[] = [];
                    try { const m = await sock.groupMetadata(chatId); m.participants.forEach((p: any) => allMembers.push(p.id)); } catch {}
                    try {
                        await sock.sendMessage(chatId, {
                            text: `🚨 *CONTEMPT OF COURT* 🚨\n\n@${senderId.split('@')[0]} has been *kicked* for sending 3 messages while court-muted. ⚖️`,
                            mentions: [senderId, ...allMembers]
                        });
                        await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                    } catch {}
                }
                return;
            }
            // ── Regular group mute (timed, auto-delete) ────────────────────
            const { resolveJid: __resolveJid } = await import('./lidUtils.js');
            const __muteSender = await __resolveJid(sock, senderId);
            const groupMuteEntry = (await getGroupMute(__muteSender, chatId)) || (await getGroupMute(senderId, chatId));
            if (groupMuteEntry) {
                try { await sock.sendMessage(chatId, { delete: message.key }); } catch {}
                return;
            }
        }

        if (!message.key.fromMe) {
            const replied = await handleAutoReply(sock, chatId, message, userMessage);
            if (replied) return;
        }

        // ── Custom trigger keyword check ───────────────────────────────────────
        if (!message.key.fromMe && userMessage && !config.prefixes.some(p => userMessage.startsWith(p))) {
            try {
                const { checkTriggers } = await import('../plugins/trigger.js');
                const triggered = await checkTriggers(sock, chatId, message, userMessage);
                if (triggered) return;
            } catch {}
        }

        const senderIsOwnerOrSudo = await isOwnerOrSudo(senderId, sock, chatId);

        const isOwnerOrSudoCheck = message.key.fromMe || senderIsOwnerOrSudo;


        if (message.message?.buttonsResponseMessage) {
            const buttonId = message.message.buttonsResponseMessage.selectedButtonId;
            printLog('info', `Button response: ${buttonId}`);

            if (buttonId === 'channel') {
                await sock.sendMessage(chatId, {
                    text: `*Join our Channel:*\n[${config.channelLink}](${config.channelLink})`
                }, { quoted: message });
                return;
            } else if (buttonId === 'owner') {
                const ownerCommand = (await import('../plugins/owner.js')).default;
                await (ownerCommand as any).handler?.(sock, chatId, "", {});
                return;
            } else if (buttonId === 'support') {
                await sock.sendMessage(chatId, {
                    text: `*Support Group:*\n${config.groupLink}`
                }, { quoted: message });
                return;
            }
        }

        const userBanned = await isBanned(senderId);
        if (userBanned && !userMessage.startsWith('.unban')) {
            if (Math.random() < 0.1) {
                printLog('warning', `Banned user attempted command: ${senderId.split('@')[0]}`);
                await sock.sendMessage(chatId, {
                    text: 'You are banned from using the bot. Contact an admin to get unbanned.',
                    ...channelInfo
                });
            }
            return;
        }

        // Court blacklist check (Turso)
        if (!isOwnerOrSudoCheck) {
            try {
                if (await isBlacklisted(senderId)) {
                    if (Math.random() < 0.15) {
                        await sock.sendMessage(chatId, { text: `⛔ You are *court-blacklisted* and cannot use bot commands.\nContact an admin to get pardoned.`, ...channelInfo });
                    }
                    return;
                }
            } catch {}
        }

        if (/^[1-9]$/.test(userMessage) || userMessage === 'surrender') {
            await handleTicTacToeMove(sock, chatId, senderId, userMessage);
            return;
        }

        if (!message.key.fromMe) {
            await store.incrementMessageCount(chatId, senderId, message.pushName);
            if (isGroup) {
                await incrementRankCount(chatId, senderId, 'daily');
                await incrementRankCount(chatId, senderId, 'weekly');
            }
        } else {
            // Count bot owner's own messages too
            const ownJid = (sock as any).user?.id || senderId;
            const ownName = (sock as any).user?.name || (sock as any).user?.notify || 'Me';
            await store.incrementMessageCount(chatId, ownJid, ownName);
            if (isGroup) {
                await incrementRankCount(chatId, ownJid, 'daily');
                await incrementRankCount(chatId, ownJid, 'weekly');
            }
        }

        if (isGroup) {
            if (userMessage) {
                await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
            }
            await handleLinkDetection(sock, chatId, message, userMessage, senderId);
        }

        // Anti-spam flood detection
        if (isGroup && !message.key.fromMe) {
            const spammed = await handleAntiSpam(sock, chatId, message, senderId, senderIsOwnerOrSudo);
            if (spammed) return;
        }

        if (!isGroup && !message.key.fromMe && !senderIsSudo) {
            try {
                const _pmblocker = (await import('../plugins/pmblocker.js')).default;
                const readPmBlockerState = _pmblocker?.readState;
                const pmState = await readPmBlockerState();
                if (pmState.enabled) {
                    printLog('warning', `PM blocked from: ${senderId.split('@')[0]}`);
                    await sock.sendMessage(chatId, {
                        text: pmState.message || 'Private messages are blocked. Please contact the owner in groups only.'
                    });
                    await new Promise(r => setTimeout(r, 1500));
                    try {
                        await sock.updateBlockStatus(chatId, 'block');
                        printLog('success', `Blocked user: ${senderId.split('@')[0]}`);
                    } catch(e: any) {
                        printLog('error', `Failed to block user: ${e.message}`);
                    }
                    return;
                }
            } catch(e: any) {
                printLog('error', `PM blocker error: ${e.message}`);
            }
        }

        const usedPrefix = config.prefixes.find(p => userMessage.startsWith(p));

        const command = commandHandler.getCommand(userMessage, config.prefixes);

        if (!usedPrefix && !command) {
            await handleAutotypingForMessage(sock, chatId, userMessage);

            if (isGroup) {
                await handleTagDetection(sock, chatId, message, senderId);
                await handleMentionDetection(sock, chatId, message);
            }

            // ── AI gate: in groups only respond when bot is mentioned or replied to ──
            let aiTriggered = !isGroup;
            if (isGroup && !aiTriggered) {
                const botJid = (sock.user?.id || '');
                const botNum = botJid.split(':')[0].split('@')[0];
                const msgContent: any = message.message || {};
                const ctx: any = msgContent.extendedTextMessage?.contextInfo
                    || msgContent.imageMessage?.contextInfo
                    || msgContent.videoMessage?.contextInfo
                    || msgContent.audioMessage?.contextInfo
                    || {};
                const mentioned: string[] = ctx.mentionedJid || [];
                const quotedSender: string = ctx.participant || '';
                const isMentioned  = mentioned.some((jid: string) => jid.split(':')[0].split('@')[0] === botNum);
                const isReplyToBot = quotedSender.split(':')[0].split('@')[0] === botNum;
                aiTriggered = isMentioned || isReplyToBot;
            }

            // ── COLLY MD Agent Mode (DuckDuckGo AI) ─────────────────────────
            if (!message.key.fromMe && userMessage && aiTriggered) {
                try {
                    const {
                        isAgentEnabled, getSession,
                        trackSpam, resetSpam,
                        buildSystemPrompt, askDuckAI, cleanForWhatsApp, DDG_MODEL,
                    } = await import('./duckAgent.js');

                    if (isAgentEnabled(chatId)) {
                        const senderName   = message.pushName || senderId.split('@')[0];
                        const senderNumber = senderId.replace(/[^0-9]/g, '');
                        const spamCount    = trackSpam(senderId);
                        // Per-user session: groups use chatId:senderId, DMs use chatId
                        const sessionKey   = isGroup ? `${chatId}:${senderId}` : chatId;
                        const session      = getSession(sessionKey);

                        let groupName: string | null = null;
                        let isAdmin = false;
                        if (isGroup) {
                            try {
                                const meta = await sock.groupMetadata(chatId);
                                groupName  = meta?.subject || 'this group';
                                const p    = meta?.participants?.find((x: any) => x.id.split(':')[0] === senderNumber || x.id === senderId);
                                isAdmin    = p?.admin === 'admin' || p?.admin === 'superadmin';
                            } catch { /* ignore */ }
                        }

                        const prompt = buildSystemPrompt({
                            groupName,
                            isGroup,
                            senderName,
                            senderNumber,
                            isOwner: senderIsOwnerOrSudo,
                            isAdmin,
                            spamCount,
                            userMessage,
                        });

                        try {
                            const raw   = await askDuckAI(prompt, session.messages, DDG_MODEL, userMessage);
                            const reply = cleanForWhatsApp(raw);

                            session.messages.push({ role: 'user',      content: userMessage });
                            session.messages.push({ role: 'assistant', content: raw });
                            if (session.messages.length > 20) session.messages.splice(0, 2);

                            resetSpam(senderId);
                            await sock.sendMessage(chatId, { text: reply, ...channelInfo }, { quoted: message });
                            await sock.sendMessage(chatId, { react: { text: '🤖', key: message.key } });
                        } catch (aiErr: any) {
                            printLog('error', `[Agent] DuckAI error: ${aiErr.message}`);
                        }
                    }
                } catch { /* duckAgent import error — silent */ }
            }
            // ─────────────────────────────────────────────────────────────────

            // ── QuillBot Chatbot Mode ─────────────────────────────────────────
            if (!message.key.fromMe && userMessage && aiTriggered) {
                try {
                    const { isQBEnabled, qbChat } = await import('./quillbotService.js');

                    if (isQBEnabled(chatId)) {
                        try {
                            await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });
                            const reply = await qbChat(userMessage, chatId);
                            await sock.sendMessage(chatId, {
                                text: reply,
                                ...channelInfo,
                            }, { quoted: message });
                        } catch (qbErr: any) {
                            printLog('error', `[QuillBot] Chat error: ${qbErr.message}`);
                        }
                    }
                } catch { /* quillbotService import error — silent */ }
            }
            // ─────────────────────────────────────────────────────────────────

            return;
        }

        if (!command) {
            if (isGroup) {
                await handleTagDetection(sock, chatId, message, senderId);
                await handleMentionDetection(sock, chatId, message);
            }
            return;
        }

        const botMode = await store.getBotMode();
        const isAllowed = (() => {
            if (isOwnerOrSudoCheck) return true;

            switch (botMode) {
                case 'public':
                    return true;
                case 'private':
                case 'self':
                    return false;
                case 'groups':
                    return isGroup;
                case 'inbox':
                    return !isGroup;
                default:
                    return true;
            }
        })();

        if (!isAllowed) {
            return;
        }

        let args;
        if (usedPrefix) {
            const originalCommandText = messageText.slice(usedPrefix.length).trim();
            args = originalCommandText.split(/\s+/).slice(1);
        } else {
            args = messageText.trim().split(/\s+/).slice(1);
        }

        if (command.strictOwnerOnly || command.superOwnerOnly) {
            const { isOwnerOnly } = await import('./isOwner.js');
            if (!message.key.fromMe && !isOwnerOnly(senderId)) {
                return await sock.sendMessage(chatId, {
                    text: '🔐 *This command is reserved for super owners only.*',
                    ...channelInfo
                }, { quoted: message });
            }
        }

        if (command.ownerOnly && !message.key.fromMe && !senderIsOwnerOrSudo) {
            return await sock.sendMessage(chatId, {
                text: 'ℹ️ *This command is only available for the owner or sudo users!*',
                ...channelInfo
            }, { quoted: message });
        }

        if (!isOwnerOrSudoCheck) {
            try {
                const { isPremiumCmd, isPremiumUser, isLinkMember } = await import('../lib/premiumDb.js');
                if (await isPremiumCmd(command.command)) {
                    const hasPremium = await isPremiumUser(senderId) || await isLinkMember(sock, senderId);
                    if (!hasPremium) {
                        const { getSocialLinks } = await import('../lib/premiumDb.js');
                        const socialRows = await getSocialLinks();
                        const LABEL: Record<string, string> = {
                            whatsapp: 'WhatsApp Group', telegram: 'Telegram',
                            facebook: 'Facebook',       instagram: 'Instagram',
                            youtube:  'YouTube',        website: 'Website',
                        };
                        const links = socialRows.map(l => `├ ${LABEL[l.platform] || l.platform}: ${l.url}`);
                        if (links.length) {
                            links[links.length - 1] = links[links.length - 1].replace('├', '└');
                        }
                        const linkBlock = links.length
                            ? `┌\n${links.join('\n')}`
                            : `└ Use *.owner* to contact the owner directly.`;

                        const senderNum = senderId.split('@')[0].split(':')[0];
                        return await sock.sendMessage(chatId, {
                            text:
`╭───❰ *🔐 PREMIUM LOCKED* ❱───╮

*👤 User:* @${senderNum}
*📊 Status:* Inactive

❌ *You are not a premium member*

*Want Premium?*
Unlock exclusive commands and features!

*Here is a guide on how to get premium:*

*➊ SUPPORT US*
Join / Follow / Subscribe / Click any one:
${linkBlock}

*➋ CONTACT OWNER*
Use *.owner* to get the owner's number.

*➌ SEND PROOF*
Screenshot your join/follow and send it to the owner for activation.

*⚠️ WARNING:* Leaving/unfollowing after activation will disconnect your premium without notice.

╰────────────────────────────╯`,
                            mentions: [senderId], ...channelInfo
                        }, { quoted: message });
                    }
                }
            } catch {}
        }

        if (command.groupOnly && !isGroup) {
            return await sock.sendMessage(chatId, {
                text: 'ℹ️ *This command can only be used in groups!*',
                ...channelInfo
            }, { quoted: message });
        }

        let isSenderAdmin = false;
        let isBotAdmin = false;

        if (command.adminOnly && isGroup) {
            const adminStatus = await isAdmin(sock, chatId, senderId);
            isSenderAdmin = adminStatus.isSenderAdmin;
            isBotAdmin = adminStatus.isBotAdmin;

            if (!isBotAdmin) {
                return await sock.sendMessage(chatId, {
                    text: 'ℹ️ *Please make the bot an admin to use this command.*',
                    ...channelInfo
                }, { quoted: message });
            }

            if (!isSenderAdmin && !message.key.fromMe && !senderIsOwnerOrSudo) {
                return await sock.sendMessage(chatId, {
                    text: 'ℹ️ *Sorry, only group admins can use this command.*',
                    ...channelInfo
                }, { quoted: message });
            }
        }

        const context = {
            chatId,
            senderId,
            isGroup,
            isSenderAdmin,
            isBotAdmin,
            senderIsOwnerOrSudo,
            isOwnerOrSudoCheck,
            channelInfo,
            rawText,
            userMessage,
            messageText,
            config
        };

        // ── .onhere / .offhere — per-group bot toggle ─────────────────────
        // Owner/sudo + the toggle commands themselves always pass through
        const __toggleCmds = new Set(['onhere', 'offhere', 'boton', 'botoff', 'enablebot', 'disablebot']);
        if (isGroup && !message.key.fromMe && !senderIsOwnerOrSudo && !__toggleCmds.has(command.command)) {
            try {
                const __botEnabled = await store.getSetting(chatId, 'bot_enabled');
                if (__botEnabled && __botEnabled.enabled === false) {
                    return; // silently ignore — bot disabled in this group
                }
            } catch {}
        }

        try {
            await command.handler(sock, message, args, context);
            await addCommandReaction(sock, message);
            await showTypingAfterCommand(sock, chatId);
        } catch(error: any) {
            printLog('error', `Command error [${command.command}]: ${error.message}`);
            console.error(error.stack);

            await sock.sendMessage(chatId, {
                text: `❌ Error executing command: ${error.message}`,
                ...channelInfo
            }, { quoted: message });

            const errorLog = {
                command: command.command,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString(),
                user: senderId,
                chat: chatId
            };

            try {
                writeErrorLog(errorLog);

            } catch(e: any) {
                printLog('error', `Failed to write error log: ${e.message}`);
            }
        }

    } catch(error: any) {
        printLog('error', `Message handler error: ${error.message}`);
        console.error(error.stack);

        const chatId = messageUpdate.messages?.[0]?.key?.remoteJid;
        if (chatId) {
            try {
                await sock.sendMessage(chatId, {
                    text: 'ℹ️ *Failed to process message!*',
                    ...channelInfo
                });
            } catch(e: any) {
                printLog('error', `Failed to send error message: ${e.message}`);
            }
        }
    }
 }


async function handleGroupParticipantUpdate(sock: any, update: any) {
    try {
        const { id, participants, action, author } = update;
        // Invalidate antispam cache so admin changes take effect immediately
        invalidateGroupCache(id);
        if (!id.endsWith('@g.us')) return;

        printLog('info', `Group update: ${action} in ${id.split('@')[0]}`);

        const botMode = await store.getBotMode();
        const isPublicMode = botMode === 'public' || botMode === 'groups';

        switch (action) {
            case 'promote':
                if (!isPublicMode) return;
                if (participants && participants.length > 0) {
                    const _participant = Array.isArray(participants) ? participants[0] : participants;
                }
                const handlePromotionEvent = (await import('../plugins/promote.js')).default?.handlePromotionEvent;
                await handlePromotionEvent(sock, id, participants, author);
                break;

            case 'demote':
                if (!isPublicMode) return;
                if (participants && participants.length > 0) {
                    const _participant = Array.isArray(participants) ? participants[0] : participants;
                }
                const handleDemotionEvent = (await import('../plugins/demote.js')).default?.handleDemotionEvent;
                await handleDemotionEvent(sock, id, participants, author);
                break;

            case 'add':
                if (participants && participants.length > 0) {
                    const _participant = Array.isArray(participants) ? participants[0] : participants;
                }

                // ── Track join time in activity DB (non-blocking) ────────────
                (async () => {
                    try {
                        const db = getDb();
                        const now = Date.now();
                        const toInsert = Array.isArray(participants) ? participants : [participants];
                        const { trackJoin } = await import('../plugins/tagnew.js');
                        for (const p of toInsert) {
                            const jidStr = typeof p === 'string' ? p : (p as any).id || p;
                            await db.execute({
                                sql: `INSERT INTO msg_activity (group_id, user_id, last_seen, msg_count)
                                      VALUES (?, ?, ?, 0)
                                      ON CONFLICT(group_id, user_id) DO NOTHING`,
                                args: [id, jidStr, now],
                            });
                            try { trackJoin(id, jidStr); } catch {}
                        }
                    } catch {}
                })();

                // ── Try batch welcome first; fall back to normal welcome ──────
                try {
                    const { handleBatchJoinEvent } = await import('../plugins/welcomedm.js');
                    const batchHandled = await handleBatchJoinEvent(sock, id, Array.isArray(participants) ? participants : [participants]);
                    if (!batchHandled) {
                        const { handleJoinEvent } = await import('../plugins/welcome.js');
                        await handleJoinEvent(sock, id, participants);
                    }
                } catch {
                    const { handleJoinEvent } = await import('../plugins/welcome.js');
                    await handleJoinEvent(sock, id, participants);
                }

                // Anti-raid check
                try {
                    const { handleJoinForRaid } = await import('../plugins/antiraid.js');
                    await handleJoinForRaid(sock, id, Array.isArray(participants) ? participants : [participants]);
                } catch {}
                break;

            case 'remove':
                if (participants && participants.length > 0) {
                    const _participant = Array.isArray(participants) ? participants[0] : participants;
                }
                const handleLeaveEvent = (await import('../plugins/goodbye.js')).default?.handleLeaveEvent;
                await handleLeaveEvent(sock, id, participants);
                break;

            default:
                printLog('warning', `Unhandled group action: ${action}`);
        }
    } catch(error: any) {
        printLog('error', `Group update error: ${error.message}`);
        console.error(error.stack);
    }
}

async function handleStatus(sock: any, status: any) {
    try {
        const { default: _autostatus } = await import('../plugins/autostatus.js');
        const handleStatusUpdate = _autostatus.handleStatusUpdate;
        await handleStatusUpdate(sock, status);
    } catch(error: any) {
        printLog('error', `Status handler error: ${error.message}`);
        console.error(error.stack);
    }
}

// Persists across events so duplicate call-state events don't re-send the message
const antiCallNotified = new Map<string, number>();

async function handleCall(sock: any, calls: any) {
    try {
        const anticallPlugin = (await import('../plugins/anticall.js')).default;
        const state = anticallPlugin.readState ? await anticallPlugin.readState() : { enabled: false };
        if (!state.enabled) return;

        for (const call of calls) {
            // Only react on the initial offer — WhatsApp fires many events per call
            if (call.status && call.status !== 'offer') continue;

            const callerJid = call.from || call.peerJid || call.chatId;
            if (!callerJid) continue;

            // Deduplicate: skip if we already handled this caller in the last 2 minutes
            const lastNotified = antiCallNotified.get(callerJid) ?? 0;
            if (Date.now() - lastNotified < 120_000) continue;
            antiCallNotified.set(callerJid, Date.now());
            setTimeout(() => antiCallNotified.delete(callerJid), 120_000);

            try {
                try {
                    if (typeof sock.rejectCall === 'function' && call.id) {
                        await sock.rejectCall(call.id, callerJid);
                    } else if (typeof sock.sendCallOfferAck === 'function' && call.id) {
                        await sock.sendCallOfferAck(call.id, callerJid, 'reject');
                    }
                } catch(e: any) {
                    printLog('error', `Error rejecting call: ${e.message}`);
                }

                await sock.sendMessage(callerJid, {
                    text: '📵 Anticall is enabled. Your call was rejected and you will be blocked.'
                });
                printLog('info', `Sent anticall warning to: ${callerJid.split('@')[0]}`);

                setTimeout(async () => {
                    try {
                        await sock.updateBlockStatus(callerJid, 'block');
                        printLog('success', `Blocked caller: ${callerJid.split('@')[0]}`);
                    } catch(e: any) {
                        printLog('error', `Error blocking caller: ${e.message}`);
                    }
                }, 800);

            } catch(error: any) {
                printLog('error', `Error handling call from ${callerJid.split('@')[0]}: ${error.message}`);
            }
        }
    } catch(error: any) {
        printLog('error', `Call handler error: ${error.message}`);
        console.error(error.stack);
    }
}

export {
    handleMessages,
    handleGroupParticipantUpdate,
    handleStatus,
    handleCall
};

