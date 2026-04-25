import axios from 'axios';
import type { BotContext } from '../types.js';
import config from '../config.js';
import { resolveJid } from '../lib/lidUtils.js';

const prefix       = config.prefixes[0];
const API_BASE     = 'https://api.truthordarebot.xyz';
const JOIN_SECS    = 30;
const JOIN_MS      = JOIN_SECS * 1_000;
const SPIN_JOIN_MS = 45_000;
const DEFAULT_ROUNDS  = 10;
const MAX_ROUNDS      = 50;
const TOD_CHOICE_MS   = 60_000;
const TOD_ROUND_MS    = 30_000;
const WYR_VOTE_MS     = 25_000;
const NHIE_REACT_MS   = 20_000;
const SPIN_ROUND_MS   = 30_000;

type GameType = 'tod' | 'wyr' | 'nhie' | 'spinbottle';
type Rating   = 'pg'  | 'r';

interface PartySession {
    chatId:   string;
    type:     GameType;
    status:   'waiting' | 'active';
    players:  string[];
    rating:   Rating;
    round:    number;
    maxRounds: number;
    seen:     Set<string>;
    handler?: (update: any) => void;
    // TOD
    currentPlayer?:   string;
    waitingChoice?:   boolean;
    truthCount?:      number;
    dareCount?:       number;
    playerPicks?:     Record<string, number>;
    // WYR
    wyrOptions?:  string[];
    wyrVotes?:    Record<string, string[]>;
    wyrVoted?:    Set<string>;
    wyrOpen?:     boolean;
    allVoted?:    Record<string, number>;
    // NHIE
    nhieOpen?:   boolean;
    drinkers?:   Set<string>;
    allDrinks?:  Record<string, number>;
}

const sessions = new Map<string, PartySession>();
const timers   = new Map<string, ReturnType<typeof setTimeout>>();

function clrTimer(key: string) {
    const t = timers.get(key);
    if (t) { clearTimeout(t); timers.delete(key); }
}
function clrAll(chatId: string) {
    ['', '_wait', '_round', '_vote'].forEach(s => clrTimer(chatId + s));
}

function stripDev(jid: string) {
    if (!jid) return jid;
    const u = jid.split('@')[0].split(':')[0];
    const d = jid.includes('@') ? '@' + jid.split('@')[1] : '';
    return u + d;
}
function tag(jid: string) {
    return '@' + jid.split('@')[0].split(':')[0];
}

// ── API helpers ─────────────────────────────────────────────────────────────────
async function apiFetch(type: string, rating: Rating): Promise<string | null> {
    try {
        const { data } = await axios.get(`${API_BASE}/v1/${type}?rating=${rating}`, { timeout: 10_000 });
        return data?.question || null;
    } catch { return null; }
}

async function fetchUnique(
    type: string,
    rating: Rating,
    seen: Set<string>,
    retries = 3,
): Promise<string | null> {
    for (let i = 0; i <= retries; i++) {
        const q = await apiFetch(type, rating);
        if (!q) return null;
        const k = q.trim().toLowerCase();
        if (!seen.has(k)) { seen.add(k); return q; }
    }
    const last = await apiFetch(type, rating);
    if (last) seen.add(last.trim().toLowerCase());
    return last;
}

function parseWYR(question: string): string[] {
    let q = question.replace(/^would you rather\s*/i, '').replace(/\?$/, '').trim();
    const parts = q.split(/\s*,\s*(?:or\s+)?|\s+or\s+/i).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts.slice(0, 4).map(p => p[0].toUpperCase() + p.slice(1));
    return [q];
}

// ── Register message listener ───────────────────────────────────────────────────
function attachListener(sock: any, session: PartySession, channelInfo: any) {
    const handler = async (update: any) => {
        const m = update?.messages?.[0];
        if (!m?.message || m.key.remoteJid !== session.chatId || m.key.fromMe) return;
        const body   = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim().toLowerCase();
        if (!body) return;
        const rawSender = m.key.participant || m.key.remoteJid;
        const sender    = await resolveJid(sock, rawSender);

        const s = sessions.get(session.chatId);
        if (!s || s.type !== session.type) return;

        if (s.type === 'tod')        await handleTOD(sock, m, body, sender, s, channelInfo);
        else if (s.type === 'wyr')   await handleWYR(sock, m, body, sender, s, channelInfo);
        else if (s.type === 'nhie')  await handleNHIE(sock, m, body, sender, s, channelInfo);
        else if (s.type === 'spinbottle') await handleSpin(sock, m, body, sender, s, channelInfo);
    };
    session.handler = handler;
    sock.ev.on('messages.upsert', handler);
}

function detach(sock: any, session: PartySession) {
    if (session.handler) sock.ev.off('messages.upsert', session.handler);
}

function endSession(sock: any, session: PartySession) {
    clrAll(session.chatId);
    detach(sock, session);
    sessions.delete(session.chatId);
}

// ══════════════════════════════════════════════════════════════════════════════
// TRUTH OR DARE
// ══════════════════════════════════════════════════════════════════════════════

async function startTOD(sock: any, chatId: string, starterJid: string, rounds: number, rating: Rating, channelInfo: any) {
    const modeLabel = rating === 'r' ? ' 🔞' : '';
    const session: PartySession = {
        chatId, type: 'tod', status: 'waiting', players: [starterJid],
        rating, round: 0, maxRounds: rounds, seen: new Set(),
        truthCount: 0, dareCount: 0, playerPicks: {}, waitingChoice: false,
    };
    sessions.set(chatId, session);
    attachListener(sock, session, channelInfo);

    await sock.sendMessage(chatId, {
        text:
`┏━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🔥 *𝗧𝗥𝗨𝗧𝗛 𝗢𝗥 𝗗𝗔𝗥𝗘*${modeLabel}
┗━━━━━━━━━━━━━━━━━━━━━━━━┛

${tag(starterJid)} started the game!

💬 Type *join* to enter (${JOIN_SECS}s)
🛑 Type *endtod* to end anytime

🎯 *${rounds} rounds*
📌 Custom: *${prefix}tod 20* | Adults: *${prefix}tod 18+*

👥 Players: 1`,
        mentions: [starterJid], ...channelInfo
    });

    timers.set(chatId + '_wait', setTimeout(async () => {
        const s = sessions.get(chatId);
        if (!s || s.type !== 'tod' || s.status !== 'waiting') return;
        if (s.players.length < 2) {
            endSession(sock, s);
            return sock.sendMessage(chatId, {
                text: `❌ Not enough players joined (${s.players.length}/2). *Truth or Dare* cancelled.\n\n_Start again with *${prefix}tod*_`,
                ...channelInfo
            });
        }
        s.status = 'active';
        await sock.sendMessage(chatId, { text: `🔥 *${s.players.length} players!* Let the game begin...`, ...channelInfo });
        await pickTODPlayer(sock, chatId, channelInfo);
    }, JOIN_MS));
}

async function pickTODPlayer(sock: any, chatId: string, channelInfo: any) {
    const s = sessions.get(chatId);
    if (!s || s.type !== 'tod') return;
    if (s.round >= s.maxRounds) return await endTOD(sock, s, channelInfo);

    const picked = s.players[Math.floor(Math.random() * s.players.length)];
    s.currentPlayer  = picked;
    s.waitingChoice  = true;

    await sock.sendMessage(chatId, {
        text: `🎯 Round ${s.round + 1}/${s.maxRounds}\n\n${tag(picked)} has been chosen!\n\n💬 Reply with *truth* or *dare*`,
        mentions: [picked], ...channelInfo
    });

    timers.set(chatId + '_wait', setTimeout(async () => {
        if (!sessions.has(chatId) || !s.waitingChoice) return;
        s.waitingChoice = false;
        const auto = Math.random() > 0.5 ? 'truth' : 'dare';
        await sock.sendMessage(chatId, { text: `⏰ Time's up! Auto-picking *${auto}*...`, ...channelInfo });
        await deliverTOD(sock, chatId, s, auto, channelInfo);
    }, TOD_CHOICE_MS));
}

async function deliverTOD(sock: any, chatId: string, s: PartySession, choice: string, channelInfo: any) {
    const q = await fetchUnique(choice === 'truth' ? 'truth' : 'dare', s.rating, s.seen);
    if (!sessions.has(chatId) || s.type !== 'tod') return;

    s.round++;
    if (choice === 'truth') s.truthCount!++;
    else s.dareCount!++;
    s.playerPicks![s.currentPlayer!] = (s.playerPicks![s.currentPlayer!] || 0) + 1;

    const emoji     = choice === 'truth' ? '🤔' : '😈';
    const remaining = s.maxRounds - s.round;

    if (!q) {
        await sock.sendMessage(chatId, { text: '❌ API unavailable. Skipping to next player...', ...channelInfo });
    } else {
        await sock.sendMessage(chatId, {
            text: `${emoji} *${choice.toUpperCase()}* for ${tag(s.currentPlayer!)}:\n\n${q}\n\n_${remaining > 0 ? `${remaining} rounds left • Next in 30s...` : 'Final round! Results coming...'}_`,
            mentions: [s.currentPlayer!], ...channelInfo
        });
    }

    timers.set(chatId + '_round', setTimeout(async () => {
        if (!sessions.has(chatId) || s.type !== 'tod') return;
        await pickTODPlayer(sock, chatId, channelInfo);
    }, TOD_ROUND_MS));
}

async function endTOD(sock: any, s: PartySession, channelInfo: any) {
    clrAll(s.chatId);
    const sorted   = Object.entries(s.playerPicks!).sort(([, a], [, b]) => b - a).slice(0, 5);
    const mentions = sorted.map(([j]) => j);
    const board    = sorted.map(([j, n], i) => `${['🥇','🥈','🥉','▪️','▪️'][i]} ${tag(j)} — ${n} picks`).join('\n') || '_No data_';

    await sock.sendMessage(s.chatId, {
        text:
`┏━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🔥 *𝗚𝗔𝗠𝗘 𝗢𝗩𝗘𝗥!*
┗━━━━━━━━━━━━━━━━━━━━━━━━┛

📊 *Truth or Dare Summary*

🎯 Total Rounds: ${s.round}
🤔 Truths: ${s.truthCount}
😈 Dares: ${s.dareCount}

👑 *Most Picked:*
${board}

Thanks for playing! 🔥`,
        mentions, ...channelInfo
    });
    endSession(sock, s);
}

async function handleTOD(sock: any, m: any, body: string, sender: string, s: PartySession, channelInfo: any) {
    const chatId = s.chatId;
    if (body === 'endtod') {
        if (s.status === 'waiting') { endSession(sock, s); return sock.sendMessage(chatId, { text: '🛑 Truth or Dare cancelled.', ...channelInfo }); }
        return await endTOD(sock, s, channelInfo);
    }
    if (s.status === 'waiting' && body === 'join') {
        if (s.players.includes(sender)) return;
        s.players.push(sender);
        return sock.sendMessage(chatId, { text: `✅ ${tag(sender)} joined! (${s.players.length} players)`, mentions: [sender], ...channelInfo });
    }
    if (!s.waitingChoice || sender !== s.currentPlayer) return;
    if (body === 'truth' || body === 't') {
        s.waitingChoice = false;
        clrTimer(chatId + '_wait');
        return await deliverTOD(sock, chatId, s, 'truth', channelInfo);
    }
    if (body === 'dare' || body === 'd') {
        s.waitingChoice = false;
        clrTimer(chatId + '_wait');
        return await deliverTOD(sock, chatId, s, 'dare', channelInfo);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// WOULD YOU RATHER
// ══════════════════════════════════════════════════════════════════════════════

async function startWYR(sock: any, chatId: string, starterJid: string, rounds: number, rating: Rating, channelInfo: any) {
    const modeLabel = rating === 'r' ? ' 🔞' : '';
    const session: PartySession = {
        chatId, type: 'wyr', status: 'waiting', players: [starterJid],
        rating, round: 0, maxRounds: rounds, seen: new Set(),
        wyrOptions: [], wyrVotes: {}, wyrVoted: new Set(), wyrOpen: false, allVoted: {},
    };
    sessions.set(chatId, session);
    attachListener(sock, session, channelInfo);

    await sock.sendMessage(chatId, {
        text:
`┏━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🤷 *𝗪𝗢𝗨𝗟𝗗 𝗬𝗢𝗨 𝗥𝗔𝗧𝗛𝗘𝗥*${modeLabel}
┗━━━━━━━━━━━━━━━━━━━━━━━━┛

${tag(starterJid)} started the game!

💬 Type *join* to enter (${JOIN_SECS}s)
🛑 Type *endwyr* to end anytime

🎯 *${rounds} rounds*
📌 Custom: *${prefix}wyr 20* | Adults: *${prefix}wyr 18+*

👥 Players: 1`,
        mentions: [starterJid], ...channelInfo
    });

    timers.set(chatId + '_wait', setTimeout(async () => {
        const s = sessions.get(chatId);
        if (!s || s.type !== 'wyr' || s.status !== 'waiting') return;
        if (s.players.length < 2) {
            endSession(sock, s);
            return sock.sendMessage(chatId, {
                text: `❌ Not enough players joined (${s.players.length}/2). *Would You Rather* cancelled.\n\n_Start again with *${prefix}wyr*_`,
                ...channelInfo
            });
        }
        s.status = 'active';
        await sock.sendMessage(chatId, { text: `🤷 *${s.players.length} players!* Let the game begin...`, ...channelInfo });
        await sendWYR(sock, chatId, channelInfo);
    }, JOIN_MS));
}

async function sendWYR(sock: any, chatId: string, channelInfo: any) {
    const s = sessions.get(chatId);
    if (!s || s.type !== 'wyr') return;
    if (s.round >= s.maxRounds) return await endWYR(sock, s, channelInfo);

    const q = await fetchUnique('wyr', s.rating, s.seen);
    if (!sessions.has(chatId) || s.type !== 'wyr') return;
    if (!q) {
        await sock.sendMessage(chatId, { text: '❌ API unavailable. Trying again in 10s...', ...channelInfo });
        timers.set(chatId + '_round', setTimeout(() => sendWYR(sock, chatId, channelInfo), 10_000));
        return;
    }

    s.round++;
    const letters  = ['A', 'B', 'C', 'D'];
    const options  = parseWYR(q);
    s.wyrOptions   = options;
    s.wyrVotes     = {};
    s.wyrVoted     = new Set();
    s.wyrOpen      = true;

    let optText = '';
    for (let i = 0; i < options.length; i++) {
        s.wyrVotes![letters[i]] = [];
        optText += `\n*${letters[i]}* ➤ ${options[i]}`;
    }

    await sock.sendMessage(chatId, {
        text: `┏━━ Round ${s.round}/${s.maxRounds} ━━┓\n\n🤷 *Would You Rather...*${optText}\n\n⏱️ Vote now! (${WYR_VOTE_MS / 1_000}s)`,
        ...channelInfo
    });

    timers.set(chatId + '_vote', setTimeout(async () => {
        if (!sessions.has(chatId) || s.type !== 'wyr') return;
        await showWYRResults(sock, chatId, s, channelInfo);
    }, WYR_VOTE_MS));
}

async function showWYRResults(sock: any, chatId: string, s: PartySession, channelInfo: any) {
    s.wyrOpen = false;
    const letters  = ['A', 'B', 'C', 'D'];
    const mentions: string[] = [];
    let out = `┏━━ 𝗥𝗘𝗦𝗨𝗟𝗧𝗦 ━━┓\n\n`;
    let total = 0;

    for (let i = 0; i < s.wyrOptions!.length; i++) {
        const l      = letters[i];
        const voters = s.wyrVotes![l] || [];
        total += voters.length;
        const vtags  = voters.map(v => { mentions.push(v); s.allVoted![v] = (s.allVoted![v] || 0) + 1; return tag(v); }).join(', ') || '_no votes_';
        out += `*${l}* ${s.wyrOptions![i]}\n   👥 ${voters.length} — ${vtags}\n\n`;
    }

    if (total === 0) out += `_Nobody voted! 😴_\n`;
    const rem = s.maxRounds - s.round;
    out += rem > 0 ? `\n⏳ Next question in 10s... (${rem} left)` : `\n🏁 Final round done! Results coming...`;

    await sock.sendMessage(chatId, { text: out, mentions, ...channelInfo });

    timers.set(chatId + '_round', setTimeout(async () => {
        if (!sessions.has(chatId) || s.type !== 'wyr') return;
        await sendWYR(sock, chatId, channelInfo);
    }, 10_000));
}

async function endWYR(sock: any, s: PartySession, channelInfo: any) {
    clrAll(s.chatId);
    const sorted   = Object.entries(s.allVoted!).sort(([, a], [, b]) => b - a).slice(0, 5);
    const mentions = sorted.map(([j]) => j);
    const board    = sorted.length
        ? sorted.map(([j, n], i) => `${['🥇','🥈','🥉','▪️','▪️'][i]} ${tag(j)} — ${n} votes`).join('\n')
        : '_No one voted!_';

    await sock.sendMessage(s.chatId, {
        text:
`┏━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🤷 *𝗚𝗔𝗠𝗘 𝗢𝗩𝗘𝗥!*
┗━━━━━━━━━━━━━━━━━━━━━━━━┛

📊 *Would You Rather Summary*

🎯 Total Rounds: ${s.round}

👑 *Most Active Voters:*
${board}

Thanks for playing! 🤷`,
        mentions, ...channelInfo
    });
    endSession(sock, s);
}

async function handleWYR(sock: any, m: any, body: string, sender: string, s: PartySession, channelInfo: any) {
    const chatId = s.chatId;
    if (body === 'endwyr') {
        if (s.status === 'waiting') { endSession(sock, s); return sock.sendMessage(chatId, { text: '🛑 Would You Rather cancelled.', ...channelInfo }); }
        return await endWYR(sock, s, channelInfo);
    }
    if (s.status === 'waiting' && body === 'join') {
        if (s.players.includes(sender)) return;
        s.players.push(sender);
        return sock.sendMessage(chatId, { text: `✅ ${tag(sender)} joined! (${s.players.length} players)`, mentions: [sender], ...channelInfo });
    }
    if (!s.wyrOpen) return;
    const letter = body.toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(letter) || !s.wyrVotes![letter]) return;
    if (s.wyrVoted!.has(sender)) return;
    s.wyrVoted!.add(sender);
    s.wyrVotes![letter].push(sender);
    await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
}

// ══════════════════════════════════════════════════════════════════════════════
// NEVER HAVE I EVER
// ══════════════════════════════════════════════════════════════════════════════

async function startNHIE(sock: any, chatId: string, starterJid: string, rounds: number, rating: Rating, channelInfo: any) {
    const modeLabel = rating === 'r' ? ' 🔞' : '';
    const session: PartySession = {
        chatId, type: 'nhie', status: 'waiting', players: [starterJid],
        rating, round: 0, maxRounds: rounds, seen: new Set(),
        nhieOpen: false, drinkers: new Set(), allDrinks: {},
    };
    sessions.set(chatId, session);
    attachListener(sock, session, channelInfo);

    await sock.sendMessage(chatId, {
        text:
`┏━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🍻 *𝗡𝗘𝗩𝗘𝗥 𝗛𝗔𝗩𝗘 𝗜 𝗘𝗩𝗘𝗥*${modeLabel}
┗━━━━━━━━━━━━━━━━━━━━━━━━┛

${tag(starterJid)} started the game!

💬 Type *join* to enter (${JOIN_SECS}s)
🛑 Type *endnhie* to end anytime

🎯 *${rounds} rounds*
📌 Custom: *${prefix}nhie 20* | Adults: *${prefix}nhie 18+*
✅ *yes* — I have  |  ❌ *no* — I haven't

👥 Players: 1`,
        mentions: [starterJid], ...channelInfo
    });

    timers.set(chatId + '_wait', setTimeout(async () => {
        const s = sessions.get(chatId);
        if (!s || s.type !== 'nhie' || s.status !== 'waiting') return;
        if (s.players.length < 2) {
            endSession(sock, s);
            return sock.sendMessage(chatId, {
                text: `❌ Not enough players joined (${s.players.length}/2). *Never Have I Ever* cancelled.\n\n_Start again with *${prefix}nhie*_`,
                ...channelInfo
            });
        }
        s.status = 'active';
        await sock.sendMessage(chatId, { text: `🍻 *${s.players.length} players!* Let the game begin...`, ...channelInfo });
        await sendNHIE(sock, chatId, channelInfo);
    }, JOIN_MS));
}

async function sendNHIE(sock: any, chatId: string, channelInfo: any) {
    const s = sessions.get(chatId);
    if (!s || s.type !== 'nhie') return;
    if (s.round >= s.maxRounds) return await endNHIE(sock, s, channelInfo);

    const q = await fetchUnique('nhie', s.rating, s.seen);
    if (!sessions.has(chatId) || s.type !== 'nhie') return;
    if (!q) {
        await sock.sendMessage(chatId, { text: '❌ API unavailable. Trying again in 10s...', ...channelInfo });
        timers.set(chatId + '_round', setTimeout(() => sendNHIE(sock, chatId, channelInfo), 10_000));
        return;
    }

    s.round++;
    s.drinkers  = new Set();
    s.nhieOpen  = true;
    const rem   = s.maxRounds - s.round;

    await sock.sendMessage(chatId, {
        text: `┏━━ Round ${s.round}/${s.maxRounds} ━━┓\n\n🍻 *${q}*\n\n✅ Type *yes* — I have\n❌ Type *no* — I haven't\n⏱️ ${NHIE_REACT_MS / 1_000}s to respond`,
        ...channelInfo
    });

    timers.set(chatId + '_vote', setTimeout(async () => {
        if (!sessions.has(chatId) || s.type !== 'nhie') return;
        s.nhieOpen = false;
        const list = Array.from(s.drinkers!);
        const mentions: string[] = [];
        let out = list.length === 0
            ? `_Nobody said yes! 😇 Innocent bunch..._`
            : `✅ *${list.length} said yes:*\n` + list.map(j => { mentions.push(j); s.allDrinks![j] = (s.allDrinks![j] || 0) + 1; return `  ✋ ${tag(j)}`; }).join('\n');
        out += rem > 0 ? `\n\n⏳ Next statement in 8s... (${rem} left)` : `\n\n🏁 Final round done! Results coming...`;
        await sock.sendMessage(chatId, { text: out, mentions, ...channelInfo });

        timers.set(chatId + '_round', setTimeout(async () => {
            if (!sessions.has(chatId) || s.type !== 'nhie') return;
            await sendNHIE(sock, chatId, channelInfo);
        }, 8_000));
    }, NHIE_REACT_MS));
}

async function endNHIE(sock: any, s: PartySession, channelInfo: any) {
    clrAll(s.chatId);
    const sorted  = Object.entries(s.allDrinks!).sort(([, a], [, b]) => b - a).slice(0, 10);
    const mentions = sorted.map(([j]) => j);
    const board   = sorted.length
        ? sorted.map(([j, n], i) => `${['🥇','🥈','🥉','▪️','▪️','▪️','▪️','▪️','▪️','▪️'][i]} ${tag(j)} — ${n} yes ✅`).join('\n')
        : '_No one said yes to anything! 😇_';
    const champ   = sorted.length ? `\n🏆 *Most Honest:* ${tag(sorted[0][0])} with ${sorted[0][1]} confessions!` : '';

    await sock.sendMessage(s.chatId, {
        text:
`┏━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🍻 *𝗚𝗔𝗠𝗘 𝗢𝗩𝗘𝗥!*
┗━━━━━━━━━━━━━━━━━━━━━━━━┛

📊 *Never Have I Ever Summary*

🎯 Total Rounds: ${s.round}

✅ *Confession Leaderboard:*
${board}${champ}

Thanks for playing! 🍻`,
        mentions, ...channelInfo
    });
    endSession(sock, s);
}

async function handleNHIE(sock: any, m: any, body: string, sender: string, s: PartySession, channelInfo: any) {
    const chatId = s.chatId;
    if (body === 'endnhie') {
        if (s.status === 'waiting') { endSession(sock, s); return sock.sendMessage(chatId, { text: '🛑 Never Have I Ever cancelled.', ...channelInfo }); }
        return await endNHIE(sock, s, channelInfo);
    }
    if (s.status === 'waiting' && body === 'join') {
        if (s.players.includes(sender)) return;
        s.players.push(sender);
        return sock.sendMessage(chatId, { text: `✅ ${tag(sender)} joined! (${s.players.length} players)`, mentions: [sender], ...channelInfo });
    }
    if (!s.nhieOpen) return;
    if (body === 'yes' || body === 'y') {
        if (s.drinkers!.has(sender)) return;
        s.drinkers!.add(sender);
        await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
    } else if (body === 'no' || body === 'n') {
        await sock.sendMessage(chatId, { react: { text: '❌', key: m.key } });
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// SPIN THE BOTTLE
// ══════════════════════════════════════════════════════════════════════════════

async function startSpinBottle(sock: any, chatId: string, starterJid: string, rating: Rating, channelInfo: any) {
    const modeLabel = rating === 'r' ? ' 🔞' : '';
    const session: PartySession = {
        chatId, type: 'spinbottle', status: 'waiting', players: [starterJid],
        rating, round: 0, maxRounds: 0, seen: new Set(),
    };
    sessions.set(chatId, session);
    attachListener(sock, session, channelInfo);

    await sock.sendMessage(chatId, {
        text:
`┏━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🍾 *𝗦𝗣𝗜𝗡 𝗧𝗛𝗘 𝗕𝗢𝗧𝗧𝗟𝗘*${modeLabel}
┗━━━━━━━━━━━━━━━━━━━━━━━━┛

${tag(starterJid)} started the game!

💬 Type *join* to enter (${SPIN_JOIN_MS / 1_000}s)
🛑 Type *endspin* to end anytime

_Bottle picks a random player each round for a truth or dare._

👥 Players: 1`,
        mentions: [starterJid], ...channelInfo
    });

    timers.set(chatId + '_wait', setTimeout(async () => {
        const s = sessions.get(chatId);
        if (!s || s.type !== 'spinbottle' || s.status !== 'waiting') return;
        if (s.players.length < 3) {
            endSession(sock, s);
            return sock.sendMessage(chatId, {
                text: `❌ Need at least 3 players (only ${s.players.length} joined). *Spin the Bottle* cancelled.\n\n_Start again with *${prefix}spinbottle*_`,
                ...channelInfo
            });
        }
        s.status = 'active';
        await sock.sendMessage(chatId, { text: `🍾 *${s.players.length} players!* Let's spin...\n\n🎲 Spinning the bottle...`, ...channelInfo });
        await doSpin(sock, s, channelInfo);
    }, SPIN_JOIN_MS));
}

async function doSpin(sock: any, s: PartySession, channelInfo: any) {
    if (!sessions.has(s.chatId) || s.type !== 'spinbottle') return;

    const picked   = s.players[Math.floor(Math.random() * s.players.length)];
    const useTruth = Math.random() > 0.5;
    const q        = await fetchUnique(useTruth ? 'truth' : 'dare', s.rating, s.seen);
    if (!sessions.has(s.chatId) || s.type !== 'spinbottle') return;

    const type  = useTruth ? 'TRUTH' : 'DARE';
    const emoji = useTruth ? '🤔' : '😈';

    if (!q) {
        await sock.sendMessage(s.chatId, { text: '❌ API unavailable. Spinning again in 10s...', ...channelInfo });
        timers.set(s.chatId + '_round', setTimeout(() => doSpin(sock, s, channelInfo), 10_000));
        return;
    }

    await sock.sendMessage(s.chatId, {
        text: `🍾 The bottle points to... ${tag(picked)}!\n\n${emoji} *${type}:*\n${q}\n\n⏳ _Next spin in ${SPIN_ROUND_MS / 1_000}s..._\n🛑 Type *endspin* to end`,
        mentions: [picked], ...channelInfo
    });

    timers.set(s.chatId + '_round', setTimeout(async () => {
        if (!sessions.has(s.chatId) || s.type !== 'spinbottle') return;
        await sock.sendMessage(s.chatId, { text: '🎲 Spinning the bottle again...', ...channelInfo });
        await doSpin(sock, s, channelInfo);
    }, SPIN_ROUND_MS));
}

async function handleSpin(sock: any, _m: any, body: string, sender: string, s: PartySession, channelInfo: any) {
    const chatId = s.chatId;
    if (body === 'endspin') {
        endSession(sock, s);
        return sock.sendMessage(chatId, { text: '🛑 Spin the Bottle ended! Thanks for playing 🍾', ...channelInfo });
    }
    if (s.status === 'waiting' && body === 'join') {
        if (s.players.includes(sender)) return;
        s.players.push(sender);
        return sock.sendMessage(chatId, { text: `✅ ${tag(sender)} joined! (${s.players.length} players)`, mentions: [sender], ...channelInfo });
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMAND PARSERS
// ══════════════════════════════════════════════════════════════════════════════

function parseRating(args: string[]): Rating {
    return args.some(a => a === '18+' || a.toLowerCase() === 'r' || a.toLowerCase() === 'adult') ? 'r' : 'pg';
}

function parseRounds(args: string[]): number {
    for (const a of args) {
        const n = parseInt(a);
        if (!isNaN(n) && n >= 1) return Math.min(n, MAX_ROUNDS);
    }
    return DEFAULT_ROUNDS;
}

function guardGroup(sock: any, message: any, chatId: string, channelInfo: any): boolean {
    if (!chatId.endsWith('@g.us')) {
        sock.sendMessage(chatId, { text: '❌ Party games only work in groups.', ...channelInfo }, { quoted: message });
        return false;
    }
    return true;
}

function guardNoGame(sock: any, message: any, chatId: string, channelInfo: any): boolean {
    if (sessions.has(chatId)) {
        const s = sessions.get(chatId)!;
        sock.sendMessage(chatId, {
            text: `⚠️ A *${s.type.toUpperCase()}* game is already running here.\nType *end${s.type}* to end it.`,
            ...channelInfo
        }, { quoted: message });
        return false;
    }
    return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

export default [
    // ── Truth or Dare ──────────────────────────────────────────────────────────
    {
        command: 'tod',
        aliases: ['truthordare', 'tord'],
        category: 'games',
        description: 'Start a Truth or Dare game. Add *18+* for adult mode.',
        usage: `.tod [rounds] [18+]`,
        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (!guardGroup(sock, message, chatId, channelInfo)) return;
            if (!guardNoGame(sock, message, chatId, channelInfo)) return;
            const rating = parseRating(args);
            const rounds = parseRounds(args);
            await startTOD(sock, chatId, senderId, rounds, rating, channelInfo);
        },
    },

    // ── Would You Rather ──────────────────────────────────────────────────────
    {
        command: 'wyr',
        aliases: ['wouldyourather'],
        category: 'games',
        description: 'Start a Would You Rather game. Add *18+* for adult mode.',
        usage: `.wyr [rounds] [18+]`,
        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (!guardGroup(sock, message, chatId, channelInfo)) return;
            if (!guardNoGame(sock, message, chatId, channelInfo)) return;
            const rating = parseRating(args);
            const rounds = parseRounds(args);
            await startWYR(sock, chatId, senderId, rounds, rating, channelInfo);
        },
    },

    // ── Never Have I Ever ─────────────────────────────────────────────────────
    {
        command: 'nhie',
        aliases: ['neverhaveiever', 'nhi'],
        category: 'games',
        description: 'Start a Never Have I Ever game. Add *18+* for adult mode.',
        usage: `.nhie [rounds] [18+]`,
        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (!guardGroup(sock, message, chatId, channelInfo)) return;
            if (!guardNoGame(sock, message, chatId, channelInfo)) return;
            const rating = parseRating(args);
            const rounds = parseRounds(args);
            await startNHIE(sock, chatId, senderId, rounds, rating, channelInfo);
        },
    },

    // ── Spin the Bottle ───────────────────────────────────────────────────────
    {
        command: 'spinbottle',
        aliases: ['spin', 'spinthebottle', 'bottle'],
        category: 'games',
        description: 'Start a Spin the Bottle game. Add *18+* for adult questions.',
        usage: `.spinbottle [18+]`,
        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (!guardGroup(sock, message, chatId, channelInfo)) return;
            if (!guardNoGame(sock, message, chatId, channelInfo)) return;
            const rating = parseRating(args);
            await startSpinBottle(sock, chatId, senderId, rating, channelInfo);
        },
    },
];
