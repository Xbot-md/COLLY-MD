import type { BotContext } from '../types.js';
import { getDb } from '../lib/turso.js';

const MAILTM = 'https://api.mail.tm';

async function getOrCreateDomain(): Promise<string | null> {
    try {
        const res = await fetch(`${MAILTM}/domains`, { signal: AbortSignal.timeout(10000) });
        const data = await res.json() as any;
        const domains = data?.['hydra:member'];
        if (!domains?.length) return null;
        return domains[0].domain;
    } catch { return null; }
}

async function createAccount(address: string, password: string): Promise<{ token: string } | null> {
    try {
        const reg = await fetch(`${MAILTM}/accounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, password }),
            signal: AbortSignal.timeout(10000),
        });
        if (!reg.ok) return null;
        const auth = await fetch(`${MAILTM}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, password }),
            signal: AbortSignal.timeout(10000),
        });
        if (!auth.ok) return null;
        const data = await auth.json() as any;
        return { token: data.token };
    } catch { return null; }
}

async function saveAccount(userId: string, address: string, token: string): Promise<void> {
    const db = getDb();
    await db.execute({
        sql: `INSERT INTO tempmail_accounts (user_id, address, token, created) VALUES (?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET address=excluded.address, token=excluded.token, created=excluded.created`,
        args: [userId, address, token, Date.now()],
    });
}

async function getAccount(userId: string): Promise<{ address: string; token: string; created: number } | null> {
    const db = getDb();
    const res = await db.execute({ sql: `SELECT address, token, created FROM tempmail_accounts WHERE user_id=?`, args: [userId] });
    if (!res.rows.length) return null;
    const r = res.rows[0] as any;
    return { address: r.address, token: r.token, created: Number(r.created) };
}

async function getMessages(token: string): Promise<any[]> {
    try {
        const res = await fetch(`${MAILTM}/messages`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json() as any;
        return data?.['hydra:member'] || [];
    } catch { return []; }
}

async function getMessage(token: string, id: string): Promise<any | null> {
    try {
        const res = await fetch(`${MAILTM}/messages/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
        });
        return await res.json();
    } catch { return null; }
}

const tempmail = {
    command: 'tempmail',
    aliases: ['tmpmail', 'disposable', 'fakemail'],
    category: 'tools',
    description: 'Generate a temporary disposable email address',
    usage: '.tempmail',

    async handler(sock: any, message: any, _args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;

        const existing = await getAccount(senderId);
        if (existing) {
            const ageHours = ((Date.now() - existing.created) / 3600_000).toFixed(1);
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *📧 YOUR TEMP MAIL* ❱───╮

*📬 Address:*
\`${existing.address}\`

*⏱️ Created:* ${ageHours}h ago

*Commands:*
• \`.readmail\` — Check inbox
• \`.tempmail new\` — Generate new email

_This email expires after ~10 minutes of inactivity_

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);
        const domain = await getOrCreateDomain();
        if (!domain) {
            return sock.sendMessage(chatId, { text: '❌ Failed to get mail domain. Try again later.', ...channelInfo }, { quoted: message });
        }

        const username = `user${Math.floor(Math.random() * 9000000) + 1000000}`;
        const address = `${username}@${domain}`;
        const password = `Colly${Math.random().toString(36).slice(2, 10)}!`;

        const acc = await createAccount(address, password);
        if (!acc) {
            return sock.sendMessage(chatId, { text: '❌ Failed to create temp email. Try again later.', ...channelInfo }, { quoted: message });
        }

        await saveAccount(senderId, address, acc.token);

        await sock.sendMessage(chatId, {
            text:
`╭───❰ *📧 TEMP EMAIL CREATED* ❱───╮

*📬 Address:*
\`${address}\`

✅ Use this email for signups, verifications, etc.

*Commands:*
• \`.readmail\` — Check your inbox
• \`.tempmail new\` — Generate new email

_Expires after ~10 minutes of inactivity_

╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });
    },
};

const readmail = {
    command: 'readmail',
    aliases: ['checkinbox', 'inbox'],
    category: 'tools',
    description: 'Read the inbox of your temporary email',
    usage: '.readmail [message number]',

    async handler(sock: any, message: any, args: string[], context: BotContext) {
        const { chatId, channelInfo, senderId } = context;

        const account = await getAccount(senderId);
        if (!account) {
            return sock.sendMessage(chatId, {
                text: '❌ *No temp email found.*\nCreate one first with `.tempmail`',
                ...channelInfo
            }, { quoted: message });
        }

        await sock.sendPresenceUpdate('composing', chatId);

        if (args[0]) {
            const idx = parseInt(args[0]) - 1;
            const msgs = await getMessages(account.token);
            if (!msgs.length || idx < 0 || idx >= msgs.length) {
                return sock.sendMessage(chatId, { text: '❌ Invalid message number.', ...channelInfo }, { quoted: message });
            }
            const full = await getMessage(account.token, msgs[idx].id);
            if (!full) {
                return sock.sendMessage(chatId, { text: '❌ Failed to read message.', ...channelInfo }, { quoted: message });
            }
            const body = full.text || full.html?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800) || '_No content_';
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *📨 MESSAGE #${idx + 1}* ❱───╮

*From:* ${full.from?.address || 'Unknown'}
*Subject:* ${full.subject || 'No subject'}
*Date:* ${new Date(full.createdAt).toLocaleString()}

*Content:*
${body}

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }

        const msgs = await getMessages(account.token);
        if (!msgs.length) {
            return sock.sendMessage(chatId, {
                text:
`╭───❰ *📭 INBOX EMPTY* ❱───╮

*📬 Email:* ${account.address}

Your inbox is empty. Send an email there and check again with \`.readmail\`

╰────────────────────────────╯`,
                ...channelInfo
            }, { quoted: message });
        }

        const list = msgs.slice(0, 10).map((m: any, i: number) =>
            `*${i + 1}.* From: ${m.from?.address || 'Unknown'}\n   📌 ${m.subject || 'No subject'}`
        ).join('\n\n');

        await sock.sendMessage(chatId, {
            text:
`╭───❰ *📬 INBOX* ❱───╮

*Email:* ${account.address}
*Messages:* ${msgs.length}

${list}

_Use .readmail <number> to open a message_

╰────────────────────────────╯`,
            ...channelInfo
        }, { quoted: message });
    },
};

export default [tempmail, readmail];
