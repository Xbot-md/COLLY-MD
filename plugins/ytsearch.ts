import type { BotContext } from '../types.js';
import yts from 'yt-search';

export default {
  command: 'ytsearch',
  aliases: ['yts', 'playlist', 'playlista'],
  category: 'music',
  description: 'Search YouTube',
  usage: '.yts [query]',

  async handler(sock: any, message: any, args: any, context: BotContext) {
    const { chatId } = context;
    const query = args.join(' ');

    if (!query) {
      return sock.sendMessage(chatId, {
        text: `Example: *.yts* Lil Peep`
      }, { quoted: message });
    }

    try {
      await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

      const result = await yts(query);
      const videos = result.videos.slice(0, 10);

      if (videos.length === 0) {
        return sock.sendMessage(chatId, { text: '❌ No results found.' });
      }

      let searchText = `✨ *MUSIC SEARCH* ✨\n\n`;

      videos.forEach((v: any, index: any) => {
        searchText += `*${index + 1}.🎧 ${v.title}*\n`;
        searchText += `*⌚ Duration:* ${v.timestamp}\n`;
        searchText += `*👀 Views:* ${v.views}\n`;
        searchText += `*🔗 URL:* ${v.url}\n`;
        searchText += `──────────────────\n`;
      });

      await sock.sendMessage(chatId, {
        image: { url: videos[0].image },
        caption: searchText
      }, { quoted: message });

    } catch(error: any) {
      console.error('YouTube Search Error:', error);
      await sock.sendMessage(chatId, { text: '❌ Error searching YouTube.' });
    }
  }
};

