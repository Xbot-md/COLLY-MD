import chalk from 'chalk';
import config from '../config.js';

// ── group name cache — fetched once per group, never per-message ──────────────
const groupNameCache = new Map<string, string>();

function extractPhoneNumber(jid: string): string | null {
    if (!jid) return null;
    const number = jid
        .replace('@s.whatsapp.net', '')
        .replace('@lid', '')
        .replace('@g.us', '')
        .split(':')[0];
    if (number.length < 7) return null;
    return number;
}

/**
 * Pretty console logger for incoming / outgoing messages.
 * - Only logs text commands (prefixed) and non-bot media — skips noise
 * - Never calls groupMetadata() on every message (uses a warm cache)
 */
async function printMessage(message: any, sock: any) {
    try {
        if (!message?.key) return;

        const m       = message;
        const chatId  = m.key.remoteJid;
        const sender  = m.key.participant || m.key.remoteJid;
        const isGroup = chatId?.endsWith('@g.us');
        const fromMe  = m.key.fromMe;

        // Skip noise types — protocol / key distribution / reactions
        const msgType = Object.keys(m.message || {})[0] || '';
        if (
            msgType === 'senderKeyDistributionMessage' ||
            msgType === 'protocolMessage'              ||
            msgType === 'reactionMessage'
        ) return;

        // ── extract text ──────────────────────────────────────────────────────
        let text = '';
        let fileSize = 0;
        switch (msgType) {
            case 'conversation':        text = m.message.conversation; break;
            case 'extendedTextMessage': text = m.message.extendedTextMessage?.text || ''; break;
            case 'imageMessage':        text = m.message.imageMessage?.caption || '[Image]';
                                        fileSize = m.message.imageMessage?.fileLength || 0; break;
            case 'videoMessage':        text = m.message.videoMessage?.caption || '[Video]';
                                        fileSize = m.message.videoMessage?.fileLength || 0; break;
            case 'audioMessage': {
                const s = m.message.audioMessage?.seconds || 0;
                text = `[Audio ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}]`;
                fileSize = m.message.audioMessage?.fileLength || 0; break;
            }
            case 'documentMessage':     text = `[📄 ${m.message.documentMessage?.fileName || 'Doc'}]`;
                                        fileSize = m.message.documentMessage?.fileLength || 0; break;
            case 'stickerMessage':      text = '[Sticker]'; break;
            case 'contactMessage':      text = `[👤 ${m.message.contactMessage?.displayName || 'Contact'}]`; break;
            case 'locationMessage':     text = '[📍 Location]'; break;
            default:                    text = `[${msgType.replace('Message', '')}]`; break;
        }

        // Only log commands (prefixed) and media from others — skip plain chat
        const prefixes = config.prefixes || ['.', '!', '/', '#'];
        const isCommand = prefixes.some(p => text.startsWith(p));
        if (!isCommand && !fromMe && ['conversation', 'extendedTextMessage'].includes(msgType)) return;

        // ── sender display ────────────────────────────────────────────────────
        const senderNum  = extractPhoneNumber(sender) || sender.split('@')[0];
        const senderName = m.pushName?.trim() || senderNum;
        const senderDisp = senderName !== senderNum ? `${senderName} (${senderNum})` : senderNum;

        // ── group name — use cache; fetch only if missing ─────────────────────
        let chatLabel = '';
        if (isGroup) {
            if (!groupNameCache.has(chatId)) {
                try {
                    const meta = await sock.groupMetadata(chatId);
                    groupNameCache.set(chatId, meta?.subject || chatId.split('@')[0]);
                } catch {
                    groupNameCache.set(chatId, chatId.split('@')[0]);
                }
            }
            chatLabel = groupNameCache.get(chatId) || '';
        }

        // ── time ──────────────────────────────────────────────────────────────
        const ts  = m.messageTimestamp;
        const t   = new Date((ts?.low || ts || Date.now() / 1000) * 1000);
        const timeStr = t.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false, timeZone: config.timeZone || 'Asia/Karachi',
        });

        // ── file size label ───────────────────────────────────────────────────
        let sizeStr = '';
        if (fileSize > 0) {
            const units = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(fileSize) / Math.log(1024));
            sizeStr = ` (${(fileSize / Math.pow(1024, i)).toFixed(1)} ${units[i]})`;
        }

        const typeLabel: Record<string, string> = {
            conversation: 'TEXT', extendedTextMessage: 'TEXT',
            imageMessage: 'IMAGE', videoMessage: 'VIDEO', audioMessage: 'AUDIO',
            documentMessage: 'DOC', stickerMessage: 'STICKER',
        };
        const displayType = typeLabel[msgType] || msgType.replace('Message', '').toUpperCase();

        const displayText = text.length > 120 ? text.slice(0, 120) + '…' : text;

        // ── print ─────────────────────────────────────────────────────────────
        const C = chalk as any;
        console.log(C.hex('#00D9FF').bold('╭─────────────────────────────────'));
        console.log(
            C.hex('#00D9FF').bold('│') + ' ' +
            C.cyan.bold('🤖 Bot') + ' ' +
            C.bgCyan.black.bold(` ${timeStr} `) + ' ' +
            C.magenta.bold(displayType) +
            C.gray(sizeStr)
        );
        console.log(
            C.hex('#00D9FF').bold('│') + ' ' +
            (fromMe ? C.green.bold('📤 ME') : C.yellow.bold('📨 FROM')) + ' ' +
            C.white.bold(senderDisp)
        );
        if (isGroup && chatLabel) {
            console.log(C.hex('#00D9FF').bold('│') + ' ' + C.blue.bold('👥 GROUP') + ' ' + C.white.bold(chatLabel));
        } else if (!isGroup) {
            console.log(C.hex('#00D9FF').bold('│') + ' ' + C.magenta.bold('💬 DM'));
        }
        if (displayText) {
            console.log(
                C.hex('#00D9FF').bold('│') + ' ' +
                C.hex('#FFD700').bold('💭 MSG') + ' ' +
                (isCommand ? C.greenBright.bold(displayText) : C.white(displayText))
            );
        }
        console.log(C.hex('#00D9FF').bold('╰─────────────────────────────────'));
        console.log();

    } catch (err: any) {
        // Silent — logger errors must never crash the bot
    }
}

/**
 * Simple structured logger for system events.
 */
function printLog(type: string, message: any) {
    const timestamp = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZone: config.timeZone || 'Asia/Karachi',
    });

    const colors: Record<string, any> = {
        info:       chalk.blue,
        success:    chalk.green,
        warning:    chalk.yellow,
        error:      chalk.red,
        connection: chalk.cyan,
        store:      chalk.magenta,
    };
    const icons: Record<string, string> = {
        info: '💡', success: '✅', warning: '⚠️',
        error: '❌', connection: '🔌', store: '🗄️',
    };

    const color = colors[type] || chalk.white;
    const icon  = icons[type]  || '•';
    console.log((chalk as any).gray.bold(`[${timestamp}]`) + ' ' + color(icon) + ' ' + color(message));
}

export { printMessage, printLog };
