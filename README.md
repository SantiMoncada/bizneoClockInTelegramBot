# Bizneo Clock-In Telegram Bot (Rust)

Telegram bot to clock in to Bizneo from Telegram, written in Rust.

## Features

- Login by sending exported browser cookies (`.json`) to the bot
- Clock in immediately with `/clocknow`
- Schedule future clock-ins with `/clockin HH:MM` or `/clockin 5pm`
- List/cancel scheduled tasks with `/list` and `/cancel`
- Update location by sending Telegram location
- User data and scheduled tasks persisted to JSON files
- English + Spanish bot messages

## Requirements

- Rust (stable) with `cargo`
- Telegram bot token from [@BotFather](https://t.me/botfather)

## Configuration

Copy env template and edit:

```bash
cp .env.example .env
```

Variables:

- `TELEGRAM_BOT_TOKEN` (required)
- `NODE_ENV` (optional, default `development`)
- `PORT` (optional, default `3000`)
- `WEBHOOK_URL` (optional, currently informational)
- `DATA_DIR` (optional, default `.`)

## Run

```bash
cargo run
```

## Run With Docker

Build image:

```bash
docker build -t bizneo-clockin-bot .
```

Run container (persistent data in local `./data`):

```bash
mkdir -p data
docker run --rm \
  --name bizneo-clockin-bot \
  --env-file .env \
  -e DATA_DIR=/data \
  -v "$(pwd)/data:/data" \
  bizneo-clockin-bot
```

Or with Docker Compose:

```bash
mkdir -p data
docker compose up --build -d
```

## Data files

Saved under `DATA_DIR`:

- `userData.json`
- `scheduledTasks.json`

## Commands

- `/start`
- `/clocknow`
- `/clockin <time>`
- `/list`
- `/cancel <task-id|all>`
- `/data`
- `/location`
- `/settimezone <IANA timezone>`
