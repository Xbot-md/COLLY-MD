# COLLY MD

> High performance multi-device WhatsApp bot

**COLLY MD** is a powerful WhatsApp automation bot with 250+ commands, built on TypeScript and the Baileys library. Designed for speed, reliability, and flexibility.

---

## Credits

- **Owner:** Colly novels
- **Created by:** DavidXTech
- **Owner Numbers:** 2349133354644 | 61474858176

---

## Features

- 250+ commands across multiple categories
- Multi-device WhatsApp support
- Group management tools
- AI chat integration (GPT, Llama, Mistral)
- Media downloading (YouTube, Instagram, Facebook, TikTok, Spotify)
- Anti-spam, anti-link, anti-badword protection
- Auto-reply and chatbot mode
- Ghost/stealth mode (hides online status and read receipts)
- Sticker maker
- Modular plugin system — drop `.ts` files into `plugins/` to add commands

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file:

```env
BOT_NAME=COLLY MD
BOT_OWNER=Colly novels
OWNER_NUMBER=2349133354644
OWNER_NUMBER2=61474858176
SESSION_ID=your_session_id
```

### 3. Build and run

```bash
npm run build
npm start
```

---

## Project Structure

```
.
├── config.ts          # Bot configuration
├── index.ts           # Entry point
├── lib/               # Core utilities and handlers
├── plugins/           # Command plugins (auto-loaded)
├── assets/            # Media assets
└── data/              # Local JSON storage
```

---

## Commands

Use `.menu` or `.list` in WhatsApp to see all available commands.

Default prefixes: `.` `!` `/` `#`

---

## Deployment

Supports deployment to:
- Replit
- Heroku
- Railway
- Render
- Fly.io
- Koyeb

---

© 2026 Colly novels. Created by DavidXTech. All rights reserved.
