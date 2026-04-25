import type { BotContext } from '../types.js';
import { getWallet } from '../lib/turso.js';
import sharp from 'sharp';

const MAX_NAME_LEN = 20;

function fmtMoney(n: number): string {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getCardNumber(userId: string): string {
    const raw = userId.replace(/\D/g, '');
    const padded = (raw + '0000000000000000').slice(0, 16);
    return `${padded.slice(0, 4)} ${padded.slice(4, 8)} ${padded.slice(8, 12)} ${padded.slice(12, 16)}`;
}

function getExpiry(userId: string, level: number): string {
    const sum = userId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const month = String((sum % 12) + 1).padStart(2, '0');
    const year  = String(26 + (level % 9));
    return `${month}/${year}`;
}

function getCvv(userId: string): string {
    const n = userId.replace(/\D/g, '');
    return (parseInt(n.slice(-4) || '0') % 900 + 100).toString();
}

function escXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildCardSvg(
    holderName: string,
    cardNumber: string,
    expiry: string,
    cash: number,
    bank: number,
    level: number,
    xp: number,
): string {
    const name    = escXml(holderName.toUpperCase().slice(0, MAX_NAME_LEN));
    const cashStr = escXml('$' + fmtMoney(cash));
    const bankStr = escXml('$' + fmtMoney(bank));
    const lvlStr  = escXml(String(level));
    const xpStr   = escXml(xp.toLocaleString());
    const cnStr   = escXml(cardNumber);
    const exStr   = escXml(expiry);

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="860" height="540" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#0b0b1f"/>
      <stop offset="60%"  stop-color="#12002e"/>
      <stop offset="100%" stop-color="#1c0038"/>
    </linearGradient>
    <linearGradient id="chip" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#e2c04a"/>
      <stop offset="100%" stop-color="#a07a00"/>
    </linearGradient>
    <linearGradient id="stripH" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="#7b2fbe" stop-opacity="0"/>
      <stop offset="50%"  stop-color="#7b2fbe" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#7b2fbe" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="blob1" cx="80%" cy="15%" r="40%">
      <stop offset="0%"   stop-color="#7b2fbe" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#7b2fbe" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blob2" cx="10%" cy="85%" r="30%">
      <stop offset="0%"   stop-color="#e94560" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#e94560" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blob3" cx="95%" cy="70%" r="25%">
      <stop offset="0%"   stop-color="#1a66ff" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#1a66ff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="860" height="540" rx="30" fill="url(#bg)"/>

  <!-- Glow blobs -->
  <rect width="860" height="540" rx="30" fill="url(#blob1)"/>
  <rect width="860" height="540" rx="30" fill="url(#blob2)"/>
  <rect width="860" height="540" rx="30" fill="url(#blob3)"/>

  <!-- Horizontal shimmer strip -->
  <rect x="0" y="200" width="860" height="120" fill="url(#stripH)"/>

  <!-- Top-left: Bank name -->
  <text x="50" y="56" font-family="Arial Black, Arial, sans-serif" font-size="24" font-weight="900" fill="white" letter-spacing="3">COLLY MD BANK</text>
  <text x="50" y="76" font-family="Arial, sans-serif" font-size="11" fill="rgba(255,255,255,0.4)" letter-spacing="5">DIGITAL ECONOMY CARD</text>

  <!-- Contactless symbol top-right -->
  <text x="820" y="64" font-family="Arial, sans-serif" font-size="30" fill="rgba(255,255,255,0.2)" text-anchor="end">(((</text>

  <!-- EMV Chip -->
  <rect x="50" y="106" width="68" height="50" rx="7" fill="url(#chip)"/>
  <rect x="50" y="106" width="68" height="50" rx="7" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>
  <!-- chip inner lines -->
  <line x1="50" y1="120" x2="118" y2="120" stroke="rgba(0,0,0,0.22)" stroke-width="1.5"/>
  <line x1="50" y1="131" x2="118" y2="131" stroke="rgba(0,0,0,0.22)" stroke-width="1.5"/>
  <line x1="50" y1="142" x2="118" y2="142" stroke="rgba(0,0,0,0.22)" stroke-width="1.5"/>
  <line x1="75"  y1="106" x2="75"  y2="156" stroke="rgba(0,0,0,0.22)" stroke-width="1.5"/>
  <line x1="94"  y1="106" x2="94"  y2="156" stroke="rgba(0,0,0,0.22)" stroke-width="1.5"/>

  <!-- Cash balance -->
  <text x="140" y="120" font-family="Arial, sans-serif" font-size="10" fill="rgba(255,255,255,0.38)" letter-spacing="3">CASH</text>
  <text x="140" y="148" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="white">${cashStr}</text>

  <!-- Bank balance -->
  <text x="450" y="120" font-family="Arial, sans-serif" font-size="10" fill="rgba(255,255,255,0.38)" letter-spacing="3">BANK</text>
  <text x="450" y="148" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="#e6c87a">${bankStr}</text>

  <!-- Thin divider -->
  <line x1="50" y1="172" x2="810" y2="172" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>

  <!-- Card number -->
  <text x="50" y="250" font-family="Courier New, Courier, monospace" font-size="30" letter-spacing="8" fill="rgba(255,255,255,0.88)">${cnStr}</text>

  <!-- Thin divider -->
  <line x1="50" y1="278" x2="810" y2="278" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>

  <!-- Cardholder name -->
  <text x="50" y="322" font-family="Arial, sans-serif" font-size="10" fill="rgba(255,255,255,0.38)" letter-spacing="3">CARD HOLDER</text>
  <text x="50" y="354" font-family="Arial Black, Arial, sans-serif" font-size="20" font-weight="900" fill="white" letter-spacing="1">${name}</text>

  <!-- Valid thru -->
  <text x="390" y="322" font-family="Arial, sans-serif" font-size="10" fill="rgba(255,255,255,0.38)" letter-spacing="3">VALID THRU</text>
  <text x="390" y="354" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="white">${exStr}</text>

  <!-- Level -->
  <text x="530" y="322" font-family="Arial, sans-serif" font-size="10" fill="rgba(255,255,255,0.38)" letter-spacing="3">LEVEL</text>
  <text x="530" y="354" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#e94560">${lvlStr}</text>

  <!-- XP -->
  <text x="630" y="322" font-family="Arial, sans-serif" font-size="10" fill="rgba(255,255,255,0.38)" letter-spacing="3">XP</text>
  <text x="630" y="354" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#7bd6f2">${xpStr}</text>

  <!-- Divider -->
  <line x1="50" y1="378" x2="810" y2="378" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>

  <!-- Bottom label -->
  <text x="50" y="415" font-family="Arial, sans-serif" font-size="10" fill="rgba(255,255,255,0.2)" letter-spacing="1">FOR IN-BOT USE ONLY  •  NOT A REAL FINANCIAL INSTRUMENT</text>

  <!-- Network logo (Mastercard-style) bottom-right -->
  <circle cx="753" cy="450" r="30" fill="#EB001B" opacity="0.9"/>
  <circle cx="790" cy="450" r="30" fill="#F79E1B" opacity="0.9"/>
  <!-- overlap blend -->
  <ellipse cx="772" cy="450" rx="13" ry="30" fill="#FF5F00" opacity="0.6"/>
  <text x="772" y="445" font-family="Arial, sans-serif" font-size="8" font-weight="bold" fill="white" text-anchor="middle">COLLY</text>
  <text x="772" y="456" font-family="Arial, sans-serif" font-size="8" font-weight="bold" fill="white" text-anchor="middle">MD</text>

  <!-- DavidXTech signature -->
  <text x="50" y="518" font-family="Arial, sans-serif" font-size="10" fill="rgba(255,255,255,0.18)">&#128278; Colly novels  |  &#128104;&#8205;&#128187; DavidXTech</text>

  <!-- Card border -->
  <rect width="860" height="540" rx="30" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="2"/>

  <!-- Gloss sheen top -->
  <rect x="0" y="0" width="860" height="200" rx="30" fill="rgba(255,255,255,0.025)"/>
</svg>`;
}

export default [
    {
        command: 'bankcard',
        aliases: ['mycard', 'walletcard', 'cardgen'],
        category: 'economy',
        description: 'Generate your personal COLLY MD Bank card as an image',
        usage: '.bankcard',
        groupOnly: false,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;

            const wallet     = await getWallet(senderId, message.pushName || '');
            const holderName = wallet.name || message.pushName || senderId.split('@')[0];
            const cardNumber = getCardNumber(senderId);
            const expiry     = getExpiry(senderId, wallet.level);

            await sock.sendMessage(chatId, { react: { text: '💳', key: message.key } });

            let png: Buffer;
            try {
                const svg = buildCardSvg(holderName, cardNumber, expiry, wallet.balance, wallet.bank, wallet.level, wallet.xp);
                png = await (sharp as any)(Buffer.from(svg)).png().toBuffer();
            } catch (e: any) {
                return sock.sendMessage(chatId, { text: `❌ Could not generate card: ${e.message}`, ...channelInfo }, { quoted: message });
            }

            return sock.sendMessage(chatId, {
                image: png,
                caption:
`💳 *COLLY MD BANK CARD*
━━━━━━━━━━━━━━━━━━━━━━
Card No: \`${cardNumber}\`
Holder:  ${holderName}
Expiry:  ${expiry}  |  CVV: ${getCvv(senderId)}
Cash:    $${fmtMoney(wallet.balance)}
Bank:    $${fmtMoney(wallet.bank)}
Level:   ${wallet.level}  |  XP: ${wallet.xp.toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━
_🔖 Colly novels | 👨‍💻 DavidXTech_`,
                ...channelInfo
            }, { quoted: message });
        }
    }
];
