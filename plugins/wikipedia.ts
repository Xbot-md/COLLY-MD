import type { BotContext } from '../types.js';
import axios from 'axios';
import { channelInfo } from '../lib/messageConfig.js';

export default {
  command: 'wiki',
  aliases: ['wikipedia', 'wikisearch'],
  category: 'search',
  description: 'Search Wikipedia — returns summary and image',
  usage: '.wiki <query>',

  async handler(sock: any, message: any, args: any, context: BotContext) {
    const chatId = context.chatId || message.key.remoteJid;
    const query = args.join(' ').trim();

    if (!query) {
      return sock.sendMessage(chatId, {
        text: `╭───❰ *📖 WIKIPEDIA* ❱───╮\n\n❌ *Please provide a search term!*\n\n📌 *Usage:* .wiki <topic>\n📌 *Example:* .wiki Elon Musk\n\n╰────────────────────────────╯`,
        ...channelInfo
      }, { quoted: message });
    }

    try {
      await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

      // Step 1: Use OpenSearch to find the best matching page title
      const searchRes = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'opensearch',
          search: query,
          limit: 1,
          namespace: 0,
          format: 'json',
          redirects: 'resolve'
        },
        headers: { 'User-Agent': 'CollyMD-Bot/6.0 (WhatsApp Automation Bot)' },
        timeout: 10000
      });

      const titles: string[] = searchRes.data[1] || [];
      if (!titles.length) {
        return sock.sendMessage(chatId, {
          text: `╭───❰ *📖 WIKIPEDIA* ❱───╮\n\n🔍 *Search:* ${query}\n\n❌ *No Wikipedia article found for that topic.*\nTry a different search term.\n\n╰────────────────────────────╯`,
          ...channelInfo
        }, { quoted: message });
      }

      const pageTitle = titles[0];

      // Step 2: Fetch full summary + thumbnail from REST API
      const summaryRes = await axios.get(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`,
        {
          headers: {
            'User-Agent': 'CollyMD-Bot/6.0 (WhatsApp Automation Bot)',
            'Accept': 'application/json'
          },
          timeout: 10000
        }
      );

      const data = summaryRes.data;
      const title: string = data.title || pageTitle;
      const extract: string = data.extract || 'No description available.';
      const pageUrl: string = data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`;
      const thumbnailUrl: string | null = data.thumbnail?.source || data.originalimage?.source || null;

      // Trim extract to ~800 chars for WhatsApp readability
      const trimmed = extract.length > 800 ? extract.slice(0, 800).trimEnd() + '...' : extract;

      const caption =
`╭───❰ *📖 WIKIPEDIA* ❱───╮

📌 *${title}*

${trimmed}

🔗 *Read more:*
${pageUrl}

╰────────────────────────────╯`;

      if (thumbnailUrl) {
        // Send with image thumbnail scraped directly from Wikipedia
        await sock.sendMessage(chatId, {
          image: { url: thumbnailUrl },
          caption,
          ...channelInfo
        }, { quoted: message });
      } else {
        await sock.sendMessage(chatId, {
          text: caption,
          ...channelInfo
        }, { quoted: message });
      }

    } catch (e: any) {
      console.error('Wikipedia plugin error:', e.message || e);
      await sock.sendMessage(chatId, {
        text: `╭───❰ *📖 WIKIPEDIA* ❱───╮\n\n❌ *Failed to fetch Wikipedia article.*\nTry again or check your spelling.\n\n╰────────────────────────────╯`,
        ...channelInfo
      }, { quoted: message });
    }
  }
};
