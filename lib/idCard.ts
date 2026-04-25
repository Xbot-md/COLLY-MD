import sharp from 'sharp';

function esc(s: string): string {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max - 2) + '..' : s;
}

export function fmtDate(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function deterministicBarcode(idNumber: string): string {
    let lines = '';
    let x = 10;
    let seed = [...idNumber].reduce((a, c) => (((a << 5) - a) + c.charCodeAt(0)) >>> 0, 5381);
    const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };

    while (x < 882) {
        const w = (next() % 3) + 1;
        const h = 20 + (next() % 32);
        const op = ((next() % 50) + 25) / 100;
        lines += `<rect x="${x}" y="${502 - h}" width="${w}" height="${h}" fill="rgba(201,162,39,${op.toFixed(2)})"/>`;
        x += w + (next() % 4) + 2;
    }
    return lines;
}

export interface IdCardData {
    legalName: string;
    dob: string;
    nationality: string;
    idNumber: string;
    issueDate: number;
    expiryDate: number;
    citizenSince: number;
    status: string;
    maritalStatus: string;
    violations: number;
}

export async function buildIdCard(data: IdCardData, profilePicBuffer: Buffer | null): Promise<Buffer> {
    const isExpired = Date.now() > data.expiryDate;
    const expiresColor = isExpired ? '#ef4444' : '#4ade80';
    const violationsColor = data.violations === 0 ? '#4ade80' : data.violations >= 3 ? '#ef4444' : '#f59e0b';
    const expiryStr = isExpired ? 'EXPIRED' : fmtDate(data.expiryDate);

    const svg = `<svg width="900" height="540" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#080d1a"/>
      <stop offset="100%" stop-color="#0e1828"/>
    </linearGradient>
    <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.7" fill="rgba(201,162,39,0.08)"/>
    </pattern>
  </defs>

  <rect width="900" height="540" fill="url(#bg)"/>
  <rect width="900" height="540" fill="url(#dots)"/>

  <rect x="5" y="5" width="890" height="530" rx="14" fill="none" stroke="#c9a227" stroke-width="2.5"/>
  <rect x="9" y="9" width="882" height="522" rx="11" fill="none" stroke="rgba(201,162,39,0.15)" stroke-width="1"/>

  <rect x="5" y="5" width="890" height="78" rx="14" fill="#c9a227"/>
  <rect x="5" y="56" width="890" height="27" fill="#c9a227"/>

  <text x="450" y="34" font-family="Arial,Helvetica,sans-serif" font-size="19" font-weight="bold" fill="#080d1a" text-anchor="middle" letter-spacing="2">COLLY COURT OF JUSTICE</text>
  <text x="450" y="59" font-family="Arial,Helvetica,sans-serif" font-size="11" fill="#080d1a" text-anchor="middle" letter-spacing="4">OFFICIAL CITIZEN IDENTIFICATION CARD</text>

  <circle cx="138" cy="288" r="88" fill="#111c31"/>
  <circle cx="138" cy="288" r="88" fill="none" stroke="#c9a227" stroke-width="2.5"/>
  <text x="138" y="308" font-family="Arial,Helvetica,sans-serif" font-size="60" font-weight="bold" fill="rgba(201,162,39,0.22)" text-anchor="middle">${esc(data.legalName.charAt(0).toUpperCase())}</text>

  <rect x="78" y="394" width="120" height="24" rx="4" fill="rgba(201,162,39,0.12)" stroke="#c9a227" stroke-width="1"/>
  <text x="138" y="411" font-family="Arial,Helvetica,sans-serif" font-size="10" font-weight="bold" fill="#c9a227" text-anchor="middle" letter-spacing="1">${esc(truncate(data.status.toUpperCase(), 14))}</text>

  <line x1="255" y1="88" x2="255" y2="535" stroke="rgba(201,162,39,0.2)" stroke-width="1.5"/>

  <text x="275" y="112" font-family="Arial,Helvetica,sans-serif" font-size="9.5" fill="rgba(201,162,39,0.65)" letter-spacing="2.5">LEGAL NAME</text>
  <text x="275" y="136" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="bold" fill="#ffffff">${esc(truncate(data.legalName, 22))}</text>

  <text x="275" y="168" font-family="Arial,Helvetica,sans-serif" font-size="9.5" fill="rgba(201,162,39,0.65)" letter-spacing="2.5">DATE OF BIRTH</text>
  <text x="275" y="188" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="#e2e8f0">${esc(data.dob)}</text>

  <text x="555" y="168" font-family="Arial,Helvetica,sans-serif" font-size="9.5" fill="rgba(201,162,39,0.65)" letter-spacing="2.5">NATIONALITY</text>
  <text x="555" y="188" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="#e2e8f0">${esc(truncate(data.nationality || 'N/A', 18))}</text>

  <text x="275" y="218" font-family="Arial,Helvetica,sans-serif" font-size="9.5" fill="rgba(201,162,39,0.65)" letter-spacing="2.5">ID NUMBER</text>
  <text x="275" y="239" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="bold" fill="#c9a227" letter-spacing="1.5">${esc(data.idNumber)}</text>

  <text x="555" y="218" font-family="Arial,Helvetica,sans-serif" font-size="9.5" fill="rgba(201,162,39,0.65)" letter-spacing="2.5">STATUS</text>
  <text x="555" y="239" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="#e2e8f0">${esc(data.status)}</text>

  <text x="275" y="268" font-family="Arial,Helvetica,sans-serif" font-size="9.5" fill="rgba(201,162,39,0.65)" letter-spacing="2.5">MARITAL STATUS</text>
  <text x="275" y="287" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#e2e8f0">${esc(truncate(data.maritalStatus, 28))}</text>

  <text x="555" y="268" font-family="Arial,Helvetica,sans-serif" font-size="9.5" fill="rgba(201,162,39,0.65)" letter-spacing="2.5">VIOLATIONS</text>
  <text x="555" y="287" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="bold" fill="${violationsColor}">${data.violations}</text>

  <line x1="265" y1="305" x2="888" y2="305" stroke="rgba(201,162,39,0.18)" stroke-width="1.5"/>

  <text x="275" y="328" font-family="Arial,Helvetica,sans-serif" font-size="9.5" fill="rgba(201,162,39,0.65)" letter-spacing="2.5">CITIZEN SINCE</text>
  <text x="275" y="347" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#e2e8f0">${fmtDate(data.citizenSince)}</text>

  <text x="500" y="328" font-family="Arial,Helvetica,sans-serif" font-size="9.5" fill="rgba(201,162,39,0.65)" letter-spacing="2.5">DATE ISSUED</text>
  <text x="500" y="347" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#e2e8f0">${fmtDate(data.issueDate)}</text>

  <text x="712" y="328" font-family="Arial,Helvetica,sans-serif" font-size="9.5" fill="rgba(201,162,39,0.65)" letter-spacing="2.5">EXPIRES</text>
  <text x="712" y="347" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="${expiresColor}">${esc(expiryStr)}</text>

  <line x1="5" y1="367" x2="895" y2="367" stroke="rgba(201,162,39,0.15)" stroke-width="1"/>

  ${deterministicBarcode(data.idNumber)}

  <text x="450" y="528" font-family="Arial,Helvetica,sans-serif" font-size="8.5" fill="rgba(201,162,39,0.4)" text-anchor="middle" letter-spacing="2">COLLY NOVELS  •  DAVIDXTECH  •  UNAUTHORISED USE IS A VIOLATION OF SECTION 47</text>

  <text x="450" y="458" font-family="Arial,Helvetica,sans-serif" font-size="60" fill="rgba(201,162,39,0.025)" text-anchor="middle" font-weight="bold" transform="rotate(-12,450,458)">COLLY MD</text>
</svg>`;

    const baseBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    if (!profilePicBuffer) return baseBuffer;

    try {
        const maskSvg = Buffer.from(`<svg width="176" height="176"><circle cx="88" cy="88" r="88" fill="white"/></svg>`);
        const circularPhoto = await sharp(profilePicBuffer)
            .resize(176, 176, { fit: 'cover' })
            .composite([{ input: maskSvg, blend: 'dest-in' }])
            .png()
            .toBuffer();

        return await sharp(baseBuffer)
            .composite([{ input: circularPhoto, top: 200, left: 50 }])
            .png()
            .toBuffer();
    } catch {
        return baseBuffer;
    }
}
