/**
 * COLLY MD — DuckDuckGo AI Agent Mode
 * .agentmode              → guide + current status
 * .agentmode on           → ON for this chat only
 * .agentmode on all       → ON everywhere (groups + PMs)
 * .agentmode on pm        → ON for all private DMs only
 * .agentmode on groups    → ON for all groups only
 * .agentmode off          → OFF for this chat
 * .agentmode off all      → OFF everywhere
 * .agentmode reset        → clear memory for this chat
 * .duckai <question>      → one-shot ask (no toggle needed)
 */

import type { BotContext } from '../types.js';
import {
    isAgentEnabled, enableAgent, disableAgent, getAgentStatus,
    clearSession, askDuckAI, cleanForWhatsApp,
    buildSystemPrompt, DDG_MODEL,
    type AgentScope,
} from '../lib/duckAgent.js';

const FOOTER = '\n\n_🔖 Colly novels | 👨‍💻 DavidXTech_';

function statusEmoji(on: boolean) { return on ? '🟢 *ON*' : '🔴 *OFF*'; }

export default [

    // ── .agentmode ────────────────────────────────────────────────────────────
    {
        command:     'agentmode',
        aliases:     ['agent', 'collychat', 'botchat'],
        category:    'ai',
        description: 'Toggle COLLY MD AI agent — responds to every message when ON',
        usage:       '.agentmode [on|off] [all|pm|groups]',

        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, isGroup } = context;

            const sub1 = (args[0] || '').toLowerCase(); // on | off | reset | (empty)
            const sub2 = (args[1] || '').toLowerCase(); // all | pm | groups | (empty)

            // ── No args → show guide + status ────────────────────────────────
            if (!sub1) {
                const s   = getAgentStatus(chatId);
                const here = isAgentEnabled(chatId);

                return sock.sendMessage(chatId, {
                    text: [
                        `🤖 *COLLY MD Agent Mode*`,
                        ``,
                        `📍 *This chat :* ${statusEmoji(here)}`,
                        `👥 *All groups :* ${statusEmoji(s.allGroups)}`,
                        `💬 *All PMs    :* ${statusEmoji(s.allPMs)}`,
                        ``,
                        `*Commands:*`,
                        `• \`.agentmode on\` — ON for *this chat only*`,
                        `• \`.agentmode on all\` — ON for *every group & PM*`,
                        `• \`.agentmode on pm\` — ON for *all private DMs*`,
                        `• \`.agentmode on groups\` — ON for *all groups*`,
                        `• \`.agentmode off\` — OFF for this chat`,
                        `• \`.agentmode off all\` — OFF *everywhere*`,
                        `• \`.agentmode reset\` — clear this chat's memory`,
                        `• \`.duckai <question>\` — one-shot AI reply (no toggle)`,
                        FOOTER,
                    ].join('\n'),
                    ...channelInfo,
                }, { quoted: message });
            }

            // ── reset ─────────────────────────────────────────────────────────
            if (sub1 === 'reset') {
                // Clear per-user key: groups use chatId:senderId, DMs use chatId
                const sessionKey = isGroup
                    ? `${chatId}:${context.senderId}`
                    : chatId;
                clearSession(sessionKey);
                return sock.sendMessage(chatId, {
                    text: `🧹 *Conversation memory cleared.*\nFresh start!${FOOTER}`,
                    ...channelInfo,
                }, { quoted: message });
            }

            // ── on ────────────────────────────────────────────────────────────
            if (sub1 === 'on') {
                let scope: AgentScope = 'here';
                let label = 'this chat';

                if (sub2 === 'all')    { scope = 'all';    label = 'ALL groups and PMs'; }
                else if (sub2 === 'pm')     { scope = 'pm';     label = 'ALL private DMs'; }
                else if (sub2 === 'groups') { scope = 'groups'; label = 'ALL groups'; }

                enableAgent(chatId, scope);

                return sock.sendMessage(chatId, {
                    text: `🟢 *COLLY MD Agent is now ON* for *${label}*!\n\nJust type naturally — no command prefix needed. I'll reply to every message.\nUse \`.agentmode off${scope !== 'here' ? ' ' + sub2 : ''}\` to stop.${FOOTER}`,
                    ...channelInfo,
                }, { quoted: message });
            }

            // ── off ───────────────────────────────────────────────────────────
            if (sub1 === 'off') {
                let scope: AgentScope = 'here';
                let label = 'this chat';

                if (sub2 === 'all')    { scope = 'all';    label = 'everywhere'; }
                else if (sub2 === 'pm')     { scope = 'pm';     label = 'all private DMs'; }
                else if (sub2 === 'groups') { scope = 'groups'; label = 'all groups'; }

                disableAgent(chatId, scope);

                return sock.sendMessage(chatId, {
                    text: `🔴 *COLLY MD Agent is now OFF* for *${label}.*\nI'll only respond to commands now.${FOOTER}`,
                    ...channelInfo,
                }, { quoted: message });
            }

            // ── unknown ───────────────────────────────────────────────────────
            return sock.sendMessage(chatId, {
                text: `❌ Unknown option.\n\nUsage: \`.agentmode on | off | reset\`\nScope: add \`all\`, \`pm\`, or \`groups\` after on/off.\n\nType \`.agentmode\` to see the full guide.${FOOTER}`,
                ...channelInfo,
            }, { quoted: message });
        },
    },

    // ── .duckai <question> — one-shot AI ask ──────────────────────────────────
    {
        command:     'duckai',
        aliases:     ['duckask', 'ai2', 'collyai'],
        category:    'ai',
        description: 'Ask COLLY MD AI a question (powered by DuckDuckGo, free)',
        usage:       '.duckai <your question>',

        async handler(sock: any, message: any, args: string[], context: BotContext) {
            const { chatId, channelInfo, senderId, senderIsOwnerOrSudo, isGroup } = context;
            const question = args.join(' ').trim();

            if (!question) {
                return sock.sendMessage(chatId, {
                    text: `🤖 *COLLY MD AI*\n\nUsage: \`.duckai <your question>\`\nExample: \`.duckai what is quantum physics?\`\n\nFor full auto-reply mode: \`.agentmode on\`${FOOTER}`,
                    ...channelInfo,
                }, { quoted: message });
            }

            await sock.sendMessage(chatId, { react: { text: '🤖', key: message.key } });

            try {
                const senderName   = message.pushName || senderId.split('@')[0];
                const senderNumber = senderId.replace(/[^0-9]/g, '');

                const prompt = buildSystemPrompt({
                    groupName:    null,
                    isGroup:      !!isGroup,
                    senderName,
                    senderNumber,
                    isOwner:      !!senderIsOwnerOrSudo,
                    isAdmin:      false,
                    spamCount:    0,
                    userMessage:  question,
                });

                const raw   = await askDuckAI(prompt, [], DDG_MODEL, question);
                const reply = cleanForWhatsApp(raw);

                return sock.sendMessage(chatId, { text: reply, ...channelInfo }, { quoted: message });

            } catch (err: any) {
                console.error('[duckai] Error:', err.message);
                return sock.sendMessage(chatId, {
                    text: `❌ AI is temporarily unavailable. Try again in a moment.${FOOTER}`,
                    ...channelInfo,
                }, { quoted: message });
            }
        },
    },
];
