import config from '../config.js';

const BOT = () => config.botName || 'COLLY MD';
const OWNER = () => config.botOwner || 'Colly novels';
const DEV = () => config.author || 'DavidXTech';

function collyHeader(title: string): string {
    return `╭──── 「 *${BOT()}* 」 ────\n│\n│  ${title}\n│`;
}

function collyFooter(): string {
    return `│\n╰──────────────────────\n🔖 *${OWNER()}* | 👨‍💻 *${DEV()}*`;
}

function collySignature(): string {
    return `\n\n🔖 *${OWNER()}* | 👨‍💻 *${DEV()}*`;
}

function collyBox(title: string, lines: string[]): string {
    const body = lines.map(l => `│  ${l}`).join('\n');
    return `╭──── 「 *${BOT()}* 」 ────\n│\n${body}\n│\n╰──────────────────────\n🔖 *${OWNER()}* | 👨‍💻 *${DEV()}*`;
}

function collySection(title: string, content: string): string {
    return `*╔══ ${title.toUpperCase()} ══╗*\n\n${content}\n\n🔖 *${OWNER()}* | 👨‍💻 *${DEV()}*`;
}

export {
    collyHeader,
    collyFooter,
    collySignature,
    collyBox,
    collySection,
    BOT,
    OWNER,
    DEV
};
