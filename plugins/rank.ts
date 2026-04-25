import type { BotContext } from '../types.js';
import store from '../lib/lightweight_store.js';
import { getRankCounts } from '../lib/turso.js';

/**
 * Increment message count for a user in a chat
 * Now uses the unified store system (backward compatible)
 */
async function incrementMessageCount(chatId: any, userId: any) {
    try {
        await store.incrementMessageCount(chatId, userId)
    } catch(error: any) {
        console.error('Error incrementing message count:', error)
    }
}

/**
 * Load all message counts (backward compatible)
 * Returns same format as old JSON file
 */
async function loadMessageCounts() {
    try {
        const data = await store.getAllMessageCounts()
        return data.messageCount || {}
    } catch(error: any) {
        console.error('Error loading message counts:', error)
        return {}
    }
}

/**
 * Save message counts (backward compatible, but now a no-op)
 * Data is auto-saved by the store system
 */
function saveMessageCounts(_messageCounts: any) {
    console.log('[RANK] saveMessageCounts called (no-op - auto-saved by store)')
}

async function buildRankText(
    sock: any,
    chatId: string,
    rawCounts: Record<string, number>,
    title: string
): Promise<{ text: string; mentions: string[] }> {
    let meta: any = null;
    const lidMap: Record<string, string> = {};
    try {
        meta = await sock.groupMetadata(chatId);
        for (const p of meta.participants) {
            if (p.lid) lidMap[p.lid] = p.id;
            if (p.id) lidMap[p.id] = p.id;
        }
    } catch {}

    const resolvedCounts: Record<string, number> = {};
    for (const [uid, count] of Object.entries(rawCounts)) {
        const resolved = lidMap[uid] || uid;
        resolvedCounts[resolved] = (resolvedCounts[resolved] || 0) + count;
    }

    const sorted = Object.entries(resolvedCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);

    if (sorted.length === 0) return { text: '📊 *No activity yet for this period!*', mentions: [] };

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    let text = `🏆 *${title}*\n\n`;
    for (let i = 0; i < sorted.length; i++) {
        const [userId, count] = sorted[i];
        const c = sock.store?.contacts?.[userId];
        const participant = meta?.participants?.find((p: any) => p.id === userId || p.lid === userId);
        const username = c?.name || c?.notify
            || participant?.notify || participant?.name
            || await sock.getName(userId)
            || (userId.includes('@s.whatsapp.net') ? '+' + userId.replace('@s.whatsapp.net', '') : 'Unknown');
        text += `${medals[i]} @${username}\n💬 ${count} messages\n\n`;
    }
    text += '_Keep chatting to climb the ranks!_';
    return { text, mentions: sorted.map(([uid]) => uid) };
}

export default {
    command: 'rank',
    aliases: ['top', 'topusers', 'leaderboard', 'ranks'],
    category: 'group',
    description: 'Show top 5 most active members. Use: .rank | .rank daily | .rank weekly',
    usage: '.rank [daily|weekly]',
    groupOnly: true,

    async handler(sock: any, message: any, args: any, context: BotContext) {
        const chatId = context.chatId || message.key.remoteJid;
        const sub = (args[0] || '').toLowerCase();

        try {
            let result: { text: string; mentions: string[] };

            if (sub === 'daily') {
                const counts = await getRankCounts(chatId, 'daily');
                result = await buildRankText(sock, chatId, counts, 'DAILY TOP MEMBERS');
            } else if (sub === 'weekly') {
                const counts = await getRankCounts(chatId, 'weekly');
                result = await buildRankText(sock, chatId, counts, 'WEEKLY TOP MEMBERS');
            } else {
                // All-time rank (original behaviour)
                const messageCounts = await loadMessageCounts();
                const groupCounts = messageCounts[chatId] || {};
                result = await buildRankText(sock, chatId, groupCounts, 'TOP MEMBERS LEADERBOARD');
            }

            await sock.sendMessage(chatId, { text: result.text, mentions: result.mentions }, { quoted: message });

        } catch (error: any) {
            console.error('Rank Command Error:', error);
            await sock.sendMessage(chatId, {
                text: '❌ Failed to load leaderboard. Please try again later.'
            }, { quoted: message });
        }
    },

    incrementMessageCount,
    loadMessageCounts,
    saveMessageCounts
}

/*
import fs from 'fs';
import path from 'path';
import { dataFile } from '../lib/paths.js';

const dataFilePath = dataFile('messageCount.json');

function loadMessageCounts() {
    if (fs.existsSync(dataFilePath)) {
        const data = fs.readFileSync(dataFilePath);
        return JSON.parse(data);
    }
    return {};
}

function saveMessageCounts(messageCounts) {
    fs.writeFileSync(dataFilePath, JSON.stringify(messageCounts, null, 2));
}

function incrementMessageCount(groupId, userId) {
    const messageCounts = loadMessageCounts();

    if (!messageCounts[groupId]) {
        messageCounts[groupId] = {};
    }

    if (!messageCounts[groupId][userId]) {
        messageCounts[groupId][userId] = 0;
    }

    messageCounts[groupId][userId] += 1;

    saveMessageCounts(messageCounts);
}

export default {
    command: 'rank',
    aliases: ['top', 'topusers', 'leaderboard', 'ranks'],
    category: 'group',
    description: 'Show top 5 most active members based on message count',
    usage: '.rank',
    groupOnly: true,

    async handler(sock: any, message: any, args: any, context: BotContext) {
        const chatId = context.chatId || message.key.remoteJid;

        const messageCounts = loadMessageCounts();
        const groupCounts = messageCounts[chatId] || {};

        const sortedMembers = Object.entries(groupCounts)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .slice(0, 5);

        if (sortedMembers.length === 0) {
            await sock.sendMessage(chatId, {
                text: '📊 *No message activity recorded yet*\n\nStart chatting to appear on the leaderboard!'
            }, { quoted: message });
            return;
        }

        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
        let messageText = '🏆 *TOP MEMBERS LEADERBOARD*\n\n';

        for (let index = 0; index < sortedMembers.length; index++) {
            const [userId, count] = sortedMembers[index];
            let username: string;
            if (userId.includes('@lid')) {
                const c = sock.store?.contacts?.[userId];
                username = c?.name || c?.notify || 'Unknown User';
            } else {
                username = await sock.getName(userId) || '+' + userId.replace('@s.whatsapp.net', '');
            }
            messageText += `${medals[index]} @${username}
💬 ${count} messages

`;
        }

        messageText += '_Keep chatting to climb the ranks!_';

        await sock.sendMessage(chatId, {
            text: messageText,
            mentions: sortedMembers.map(([userId]) => userId)
        }, { quoted: message });
    },

    incrementMessageCount,
    loadMessageCounts,
    saveMessageCounts
};
*/

