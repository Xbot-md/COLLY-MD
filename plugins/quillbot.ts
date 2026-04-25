/**
 * COLLY MD — QuillBot Chatbot Mode
 * .quillbot              → guide + current status
 * .quillbot on           → ON for this chat only
 * .quillbot on all       → ON everywhere (groups + PMs)
 * .quillbot on pm        → ON for all private DMs only
 * .quillbot on groups    → ON for all groups only
 * .quillbot off          → OFF for this chat
 * .quillbot off all      → OFF everywhere
 * .quillbot reset        → clear conversation for this chat
 * .quillask <question>   → one-shot ask (no toggle needed)
 */

import type { BotContext } from '../types.js';
import {
    isQBEnabled, enableQB, disableQB, getQBStatus,
    qbChat, qbClearSession,
    type QBScope,
} from '../lib/quillbotService.js';

const FOOTER = '\n\n_🔖 Colly novels | 👨‍💻 DavidXTech_';

function statusEmoji(on: boolean) { return on ? '🟢 *ON*' : '🔴 *OFF*'; }

export default [

    // ── .quillbot ─────────────────────────────────────────────────────────────
    {
        command:     'quillbot',
        aliases:     ['qbot', 'quill', 'quillchat'],
        category:    'ai',
        description: 'Toggle QuillBot chatbot — replies to every message when ON (has live search)',
        usage:       '.quillbot [on|off] [all|pm|groups]',

        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo } = context;

            const sub1 = (args[0] || '').toLowerCase();
            const sub2 = (args[1] || '').toLowerCase();

            // ── No args → show guide + status ────────────────────────────────
            if (!sub1) {
                const s    = getQBStatus(chatId);
                const here = isQBEnabled(chatId);

                return sock.sendMessage(chatId, {
                    text: [
                        `🤖 *COLLY MD — QuillBot Chatbot*`,
                        ``,
                        `📍 *This chat :* ${statusEmoji(here)}`,
                        `👥 *All groups :* ${statusEmoji(s.allGroups)}`,
                        `💬 *All PMs    :* ${statusEmoji(s.allPMs)}`,
                        ``,
                        `*Commands:*`,
                        `• \`.quillbot on\` — ON for *this chat only*`,
                        `• \`.quillbot on all\` — ON for *every group & PM*`,
                        `• \`.quillbot on pm\` — ON for *all private DMs*`,
                        `• \`.quillbot on groups\` — ON for *all groups*`,
                        `• \`.quillbot off\` — OFF for this chat`,
                        `• \`.quillbot off all\` — OFF *everywhere*`,
                        `• \`.quillbot reset\` — clear this chat's conversation`,
                        `• \`.quillask <question>\` — one-shot reply (no toggle)`,
                        ``,
                        `_Powered by QuillBot AI with live web search._`,
                        FOOTER,
                    ].join('\n'),
                    ...channelInfo,
                }, { quoted: message });
            }

            // ── reset ─────────────────────────────────────────────────────────
            if (sub1 === 'reset') {
                qbClearSession(chatId);
                return sock.sendMessage(chatId, {
                    text: `🧹 *Conversation cleared.*\nStarting fresh!${FOOTER}`,
                    ...channelInfo,
                }, { quoted: message });
            }

            // ── on ────────────────────────────────────────────────────────────
            if (sub1 === 'on') {
                let scope: QBScope = 'here';
                let label = 'this chat';

                if      (sub2 === 'all')    { scope = 'all';    label = 'ALL groups and PMs'; }
                else if (sub2 === 'pm')     { scope = 'pm';     label = 'ALL private DMs'; }
                else if (sub2 === 'groups') { scope = 'groups'; label = 'ALL groups'; }

                enableQB(chatId, scope);

                return sock.sendMessage(chatId, {
                    text: `🟢 *QuillBot Chatbot is now ON* for *${label}*!\n\nJust type naturally — I'll reply to every message. Live search is active.\nUse \`.quillbot off${scope !== 'here' ? ' ' + sub2 : ''}\` to stop.${FOOTER}`,
                    ...channelInfo,
                }, { quoted: message });
            }

            // ── off ───────────────────────────────────────────────────────────
            if (sub1 === 'off') {
                let scope: QBScope = 'here';
                let label = 'this chat';

                if      (sub2 === 'all')    { scope = 'all';    label = 'everywhere'; }
                else if (sub2 === 'pm')     { scope = 'pm';     label = 'all private DMs'; }
                else if (sub2 === 'groups') { scope = 'groups'; label = 'all groups'; }

                disableQB(chatId, scope);

                return sock.sendMessage(chatId, {
                    text: `🔴 *QuillBot Chatbot is now OFF* for *${label}.*\nI'll only respond to commands now.${FOOTER}`,
                    ...channelInfo,
                }, { quoted: message });
            }

            // ── unknown ───────────────────────────────────────────────────────
            return sock.sendMessage(chatId, {
                text: `❌ Unknown option.\n\nUsage: \`.quillbot on | off | reset\`\nScope: add \`all\`, \`pm\`, or \`groups\` after on/off.\n\nType \`.quillbot\` to see the full guide.${FOOTER}`,
                ...channelInfo,
            }, { quoted: message });
        },
    },

    // ── .quillask <question> — one-shot ask ───────────────────────────────────
    {
        command:     'quillask',
        aliases:     ['qask', 'quillai', 'quillaim'],
        category:    'ai',
        description: 'Ask QuillBot AI a question with live search (one-shot, no toggle needed)',
        usage:       '.quillask <your question>',

        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo } = context;
            const question = args.join(' ').trim();

            if (!question) {
                return sock.sendMessage(chatId, {
                    text: `🤖 *QuillBot AI*\n\nUsage: \`.quillask <your question>\`\nExample: \`.quillask what's the latest news?\`\n\nFor full auto-reply mode: \`.quillbot on\`${FOOTER}`,
                    ...channelInfo,
                }, { quoted: message });
            }

            await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

            try {
                const reply = await qbChat(question, `oneshot:${chatId}`);
                return sock.sendMessage(chatId, {
                    text: reply + FOOTER,
                    ...channelInfo,
                }, { quoted: message });
            } catch (err: any) {
                console.error('[quillask] Error:', err.message);
                return sock.sendMessage(chatId, {
                    text: `❌ QuillBot is temporarily unavailable. Try again in a moment.${FOOTER}`,
                    ...channelInfo,
                }, { quoted: message });
            }
        },
    },
];
