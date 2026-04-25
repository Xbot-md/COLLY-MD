import type { BotContext } from '../types.js';

interface MomoInfo {
    name: string;
    countries: string[];
    ussd: Record<string, string>;
    shortcodes: Record<string, string>;
    features: string[];
    website: string;
    helpline: Record<string, string>;
}

const MOMO_DATA: Record<string, MomoInfo> = {
    mtn: {
        name: 'MTN Mobile Money (MoMo)',
        countries: ['Ghana 🇬🇭', 'Uganda 🇺🇬', 'Rwanda 🇷🇼', 'Cameroon 🇨🇲', 'Ivory Coast 🇨🇮',
                    'Zambia 🇿🇲', 'Benin 🇧🇯', 'South Africa 🇿🇦', 'Nigeria 🇳🇬', 'Congo 🇨🇬'],
        ussd: {
            'Ghana': '*170#',
            'Uganda': '*165#',
            'Rwanda': '*182#',
            'Cameroon': '*126#',
            'Nigeria': '*671#',
            'Zambia': '*303#'
        },
        shortcodes: {
            'Ghana': '1-300',
            'Uganda': '165',
            'Rwanda': '182'
        },
        features: [
            'Send & receive money',
            'Buy airtime & data',
            'Pay bills (electricity, water, TV)',
            'Bank transfers',
            'International transfers',
            'Merchant payments',
            'Savings & loans',
            'Insurance',
        ],
        website: 'mtn.com/momo',
        helpline: {
            'Ghana': '100',
            'Uganda': '100',
            'Rwanda': '100',
            'Nigeria': '180'
        }
    },
    airtel: {
        name: 'Airtel Money',
        countries: ['Kenya 🇰🇪', 'Tanzania 🇹🇿', 'Uganda 🇺🇬', 'Rwanda 🇷🇼', 'Zambia 🇿🇲',
                    'Malawi 🇲🇼', 'Madagascar 🇲🇬', 'Niger 🇳🇪', 'Congo DR 🇨🇩', 'Seychelles 🇸🇨'],
        ussd: {
            'Kenya': '*334#',
            'Tanzania': '*150*60#',
            'Uganda': '*185#',
            'Rwanda': '*171#',
            'Zambia': '*778#',
            'Malawi': '*121#'
        },
        shortcodes: {
            'Kenya': '334',
            'Tanzania': '150',
            'Uganda': '185'
        },
        features: [
            'Send & receive money',
            'Buy airtime & data',
            'Pay bills',
            'Bank to Airtel Money',
            'Airtel Money to bank',
            'International remittance',
            'Merchant payments',
        ],
        website: 'airtel.com/airtelmoney',
        helpline: {
            'Kenya': '100',
            'Tanzania': '100',
            'Uganda': '100'
        }
    },
    mpesa: {
        name: 'M-Pesa',
        countries: ['Kenya 🇰🇪', 'Tanzania 🇹🇿', 'Mozambique 🇲🇿', 'DRC 🇨🇩',
                    'Lesotho 🇱🇸', 'Ghana 🇬🇭', 'Egypt 🇪🇬', 'Ethiopia 🇪🇹'],
        ussd: {
            'Kenya': '*334# or *737#',
            'Tanzania': '*150*00#',
            'Mozambique': '*150*5#',
            'Ghana': '*500#',
            'Egypt': '*9#'
        },
        shortcodes: {
            'Kenya': '737 / 334',
            'Tanzania': '150'
        },
        features: [
            'Send money (Lipa na M-Pesa)',
            'Withdraw at agents',
            'Buy airtime',
            'Pay bills & merchants',
            'M-Shwari savings & loans',
            'KCB M-Pesa loans',
            'International transfers (WorldRemit, Western Union)',
            'Pay with QR code',
            'M-Pesa App',
        ],
        website: 'safaricom.co.ke/mpesa',
        helpline: {
            'Kenya': '234',
            'Tanzania': '100'
        }
    },
    orange: {
        name: 'Orange Money',
        countries: ['Senegal 🇸🇳', 'Mali 🇲🇱', 'Cameroon 🇨🇲', 'Ivory Coast 🇨🇮',
                    'Burkina Faso 🇧🇫', 'Guinea 🇬🇳', 'Madagascar 🇲🇬', 'Tunisia 🇹🇳'],
        ussd: {
            'Senegal': '#144#',
            'Mali': '#144#',
            'Cameroon': '#150#',
            'Ivory Coast': '#144#'
        },
        shortcodes: { 'Senegal': '144' },
        features: [
            'Send & receive money',
            'Buy airtime',
            'Pay bills',
            'Orange Bank transfers',
            'International transfers',
        ],
        website: 'orange.com/orangemoney',
        helpline: { 'Senegal': '888', 'Mali': '888' }
    },
    wave: {
        name: 'Wave Mobile Money',
        countries: ['Senegal 🇸🇳', 'Ivory Coast 🇨🇮', 'Mali 🇲🇱', 'Burkina Faso 🇧🇫',
                    'Guinea 🇬🇳', 'Uganda 🇺🇬', 'Gambia 🇬🇲'],
        ussd: {
            'Senegal': '*999#',
            'Ivory Coast': '*999#'
        },
        shortcodes: {},
        features: [
            'Zero fees on transfers (between Wave users)',
            'Send & receive money',
            'Pay merchants',
            'Buy airtime',
            'Cash in/out at agents',
            'Wave App (iOS & Android)',
        ],
        website: 'wave.com',
        helpline: { 'Senegal': '33 889 05 55' }
    }
};

export default {
    command: 'momo',
    aliases: ['mobilemoney', 'mpesa', 'airtelmoney', 'mtnmomo', 'wave'],
    category: 'info',
    description: 'Mobile Money info for African networks (MTN, Airtel, M-Pesa, Wave, Orange)',
    usage: '.momo mtn\n.momo mpesa\n.momo airtel',

    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo, userMessage } = context;

        // Detect from command used
        let query = args[0]?.toLowerCase() || '';
        if (userMessage.includes('mpesa')) query = 'mpesa';
        else if (userMessage.includes('airtelmoney')) query = 'airtel';
        else if (userMessage.includes('mtnmomo')) query = 'mtn';
        else if (userMessage.includes('wave')) query = 'wave';

        if (!query) {
            const list = Object.entries(MOMO_DATA).map(([k, v]) =>
                `• \`.momo ${k}\` — ${v.name}`
            ).join('\n');

            return await sock.sendMessage(chatId, {
                text: `📡 *Mobile Money Info*\n\n` +
                      `*Available networks:*\n${list}\n\n` +
                      `*Examples:*\n` +
                      `\`.momo mtn\`\n` +
                      `\`.momo mpesa\`\n` +
                      `\`.momo airtel\``,
                ...channelInfo
            }, { quoted: message });
        }

        // Fuzzy match
        const key = Object.keys(MOMO_DATA).find(k =>
            query.includes(k) || k.includes(query) ||
            MOMO_DATA[k].name.toLowerCase().includes(query)
        );

        if (!key) {
            return await sock.sendMessage(chatId, {
                text: `❌ Unknown network: *${query}*\n\nAvailable: ${Object.keys(MOMO_DATA).join(', ')}`,
                ...channelInfo
            }, { quoted: message });
        }

        const m = MOMO_DATA[key];
        const ussdList = Object.entries(m.ussd).map(([c, u]) => `• ${c}: \`${u}\``).join('\n');
        const helpList = Object.entries(m.helpline).map(([c, h]) => `• ${c}: ${h}`).join('\n');
        const featureList = m.features.map(f => `✅ ${f}`).join('\n');

        await sock.sendMessage(chatId, {
            text: `📡 *${m.name}*\n\n` +
                  `🌍 *Available in:*\n${m.countries.join(', ')}\n\n` +
                  `📲 *USSD Codes:*\n${ussdList}\n\n` +
                  `⚡ *Features:*\n${featureList}\n\n` +
                  (helpList ? `📞 *Helpline:*\n${helpList}\n\n` : '') +
                  `🌐 *Website:* ${m.website}`,
            ...channelInfo
        }, { quoted: message });
    }
};
