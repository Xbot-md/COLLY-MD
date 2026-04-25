import type { BotContext } from '../types.js';
import { getWallet, saveWallet } from '../lib/turso.js';
import { resolveJid } from '../lib/lidUtils.js';
import isOwnerOrSudo from '../lib/isOwner.js';
import config from '../config.js';

const prefix = config.prefixes[0];
const fmt    = (n: number) => n.toLocaleString();
const sleep  = (ms: number) => new Promise(r => setTimeout(r, ms));
const pick   = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const ENTRY_FEE        = 500;
const MIN_PLAYERS      = 2;
const ELIM_BONUS       = 1_000;
const VOTE_SECONDS     = 60;
const QUIT_PENALTY     = 15_000_000;
const QUIT_SHARE       = ENTRY_FEE;
const RECRUIT_TIMEOUT  = 5 * 60 * 1_000; // 5 minutes in ms

// ── Helpers ────────────────────────────────────────────────────────────────────
/** Convert ASCII digits to full-width Unicode (e.g. "382" → "３８２") */
const toFW = (s: string) => [...s].map(c => {
    const code = c.charCodeAt(0);
    return code >= 48 && code <= 57 ? String.fromCharCode(code + 0xFEE0) : c;
}).join('');

/** Estimate VIP backers from prize pool */
const calcVips = (pool: number) => Math.floor(pool / 16_000);

/** Panel shown when session expires without enough players */
function gameEndedPanel(count: number, pool: number): string {
    const vips = calcVips(pool);
    return (
`╔═══════════════════════════════════════╗
║       ◯   △   □       ◯   △   □       ║
║   *_Ｇ Ａ Ｍ Ｅ  Ｅ Ｎ Ｄ Ｅ Ｄ_*         ║
║       ◯   △   □       ◯   △   □       ║
╚═══════════════════════════════════════╝
_ＰＬＡＹＥＲＳ：_ ${count} out of 456
_ＳＴＡＴＵＳ：_ Insufficient players
_ＦＵＮＤＥＤ  ＢＹ：_ VIPs ${vips}
_ＴＩＭＥ  ＬＥＦＴ：_ 00:00
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_A voice echoes through the dormitory._
_"Attention, players. There ${count === 1 ? 'is' : 'are'} only *${count}* participant${count !== 1 ? 's' : ''} present."_
_"The game requires at least *${MIN_PLAYERS}* players to proceed."_
_"The game will end due to insufficient players."_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ℹ️ _Game ended. Minimum player count not met. You will be returned home._
═━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━═`
    );
}

// ── Game definitions (ordered — played in sequence) ────────────────────────────
const ORDERED_GAMES: [string, string][] = [
    ['Red Light, Green Light',
        'Move on Green Light. Stop on Red Light. Any movement on Red Light means elimination.'],
    ['Dalgona / Sugar Honeycombs',
        'Carve your assigned shape from the honeycomb without breaking it. Break it and you are eliminated.'],
    ['Tug of War',
        'Pull the opposing team across the line. The losing team is eliminated.'],
    ['Marbles',
        'Win all of your partner\'s marbles. The player with none remaining is eliminated.'],
    ['Glass Bridge',
        'Cross the bridge by choosing the correct tempered glass panel at each step. Choose wrong and you fall.'],
    ['Squid Game',
        'Attackers must reach the head of the squid. Defenders must stop them. The losing side is eliminated.'],
    ['Red Light, Green Light — Return',
        'The giant doll returns. Move only on Green Light. Any motion on Red Light means immediate elimination.'],
    ['Six-Legged Pentathlon',
        'Teams of six complete five consecutive physical challenges. The slowest team is eliminated.'],
    ['Mingle',
        'When a number is announced, form groups of exactly that size instantly. Players left over are eliminated.'],
    ['Lights Out / Special Game',
        'Survive in complete darkness. The rules change without warning. The last player standing advances.'],
    ['Human Chess',
        'You are the pieces on a giant board. Lose your piece and you are eliminated. Checkmate to survive.'],
    ['Sky Squid Game',
        'The arena is suspended in the sky. Cross to the other side. Those who fall are eliminated.'],
];
const GUARDS = ['Front Man', 'Circle Guard', 'Triangle Guard', 'Square Guard'];

// ── Constants ──────────────────────────────────────────────────────────────────
const VIP_FEE     = 1_000_000_000;   // min buy-in for VIP status (goes to prize pool)
const VIP_BET_MIN = 1_000_000_000;   // min VIP side-bet

// ── Session types ──────────────────────────────────────────────────────────────
interface SquidPlayer {
    jid: string;
    name: string;
    dob: string;
    number: string;
    displayName: string;
}

interface VipEntry {
    jid: string;
    displayName: string;
    buyinAmount: number;
    betPlayerJid?: string;
    betAmount?: number;
}

interface SquidSession {
    chatId: string;
    hostId: string;
    messageId: string;
    players: SquidPlayer[];
    survivors: SquidPlayer[];
    status: 'recruiting' | 'playing' | 'ended';
    prizePool: number;
    vips: Map<string, VipEntry>;
    vipBetPool: number;
    voteActive: boolean;
    recruitTimer?: ReturnType<typeof setTimeout>;
    eventHandler?: (update: any) => Promise<void>;
}

const sessions              = new Map<string, SquidSession>();
const investigateCooldowns  = new Map<string, number>();

// ── Unique player number ───────────────────────────────────────────────────────
function uniqueNumber(session: SquidSession): string {
    const used = new Set(session.players.map(p => p.number));
    let n: string;
    do { n = String(Math.floor(Math.random() * 456) + 1).padStart(3, '0'); } while (used.has(n));
    return n;
}

// ── Panel builders ─────────────────────────────────────────────────────────────
function statusUpdatePanel(player: SquidPlayer, session: SquidSession): string {
    const vips  = calcVips(session.prizePool);
    const count = session.players.length;
    return (
`╔═══════════════════════════════════════╗
║       ◯   △   □       ◯   △   □       ║
║   *_Ｓ Ｔ Ａ Ｔ Ｕ Ｓ  Ｕ Ｐ Ｄ Ａ Ｔ Ｅ Ｄ_*  ║
║       ◯   △   □       ◯   △   □       ║
╚═══════════════════════════════════════╝
_ＰＬＡＹＥＲ：_ ${player.name}
_ＰＬＡＹＥＲＳ：_ ${count} / 456
_ＳＴＡＴＵＳ：_ Awaiting players
_ＦＵＮＤＥＤ  ＢＹ：_ VIPs ${vips}
_ＴＩＭＥ  ＬＥＦＴ：_ --:--
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_A black van arrives. Masked men take you inside. The doors shut and gas fills the van... Everything goes black. You wake in a cold dormitory. Your clothes are gone. You now wear a green tracksuit._
_ＹＯＵ  ＡＲＥ  ＰＬＡＹＥＲ  #${toFW(player.number)}_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ℹ️ _Wait for the Front Man to announce the first game. Do not attempt to leave the dormitory._
═━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );
}

function gameStartingPanel(session: SquidSession, firstGame: string, firstDesc: string): string {
    const vips  = calcVips(session.prizePool);
    const count = session.players.length;
    return (
`╔═══════════════════════════════════════╗
║       ◯   △   □       ◯   △   □       ║
║   *_Ｇ Ａ Ｍ Ｅ  Ｓ Ｔ Ａ Ｒ Ｔ Ｉ Ｎ Ｇ_*   ║
║       ◯   △   □       ◯   △   □       ║
╚═══════════════════════════════════════╝
_ＰＬＡＹＥＲＳ：_ ${count} / 456
_ＳＴＡＴＵＳ：_ Game commencing
_ＦＵＮＤＥＤ  ＢＹ：_ VIPs ${vips}
_ＴＩＭＥ  ＬＥＦＴ：_ 00:00
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_The Front Man's voice fills the dormitory._
_"Attention, players. The game will now begin."_
_"Please follow the staff and proceed to the arena in an orderly line."_
_"Players who refuse to play will be eliminated."_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ _First Game: ${firstGame}. ${firstDesc}_
═━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━═`
    );
}

// ── Round result panel ─────────────────────────────────────────────────────────
function roundResultPanel(
    round: number,
    gameName: string,
    survivors: SquidPlayer[],
    eliminated: SquidPlayer[],
    total: number,
    nextRound: number,
    prizePool: number,
): { text: string; mentions: string[] } {
    const bonusTotal  = eliminated.length * ELIM_BONUS;
    const winnerTags  = survivors.map(p => `@${p.jid.split(':')[0].split('@')[0]}`).join(', ');
    const elimTags    = eliminated.map(p => `@${p.jid.split(':')[0].split('@')[0]}`).join(', ');
    const text =
`╔═══════════════════════════════════════╗
║       ◯   △   □       ◯   △   □       ║
║   _Ｒ Ｏ Ｕ Ｎ Ｄ  ${round}  Ｒ Ｅ Ｓ Ｕ Ｌ Ｔ_  ║
║       ◯   △   □       ◯   △   □       ║
╚═══════════════════════════════════════╝
_ＲＯＵＮＤ  ＮＡＭＥ：_ ${gameName}
_ＳＴＡＴＵＳ：_ Round ${round} Complete
_ＰＬＡＹＥＲＳ：_ ${survivors.length} / ${total} Remaining
_ＷＩＮＮＥＲＳ：_ ${winnerTags}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_A gunshot echoes. The doll stops scanning._
➤ ${elimTags} eliminated.
➤ Prize increased by ₩${fmt(ELIM_BONUS)} per elimination.
➤ Total increased was ₩${fmt(bonusTotal)}.
➤ Winners may continue to Round ${nextRound}.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＶＯＴＥ：_ Do you wish to continue or end the game?
➤ Reply \`vote O\` to continue to Round ${nextRound}
➤ Reply \`vote X\` to end and split the prize
ℹ️ _Current prize total: ₩${fmt(prizePool)}. Majority vote decides. You have ${VOTE_SECONDS}s._
═━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━═`;
    const mentions = [...survivors, ...eliminated].map(p => p.jid);
    return { text, mentions };
}

// ── Vote result panel ──────────────────────────────────────────────────────────
function voteResultPanel(
    survivors: SquidPlayer[],
    oVoters: SquidPlayer[],
    xVoters: SquidPlayer[],
    result: 'continue' | 'end',
    nextRound: number,
    prizePool: number,
): { text: string; mentions: string[] } {
    const oList = oVoters.length ? oVoters.map(p => `@${p.jid.split(':')[0].split('@')[0]}`).join(', ') : 'None';
    const xList = xVoters.length ? xVoters.map(p => `@${p.jid.split(':')[0].split('@')[0]}`).join(', ') : 'None';
    const share = Math.floor(prizePool / survivors.length);
    const cont  = result === 'continue';
    const tail  = cont
        ? `_ＮＥＸＴ  ＲＯＵＮＤ：_ Round ${nextRound}\n_ＰＲＩＺＥ  ＰＯＯＬ：_ ₩${fmt(prizePool)}`
        : `_ＦＩＮＡＬ  ＰＲＩＺＥ：_ ₩${fmt(prizePool)}\n_ＥＡＣＨ  ＷＩＮＮＥＲ：_ ₩${fmt(share)}`;
    const text =
`╔═══════════════════════════════════════╗
║   _Ｖ Ｏ Ｔ Ｅ  Ｒ Ｅ Ｓ Ｕ Ｌ Ｔ_    ║
╚═══════════════════════════════════════╝
_ＳＴＡＴＵＳ：_ Voting Complete
_ＲＥＳＵＬＴ：_ ${cont ? 'Continuing' : 'Game Ended'}
_ＲＥＭＡＩＮＩＮＧ：_ ${survivors.length} Player${survivors.length !== 1 ? 's' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＶＯＴＥＳ_
➤ End \`X\`: ${xVoters.length} — ${xList}
➤ Continue \`O\`: ${oVoters.length} — ${oList}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
➤ Vote concluded. Majority chose ${cont ? 'O' : 'X'}.
➤ ${cont ? `Game continues. Round ${nextRound} begins shortly.` : `Game ends. ₩${fmt(prizePool)} split equally.`}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${tail}
═━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━═`;
    const mentions = [...oVoters, ...xVoters].map(p => p.jid);
    return { text, mentions };
}

// ── Player Quit panel ──────────────────────────────────────────────────────────
function playerQuitPanel(player: SquidPlayer, session: SquidSession): { text: string; mentions: string[] } {
    const tag = `@${player.jid.split(':')[0].split('@')[0]}`;
    const text =
`╔═══════════════════════════════════════╗
║   _Ｐ Ｌ Ａ Ｙ Ｅ Ｒ  Ｑ Ｕ Ｉ Ｔ_    ║
╚═══════════════════════════════════════╝
_ＳＴＡＴＵＳ：_ Player Left
_ＰＬＡＹＥＲ：_ ${tag}
_ＲＥＳＵＬＴ：_ Eliminated
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
➤ You were eliminated
➤ ${tag} has quit the game
➤ Your share was added to the prize pool
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＬＥＧＡＬ  ＮＯＴＩＣＥ_
➤ Per Clause 2 of the Player Consent Form
➤ You were charged a debt of ₩${fmt(QUIT_PENALTY)}
➤ Reason: Breach of contract and game operating costs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＣＵＲＲＥＮＴ  ＰＲＩＺＥ：_ ₩${fmt(session.prizePool)}
_ＲＥＭＡＩＮＩＮＧ：_ ${session.survivors.length} Player${session.survivors.length !== 1 ? 's' : ''}
═━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━═`;
    return { text, mentions: [player.jid] };
}

// ── Game Over panel ─────────────────────────────────────────────────────────────
function gameOverPanel(
    winner: SquidPlayer,
    losers: SquidPlayer[],
    prizePool: number,
    forceTerminated: boolean,
    vipLine?: string,
): { text: string; mentions: string[] } {
    const winTag    = `@${winner.jid.split(':')[0].split('@')[0]}`;
    const loserTags = losers.map(p => `@${p.jid.split(':')[0].split('@')[0]}`).join(', ');
    const status    = forceTerminated ? 'Force Terminated' : 'Game Concluded';
    const narrative = forceTerminated
        ? `➤ ${winTag} stormed the control room\n➤ ${winTag} killed the Front Man and his guards\n➤ All remaining players lost`
        : `➤ ${winTag} outlasted every other player\n➤ The last opponent fell\n➤ The prize is unclaimed no more`;
    const clause    = forceTerminated ? 3 : 3;
    const legal     = forceTerminated
        ? `➤ Per Clause ${clause} of the Player Consent Form\n➤ Game terminated by force majeure\n➤ Remaining prize pool awarded to ${winTag}`
        : `➤ Per Clause ${clause} of the Player Consent Form\n➤ Game concluded — last player standing\n➤ Full prize pool awarded to ${winTag}`;
    const text =
`╔═══════════════════════════════════════╗
║   _Ｇ Ａ Ｍ Ｅ  Ｏ Ｖ Ｅ Ｒ_    ║
╚═══════════════════════════════════════╝
_ＳＴＡＴＵＳ：_ ${status}
_ＰＬＡＹＥＲ：_ ${winTag}
_ＲＥＳＵＬＴ：_ Sole Winner
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${narrative}
➤ ${loserTags || 'No remaining players'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＬＥＧＡＬ  ＮＯＴＩＣＥ_
${legal}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＦＩＮＡＬ  ＰＲＩＺＥ：_ ₩${fmt(prizePool)}
_ＷＩＮＮＥＲ：_ ${winTag}
_ＰＡＹＯＵＴ：_ ₩${fmt(prizePool)}${vipLine ? `\n${vipLine}` : ''}
═━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━═`;
    const mentions = [winner.jid, ...losers.map(p => p.jid)];
    return { text, mentions };
}

// ── Vote conductor ─────────────────────────────────────────────────────────────
async function conductVote(
    sock: any,
    chatId: string,
    survivors: SquidPlayer[],
): Promise<{ result: 'continue' | 'end'; oVoters: SquidPlayer[]; xVoters: SquidPlayer[] }> {
    const survivorMap = new Map(survivors.map(p => [p.jid, p]));
    const votes       = new Map<string, 'O' | 'X'>();

    return new Promise(resolve => {
        let done = false;

        const finish = () => {
            if (done) return;
            done = true;
            sock.ev.off('messages.upsert', listener);
            clearTimeout(timer);
            const oVoters = survivors.filter(p => votes.get(p.jid) === 'O');
            const xVoters = survivors.filter(p => votes.get(p.jid) === 'X');
            const result: 'continue' | 'end' = xVoters.length > oVoters.length ? 'end' : 'continue';
            resolve({ result, oVoters, xVoters });
        };

        const timer = setTimeout(finish, VOTE_SECONDS * 1000);

        const listener = async (update: any) => {
            const m = update?.messages?.[0];
            if (!m?.message || m.key.remoteJid !== chatId) return;

            let jid = m.key.participant || m.key.remoteJid;
            if (jid?.includes('@lid')) {
                try { jid = await resolveJid(sock, jid); } catch { return; }
            }
            if (!survivorMap.has(jid)) return;

            const raw  = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim();
            const vote = raw.match(/^[.!\/\#]?vote\s+([oxOX])$/i)?.[1]?.toUpperCase();
            if (vote === 'O' || vote === 'X') {
                votes.set(jid, vote as 'O' | 'X');
            } else {
                return;
            }

            if (votes.size >= survivors.length) finish();
        };

        sock.ev.on('messages.upsert', listener);
    });
}

// ── Award winner helper ────────────────────────────────────────────────────────
async function awardWinner(
    sock: any,
    session: SquidSession,
    channelInfo: any,
    winner: SquidPlayer,
    losers: SquidPlayer[],
    forceTerminated: boolean,
) {
    session.status = 'ended';
    sessions.delete(session.chatId);

    try {
        const ww = await getWallet(winner.jid, winner.displayName);
        ww.balance += session.prizePool;
        await saveWallet(ww);
    } catch { /* non-fatal */ }

    let vipLine: string | undefined;
    if (session.vipBetPool > 0) {
        const vipWinners: VipEntry[] = [];
        let totalWinBets = 0;
        for (const v of session.vips.values()) {
            if (v.betPlayerJid === winner.jid && v.betAmount) {
                vipWinners.push(v);
                totalWinBets += v.betAmount;
            }
        }
        if (vipWinners.length > 0) {
            for (const v of vipWinners) {
                const payout = Math.floor((v.betAmount! / totalWinBets) * session.vipBetPool);
                try {
                    const vw = await getWallet(v.jid, v.displayName);
                    vw.balance += payout;
                    await saveWallet(vw);
                } catch { /* non-fatal */ }
            }
            vipLine = `_VIP BETTORS：_ ${vipWinners.length} winner${vipWinners.length !== 1 ? 's' : ''} — ₩${fmt(session.vipBetPool)} shared`;
        }
    }

    const panel = gameOverPanel(winner, losers, session.prizePool, forceTerminated, vipLine);
    await sock.sendMessage(session.chatId, { text: panel.text, mentions: panel.mentions, ...channelInfo });
}

// ── Game runner ────────────────────────────────────────────────────────────────
async function runGame(sock: any, session: SquidSession, channelInfo: any) {
    session.status   = 'playing';
    session.survivors = [...session.players];
    const { chatId } = session;

    if (session.recruitTimer) clearTimeout(session.recruitTimer);
    if (session.eventHandler) sock.ev.off('messages.upsert', session.eventHandler);

    // ── Prefix-free in-game listener (quit/leave without prefix) ─────────────
    const QUIT_WORDS  = new Set(['quit', 'squidleave', 'leavesquid', 'leave', 'quitsquid', 'quitsquidgame']);
    const PREFIXES    = config.prefixes;

    const gameHandler = async (update: any) => {
        const m = update?.messages?.[0];
        if (!m?.message || m.key.remoteJid !== chatId || m.key.fromMe) return;
        if (session.status !== 'playing') return;

        const raw = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim();
        if (!raw) return;

        // Strip any bot prefix before checking
        let body = raw.toLowerCase();
        for (const p of PREFIXES) { if (body.startsWith(p)) { body = body.slice(p.length).trimStart(); break; } }

        if (!QUIT_WORDS.has(body)) return;

        let jid = m.key.participant || m.key.remoteJid;
        if (jid?.includes('@lid')) {
            try { jid = await resolveJid(sock, jid); } catch { return; }
        }

        const survIdx = session.survivors.findIndex(p => p.jid === jid);
        if (survIdx === -1) return;

        const quitter = session.survivors[survIdx];
        session.survivors.splice(survIdx, 1);
        session.prizePool += QUIT_SHARE;

        try {
            const w = await getWallet(jid, quitter.displayName);
            w.balance = Math.max(0, w.balance - QUIT_PENALTY);
            await saveWallet(w);
        } catch { /* non-fatal */ }

        const pq = playerQuitPanel(quitter, session);
        await sock.sendMessage(chatId, { text: pq.text, mentions: pq.mentions, ...channelInfo });

        if (session.survivors.length === 1) {
            const winner = session.survivors[0];
            const losers = session.players.filter(p => p.jid !== winner.jid);
            await sleep(2000);
            await awardWinner(sock, session, channelInfo, winner, losers, true);
        }
    };

    session.eventHandler = gameHandler;
    sock.ev.on('messages.upsert', gameHandler);

    const [firstGame, firstDesc] = ORDERED_GAMES[0];
    await sock.sendMessage(chatId, { text: gameStartingPanel(session, firstGame, firstDesc), ...channelInfo });
    await sleep(5000);

    const total     = session.survivors.length;
    const maxRounds = ORDERED_GAMES.length;

    try {
        for (let round = 1; round <= maxRounds && session.survivors.length > 1; round++) {
            const [game, gameDesc] = ORDERED_GAMES[round - 1];

            await sock.sendMessage(chatId, {
                text:
`╔══════════════════════════════════╗
║  ◯  △  □  *ROUND ${round}*  ◯  △  □  ║
╚══════════════════════════════════╝
*GAME: ${game}*
_${gameDesc}_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_The ${pick(GUARDS)} gives the signal..._
_Players are moving..._
_Type \`quit\` or \`leave\` to exit the game_`,
                ...channelInfo
            });
            await sleep(6000);

            // Check if force-terminated while sleeping
            if (session.survivors.length <= 1) break;

            const toElim    = Math.max(1, Math.floor(session.survivors.length / 2));
            const shuffled  = [...session.survivors].sort(() => Math.random() - 0.5);
            const eliminated = shuffled.slice(0, toElim);
            session.survivors = shuffled.slice(toElim);
            session.prizePool += eliminated.length * ELIM_BONUS;

            if (session.survivors.length <= 1) break;

            const rr = roundResultPanel(round, game, session.survivors, eliminated, total, round + 1, session.prizePool);
            await sock.sendMessage(chatId, { text: rr.text, mentions: rr.mentions, ...channelInfo });

            session.voteActive = true;
            const { result, oVoters, xVoters } = await conductVote(sock, chatId, session.survivors);
            session.voteActive = false;

            const vr = voteResultPanel(session.survivors, oVoters, xVoters, result, round + 1, session.prizePool);
            await sock.sendMessage(chatId, { text: vr.text, mentions: vr.mentions, ...channelInfo });

            if (result === 'end') {
                const share = Math.floor(session.prizePool / session.survivors.length);
                for (const p of session.survivors) {
                    try {
                        const pw = await getWallet(p.jid, p.displayName);
                        pw.balance += share;
                        await saveWallet(pw);
                    } catch { /* non-fatal */ }
                }
                session.status = 'ended';
                sessions.delete(chatId);
                return;
            }

            // Check for force-terminate during vote
            if (session.survivors.length <= 1) break;

            await sleep(3000);
        }

        if (session.survivors.length === 0) return; // session already cleaned up
        const winner = pick(session.survivors);
        const losers = session.players.filter(p => p.jid !== winner.jid);
        await awardWinner(sock, session, channelInfo, winner, losers, false);
    } finally {
        // Always clean up the in-game event handler
        sock.ev.off('messages.upsert', gameHandler);
        if (session.eventHandler === gameHandler) session.eventHandler = undefined;
    }
}

// ── Recruiter message ──────────────────────────────────────────────────────────
const RECRUITER_MSG = (pref: string) =>
`╔═══════════════════════════════════════╗
║       ◯   △   □       ◯   △   □       ║
║  *_Ｇ Ａ Ｍ Ｅ  Ｒ Ｅ Ｃ Ｒ Ｕ Ｉ Ｔ Ｅ Ｒ_*  ║
║       ◯   △   □       ◯   △   □       ║
╚═══════════════════════════════════════╝

Do you wish to participate in the game?
...
If you wish to play, please state your name and birthdate.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️ _Reply to this message with your details to participate._
_Example: Seong Gi-hun, 10/31/1974_

ℹ️ _Other players can join too by replying with their details!_
ℹ️ _Entry fee: *${ENTRY_FEE} 🪙* deducted on join._
ℹ️ _Host uses *${pref}squidstart* to begin the game._

═━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━═
╔═════════════════════╗
║     ◯   △   □     ║
║  *_ＳＱＵＩＤ ＧＡＭＥ_*  ║
╚═════════════════════╝`;

// ── Commands ───────────────────────────────────────────────────────────────────
export default [
    {
        command: 'joinsquidgames',
        aliases: ['squidgame', 'squid', 'sg'],
        category: 'games',
        description: 'Open a Squid Game recruitment session in this group',
        usage: `.joinsquidgames Your Name MM/DD/YYYY`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (!chatId.endsWith('@g.us')) {
                return sock.sendMessage(chatId, { text: `❌ Squid Game only works in groups.`, ...channelInfo }, { quoted: message });
            }

            // .squidgame price — show current prize pool
            if (args[0]?.toLowerCase() === 'price') {
                const s = sessions.get(chatId);
                if (!s) return sock.sendMessage(chatId, { text: `❌ No active Squid Game session.`, ...channelInfo }, { quoted: message });
                return sock.sendMessage(chatId, {
                    text: `💰 *Current Prize Pool:* ₩${fmt(s.prizePool)}\n👥 *Players:* ${s.players.length}\n🎩 *VIPs:* ${s.vips.size}`,
                    ...channelInfo
                }, { quoted: message });
            }

            // Parse name + DOB from command args
            const input     = args.join(' ').trim();
            const dateMatch = input.match(/^(.+?)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})$/);
            if (!dateMatch) {
                return sock.sendMessage(chatId, {
                    text:
`❌ Please include your *name* and *date of birth* to register.
Format: *${prefix}joinsquidgames Your Name MM/DD/YYYY*
Example: *${prefix}joinsquidgames Seong Gi Hun 10/31/1974*`,
                    ...channelInfo
                }, { quoted: message });
            }
            const registeredName = dateMatch[1].trim();
            const registeredDob  = dateMatch[2].trim();

            if (sessions.has(chatId)) {
                const s = sessions.get(chatId)!;
                return sock.sendMessage(chatId, {
                    text: `⚠️ A session is already active.\n\nPlayers: *${s.players.length}*\nUse *${prefix}squidstatus* to see the list.`,
                    ...channelInfo
                }, { quoted: message });
            }

            const hostW = await getWallet(senderId, message.pushName || senderId.split('@')[0]);
            if (hostW.balance < ENTRY_FEE) {
                return sock.sendMessage(chatId, {
                    text: `❌ You need *${fmt(ENTRY_FEE)} 🪙* to open a session. You have *${fmt(hostW.balance)} 🪙*.`,
                    ...channelInfo
                }, { quoted: message });
            }

            hostW.balance -= ENTRY_FEE;
            await saveWallet(hostW);

            const session: SquidSession = {
                chatId, hostId: senderId, messageId: '',
                players: [], status: 'recruiting', prizePool: ENTRY_FEE,
                vips: new Map(), vipBetPool: 0, voteActive: false, survivors: [],
            };

            const hostNum = uniqueNumber(session);
            const hostPlayer: SquidPlayer = {
                jid: senderId,
                name: registeredName,
                dob: registeredDob,
                number: hostNum,
                displayName: message.pushName || senderId.split('@')[0],
            };
            session.players.push(hostPlayer);

            // 1. Send recruiter message (others reply to this)
            const sent = await sock.sendMessage(chatId, { text: RECRUITER_MSG(prefix), ...channelInfo }, { quoted: message });
            session.messageId = sent?.key?.id || '';
            sessions.set(chatId, session);

            // 2. Send STATUS UPDATE for the host
            await sock.sendMessage(chatId, {
                text: statusUpdatePanel(hostPlayer, session),
                mentions: [senderId], ...channelInfo
            });

            // 3. Recruitment countdown — auto-end if not enough players in time
            const timeoutMins = Math.round(RECRUIT_TIMEOUT / 60_000);
            await sock.sendMessage(chatId, {
                text: `⏳ _Recruitment is open for *${timeoutMins} minutes*. If fewer than *${MIN_PLAYERS}* players join, the game will be cancelled and all entry fees refunded._`,
                ...channelInfo
            });

            // 1-minute warning
            const warnTimer = setTimeout(async () => {
                const s = sessions.get(chatId);
                if (!s || s.status !== 'recruiting') return;
                await sock.sendMessage(chatId, {
                    text: `⚠️ _Only *1 minute* left to join! Currently *${s.players.length}* player${s.players.length !== 1 ? 's' : ''} registered. Need at least *${MIN_PLAYERS}*._`,
                    ...channelInfo
                });
            }, RECRUIT_TIMEOUT - 60_000);

            // Main expiry timer
            session.recruitTimer = setTimeout(async () => {
                const s = sessions.get(chatId);
                if (!s || s.status !== 'recruiting') {
                    clearTimeout(warnTimer);
                    return;
                }
                clearTimeout(warnTimer);
                // Refund players
                for (const p of s.players) {
                    try {
                        const pw = await getWallet(p.jid, p.displayName);
                        pw.balance += ENTRY_FEE;
                        await saveWallet(pw);
                    } catch { /* ignore */ }
                }
                // Refund VIPs
                for (const v of s.vips.values()) {
                    try {
                        const vw = await getWallet(v.jid, v.displayName);
                        vw.balance += v.buyinAmount + (v.betAmount || 0);
                        await saveWallet(vw);
                    } catch { /* ignore */ }
                }
                if (s.eventHandler) sock.ev.off('messages.upsert', s.eventHandler);
                sessions.delete(chatId);
                await sock.sendMessage(chatId, { text: gameEndedPanel(s.players.length, s.prizePool), ...channelInfo });
            }, RECRUIT_TIMEOUT);

            // ── Reply listener ────────────────────────────────────────────────
            const eventHandler = async (update: any) => {
                const m = update?.messages?.[0];
                if (!m?.message || m.key.remoteJid !== chatId) return;
                if (session.status !== 'recruiting') return;

                const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
                if (quotedId !== session.messageId) return;

                const text  = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim();
                const match = text.match(/^(.+?),\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})$/);
                if (!match) return;

                let joinerJid = m.key.participant || m.key.remoteJid;
                if (joinerJid?.includes('@lid')) joinerJid = await resolveJid(sock, joinerJid);

                const existing = session.players.find(p => p.jid === joinerJid);
                if (existing) {
                    await sock.sendMessage(chatId, {
                        text: `⚠️ You're already registered as Player *#${existing.number}*.`,
                        ...channelInfo
                    }, { quoted: m });
                    return;
                }

                const joinerW = await getWallet(joinerJid, m.pushName || joinerJid.split('@')[0]);
                if (joinerW.balance < ENTRY_FEE) {
                    await sock.sendMessage(chatId, {
                        text: `❌ @${joinerJid.split('@')[0]}, you need *${fmt(ENTRY_FEE)} 🪙* to join. You only have *${fmt(joinerW.balance)} 🪙*.`,
                        mentions: [joinerJid], ...channelInfo
                    }, { quoted: m });
                    return;
                }

                joinerW.balance -= ENTRY_FEE;
                await saveWallet(joinerW);
                session.prizePool += ENTRY_FEE;

                const playerNum  = uniqueNumber(session);
                const newPlayer: SquidPlayer = {
                    jid: joinerJid,
                    name: match[1].trim(),
                    dob:  match[2].trim(),
                    number: playerNum,
                    displayName: m.pushName || joinerJid.split('@')[0],
                };
                session.players.push(newPlayer);

                await sock.sendMessage(chatId, {
                    text: statusUpdatePanel(newPlayer, session),
                    mentions: [joinerJid], ...channelInfo
                }, { quoted: m });
            };

            session.eventHandler = eventHandler;
            sock.ev.on('messages.upsert', eventHandler);

            // Auto-start or refund after 15 minutes
            setTimeout(async () => {
                if (!sessions.has(chatId) || session.status !== 'recruiting') return;
                if (session.players.length < MIN_PLAYERS) {
                    const count = session.players.length;
                    const pool  = session.prizePool;
                    for (const p of session.players) {
                        try {
                            const pw = await getWallet(p.jid, p.displayName);
                            pw.balance += ENTRY_FEE;
                            await saveWallet(pw);
                        } catch { /* ignore */ }
                    }
                    sessions.delete(chatId);
                    sock.ev.off('messages.upsert', eventHandler);
                    await sock.sendMessage(chatId, {
                        text: gameEndedPanel(count, pool),
                        ...channelInfo
                    });
                } else {
                    await runGame(sock, session, channelInfo);
                }
            }, 15 * 60 * 1000);
        },
    },

    {
        command: 'squidstart',
        aliases: ['startgame', 'squidgo'],
        category: 'games',
        description: 'Start the Squid Game (host or admin only)',
        usage: `.squidstart`,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const session = sessions.get(chatId);
            if (!session || session.status !== 'recruiting') {
                return sock.sendMessage(chatId, { text: `❌ No active session. Start one with *${prefix}joinsquidgames*.`, ...channelInfo }, { quoted: message });
            }

            const isHost  = senderId === session.hostId;
            const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
            if (!isHost && !isOwner) {
                return sock.sendMessage(chatId, { text: `❌ Only the host or an admin can start the game.`, ...channelInfo }, { quoted: message });
            }

            if (session.players.length < MIN_PLAYERS) {
                return sock.sendMessage(chatId, { text: `⚠️ Need at least *${MIN_PLAYERS} players* to start. Currently: *${session.players.length}*.`, ...channelInfo }, { quoted: message });
            }

            await runGame(sock, session, channelInfo);
        },
    },

    {
        command: 'squidstatus',
        aliases: ['squidplayers', 'squidlist'],
        category: 'games',
        description: 'View current Squid Game participants',
        usage: `.squidstatus`,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const session = sessions.get(chatId);
            if (!session) {
                return sock.sendMessage(chatId, { text: `❌ No active session. Use *${prefix}joinsquidgames* to start.`, ...channelInfo }, { quoted: message });
            }

            const vips = calcVips(session.prizePool);
            let text =
`╔═══════════════════════════════════════╗
║       ◯   △   □       ◯   △   □       ║
║     *_ＳＱＵＩＤ ＧＡＭＥ — ＲＯＳＴＥＲ_*      ║
║       ◯   △   □       ◯   △   □       ║
╚═══════════════════════════════════════╝
_ＰＬＡＹＥＲＳ：_ ${session.players.length} / 456
_ＳＴＡＴＵＳ：_ ${session.status}
_ＦＵＮＤＥＤ  ＢＹ：_ VIPs ${vips}
_ＰＲＩＺＥ：_ ${fmt(session.prizePool)} 🪙
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
            for (const p of session.players) {
                text += `*#${p.number}* — ${p.name} (${p.displayName})\n`;
            }
            text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        },
    },

    {
        command: 'squidleave',
        aliases: ['leavesquid', 'quitsquidgame', 'quitsquid'],
        category: 'games',
        description: 'Leave the Squid Game before it starts (50% refund)',
        usage: `.squidleave`,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const session = sessions.get(chatId);
            if (!session) {
                return sock.sendMessage(chatId, { text: `❌ No active Squid Game session.`, ...channelInfo }, { quoted: message });
            }

            // ── Pre-game leave (recruiting) ──────────────────────────────────
            if (session.status === 'recruiting') {
                const idx = session.players.findIndex(p => p.jid === senderId);
                if (idx === -1) return sock.sendMessage(chatId, { text: `❌ You're not registered.`, ...channelInfo }, { quoted: message });
                if (senderId === session.hostId) return sock.sendMessage(chatId, {
                    text: `❌ The host can't leave. Use *${prefix}squidcancel* to cancel the whole session.`,
                    ...channelInfo
                }, { quoted: message });

                const refund = Math.floor(ENTRY_FEE * 0.5);
                session.players.splice(idx, 1);
                session.prizePool = Math.max(0, session.prizePool - ENTRY_FEE + refund);

                const w = await getWallet(senderId, message.pushName || senderId.split('@')[0]);
                w.balance += refund;
                await saveWallet(w);

                return sock.sendMessage(chatId, {
                    text: `🚪 _You walked away. *${fmt(refund)} 🪙* refunded (50%). The game continues without you._`,
                    ...channelInfo
                }, { quoted: message });
            }

            // ── Mid-game quit (playing) ──────────────────────────────────────
            if (session.status === 'playing') {
                const survIdx = session.survivors.findIndex(p => p.jid === senderId);
                if (survIdx === -1) {
                    return sock.sendMessage(chatId, {
                        text: `❌ You're not an active player — you've already been eliminated.`,
                        ...channelInfo
                    }, { quoted: message });
                }

                const quitter = session.survivors[survIdx];
                session.survivors.splice(survIdx, 1);
                session.prizePool += QUIT_SHARE;

                // Apply Clause 2 penalty
                const w = await getWallet(senderId, quitter.displayName);
                w.balance = Math.max(0, w.balance - QUIT_PENALTY);
                await saveWallet(w);

                const pq = playerQuitPanel(quitter, session);
                await sock.sendMessage(chatId, { text: pq.text, mentions: pq.mentions, ...channelInfo });

                // Force-terminate if only 1 survivor left
                if (session.survivors.length === 1) {
                    const winner = session.survivors[0];
                    const losers = session.players.filter(p => p.jid !== winner.jid);
                    await sleep(2000);
                    await awardWinner(sock, session, channelInfo, winner, losers, true);
                }
                return;
            }

            return sock.sendMessage(chatId, { text: `❌ The game has already ended.`, ...channelInfo }, { quoted: message });
        },
    },

    {
        command: 'squidcancel',
        aliases: ['cancelsquid'],
        category: 'games',
        description: 'Cancel an active Squid Game session (host/admin only)',
        usage: `.squidcancel`,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const session = sessions.get(chatId);
            if (!session || session.status !== 'recruiting') {
                return sock.sendMessage(chatId, { text: `❌ No active session to cancel.`, ...channelInfo }, { quoted: message });
            }

            const isHost  = senderId === session.hostId;
            const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
            if (!isHost && !isOwner) return sock.sendMessage(chatId, { text: `❌ Only the host or admin can cancel.`, ...channelInfo }, { quoted: message });

            for (const p of session.players) {
                try {
                    const pw = await getWallet(p.jid, p.displayName);
                    pw.balance += ENTRY_FEE;
                    await saveWallet(pw);
                } catch { /* ignore */ }
            }
            for (const v of session.vips.values()) {
                try {
                    const vw = await getWallet(v.jid, v.displayName);
                    vw.balance += v.buyinAmount + (v.betAmount || 0);
                    await saveWallet(vw);
                } catch { /* ignore */ }
            }

            if (session.recruitTimer) clearTimeout(session.recruitTimer);
            if (session.eventHandler) sock.ev.off('messages.upsert', session.eventHandler);
            sessions.delete(chatId);

            await sock.sendMessage(chatId, {
                text: `❌ *Squid Game cancelled.* All *${session.players.length}* players refunded *${fmt(ENTRY_FEE)} 🪙* each. All VIP buy-ins and bets refunded.`,
                ...channelInfo
            }, { quoted: message });
        },
    },

    // ── .vote ────────────────────────────────────────────────────────────────────
    {
        command: 'vote',
        aliases: [],
        category: 'games',
        description: 'Vote to continue or end the Squid Game',
        usage: `.vote O | .vote X`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const session = sessions.get(chatId);
            if (!session || session.status !== 'playing') {
                return sock.sendMessage(chatId, { text: `❌ No active game in progress.`, ...channelInfo }, { quoted: message });
            }
            if (!session.voteActive) {
                return sock.sendMessage(chatId, { text: `⏳ _No vote is currently in progress._`, ...channelInfo }, { quoted: message });
            }
            const choice = args[0]?.toUpperCase();
            if (choice !== 'O' && choice !== 'X') {
                return sock.sendMessage(chatId, { text: `⚠️ Use *${prefix}vote O* to continue or *${prefix}vote X* to end.`, ...channelInfo }, { quoted: message });
            }
            // Actual vote is captured by conductVote listener — just confirm receipt
            await sock.sendMessage(chatId, { text: `✅ _Your vote (*${choice}*) has been received._`, ...channelInfo }, { quoted: message });
        },
    },

    // ── .buyvip ──────────────────────────────────────────────────────────────────
    {
        command: 'buyvip',
        aliases: ['vip', 'joinvip'],
        category: 'games',
        description: 'Buy VIP status for the active Squid Game (min 1B). Your buy-in boosts the prize pool.',
        usage: `.buyvip [amount]`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (!chatId.endsWith('@g.us')) {
                return sock.sendMessage(chatId, { text: `❌ Squid Game only works in groups.`, ...channelInfo }, { quoted: message });
            }
            const session = sessions.get(chatId);
            if (!session || session.status !== 'recruiting') {
                return sock.sendMessage(chatId, { text: `❌ No active recruitment session.`, ...channelInfo }, { quoted: message });
            }
            if (session.players.find(p => p.jid === senderId)) {
                return sock.sendMessage(chatId, { text: `❌ Players cannot also be VIPs.`, ...channelInfo }, { quoted: message });
            }
            if (session.vips.has(senderId)) {
                return sock.sendMessage(chatId, { text: `⚠️ You are already a VIP for this session.`, ...channelInfo }, { quoted: message });
            }

            const amount = parseInt(args[0] || '0');
            if (isNaN(amount) || amount < VIP_FEE) {
                return sock.sendMessage(chatId, {
                    text: `❌ Minimum VIP buy-in is *₩${fmt(VIP_FEE)} (1B)*. Usage: *${prefix}buyvip [amount]*`,
                    ...channelInfo
                }, { quoted: message });
            }

            const displayName = message.pushName || senderId.split('@')[0];
            const w = await getWallet(senderId, displayName);
            if (w.balance < amount) {
                return sock.sendMessage(chatId, { text: `❌ Insufficient balance. You have *${fmt(w.balance)} 🪙*.`, ...channelInfo }, { quoted: message });
            }

            w.balance -= amount;
            await saveWallet(w);
            session.prizePool += amount;
            session.vips.set(senderId, { jid: senderId, displayName, buyinAmount: amount });

            await sock.sendMessage(chatId, {
                text:
`🎩 *VIP STATUS GRANTED*
━━━━━━━━━━━━━━━━━━━━━━━━
*${displayName}* has joined as a VIP.
Buy-in: ₩${fmt(amount)} → added to prize pool.
Prize pool is now: ₩${fmt(session.prizePool)}
━━━━━━━━━━━━━━━━━━━━━━━━
Use *${prefix}squidbet @Player [amount]* to place your bet.`,
                ...channelInfo
            }, { quoted: message });
        },
    },

    // ── .bet ─────────────────────────────────────────────────────────────────────
    {
        command: 'bet',
        aliases: ['vipbet', 'squidbet'],
        category: 'games',
        description: 'As a VIP, bet on a Squid Game player to win (min 1B)',
        usage: `.bet @Player [amount]`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const session = sessions.get(chatId);
            if (!session || session.status !== 'recruiting') {
                return sock.sendMessage(chatId, { text: `❌ Bets can only be placed during the recruitment phase.`, ...channelInfo }, { quoted: message });
            }
            if (!session.vips.has(senderId)) {
                return sock.sendMessage(chatId, { text: `❌ Only VIPs can place bets. Use *${prefix}buyvip [amount]* first.`, ...channelInfo }, { quoted: message });
            }

            const mentions = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            let targetJid: string = mentions[0] || '';
            if (!targetJid) {
                return sock.sendMessage(chatId, { text: `❌ Tag a player: *${prefix}bet @Player [amount]*`, ...channelInfo }, { quoted: message });
            }
            if (targetJid.includes('@lid')) {
                try { targetJid = await resolveJid(sock, targetJid); } catch { /* ignore */ }
            }

            const targetPlayer = session.players.find(p => p.jid === targetJid);
            if (!targetPlayer) {
                return sock.sendMessage(chatId, { text: `❌ That player is not registered in this session.`, ...channelInfo }, { quoted: message });
            }

            const amountStr = args.find(a => /^\d+$/.test(a));
            const betAmount = parseInt(amountStr || '0');
            if (!betAmount || betAmount < VIP_BET_MIN) {
                return sock.sendMessage(chatId, { text: `❌ Minimum bet is *₩${fmt(VIP_BET_MIN)} (1B)*. Usage: *${prefix}bet @Player [amount]*`, ...channelInfo }, { quoted: message });
            }

            const vip = session.vips.get(senderId)!;
            if (vip.betAmount) {
                return sock.sendMessage(chatId, { text: `⚠️ You already placed a bet on *Player #${session.players.find(p => p.jid === vip.betPlayerJid)?.number || '???'}*. Only one bet per VIP.`, ...channelInfo }, { quoted: message });
            }

            const displayName = message.pushName || senderId.split('@')[0];
            const w = await getWallet(senderId, displayName);
            if (w.balance < betAmount) {
                return sock.sendMessage(chatId, { text: `❌ Insufficient balance. You have *${fmt(w.balance)} 🪙*.`, ...channelInfo }, { quoted: message });
            }

            w.balance -= betAmount;
            await saveWallet(w);
            vip.betPlayerJid = targetJid;
            vip.betAmount    = betAmount;
            session.vipBetPool += betAmount;

            await sock.sendMessage(chatId, {
                text:
`🎰 *BET PLACED*
━━━━━━━━━━━━━━━━━━━━━━━━
VIP: ${displayName}
Bet on: *Player #${targetPlayer.number}* (${targetPlayer.displayName})
Amount: ₩${fmt(betAmount)}
VIP Bet Pool: ₩${fmt(session.vipBetPool)}
━━━━━━━━━━━━━━━━━━━━━━━━
_If your player wins, you share the entire VIP bet pool proportionally._`,
                ...channelInfo
            }, { quoted: message });
        },
    },

    // ── .squidgamerules ──────────────────────────────────────────────────────────
    {
        command: 'squidgamerules',
        aliases: ['squidrules', 'sgrules'],
        category: 'games',
        description: 'Show all Squid Game rules, rounds, and how to play',
        usage: `.squidgamerules`,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const roundList = ORDERED_GAMES.map(([name], i) => `➤ ${i + 1}. ${name}`).join('\n');
            const text =
`╔═══════════════════════════════════════╗
║   _Ｓ Ｑ Ｕ Ｉ Ｄ  Ｇ Ａ Ｍ Ｅ Ｓ_    ║
╚═══════════════════════════════════════╝
_ＳＴＡＴＵＳ：_ Rules Guide
_ＥＬＩＭＩＮＡＴＩＯＮ：_ Random Each Round
_ＰＬＡＹＥＲＳ：_ Unlimited
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＰＬＡＹＥＲ  ＣＯＮＳＥＮＴ  ＦＯＲＭ_
➤ Clause 1: A player is not allowed to stop playing
➤ Clause 2: A player who refuses to play will be eliminated
➤ Clause 3: The games may be terminated if majority agrees
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＨＯＷ  ＴＯ  ＰＬＡＹ_
➤ Join with \`${prefix}joinsquidgames\` and accept Consent Form
➤ Survive 12 rounds. Outcomes are random each round
➤ After each round, vote to continue or end
➤ Per Clause 3: Majority \`X\` ends game and splits prize
➤ Last player standing takes entire prize pool
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＴＨＥ  １２  ＲＯＵＮＤＳ_
${roundList}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＶＯＴＩＮＧ  ＲＵＬＥＳ_
➤ \`.vote O\` = Continue to next round
➤ \`.vote X\` = End game and split prize now
➤ Majority decides. Tie = Continue
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＶＩＰ  ＲＵＬＥＳ_
➤ \`${prefix}buyvip\` = Buy VIP status. Cannot join as player
➤ \`${prefix}bet @Player [amount]\` = Bet on a player to win
➤ Min bet 1B. No max. Your bet adds to player prize pool
➤ Payout scales with your bet if your player wins
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＩＮＶＥＳＴＩＧＡＴＩＯＮ_
➤ Anyone can investigate the Squid Games
➤ Success = Earn money from findings
➤ Failure = Lose money to pay for losses
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＣＯＭＭＡＮＤＳ_
➤ \`${prefix}joinsquidgames\` — Join as player, agree to Consent Form
➤ \`${prefix}quitsquidgame\` — Quit the game anytime
➤ \`${prefix}vote O\` — Vote to continue
➤ \`${prefix}vote X\` — Vote to end and split
➤ \`${prefix}squidgame price\` — Check current prize pool
➤ \`${prefix}buyvip\` — Buy VIP status
➤ \`${prefix}bet @Player [amount]\` — Bet on a player. Min 1B
➤ \`${prefix}investigate\` — Investigate Squid Games. Win money if successful, lose money if failed
➤ \`${prefix}squidgamerules\` — Show this rules guide
═━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━═`;
            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        },
    },

    // ── .investigate ─────────────────────────────────────────────────────────────
    {
        command: 'investigate',
        aliases: ['squidinvestigate'],
        category: 'games',
        description: 'Investigate the Squid Games — win or lose money based on your findings',
        usage: `.investigate`,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;

            if (investigateCooldowns.has(senderId)) {
                const remaining = Math.ceil((investigateCooldowns.get(senderId)! - Date.now()) / 60000);
                return sock.sendMessage(chatId, {
                    text: `⏳ _You must wait *${remaining} min* before investigating again._`,
                    ...channelInfo
                }, { quoted: message });
            }

            const displayName = message.pushName || senderId.split('@')[0];
            const w = await getWallet(senderId, displayName);

            investigateCooldowns.set(senderId, Date.now() + 30 * 60 * 1000);
            setTimeout(() => investigateCooldowns.delete(senderId), 30 * 60 * 1000);

            const success = Math.random() < 0.45;
            const amount  = success
                ? Math.floor(Math.random() * 4500) + 500
                : Math.floor(Math.random() * 1500) + 200;

            const outcomes = success ? [
                'You slipped past a Triangle Guard and found a ledger of eliminated players. The information sold for',
                'You photographed a VIP mask and smuggled it out. A journalist paid you',
                'You bribed a Circle Guard and got intel on the next game. Your contact paid you',
                'You discovered a secret dormitory room with hidden cash.',
                'You overheard VIP conversations and sold the recordings for',
            ] : [
                'A Square Guard caught you snooping. You had to bribe your way out for',
                'Your cover was blown. You paid off a Front Man contact to stay quiet for',
                'You were spotted near the arena and fined for trespassing.',
                'Your informant was compromised. You lost funds covering their escape for',
                'A masked staff member found your recording device. Confiscated and fined',
            ];
            const narrative = outcomes[Math.floor(Math.random() * outcomes.length)];

            if (success) {
                w.balance += amount;
            } else {
                w.balance = Math.max(0, w.balance - amount);
            }
            await saveWallet(w);

            await sock.sendMessage(chatId, {
                text:
`╔═══════════════════════════════════════╗
║   _ＩＮＶＥＳＴＩＧＡＴＩＯＮ  ＲＥＰＯＲＴ_    ║
╚═══════════════════════════════════════╝
_ＡＧＥＮＴ：_ ${displayName}
_ＲＥＳＵＬＴ：_ ${success ? '✅ SUCCESS' : '❌ FAILED'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${narrative} *${fmt(amount)} 🪙*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_ＢＡＬＡＮＣＥ：_ ${fmt(w.balance)} 🪙
ℹ️ _Cooldown: 30 minutes_
═━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━═`,
                ...channelInfo
            }, { quoted: message });
        },
    },
];
