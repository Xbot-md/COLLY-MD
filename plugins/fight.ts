import type { BotContext } from '../types.js';
import { getWallet, saveWallet } from '../lib/turso.js';
import { resolveJid } from '../lib/lidUtils.js';
import config from '../config.js';

const prefix = config.prefixes[0];
const fmt = (n: number) => n.toLocaleString();
const cleanJid = (jid: string) => jid.split(':')[0].split('@')[0];
const rng = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ── In-memory cooldowns (keyed by userId) ─────────────────────────────────────
const fightCooldowns = new Map<string, number>();
const WIN_CD  = 15 * 60 * 1000;
const LOSS_CD = 30 * 60 * 1000;

// ── NPC pool ──────────────────────────────────────────────────────────────────
const NPCS = [
    { name: 'BadBoy',      handle: 'badboy',      tier: 1, winChance: 0.78, payMin: 200,  payMax: 350  },
    { name: 'City Punk',   handle: 'citypunk',    tier: 1, winChance: 0.78, payMin: 180,  payMax: 300  },
    { name: 'Runt',        handle: 'runt',        tier: 1, winChance: 0.82, payMin: 150,  payMax: 250  },
    { name: 'Iron Mike',   handle: 'ironmike',    tier: 2, winChance: 0.58, payMin: 400,  payMax: 650  },
    { name: 'El Toro',     handle: 'eltoro',      tier: 2, winChance: 0.55, payMin: 380,  payMax: 600  },
    { name: 'Night Hawk',  handle: 'nighthawk',   tier: 2, winChance: 0.55, payMin: 450,  payMax: 700  },
    { name: 'The Beast',   handle: 'thebeast',    tier: 3, winChance: 0.35, payMin: 800,  payMax: 1500 },
    { name: 'Crusher',     handle: 'crusher',     tier: 3, winChance: 0.35, payMin: 900,  payMax: 1400 },
    { name: 'Shadow King', handle: 'shadowking',  tier: 3, winChance: 0.30, payMin: 1200, payMax: 2000 },
    { name: 'The Butcher', handle: 'thebutcher',  tier: 4, winChance: 0.20, payMin: 2000, payMax: 5000 },
    { name: 'Zero',        handle: 'zero',        tier: 4, winChance: 0.18, payMin: 3000, payMax: 7000 },
    { name: 'Death Wish',  handle: 'deathwish',   tier: 4, winChance: 0.15, payMin: 3500, payMax: 8000 },
];

const WIN_NARRATIVES = [
    (npc: string) => `You fought aggressively, landing combo after combo! ${npc}'s out cold (0 energy, 0 health) — no chance of a comeback!`,
    (npc: string) => `Lightning reflexes. You read every swing from ${npc} and landed the perfect counter. They crumbled.`,
    (npc: string) => `You came in with a game plan. Wore ${npc} down round by round — by the end, they couldn't even stand.`,
    (npc: string) => `Body shots. Head shots. ${npc} never found their rhythm. You dominated from the first bell.`,
    (npc: string) => `${npc} threw everything they had but you slipped through every punch. A textbook dismantling.`,
];

const LOSS_NARRATIVES = [
    (npc: string) => `${npc} was operating on a different level. You landed solid shots but they just shrugged them off and came back harder.`,
    (npc: string) => `You started strong but ${npc} caught you with a vicious combo mid-round. Everything went dark after that.`,
    (npc: string) => `${npc} picked apart your defence like it was nothing. Couldn't land clean and the punishment kept coming.`,
    (npc: string) => `Overextended on a right hook. ${npc} countered perfectly. Textbook — but on the wrong end of it.`,
    (npc: string) => `${npc} was patient. Way too patient. When the opening came, they didn't miss.`,
];

const WIN_SIDE_EFFECTS  = ['Adrenaline Rush', 'Pumped Up', 'On a Roll', 'Battle Ready', 'None'];
const LOSS_SIDE_EFFECTS = ['Dazed', 'Bruised', 'Fatigued', 'Winded', 'Rattled'];

// ── Core fight logic ──────────────────────────────────────────────────────────
async function runFight(
    sock: any, message: any, chatId: string, channelInfo: any,
    senderId: string, senderName: string,
    npcName: string, npcHandle: string, winChance: number, payMin: number, payMax: number,
    w: any
) {
    const now = Date.now();

    // Weapon buffs
    let chance = winChance;
    let payoutMult = 1;
    let weaponNote = '';

    if (w.inventory.includes('m4a1')) {
        chance = 1; payoutMult = 3;
        w.inventory.splice(w.inventory.indexOf('m4a1'), 1);
        weaponNote = '\n╽ 🪖 *M4A1 equipped* — ultimate firepower engaged!';
    } else if (w.inventory.includes('combat_katana')) {
        chance = Math.min(1, chance + 0.55); payoutMult = 2;
        w.inventory.splice(w.inventory.indexOf('combat_katana'), 1);
        weaponNote = '\n╽ 🗡️ *Combat Katana* drawn — devastating blow incoming!';
    } else if (w.inventory.includes('taser_baton')) {
        chance = Math.min(1, chance + 0.40);
        w.inventory.splice(w.inventory.indexOf('taser_baton'), 1);
        weaponNote = '\n╽ ⚡ *Taser Baton* used — opponent stunned!';
    }

    const won = Math.random() < chance;

    // Generate stats
    const playerEnergy = won ? rng(40, 75)  : rng(5, 30);
    const playerHealth = won ? rng(80, 100) : rng(40, 72);
    const sideEffect   = won ? pick(WIN_SIDE_EFFECTS) : pick(LOSS_SIDE_EFFECTS);
    const narrative    = won ? pick(WIN_NARRATIVES)(npcName) : pick(LOSS_NARRATIVES)(npcName);

    let resultLine: string;
    let statLine: string;
    let cdMs: number;

    if (won) {
        const earned = Math.floor(rng(payMin, payMax) * payoutMult);
        w.balance += earned;
        w.xp      += 20;
        fightCooldowns.set(senderId, now + WIN_CD);
        cdMs = WIN_CD;
        resultLine = `╽ You won the match! You earned *${fmt(earned)} 🪙*`;
        statLine   = `╽ EARNED    :: +${fmt(earned)} 🪙\n╽ NEW BALANCE :: ${fmt(w.balance)} 🪙\n╽ COOLDOWN  :: 15 Minutes`;
    } else {
        const fine = Math.min(Math.floor(w.balance * 0.08), rng(100, 400));
        w.balance  = Math.max(0, w.balance - fine);
        fightCooldowns.set(senderId, now + LOSS_CD);
        cdMs = LOSS_CD;
        resultLine = `╽ You *lost* the match. Deducted *${fmt(fine)} 🪙*`;
        statLine   = `╽ LOST      :: -${fmt(fine)} 🪙\n╽ NEW BALANCE :: ${fmt(w.balance)} 🪙\n╽ COOLDOWN  :: 30 Minutes`;
    }

    await saveWallet(w);

    const panel =
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ 💪 *SHADOW BOXING MATCH* 💪
╽ You challenged @${npcHandle}/${npcName} to a shadow boxing match!${weaponNote}
╽
╽ *_YOUR STATUS_*
╽ @${cleanJid(senderId)}
╽ Energy: ${playerEnergy}/100
╽ Health: ${playerHealth}/100
╽ Side Effects: ${sideEffect}
╽
╽ *_MATCH SUMMARY_*
╽ ${narrative}
╽
╽ *_MATCH RESULT_*
${resultLine}
╽
╽ ───────────────────────────────
${statLine}
╽ ───────────────────────────────
╽ Note: → Can't consume items during match
╽ → Fight continues till energy/health runs out
╽ → Effects may impact performance
╽ → Use *${prefix}nextfight* to start next round
╽ → Use *${prefix}forfeit* to end match
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`;

    await sock.sendMessage(chatId, { text: panel, mentions: [senderId], ...channelInfo }, { quoted: message });
}

// ── Exports ───────────────────────────────────────────────────────────────────
export default [
    {
        command: 'fight',
        aliases: ['shadowbox', 'box', 'brawl', 'nextfight'],
        category: 'economy',
        description: 'Challenge an NPC or player to a shadow boxing match',
        usage: `.fight [npc_name | @user]`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const senderName = message.pushName || cleanJid(senderId);

            // Cooldown check
            const cd = fightCooldowns.get(senderId);
            if (cd && Date.now() < cd) {
                const rem = cd - Date.now();
                const m   = Math.ceil(rem / 60000);
                return sock.sendMessage(chatId, {
                    text: `🥊 You need to recover! Come back in *${m} minute${m !== 1 ? 's' : ''}*.`,
                    ...channelInfo
                }, { quoted: message });
            }

            const w = await getWallet(senderId, senderName);

            // Check for @mention → PvP
            let mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (mentionedJid?.includes('@lid')) mentionedJid = await resolveJid(sock, mentionedJid);

            if (mentionedJid && mentionedJid !== senderId) {
                // PvP fight
                const opponentW  = await getWallet(mentionedJid, cleanJid(mentionedJid));
                const opName     = opponentW.name || cleanJid(mentionedJid);
                const levelDiff  = opponentW.level - w.level;
                const winChancePvp = Math.min(0.85, Math.max(0.15, 0.50 - levelDiff * 0.05));
                const won = Math.random() < winChancePvp;
                const stake = Math.min(Math.floor(opponentW.balance * 0.10), 2000);
                const now = Date.now();

                if (won) {
                    w.balance         += stake;
                    opponentW.balance  = Math.max(0, opponentW.balance - stake);
                    fightCooldowns.set(senderId,   now + WIN_CD);
                    fightCooldowns.set(mentionedJid, now + LOSS_CD);
                    await Promise.all([saveWallet(w), saveWallet(opponentW)]);
                    return sock.sendMessage(chatId, {
                        text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ 💪 *PvP SHADOW BOXING* 💪
╽ @${cleanJid(senderId)} vs @${cleanJid(mentionedJid)}
╽
╽ *_RESULT_*
╽ @${cleanJid(senderId)} wins by ${pick(['unanimous decision', 'knockout', 'technical knockout', 'submission'])}!
╽
╽ ───────────────────────────────
╽ EARNED      :: +${fmt(stake)} 🪙
╽ NEW BALANCE :: ${fmt(w.balance)} 🪙
╽ COOLDOWN    :: 15 Minutes
╽ ───────────────────────────────
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                        mentions: [senderId, mentionedJid], ...channelInfo
                    }, { quoted: message });
                } else {
                    opponentW.balance += stake;
                    w.balance          = Math.max(0, w.balance - stake);
                    fightCooldowns.set(senderId,   now + LOSS_CD);
                    fightCooldowns.set(mentionedJid, now + WIN_CD);
                    await Promise.all([saveWallet(w), saveWallet(opponentW)]);
                    return sock.sendMessage(chatId, {
                        text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ 💪 *PvP SHADOW BOXING* 💪
╽ @${cleanJid(senderId)} vs @${cleanJid(mentionedJid)}
╽
╽ *_RESULT_*
╽ @${cleanJid(mentionedJid)} wins by ${pick(['unanimous decision', 'knockout', 'technical knockout', 'counter-punch'])}!
╽ @${cleanJid(senderId)} takes the L this time.
╽
╽ ───────────────────────────────
╽ LOST        :: -${fmt(stake)} 🪙
╽ NEW BALANCE :: ${fmt(w.balance)} 🪙
╽ COOLDOWN    :: 30 Minutes
╽ ───────────────────────────────
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                        mentions: [senderId, mentionedJid], ...channelInfo
                    }, { quoted: message });
                }
            }

            // NPC fight
            let npc = NPCS.find(n => args[0] && n.handle === args[0].toLowerCase().replace(/\s/g, ''));
            if (!npc) {
                // Auto-pick based on level
                const tierPool = w.level >= 15 ? NPCS.filter(n => n.tier >= 3)
                               : w.level >= 8  ? NPCS.filter(n => n.tier >= 2)
                               : NPCS.filter(n => n.tier <= 2);
                npc = pick(tierPool.length ? tierPool : NPCS);
            }

            await runFight(sock, message, chatId, channelInfo, senderId, senderName,
                npc.name, npc.handle, npc.winChance, npc.payMin, npc.payMax, w);
        },
    },

    {
        command: 'forfeit',
        aliases: ['giveup', 'retreat'],
        category: 'economy',
        description: 'Forfeit your current fight',
        usage: `.forfeit`,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const fine = Math.min(Math.floor(w.balance * 0.05), 200);
            w.balance = Math.max(0, w.balance - fine);
            fightCooldowns.set(senderId, Date.now() + WIN_CD);
            await saveWallet(w);
            await sock.sendMessage(chatId, {
                text:
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ 🏳️ *MATCH FORFEITED*
╽ ───────────────────────────────
╽ You threw in the towel and walked
╽ away. The crowd boos. Respect lost.
╽ ───────────────────────────────
╽ COWARDICE TAX :: -${fmt(fine)} 🪙
╽ NEW BALANCE   :: ${fmt(w.balance)} 🪙
╽ COOLDOWN      :: 15 Minutes
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`,
                ...channelInfo
            }, { quoted: message });
        },
    },

    {
        command: 'npclist',
        aliases: ['fighters', 'opponents'],
        category: 'economy',
        description: 'View all NPC fighters',
        usage: `.npclist`,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const tierLabels: Record<number, string> = { 1: '🟢 EASY', 2: '🟡 MEDIUM', 3: '🔴 HARD', 4: '☠️ LEGENDARY' };
            let text = `┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n╽ 🥊 *NPC FIGHTER ROSTER*\n╽ ───────────────────────────────\n`;
            let lastTier = 0;
            for (const npc of NPCS) {
                if (npc.tier !== lastTier) {
                    text += `╽\n╽ *${tierLabels[npc.tier]}*\n`;
                    lastTier = npc.tier;
                }
                text += `╽ • *${npc.name}* — ${fmt(npc.payMin)}–${fmt(npc.payMax)} 🪙 | Win: ${Math.round(npc.winChance * 100)}%\n`;
                text += `╽   _.fight ${npc.handle}_\n`;
            }
            text += `╽ ───────────────────────────────\n╽ Tag @user instead to fight PvP\n┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`;
            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
        },
    },
];
