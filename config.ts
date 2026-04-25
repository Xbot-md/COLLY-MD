import 'dotenv/config';

const _prefixes = process.env.PREFIXES ? process.env.PREFIXES.split(',') : ['.', '!', '/', '#'];

const config = {
    // Bot Identity
    botName:     process.env.BOT_NAME      || 'COLLY MD',
    botOwner:    process.env.BOT_OWNER     || 'Colly novels',
    ownerNumber: process.env.OWNER_NUMBER  || '2349133354644',
    ownerNumber2: process.env.OWNER_NUMBER2 || '61474858176',
    author:      process.env.AUTHOR        || 'DavidXTech',
    packname:    process.env.PACKNAME      || 'COLLY MD',
    description: process.env.DESCRIPTION  || 'High performance multi-device WhatsApp bot',
    version:     '6.0.0',

    // Bot Config
    prefixes:    _prefixes,
    prefix:      _prefixes[0],
    commandMode: process.env.COMMAND_MODE  || 'public',
    timeZone:    process.env.TIMEZONE      || 'Asia/Karachi',

    // Links
    channelLink:   process.env.CHANNEL_LINK   || 'https://whatsapp.com/channel/0029VbCGhUI7T8bP7vjhfq3t',
    groupLink:     process.env.GROUP_LINK     || 'https://chat.whatsapp.com/E6inrNqyGVN8b5KPcn9VXe?mode=gi_t',
    updateZipUrl:  process.env.UPDATE_URL     || 'https://github.com/DavidXTech/COLLY-MD/archive/refs/heads/main.zip',
    ytChannel:     process.env.YT_CHANNEL     || 'DavidXTech',

    // Social Links
    telegramLink:  process.env.TELEGRAM_LINK  || '',
    facebookLink:  process.env.FACEBOOK_LINK  || '',
    instagramLink: process.env.INSTAGRAM_LINK || '',
    youtubeLink:   process.env.YOUTUBE_LINK   || '',
    websiteLink:   process.env.WEBSITE_LINK   || '',

    // Session
    sessionId:     process.env.SESSION_ID      || '',
    pairingNumber: process.env.PAIRING_NUMBER  || '',

    // Performance
    port:                Number(process.env.PORT)                 || 5000,
    maxStoreMessages:    Number(process.env.MAX_STORE_MESSAGES)   || 20,
    tempCleanupInterval: Number(process.env.CLEANUP_INTERVAL)     || 1 * 60 * 60 * 1000,
    storeWriteInterval:  Number(process.env.STORE_WRITE_INTERVAL) || 10000,

    // API Keys
    giphyApiKey: process.env.GIPHY_API_KEY || 'qnl7ssQChTdPjsKta2Ax2LMaGXz303tq',
    removeBgKey: process.env.REMOVEBG_KEY  || '',

    // Warn system
    warnCount: 3,

    // External APIs
    APIs: {
        xteam:    'https://api.xteam.xyz',
        dzx:      'https://api.dhamzxploit.my.id',
        lol:      'https://api.lolhuman.xyz',
        violetics:'https://violetics.pw',
        neoxr:    'https://api.neoxr.my.id',
        zenzapis: 'https://zenzapis.xyz',
        akuari:   'https://api.akuari.my.id',
        akuari2:  'https://apimu.my.id',
        nrtm:     'https://fg-nrtm.ddns.net',
        fgmods:   'https://api-fgmods.ddns.net'
    },

    APIKeys: {
        'https://api.xteam.xyz':       'd90a9e986e18778b',
        'https://api.lolhuman.xyz':    '85faf717d0545d14074659ad',
        'https://api.neoxr.my.id':     process.env.NEOXR_KEY   || 'yourkey',
        'https://violetics.pw':        'beta',
        'https://zenzapis.xyz':        process.env.ZENZAPIS_KEY || 'yourkey',
        'https://api-fgmods.ddns.net': 'fg-dylux'
    }
};

export default config;
