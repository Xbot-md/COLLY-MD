export async function handlePromotionEvent(sock: any, groupId: any, participants: any, author: any) {
    try {
        if (!Array.isArray(participants) || participants.length === 0) return;

        const promotedUsernames = participants.map((jid: any) => {
            const s = typeof jid === 'string' ? jid : (jid.id || jid.toString());
            return `• @${s.split('@')[0]}`;
        });

        const mentionList = participants.map((jid: any) =>
            typeof jid === 'string' ? jid : (jid.id || jid.toString())
        );

        let promotedBy = 'System';
        if (author && author.length > 0) {
            const authorJid = typeof author === 'string' ? author : (author.id || author.toString());
            promotedBy = `@${authorJid.split('@')[0]}`;
            mentionList.push(authorJid);
        }

        await sock.sendMessage(groupId, {
            text:
                `👑 *GROUP PROMOTION*\n\n` +
                `👥 *Promoted:*\n${promotedUsernames.join('\n')}\n\n` +
                `🎖️ *By:* ${promotedBy}\n` +
                `📅 ${new Date().toLocaleString()}\n\n` +
                `_🔖 Colly novels | 👨‍💻 DavidXTech_`,
            mentions: mentionList
        });
    } catch (e: any) {
        console.error('[promote event]', e.message);
    }
}

export default { handlePromotionEvent };
