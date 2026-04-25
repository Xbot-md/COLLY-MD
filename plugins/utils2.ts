import type { BotContext } from '../types.js';

function numOf(jid: string) { return jid.split('@')[0].split(':')[0]; }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// ── device ─────────────────────────────────────────────────────────────────────
function analyzeDevice(msgId: string, targetJid: string): { device: string; icon: string; connection: string; confidence: string } {
    const idLen   = msgId.length;
    const prefix  = msgId.substring(0, 2).toUpperCase();
    const isLinked = targetJid.includes(':');

    // --- Method 1: Message-ID entropy (22-char Baileys signature) ---
    if (prefix === '3A' && idLen >= 20 && idLen <= 22) {
        return { device: 'iPhone (iOS)', icon: '🍎', connection: isLinked ? 'Multi-Device' : 'Primary', confidence: 'High (3A-prefix + ID length)' };
    }
    if (idLen === 22) {
        return { device: 'Baileys / Automated Bot', icon: '⚙️', connection: 'Multi-Device', confidence: 'High (22-char signature)' };
    }

    // --- Method 2: JID device-slot fallback ---
    const slot = isLinked ? parseInt(targetJid.split(':')[1]) : 0;
    if (isLinked || idLen < 20) {
        if (slot >= 10 && slot <= 20) {
            return { device: 'iPhone (iOS)', icon: '🍎', connection: 'Multi-Device', confidence: 'Medium (JID slot)' };
        }
        return { device: 'WhatsApp Web / Desktop', icon: '💻', connection: 'Multi-Device', confidence: 'Medium (JID slot)' };
    }
    if (idLen > 22) {
        return { device: 'Android Mobile', icon: '🤖', connection: 'Primary', confidence: 'Medium (ID length > 22)' };
    }

    return { device: 'Unknown / Emulated', icon: '🕵️', connection: 'Unknown', confidence: 'Low' };
}

const device = {
    command: 'device',
    aliases: ['mydevice', 'platform', 'whichapp', 'os', 'getdevice'],
    category: 'info',
    description: 'Pinpoint platform via 22-character entropy + JID analysis',
    usage: '.device [@mention | reply to message]',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;

        const ctx = message.message?.extendedTextMessage?.contextInfo;

        // Resolve target JID
        const mentioned     = ctx?.mentionedJid?.[0];
        const quotedPart    = ctx?.participant || ctx?.remoteJid;
        const inputJid      = args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null;
        const targetJid     = mentioned || quotedPart || inputJid || senderId;

        // Resolve message ID (quoted msg preferred for the target)
        const quotedMsgId   = ctx?.stanzaId;
        const msgId         = quotedMsgId || message.key.id || '';

        if (!msgId) {
            return sock.sendMessage(chatId,
                { text: '❌ *Analysis failed.* No message ID found. Try replying to a message.' },
                { quoted: message }
            );
        }

        const { device: detectedDevice, icon, connection, confidence } = analyzeDevice(msgId, targetJid);
        const userTag  = `@${targetJid.split('@')[0].split(':')[0]}`;
        const userNum  = targetJid.split('@')[0].split(':')[0];
        const now      = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const text = [
            '╭───❰ *⚡ PLATFORM ANALYZER* ❱───╮',
            '│',
            `│  👤 *User:* ${userTag}`,
            `│  📞 *Number:* +${userNum}`,
            '│',
            `│  🏷️ *Detected Platform:*`,
            `│  ╰ › ${icon} *${detectedDevice}*`,
            '│',
            `│  📊 *Data Signature:*`,
            `│  📂 ID: \`${msgId}\``,
            `│  📏 Length: \`${msgId.length} chars\``,
            `│  📡 Connection: \`${connection}\``,
            '│',
            `│  🛡️ *Confidence:* \`${confidence}\``,
            `│  🕒 *Checked:* ${now}`,
            '│',
            '╰────────────────────────────╯',
        ].join('\n');

        await sock.sendMessage(chatId, {
            text,
            mentions: [targetJid],
            ...channelInfo,
        }, { quoted: message });
    },
};

// ── vcf ────────────────────────────────────────────────────────────────────────
const vcf = {
    command: 'vcf',
    aliases: ['vcard', 'contact', 'savecontact'],
    category: 'tools',
    description: 'Generate a downloadable VCF contact card from a number',
    usage: '.vcf <+number> <Name>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        if (args.length < 2) {
            return sock.sendMessage(chatId, {
                text: '❌ *Usage:* `.vcf <+number> <Full Name>`\nExample: `.vcf +2347012345678 John Doe`',
                ...channelInfo
            }, { quoted: message });
        }

        const phone = args[0].replace(/[^+\d]/g, '');
        const name = args.slice(1).join(' ');

        if (!phone.startsWith('+') || phone.length < 7) {
            return sock.sendMessage(chatId, {
                text: '❌ Phone number must start with + and country code.\nExample: `+2347012345678`',
                ...channelInfo
            }, { quoted: message });
        }

        const vcfContent =
`BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;TYPE=CELL:${phone}
ORG:Saved via COLLY MD
NOTE:Contact added via bot
END:VCARD`;

        const buf = Buffer.from(vcfContent, 'utf-8');

        await sock.sendMessage(chatId, {
            document: buf,
            fileName: `${name.replace(/\s+/g, '_')}.vcf`,
            mimetype: 'text/x-vcard',
            caption:
`╭───❰ *📇 CONTACT CARD* ❱───╮

*👤 Name:* ${name}
*📞 Phone:* ${phone}

_Save this file to add the contact_

╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });
    },
};

// ── jid ────────────────────────────────────────────────────────────────────────
const jid = {
    command: 'jid',
    aliases: ['myjid', 'getjid', 'showjid'],
    category: 'info',
    description: 'Display the unique WhatsApp JID of a user or group',
    usage: '.jid [@user or in a group]',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId, isGroup } = context;

        const ctx = message.message?.extendedTextMessage?.contextInfo;
        const targetJid = ctx?.mentionedJid?.[0] || ctx?.participant;

        let text = '';

        if (isGroup) {
            text =
`╭───❰ *🆔 JID INFO* ❱───╮

*👥 Group JID:*
\`${chatId}\`

*👤 Your JID:*
\`${senderId}\`

${targetJid ? `*🎯 Mentioned JID:*\n\`${targetJid}\`` : ''}

╰────────────────────────────╯`;
        } else {
            text =
`╭───❰ *🆔 YOUR JID* ❱───╮

*👤 JID:*
\`${senderId}\`

*📞 Number:* +${numOf(senderId)}

╰────────────────────────────╯`;
        }

        await sock.sendMessage(chatId, {
            text,
            mentions: targetJid ? [targetJid] : [],
            ...channelInfo
        }, { quoted: message });
    },
};

// ── leakcheck ──────────────────────────────────────────────────────────────────
const leakcheck = {
    command: 'leakcheck',
    aliases: ['breach', 'pwned', 'databreach'],
    category: 'info',
    description: 'Check if an email or phone was in a known data breach',
    usage: '.leakcheck <email or phone>',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const input = args[0]?.trim();
        if (!input) {
            return sock.sendMessage(chatId, {
                text: '❌ *Usage:* `.leakcheck <email or phone>`\nExample: `.leakcheck user@example.com`',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);
        await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

        try {
            const isEmail = input.includes('@');

            let breaches: any[] = [];
            let source = '';

            if (isEmail) {
                const res = await fetch(`https://leakcheck.io/api/public?check=${encodeURIComponent(input)}`, {
                    headers: { 'User-Agent': UA },
                    signal: AbortSignal.timeout(15000),
                });

                if (res.ok) {
                    const data = await res.json() as any;
                    if (data.found && data.sources) {
                        breaches = data.sources;
                        source = 'LeakCheck.io';
                    }
                }

                if (!source) {
                    const hibpRes = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(input)}?truncateResponse=false`, {
                        headers: {
                            'User-Agent': 'colly-md-bot',
                            'hibp-api-key': process.env.HIBP_KEY || '',
                        },
                        signal: AbortSignal.timeout(10000),
                    });

                    if (hibpRes.status === 200) {
                        const data = await hibpRes.json() as any[];
                        breaches = data.map(b => b.Name);
                        source = 'HaveIBeenPwned';
                    } else if (hibpRes.status === 404) {
                        breaches = [];
                        source = 'HaveIBeenPwned';
                    }
                }
            }

            if (!source && !isEmail) {
                const res = await fetch(`https://leakcheck.io/api/public?check=${encodeURIComponent(input)}`, {
                    headers: { 'User-Agent': UA },
                    signal: AbortSignal.timeout(15000),
                });
                if (res.ok) {
                    const data = await res.json() as any;
                    if (data.found && data.sources) {
                        breaches = data.sources;
                        source = 'LeakCheck.io';
                    } else {
                        source = 'LeakCheck.io';
                    }
                }
            }

            const maskedInput = isEmail
                ? input.replace(/(?<=.{2}).(?=.*@)/g, '*')
                : input.replace(/\d(?=\d{4})/g, '*');

            if (breaches.length > 0) {
                const list = breaches.slice(0, 10).map((b: any, i: number) =>
                    `*${i + 1}.* ${typeof b === 'string' ? b : b.name || b}`
                ).join('\n');

                await sock.sendMessage(chatId, {
                    text:
`╭───❰ *🔍 BREACH CHECK* ❱───╮

*🔎 Checked:* ${maskedInput}
*⚠️ Status:* COMPROMISED
*📊 Found in:* ${breaches.length} breach${breaches.length !== 1 ? 'es' : ''}

*Breached sources:*
${list}

*🛡️ Recommendations:*
• Change your passwords immediately
• Enable 2-Factor Authentication
• Use a unique password manager

_Source: ${source}_

╰────────────────────────────╯`,
                    ...channelInfo
                }, { quoted: message });
            } else {
                await sock.sendMessage(chatId, {
                    text:
`╭───❰ *🔍 BREACH CHECK* ❱───╮

*🔎 Checked:* ${maskedInput}
*✅ Status:* NOT FOUND

Good news — no known breaches found for this ${isEmail ? 'email' : 'number'}.

_Stay safe: use strong unique passwords!_
${source ? `_Source: ${source}_` : ''}

╰────────────────────────────╯`,
                    ...channelInfo
                }, { quoted: message });
            }
        } catch (e: any) {
            await sock.sendMessage(chatId, {
                text: `❌ Breach check failed: ${e.message}\n\n_Note: Some checks may require an API key to be configured by the bot owner._`,
                ...channelInfo
            }, { quoted: message });
        }
    },
};

// ── gcstory ────────────────────────────────────────────────────────────────────
const gcstory = {
    command: 'gcstory',
    aliases: ['groupstory', 'poststory'],
    category: 'group',
    description: 'Post a group-exclusive status (story) through the bot',
    usage: '.gcstory <message> or reply to an image',
    groupOnly: true,
    adminOnly: true,

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;

        const ctx = message.message?.extendedTextMessage?.contextInfo;
        const quotedImg = ctx?.quotedMessage?.imageMessage;

        const caption = args.join(' ').trim();

        try {
            await sock.sendPresenceUpdate('composing', chatId);

            if (quotedImg) {
                const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
                const stream = await downloadContentFromMessage(quotedImg, 'image');
                const chunks: Buffer[] = [];
                for await (const c of stream) chunks.push(c);
                const buf = Buffer.concat(chunks);

                await (sock as any).sendMessage('status@broadcast', {
                    image: buf,
                    caption: caption || '📸 Posted by group admin',
                    backgroundColor: '#000000',
                });

                await sock.sendMessage(chatId, {
                    text: '✅ *Story posted!* The image has been shared as a status update.',
                    ...channelInfo
                }, { quoted: message });
            } else if (caption) {
                await (sock as any).sendMessage('status@broadcast', {
                    text: caption,
                    backgroundColor: '#1DA462',
                    font: 2,
                });

                await sock.sendMessage(chatId, {
                    text: '✅ *Story posted!* Your text has been shared as a status update.',
                    ...channelInfo
                }, { quoted: message });
            } else {
                return sock.sendMessage(chatId, {
                    text: '❌ *Usage:* `.gcstory <text>` or reply to an image with `.gcstory [caption]`',
                    ...channelInfo
                }, { quoted: message });
            }
        } catch (e: any) {
            await sock.sendMessage(chatId, {
                text: `❌ Could not post story: ${e.message}`,
                ...channelInfo
            }, { quoted: message });
        }
    },
};

// ── fakechat ───────────────────────────────────────────────────────────────────
const fakechat = {
    command: 'fakechat',
    aliases: ['fakemsg', 'fakewa', 'mockconvo'],
    category: 'fun',
    description: 'Generate a realistic fake WhatsApp conversation for memes',
    usage: '.fakechat <Name1>: <msg1> | <Name2>: <msg2> | ...',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const input = args.join(' ').trim();
        if (!input || !input.includes('|')) {
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *💬 FAKE CHAT HELP* ❱───╮

*Usage:*
\`.fakechat Name1: message | Name2: reply | Name1: response\`

*Example:*
\`.fakechat John: Hey what's up | Sarah: Nothing much lol | John: Wanna hang out?\`

*Tips:*
• Separate each message with \`|\`
• Format: \`Name: message\`
• Up to 10 messages

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }

        const parts = input.split('|').map(p => p.trim()).filter(Boolean).slice(0, 10);
        const parsed: { name: string; msg: string }[] = [];

        for (const part of parts) {
            const colon = part.indexOf(':');
            if (colon === -1) continue;
            const name = part.slice(0, colon).trim();
            const msg = part.slice(colon + 1).trim();
            if (name && msg) parsed.push({ name, msg });
        }

        if (parsed.length < 2) {
            return sock.sendMessage(chatId, {
                text: '❌ Provide at least 2 messages in format `Name: message | Name2: reply`',
                ...channelInfo
            }, { quoted: message });
        }

        const TIME = ['10:22 AM', '10:22 AM', '10:23 AM', '10:23 AM', '10:24 AM', '10:24 AM', '10:25 AM', '10:25 AM', '10:26 AM', '10:26 AM'];
        const TICKS = ['✓✓', '✓✓', '✓✓', '✓✓'];

        const firstSpeaker = parsed[0].name;
        const chat = parsed.map((m, i) => {
            const time = TIME[i] || '10:30 AM';
            const tick = TICKS[Math.floor(Math.random() * TICKS.length)];
            if (m.name === firstSpeaker) {
                return `┌─────────────────────────┐\n│ *${m.name}*\n│ ${m.msg}\n│ ${time} ${tick}\n└─────────────────────────┘`;
            } else {
                return `                  ┌──────────────────────┐\n                  │ *${m.name}*\n                  │ ${m.msg}\n                  │ ${time}\n                  └──────────────────────┘`;
            }
        }).join('\n\n');

        await sock.sendMessage(chatId, {
            text:
`╭───❰ *💬 FAKE CHAT* ❱───╮

${chat}

_⚠️ This is a fictional conversation for entertainment purposes only_

╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });
    },
};

export default [device, vcf, jid, leakcheck, gcstory, fakechat];
