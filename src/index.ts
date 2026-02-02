import TelegramBot from 'node-telegram-bot-api';
import { config } from './config.js';
import { parsePhoenixToken } from './parse-phoenix-token-browser';
import { error } from 'console';
import { getCsrfTokes, parseJsonCookies } from './helperFunctions.js';
import { UserData } from './types.js';


interface UserStore {
  [chatId: number]: UserData;
}

const db: UserStore = {}

// Create bot instance
const bot = new TelegramBot(config.telegramBotToken, {
  polling: config.nodeEnv === 'development',
});

console.log(`Bot started in ${config.nodeEnv} mode`);

// Define bot commands
const botCommands = [
  { command: 'start', description: 'Start the bot and see welcome message' },
  { command: 'data', description: 'gets all user data' },
  { command: 'clockin', description: 'clocks in' },
];

// Set bot commands in Telegram
bot.setMyCommands(botCommands).catch(console.error);

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    'Welcome! 👋\n\nTo start you first need the Cookies in JSON format\ninstall this extention in chrome https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc\n\nThen you can send me file in telegram web https://web.telegram.org/'
  );
});

// Command: /clockin
bot.onText(/\/clockin/, async (msg, match) => {
  const chatId = msg.chat.id;

  const data = db[chatId]
  if (!data) {
    bot.sendMessage(chatId, "You have to log in /start");
    return
  }
  const { metaCsrf, inputCsrf } = await getCsrfTokes(data)

  try {
    const response = await fetch(`https://${data.cookies.domain}/chrono`, {
      method: 'POST',
      headers: {
        'Cookie': [
          '_hcmex_key=' + data.cookies.hcmex,
          'device_id=' + data.cookies.deviceId,
          'geo=' + data.cookies.geo,
        ].join('; '),
        'content-type': 'application/x-www-form-urlencoded',
        'x-csrf-token': metaCsrf ? metaCsrf : "",
        'hx-request': 'true',
        'hx-target': 'chronometer-wrapper',
        'hx-trigger': 'chrono-form-hub_chrono',
        'accept': '*/*',
        'origin': 'https://' + data.cookies.domain,
        'referer': 'https://' + data.cookies.domain + "/"
      },
      body: new URLSearchParams({
        '_csrf_token': inputCsrf ? inputCsrf : '',
        'location_id': '',
        'user_id': data.userId ? data.userId.toString() : '',
        'shift_id': ''
      })
    });

    bot.sendMessage(chatId, `Clocked in successfully`);

  } catch (error) {
    bot.sendMessage(chatId, `ERROR Clockin in ${error}`);
  }
});

bot.onText(/\/data/, (msg, match) => {
  const chatId = msg.chat.id;

  const data = db[chatId]

  if (!data) {
    bot.sendMessage(chatId, "there is no user data");
  }
  console.log(parsePhoenixToken(data.cookies.hcmex))
  bot.sendMessage(chatId, JSON.stringify(data));
});

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const document = msg.document;

  if (!document?.file_name?.endsWith('.json')) {
    bot.sendMessage(chatId, 'Please send a .json file');
    return;
  }

  if (document.file_size && document.file_size > 5 * 1024 * 1024) {
    bot.sendMessage(chatId, 'File too large. Max 5MB.');
    return;
  }

  try {
    // Download file
    const fileLink = await bot.getFileLink(document.file_id);
    const response = await fetch(fileLink);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const jsonData = await response.json();


    const parsedJSON = JSON.parse(JSON.stringify(jsonData))

    const cookies = parseJsonCookies((parsedJSON))

    const buf = Buffer.from(cookies.geo, 'base64')

    const geo = JSON.parse(buf.toString())

    const phoenix = parsePhoenixToken(cookies.hcmex)

    if (!phoenix?.user_id) {
      throw error("No user id")
    }

    const userData: UserData = {
      userId: phoenix.user_id,
      geo,
      cookies,
      fakeGeo: null

    }

    db[msg.chat.id] = userData

    const replymsg = `lat long ${geo.lat.toFixed(6)}, ${geo.long.toFixed(6)}\nhttps://www.google.com/search?q=${geo.lat.toFixed(6)}%2C+${geo.long.toFixed(6)}\n\ndomain ${cookies.domain}\nexpires on ${new Date(cookies.expires).toLocaleString(phoenix?.locale)}`

    bot.sendMessage(chatId, `✅ Parsed successfully!\n\n${replymsg}`, {
      parse_mode: 'Markdown'
    });

  } catch (error) {
    console.error('Error processing JSON:', error);
    bot.sendMessage(chatId, `❌ Error: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
  }
});


// Handle all text messages
bot.on('message', (msg) => {
  const chatId = msg.chat.id;

  // Skip if message is a command
  if (msg.text?.startsWith('/')) {
    return;
  }

  console.log(`Received message from ${msg.from?.username || 'unknown'}: ${msg.text}`);
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('Stopping bot...');
  bot.stopPolling();
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('Stopping bot...');
  bot.stopPolling();
  process.exit(0);
});


export default bot;
