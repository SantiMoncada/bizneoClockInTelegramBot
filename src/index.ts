import TelegramBot from 'node-telegram-bot-api';
import { config } from './config.js';
import { parsePhoenixToken } from './parse-phoenix-token-browser';
import { JSDOM } from 'jsdom';
import { error } from 'console';

interface UserData {
  userId: number,
  geo: {
    lat: number,
    long: number,
    accuracy: number
  };
  cookies: {
    geo: string;
    hcmex: string;
    deviceId: string;
    domain: string;
    expires: number;
  }
  fakeGeo: number | null
}

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
  { command: 'help', description: 'Get help information' },
  { command: 'data', description: 'gets all user data' },
  { command: 'csrf', description: 'gets the csrf tokens from the web' },
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

// Command: /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    'Available commands:\n\n/start - Start the bot\n/help - Show this help message\n/echo <text> - Echo your message back'
  );
});

// Command: /echo
bot.onText(/\/echo (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const text = match?.[1];

  if (text) {
    bot.sendMessage(chatId, text);
  }
});

async function getCsrfTokes(data: UserData) {
  const MINIMAL_REQUEST = {
    // Only these 3 cookies are actually needed
    headers: {
      'Cookie': [
        '_hcmex_key=' + data.cookies.hcmex,
        'device_id=' + data.cookies.deviceId,
        'geo=' + data.cookies.geo
      ].join('; ')
    }
  };

  const response = await fetch(`https://${data.cookies.domain}/`, MINIMAL_REQUEST);
  const text = await response.text();
  const dom = new JSDOM(text)
  const document = dom.window.document
  const metaCsrf = document.querySelector('meta[name="csrf"]')?.getAttribute('content') || null;

  const chronoResponse = await fetch(`https://${data.cookies.domain}/chrono/${data.userId}/hub_chrono`, MINIMAL_REQUEST);
  const chronoText = await chronoResponse.text();
  const chronoDom = new JSDOM(chronoText)
  const chronoDocument = chronoDom.window.document;
  const inputCsrf = chronoDocument.querySelector('input[name="_csrf_token"]')?.getAttribute("value") || null;

  return { metaCsrf, inputCsrf }
}

bot.onText(/\/csrf/, async (msg, match) => {
  const chatId = msg.chat.id;

  const data = db[chatId]
  if (!data) {
    bot.sendMessage(chatId, "You have to log in /start");
    return
  }


  const { metaCsrf, inputCsrf } = await getCsrfTokes(data)

  bot.sendMessage(chatId, `csrf in header\n${metaCsrf}\n\ncsrf in input\n${inputCsrf}`);
});

bot.onText(/\/clockin/, async (msg, match) => {
  const chatId = msg.chat.id;

  const data = db[chatId]
  if (!data) {
    bot.sendMessage(chatId, "You have to log in /start");
    return
  }


  const { metaCsrf, inputCsrf } = await getCsrfTokes(data)

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

  // console.log('\n--- RESPONSE ---');
  // console.log('Status:', response.status, response.statusText);
  // console.log('Headers:', Object.fromEntries(response.headers.entries()));

  // const body = await response.text();
  // console.log('\n--- RESPONSE BODY ---');
  // console.log('Length:', body.length);
  // console.log('First 1000 chars:\n', body.slice(0, 1000));
  // console.log('Contains "error":', body.toLowerCase().includes('error'));
  // console.log('Contains "success":', body.toLowerCase().includes('success'));
  // console.log('Contains "csrf":', body.toLowerCase().includes('csrf'));


  bot.sendMessage(chatId, `csrf in header\n${metaCsrf}\n\ncsrf in input\n${inputCsrf}`);
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
// Handle JSON file uploads
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

function parseJsonCookies(json: any) {
  const output = {
    geo: "",
    hcmex: "",
    deviceId: "",
    domain: "",
    expires: 0
  }

  for (const item of json) {
    switch (item.name) {
      case "geo":
        output.geo = item.value
        break;
      case "_hcmex_key":
        output.hcmex = item.value
        output.domain = item.domain
        output.expires = parseFloat(item.expirationDate) * 1000
        break;
      case "device_id":
        output.deviceId = item.value
        break;
    }
  }
  return output
}

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
