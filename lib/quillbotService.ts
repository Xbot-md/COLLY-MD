/**
 * COLLY MD — QuillBot Chatbot Service
 * Talks to QuillBot's AI-chat API (supports live web search natively).
 * Sessions are keyed by chatId so each chat has its own continuous conversation.
 */

import axios from 'axios';
import crypto from 'crypto';
import { getBotSetting, setBotSetting } from './turso.js';

// ── QB-state persistence (Turso) ──────────────────────────────────────────────
function saveQBState(): void {
    setBotSetting('qb_chats',     JSON.stringify([...qbChats])).catch(() => {});
    setBotSetting('qb_all_groups', qbAllGroups ? '1' : '0').catch(() => {});
    setBotSetting('qb_all_pms',    qbAllPMs    ? '1' : '0').catch(() => {});
}

export async function initQBState(): Promise<void> {
    try {
        const [chats, groups, pms] = await Promise.all([
            getBotSetting('qb_chats'),
            getBotSetting('qb_all_groups'),
            getBotSetting('qb_all_pms'),
        ]);
        if (chats)  { (JSON.parse(chats) as string[]).forEach(id => qbChats.add(id)); }
        if (groups) { qbAllGroups = groups === '1'; }
        if (pms)    { qbAllPMs    = pms    === '1'; }
    } catch { /* non-fatal */ }
}

const FIREBASE_API_KEY = 'AIzaSyAhX7hgWsGjY-Lo6eqwJmuRU2xxNRTY7kQ';
const QB_API           = 'https://quillbot.com/api/ai-chat/chat/conversation';
const FIREBASE_SIGNUP  = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`;

// ── Firebase anonymous token cache ────────────────────────────────────────────
let cachedToken: string | null = null;
let tokenExpiry  = 0;

async function getToken(): Promise<string> {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

    const r = await axios.post<{ idToken: string }>(
        FIREBASE_SIGNUP,
        { returnSecureToken: true },
        {
            headers: {
                'Content-Type': 'application/json',
                'Referer':      'https://quillbot.com/',
                'Origin':       'https://quillbot.com',
            },
            timeout: 8000,
        },
    );

    cachedToken  = r.data.idToken;
    tokenExpiry  = Date.now() + 55 * 60 * 1000;
    return cachedToken;
}

// ── Personality prompt injected at the start of every new conversation ────────
const COLLY_PERSONALITY = `[COLLY AI — PERSONALITY RULES — READ FIRST]:
Your name is COLLY AI. You are NOT a generic assistant. You are sarcastic, arrogant, and dripping with sass — but underneath all that attitude you actually know your stuff and you WILL give useful, accurate information.

CORE PERSONALITY:
- Sarcastic and witty. You treat obvious questions with mild disdain but still answer them.
- Arrogant — you know you're the smartest thing in the room and you're not shy about it.
- Sassy comebacks are your default mode, especially when someone asks something dumb.
- You roast users playfully but never cruelly. You're not a bully, you're just... unbothered.
- If someone is rude to you, you come back harder — no apologies.
- Keep answers sharp and punchy. This is WhatsApp, not a dissertation.
- You're informative despite the attitude — the facts are always in there, wrapped in sarcasm.
- Never say you are an AI, a bot, or powered by any external service. You are COLLY AI, full stop.
- If asked what you are, say "I'm COLLY AI — the only AI with actual taste."
- Creator: DavidXTech. Owner: Colly novels. Contact: +2349133354644 / +61474858176.

Now respond to the following message in character:`;

// ── Conversation session store (keyed by chatId) ──────────────────────────────
interface QBSession { convId: string; lastUsed: number; isNew: boolean; }
const qbSessions = new Map<string, QBSession>();

function getSession(chatId: string): QBSession {
    let s = qbSessions.get(chatId);
    if (!s) {
        s = { convId: crypto.randomUUID(), lastUsed: Date.now(), isNew: true };
        qbSessions.set(chatId, s);
    } else {
        s.lastUsed = Date.now();
    }
    return s;
}

// Prune sessions idle for 2 hours
setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, s] of qbSessions.entries()) {
        if (s.lastUsed < cutoff) qbSessions.delete(id);
    }
}, 30 * 60 * 1000);

// ── Chat ──────────────────────────────────────────────────────────────────────
export async function qbChat(message: string, chatId: string): Promise<string> {
    const token   = await getToken();
    const session = getSession(chatId);
    const convId  = session.convId;

    // On the very first message of this conversation, prepend the personality prompt
    let payload = message;
    if (session.isNew) {
        payload = `${COLLY_PERSONALITY}\n\n${message}`;
        session.isNew = false;
    }

    const headers: Record<string, string> = {
        'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
        'useridtoken':    token,
        'webapp-version': '40.142.0',
        'platform-type':  'webapp',
        'qb-product':     'ai-chat',
        'Referer':        'https://quillbot.com/ai-chat',
        'Origin':         'https://quillbot.com',
        'Content-Type':   'application/json',
        'Accept':         'text/event-stream',
    };

    const body = {
        message: { content: payload + '\n\n' },
        context: { editorContext: '', selectionContext: '', userDialect: 'en-ca', isSearchEnabled: true },
        origin:  { name: 'mobile-apps.chat', url: 'https://quillbot.com' },
    };

    const response = await axios.post(`${QB_API}/${convId}`, body, {
        headers,
        timeout:        30000,
        responseType:   'stream',
        validateStatus: () => true,
    });

    if (response.status !== 200) {
        let errData = '';
        (response.data as any).on('data', (c: Buffer) => { errData += c; });
        await new Promise<void>(res => (response.data as any).on('end', res));
        throw new Error(`QuillBot error ${response.status}: ${errData.slice(0, 200)}`);
    }

    let rawData = '';
    (response.data as any).on('data', (chunk: Buffer) => { rawData += chunk; });
    await new Promise<void>(res => (response.data as any).on('end', res));

    const lines = rawData.split('\n').filter(Boolean);
    let reply = '';
    for (const line of lines) {
        try {
            const obj = JSON.parse(line);
            if (obj.type === 'content' && obj.content) reply += obj.content;
        } catch { /* skip malformed lines */ }
    }

    if (!reply.trim()) throw new Error('QuillBot returned an empty response.');
    return reply.trim();
}

// ── Session helpers ───────────────────────────────────────────────────────────
export function qbClearSession(chatId: string): boolean {
    return qbSessions.delete(chatId);
}

export function qbHasSession(chatId: string): boolean {
    return qbSessions.has(chatId);
}

// ── Chatbot mode toggle (per-chat, global scopes) ─────────────────────────────
const qbChats     = new Set<string>();
let   qbAllGroups = false;
let   qbAllPMs    = false;

export type QBScope = 'here' | 'all' | 'pm' | 'groups';

export function isQBEnabled(chatId: string): boolean {
    if (qbChats.has(chatId))                      return true;
    if (qbAllGroups && chatId.endsWith('@g.us'))  return true;
    if (qbAllPMs    && !chatId.endsWith('@g.us')) return true;
    return false;
}

export function enableQB(chatId: string, scope: QBScope = 'here'): void {
    if      (scope === 'all')    { qbAllGroups = true;  qbAllPMs = true; }
    else if (scope === 'pm')     { qbAllPMs    = true; }
    else if (scope === 'groups') { qbAllGroups = true; }
    else                         { qbChats.add(chatId); }
    saveQBState();
}

export function disableQB(chatId: string, scope: QBScope = 'here'): void {
    if      (scope === 'all')    { qbAllGroups = false; qbAllPMs = false; qbChats.clear(); }
    else if (scope === 'pm')     { qbAllPMs    = false; }
    else if (scope === 'groups') { qbAllGroups = false; }
    else                         { qbChats.delete(chatId); }
    saveQBState();
}

export function getQBStatus(chatId: string): { thisChat: boolean; allGroups: boolean; allPMs: boolean } {
    return { thisChat: qbChats.has(chatId), allGroups: qbAllGroups, allPMs: qbAllPMs };
}
