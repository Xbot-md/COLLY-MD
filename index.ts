import './config.js';

// Suppress noisy internal crypto/session logs from Baileys/libsignal
const _origInfo = console.info.bind(console);
const _origLog = console.log.bind(console);
const _origError = console.error.bind(console);
const _NOISE = /Closing session|Closing open session|Failed to decrypt|Bad MAC|verifyMAC|decryptWith|Removing old closed session|Removing old session|SessionEntry|No matching sessions found for message|Session error|MessageCounterError/;
console.info = (...a: any[]) => { if (!_NOISE.test(String(a[0]))) _origInfo(...a); };
console.log  = (...a: any[]) => { if (!_NOISE.test(String(a[0]))) _origLog(...a); };
console.error = (...a: any[]) => { if (!_NOISE.test(String(a[0]))) _origError(...a); };

import fs from 'fs';
import { existsSync, mkdirSync, rmSync } from 'fs';
import path, { dirname } from 'path';
import chalk from 'chalk';
import syntaxerror from 'syntax-error';
import { parsePhoneNumber as PhoneNumber } from 'awesome-phonenumber';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import { waitForPhoneNumber, setPairingCode, setConnected, setError } from './lib/pairingState.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { smsg } from './lib/myfunc.js';
import { compileAll } from './lib/compile.js';
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    jidDecode,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} from '@whiskeysockets/baileys';
import NodeCache from 'node-cache';
import pino from 'pino';
import config from './config.js';
import store from './lib/lightweight_store.js';
import SaveCreds from './lib/session.js';
import { server, PORT } from './lib/server.js';
import { printLog } from './lib/print.js';
import { writeErrorLog } from './lib/logger.js';
import {
    handleMessages,
    handleGroupParticipantUpdate,
    handleStatus,
    handleCall
} from './lib/messageHandler.js';
import commandHandler from './lib/commandHandler.js';
import { initTurso } from './lib/turso.js';
import { initAgentState } from './lib/duckAgent.js';
import { initQBState } from './lib/quillbotService.js';


store.readFromFile();
// Write store every 5 minutes only — lightweight_store.ts already has its own 5-min timer
setInterval(() => store.writeToFile(), config.storeWriteInterval || 5 * 60 * 1000);

// Initialize Turso database tables, then restore bot states
initTurso().then(async () => {
    printLog('success', '✅ Turso DB connected and tables ready');
    await Promise.all([initAgentState(), initQBState()]);
    const { startShopBillingScheduler, seedDefaultShopOwners } = await import('./lib/shopStore.js');
    const { SUPER_OWNER_NUMBERS } = await import('./lib/ownerManager.js');
    await seedDefaultShopOwners(SUPER_OWNER_NUMBERS);
    startShopBillingScheduler();
}).catch((err: any) => {
    printLog('error', `❌ Turso init failed: ${err.message}`);
});

setInterval(() => {
    if (global.gc) {
        global.gc();
        console.log('🧹 Garbage collection completed');
    }
}, 60_000);

setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024;
    if (used > 600) {
        printLog('warning', `RAM too high (>${Math.round(used)}MB), restarting bot...`);
        process.exit(1);
    }
}, 30_000);

const phoneNumber: string = config.pairingNumber || config.ownerNumber || "2349133354644";

// Auto-create data directory and default files on startup
const DATA_DEFAULTS: Record<string, any> = {
    'owner.json': [],
    'banned.json': [],
    'premium.json': [],
    'warnings.json': {},
    'notes.json': {},
    'autoAi.json': {},
    'messageCount.json': { isPublic: true, messageCount: {} },
    'userGroupData.json': { users: [], groups: [], antilink: {}, antibadword: {}, warnings: {}, sudo: [], welcome: {}, goodbye: {}, chatbot: {}, autoReaction: false },
    'autoStatus.json': { enabled: false },
    'autoread.json': { enabled: false },
    'autotyping.json': { enabled: false },
    'pmblocker.json': { enabled: false },
    'anticall.json': { enabled: false },
    'stealthMode.json': { enabled: false },
    'autoBio.json': { enabled: false, customBio: null },
    'autoReaction.json': { enabled: false },
    'antidelete.json': { enabled: false },
    'antilink.json': {},
    'antibadword.json': {},
};
fs.mkdirSync('./data', { recursive: true });
for (const [file, def] of Object.entries(DATA_DEFAULTS)) {
    const fp = `./data/${file}`;
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, JSON.stringify(def, null, 2));
}

let owner: string[] = [];
try {
    owner = JSON.parse(fs.readFileSync('./data/owner.json', 'utf-8'));
} catch { owner = []; }

global.botname = config.botName || "COLLY MD";
global.themeemoji = "•";

const pairingCode = !process.argv.includes("--qr-code");
const useMobile = process.argv.includes("--mobile");

process.on('SIGINT', () => {
    process.exit(0);
});

function ensureSessionDirectory(): string {
    const sessionPath = path.join(__dirname, 'session');
    if (!existsSync(sessionPath)) {
        mkdirSync(sessionPath, { recursive: true });
    }
    return sessionPath;
}

function hasValidSession(): boolean {
    try {
        const credsPath = path.join(__dirname, 'session', 'creds.json');
        if (!existsSync(credsPath)) return false;

        const fileContent = fs.readFileSync(credsPath, 'utf8');
        if (!fileContent || fileContent.trim().length === 0) {
            printLog('warning', 'creds.json exists but is empty');
            return false;
        }

        try {
            const creds = JSON.parse(fileContent);
            if (!creds.noiseKey || !creds.signedIdentityKey || !creds.signedPreKey) {
                printLog('warning', 'creds.json is missing required fields');
                return false;
            }
            if (creds.registered === false) {
                printLog('warning', 'Session not registered. Clearing for fresh pairing...');
                try { rmSync(path.join(__dirname, 'session'), { recursive: true, force: true }); } catch (_e: any) { /* ignore */ }
                return false;
            }
            printLog('success', 'Valid and registered session credentials found');
            return true;
        } catch (_parseError: any) {
            printLog('warning', 'creds.json contains invalid JSON');
            return false;
        }
    } catch (error: any) {
        printLog('error', `Error checking session validity: ${error.message}`);
        return false;
    }
}

async function initializeSession(): Promise<boolean> {
    ensureSessionDirectory();

    const txt = config.sessionId;

    if (!txt) {
        if (hasValidSession()) {
            printLog('success', 'Existing session found. Using saved credentials');
            return true;
        }
        return false;
    }

    if (hasValidSession()) return true;

    try {
        await SaveCreds(txt);
        await delay(2000);

        if (hasValidSession()) {
            printLog('success', 'Session file verified and valid');
            await delay(1000);
            return true;
        } else {
            printLog('error', 'Session file not valid after download');
            return false;
        }
    } catch (error: any) {
        printLog('error', `Error downloading session: ${error.message}`);
        return false;
    }
}

server.listen(PORT, () => {
    printLog('success', `Server listening on port ${PORT}`);
});

async function startDave(): Promise<any> {
    try {
        const { version } = await fetchLatestBaileysVersion();

        ensureSessionDirectory();
        await delay(1000);

        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        const _saveCreds = async () => {
            ensureSessionDirectory();
            await saveCreds();
        };
        const msgRetryCounterCache = new NodeCache();

        const ghostMode = await store.getSetting('global', 'stealthMode');
        const isGhostActive = ghostMode && ghostMode.enabled;

        const Dave = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: !isGhostActive,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key: any) => {
                const jid = jidNormalizedUser(key.remoteJid);
                const msg = await store.loadMessage(jid, key.id);
                return msg?.message || "";
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        }) as any;
        Dave.store = store;

        const originalSendPresenceUpdate = Dave.sendPresenceUpdate;
        const originalReadMessages = Dave.readMessages;
        const originalSendReceipt = Dave.sendReceipt;

        Dave.sendPresenceUpdate = async function (...args: any[]) {
            const ghostMode = await store.getSetting('global', 'stealthMode');
            if (ghostMode && ghostMode.enabled) {
                printLog('info', '👻 Blocked presence update (stealth mode)');
                return;
            }
            return originalSendPresenceUpdate.apply(this, args);
        };

        Dave.readMessages = async function (...args: any[]) {
            const ghostMode = await store.getSetting('global', 'stealthMode');
            if (ghostMode && ghostMode.enabled) return;
            return originalReadMessages.apply(this, args);
        };

        if (originalSendReceipt) {
            Dave.sendReceipt = async function (...args: any[]) {
                const ghostMode = await store.getSetting('global', 'stealthMode');
                if (ghostMode && ghostMode.enabled) return;
                return originalSendReceipt.apply(this, args);
            };
        }

        const originalQuery = Dave.query;
        Dave.query = async function (node: any, ...args: any[]) {
            const ghostMode = await store.getSetting('global', 'stealthMode');
            if (ghostMode && ghostMode.enabled) {
                if (node && node.tag === 'receipt') return;
                if (node && node.attrs && (node.attrs.type === 'read' || node.attrs.type === 'read-self')) return;
            }
            return originalQuery.apply(this, [node, ...args]);
        };

        Dave.isGhostMode = async () => {
            const ghostMode = await store.getSetting('global', 'stealthMode');
            return ghostMode && ghostMode.enabled;
        };

        Dave.ev.on('creds.update', _saveCreds);
        store.bind(Dave.ev);

        Dave.ev.on('messages.upsert', async (chatUpdate: any) => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek.message) return;

                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage')
                    ? mek.message.ephemeralMessage.message
                    : mek.message;

                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(Dave, chatUpdate);
                    return;
                }

                if (!Dave.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
                    const isGroup = mek.key?.remoteJid?.endsWith('@g.us');
                    if (!isGroup) return;
                }

                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;

                if (Dave?.msgRetryCounterCache) {
                    Dave.msgRetryCounterCache.clear();
                }

                try {
                    await handleMessages(Dave, chatUpdate);
                } catch (err: any) {
                    printLog('error', `Error in handleMessages: ${err.message}`);
                    if (mek.key && mek.key.remoteJid) {
                        await Dave.sendMessage(mek.key.remoteJid, {
                            text: '❌ An error occurred while processing your message.',
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterName: 'DavidXTech',
                                    serverMessageId: -1
                                }
                            }
                        }).catch(console.error);
                    }
                }
            } catch (err: any) {
                printLog('error', `Error in messages.upsert: ${err.message}`);
            }
        });

        Dave.decodeJid = (jid: any) => {
            if (!jid) return jid;
            if (/:\d+@/gi.test(jid)) {
                const decode = jidDecode(jid) || {};
                return (decode as any).user && (decode as any).server && (decode as any).user + '@' + (decode as any).server || jid;
            } else return jid;
        };

        Dave.ev.on('contacts.update', (update: any[]) => {
            for (const contact of update) {
                const id = Dave.decodeJid(contact.id);
                if (store && store.contacts) (store.contacts as any)[id] = { id, name: contact.notify };
            }
        });

        Dave.getName = (jid: any, withoutContact = false) => {
            const id = Dave.decodeJid(jid);
            withoutContact = Dave.withoutContact || withoutContact;
            let v: any;
            if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
                v = (store.contacts as any)[id] || {};
                if (!(v.name || v.subject)) v = Dave.groupMetadata(id) || {};
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).number?.international);
            });
            else v = id === '0@s.whatsapp.net' ? {
                id,
                name: 'WhatsApp'
            } : id === Dave.decodeJid(Dave.user.id) ?
                Dave.user :
                ((store.contacts as any)[id] || {});
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).number?.international;
        };

        Dave.public = true;
        Dave.serializeM = (m: any) => smsg(Dave, m, store);

        const isRegistered = state.creds?.registered === true;

        if (pairingCode && !isRegistered) {
            if (useMobile) throw new Error('Cannot use pairing code with mobile api');

            let phoneNumberInput: string = '';

            if (config.pairingNumber) {
                phoneNumberInput = config.pairingNumber.replace(/[^0-9]/g, '');
                printLog('info', `Using configured pairing number: ${phoneNumberInput}`);
            } else if (process.env.PAIRING_NUMBER) {
                phoneNumberInput = process.env.PAIRING_NUMBER.replace(/[^0-9]/g, '');
                printLog('info', `Using env pairing number: ${phoneNumberInput}`);
            } else {
                // Loop until a valid number is submitted via web panel
                while (true) {
                    printLog('info', '🌐 Waiting for number from web panel...');
                    const raw = await waitForPhoneNumber();
                    const cleaned = raw.replace(/[^0-9]/g, '');
                    if (PhoneNumber('+' + cleaned).valid) {
                        phoneNumberInput = cleaned;
                        break;
                    }
                    printLog('error', `Invalid number submitted: ${cleaned} — resetting web panel`);
                    setError('❌ Invalid number. Include your country code with no + or spaces, then try again.');
                    await delay(2000);
                    // waitForPhoneNumber() will be called again in the next loop iteration
                }
            }

            const doPairing = async (num: string, attempt: number = 1): Promise<void> => {
                try {
                    let code = await Dave.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    setPairingCode(code);
                    console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)));
                    printLog('success', `Pairing code generated: ${code}`);
                } catch (error: any) {
                    if (attempt < 3) {
                        try { rmSync('./session', { recursive: true, force: true }); } catch (_e: any) { /* ignore */ }
                        await delay(3000);
                        startDave();
                    } else {
                        setError('Pairing failed after 3 attempts. Please restart.');
                        printLog('error', 'All 3 pairing attempts failed. Please restart manually.');
                    }
                }
            };
            setTimeout(() => doPairing(phoneNumberInput), 3000);
        } else if (isRegistered) {
            printLog('info', 'Session already registered');
        } else {
            printLog('warning', 'Waiting for connection to establish...');
        }

        Dave.ev.on('connection.update', async (s: any) => {
            const { connection, lastDisconnect, qr } = s;

            if (qr) {
                if (!pairingCode) {
                    try {
                        console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
                    } catch (_e: any) { console.log('QR:', qr); }
                }
            }

            if (connection === "open") {
                printLog('success', 'Bot connected successfully!');

                try {
                    const setbioModule = await import('./plugins/setbio.js');
                    const startAutoBio = setbioModule.startAutoBio || (setbioModule.default as any)?.startAutoBio;
                    if (typeof startAutoBio === 'function') startAutoBio(Dave);
                } catch (e: any) {
                    printLog('error', `Failed to start auto bio: ${e.message}`);
                }

                const ghostMode = await store.getSetting('global', 'stealthMode');
                if (ghostMode && ghostMode.enabled) {
                    printLog('info', '👻 STEALTH MODE ACTIVE');
                }

                printLog('success', 'Connected to => ' + JSON.stringify(Dave.user, null, 2));
                const connectedNum = Dave.user?.id?.split(':')[0] || '';
                setConnected(connectedNum);
                (global as any).botJid = Dave.user?.id?.split(':')[0] + '@s.whatsapp.net';

                try {
                    const botNumber = Dave.user.id.split(':')[0] + '@s.whatsapp.net';
                    const ghostStatus = (ghostMode && ghostMode.enabled) ? '\n👻 Stealth Mode: ACTIVE' : '';

                    await Dave.sendMessage(botNumber, {
                        text: `🤖 *COLLY MD* — Connected Successfully!\n\n⏰ *Time:* ${new Date().toLocaleString()}\n✅ *Status:* Online and Ready!${ghostStatus}\n\n📢 Join our channel: https://whatsapp.com/channel/0029VbCGhUI7T8bP7vjhfq3t\n\n🔖 *Colly novels* | 👨‍💻 *DavidXTech*`
                    });
                } catch (error: any) {
                    printLog('error', `Failed to send connection message: ${error.message}`);
                }

                await delay(1999);
                try { owner = JSON.parse(fs.readFileSync('./data/owner.json', 'utf-8')); } catch (_e: any) {}
                printLog('info',    `[ ${config.botName || 'COLLY MD'} ]`);
                printLog('info',    `WA NUMBER  : ${owner[0] || config.ownerNumber || ''}`);
                printLog('success', `Bot Connected Successfully!`);
                printLog('info',    `Plugins   : ${commandHandler.commands.size}`);
                printLog('info',    `Prefixes   : ${config.prefixes.join(', ')}`);
                printLog('store',   `Backend    : ${store.getStats().backend}`);
                console.log();
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    try { rmSync('./session', { recursive: true, force: true }); } catch (_e: any) { /* ignore */ }
                    await delay(3000);
                    startDave();
                    return;
                }

                if (shouldReconnect) {
                    printLog('connection', 'Reconnecting in 5 seconds...');
                    await delay(5000);
                    startDave();
                }
            }
        });

        Dave.ev.on('call', async (calls: any) => {
            await handleCall(Dave, calls);
        });

        Dave.ev.on('group-participants.update', async (update: any) => {
            await handleGroupParticipantUpdate(Dave, update);
        });

        Dave.ev.on('status.update', async (status: any) => {
            await handleStatus(Dave, status);
        });

        Dave.ev.on('messages.reaction', async (reaction: any) => {
            await handleStatus(Dave, reaction);
        });


        return Dave;
    } catch (error: any) {
        printLog('error', `Error in startDave: ${error.message}`);
        await delay(5000);
        startDave();
    }
}

async function main() {
    await compileAll();
    await commandHandler.loadCommands();
    printLog('info', 'Starting COLLY MD BOT...');
    await initializeSession();
    await delay(3000);
    startDave().catch((error: any) => {
        printLog('error', `Fatal error: ${error.message}`);
        process.exit(1);
    });
}

main();

// Session cleanup interval
const sessionDir = path.join(process.cwd(), 'session');
setInterval(() => {
    if (!fs.existsSync(sessionDir)) return;
    fs.readdir(sessionDir, (err, files) => {
        if (err) return;
        for (const file of files) {
            if (file === 'creds.json') continue;
            if (file.startsWith('app-state-sync-key-')) continue;
            fs.unlink(path.join(sessionDir, file), () => {});
        }
    });
}, 3 * 60 * 1000);

// Temp folder setup
const customTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(customTemp)) fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

// Temp folder cleanup
setInterval(() => {
    fs.readdir(customTemp, (err, files) => {
        if (err) return;
        for (const file of files) {
            const filePath = path.join(customTemp, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && Date.now() - stats.mtimeMs > 3 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => {});
                }
            });
        }
    });
}, 1 * 60 * 60 * 1000);

// Syntax check dist files
const folders = [
    path.join(__dirname, './dist/lib'),
    path.join(__dirname, './dist/plugins')
];

folders.forEach(folder => {
    if (!fs.existsSync(folder)) return;
    fs.readdirSync(folder)
        .filter(file => file.endsWith('.js'))
        .forEach(file => {
            const filePath = path.join(folder, file);
            try {
                const code = fs.readFileSync(filePath, 'utf-8');
                const err = syntaxerror(code, file, {
                    sourceType: 'module',
                    allowAwaitOutsideFunction: true
                });
                if (err) {
                    console.error(chalk.red(`❌ Syntax error in ${filePath}:\n${err}`));
                }
            } catch (e: any) {
                console.error(chalk.yellow(`⚠️ Cannot read file ${filePath}:\n${e}`));
            }
        });
});

// Error handlers
process.on('uncaughtException', (err) => {
    printLog('error', `Uncaught Exception: ${(err as any).message}`);
    console.error((err as any).stack);
    writeErrorLog({
        type: 'uncaughtException',
        error: (err as any).message,
        stack: (err as any).stack,
        timestamp: new Date().toISOString()
    });
});

process.on('unhandledRejection', (err) => {
    printLog('error', `Unhandled Rejection: ${(err as any).message}`);
    console.error((err as any).stack);
    writeErrorLog({
        type: 'unhandledRejection',
        error: (err as any).message,
        stack: (err as any).stack,
        timestamp: new Date().toISOString()
    });
});

server.on('error', (error) => {
    if ((error as any).code === 'EADDRINUSE') {
        printLog('error', `Address localhost:${PORT} in use`);
        writeErrorLog({
            type: 'serverError',
            error: `Address localhost:${PORT} in use`,
            timestamp: new Date().toISOString()
        });
        server.close();
    } else {
        printLog('error', `Server error: ${error.message}`);
        writeErrorLog({
            type: 'serverError',
            error: error.message,
            stack: (error as any).stack,
            timestamp: new Date().toISOString()
        });
    }
});
