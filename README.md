## to log install

https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc

Use this extension to download the cookies in JSON and send it to the bot


# Telegram Bot with TypeScript

A Telegram bot built with Node.js, TypeScript, and node-telegram-bot-api.

## Features

- ✅ TypeScript for type safety
- ✅ Environment variables configuration
- ✅ Separate development and production scripts
- ✅ Hot reload in development with tsx
- ✅ pnpm for fast package management

## Prerequisites

- Node.js (v18 or higher)
- pnpm (install with `npm install -g pnpm`)
- A Telegram Bot Token (get one from [@BotFather](https://t.me/botfather))

## Setup

1. **Clone or create the project**

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Configure environment variables**
   
   Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your bot token:
   ```env
   TELEGRAM_BOT_TOKEN=your_actual_bot_token_here
   NODE_ENV=development
   ```

## Development

Run the bot in development mode with hot reload:

```bash
pnpm dev
```

This uses `tsx watch` to automatically restart the bot when you make changes to the code.

## Production

### Build and run

```bash
pnpm prod
```

This command will:
1. Compile TypeScript to JavaScript (`pnpm build`)
2. Run the compiled code (`pnpm start`)

### Or run separately

Build the project:
```bash
pnpm build
```

Start the production server:
```bash
pnpm start
```

## Scripts

- `pnpm dev` - Start development server with hot reload
- `pnpm build` - Compile TypeScript to JavaScript
- `pnpm start` - Run the compiled production code
- `pnpm prod` - Build and run production
- `pnpm type-check` - Check TypeScript types without building

## Project Structure

```
telegram-bot-ts/
├── src/
│   ├── index.ts      # Main bot file
│   └── config.ts     # Environment configuration
├── dist/             # Compiled JavaScript (generated)
├── .env              # Environment variables (create this)
├── .env.example      # Environment variables template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Available Bot Commands

- `/start` - Start the bot and see welcome message
- `/help` - Show help message
- `/echo <text>` - Echo your message back

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token from BotFather | Yes |
| `NODE_ENV` | Environment (development/production) | No (default: development) |
| `PORT` | Server port for webhooks | No (default: 3000) |
| `WEBHOOK_URL` | Webhook URL for production | No |

## Notes

- In development mode, the bot uses polling to receive updates
- For production, you may want to configure webhooks (see environment variables)
- The bot automatically handles graceful shutdown on SIGINT/SIGTERM

## Getting a Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` command
3. Follow the instructions to create your bot
4. Copy the token and add it to your `.env` file

## License

ISC
