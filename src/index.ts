import TelegramBot from 'node-telegram-bot-api';
import { config } from './config.js';
import { parsePhoenixToken } from './parse-phoenix-token-browser';
import { error } from 'console';
import { getCsrfTokes, parseJsonCookies } from './helperFunctions.js';
import { UserData } from './types.js';
import { Database } from './database.js';
import { SchedulerStore } from './schedulerStore.js';

const db = new Database()
const scheduler = new SchedulerStore()

let isRunningSchedule = false;

function parseClockTime(input: string): { hours: number; minutes: number } | null {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, '');
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(trimmed);
  if (!match) return null;

  const rawHours = Number(match[1]);
  const rawMinutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3] ?? null;

  if (Number.isNaN(rawHours) || Number.isNaN(rawMinutes)) return null;
  if (rawMinutes < 0 || rawMinutes > 59) return null;

  if (meridiem) {
    if (rawHours < 1 || rawHours > 12) return null;
    const baseHours = rawHours % 12;
    const hours = meridiem === 'pm' ? baseHours + 12 : baseHours;
    return { hours, minutes: rawMinutes };
  }

  if (rawHours < 0 || rawHours > 23) return null;
  return { hours: rawHours, minutes: rawMinutes };
}

function nextOccurrence(hours: number, minutes: number, now = new Date()): Date {
  const scheduled = new Date(now);
  scheduled.setHours(hours, minutes, 0, 0);
  if (scheduled.getTime() <= now.getTime()) {
    scheduled.setDate(scheduled.getDate() + 1);
  }
  return scheduled;
}

function formatScheduleTime(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function performClockIn(chatId: number, data: UserData, scheduledAt?: Date) {
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

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  if (scheduledAt) {
    bot.sendMessage(chatId, `✅ Clocked in (scheduled) 🎯\nTime: ${formatScheduleTime(new Date())}`);
  } else {
    bot.sendMessage(chatId, `Clocked in successfully ✅`);
  }
}

async function runScheduledTasks() {
  if (isRunningSchedule) return;
  isRunningSchedule = true;
  try {
    const now = new Date();
    const pending = scheduler.getPending(now).filter((task) => task.scheduledTime.getTime() <= now.getTime());
    for (const task of pending) {
      const data = db.getUser(task.userId);
      if (!data) {
        scheduler.markExecuted(task.id, "User not found");
        continue;
      }
      try {
        await performClockIn(task.userId, data, task.scheduledTime);
        scheduler.markExecuted(task.id);
      } catch (error) {
        scheduler.markExecuted(task.id, error instanceof Error ? error.message : String(error));
        bot.sendMessage(task.userId, `❌ Scheduled clock-in failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    isRunningSchedule = false;
  }
}

// Create bot instance
const bot = new TelegramBot(config.telegramBotToken, {
  polling: config.nodeEnv === 'development',
});

console.log(`Bot started in ${config.nodeEnv} mode`);

// Define bot commands
const botCommands = [
  { command: 'start', description: 'Get setup instructions and login steps' },
  { command: 'data', description: 'Show your saved account info' },
  { command: 'clocknow', description: 'Clock in right now' },
  { command: 'clockin', description: 'Schedule a future clock-in time' },
  { command: 'list', description: 'List your scheduled clock-ins' },
  { command: 'cancel', description: 'Cancel a scheduled clock-in' },
  { command: 'location', description: 'Show your saved location link' },
];

// Set bot commands in Telegram
bot.setMyCommands(botCommands).catch(console.error);

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    'Welcome! 👋\n\nHere is how to get started:\n1) Install the Chrome extension: https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc\n2) Export your cookies as a JSON file\n3) Send the JSON file to me using Telegram Web: https://web.telegram.org/\n\nAfter you are logged in, you can update your location anytime by sending a location from the Telegram location picker 📍'
  );
});

bot.onText(/\/clocknow/, async (msg, match) => {
  const chatId = msg.chat.id;

  const data = db.getUser(chatId)
  if (!data) {
    bot.sendMessage(chatId, "You have to log in /start");
    return
  }
  try {
    await performClockIn(chatId, data);
  } catch (error) {
    bot.sendMessage(chatId, `ERROR Clockin in ${error}`);
  }
});

bot.onText(/\/clockin(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const rawInput = match?.[1]?.trim();

  if (!rawInput) {
    bot.sendMessage(chatId, "Usage: /clockin 14:00 or /clockin 5pm or /clockin 5:20pm ⏰");
    return;
  }

  const data = db.getUser(chatId)
  if (!data) {
    bot.sendMessage(chatId, "You have to log in /start 🔐");
    return;
  }

  const parsed = parseClockTime(rawInput);
  if (!parsed) {
    bot.sendMessage(chatId, "Invalid time format 😅 Try /clockin 14:00, /clockin 5pm, or /clockin 5:20pm");
    return;
  }

  const scheduledTime = nextOccurrence(parsed.hours, parsed.minutes);
  const task = scheduler.add(chatId, scheduledTime);

  bot.sendMessage(
    chatId,
    `✅ Scheduled clock-in 🎉\nTime: ${formatScheduleTime(scheduledTime)}\nTask ID: ${task.id}`
  );
});

bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const tasks = scheduler.getByUser(chatId);

  if (tasks.length === 0) {
    bot.sendMessage(chatId, "No scheduled clock-ins yet 💤");
    return;
  }

  const lines = tasks.map((task) => {
    const statusEmoji = task.status === 'pending' ? '⏳' : task.status === 'executed' ? '✅' : '❌';
    return `${statusEmoji} ${task.id} — ${formatScheduleTime(task.scheduledTime)} (${task.status})`;
  });

  bot.sendMessage(chatId, `Here are your scheduled clock-ins 📋\n\n${lines.join('\n')}`);
});

bot.onText(/\/cancel(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const rawArg = match?.[1]?.trim();

  if (!rawArg) {
    bot.sendMessage(chatId, "Usage: /cancel <task-id> or /cancel all 🧹");
    return;
  }

  const tasks = scheduler.getByUser(chatId);
  if (rawArg.toLowerCase() === 'all') {
    const pending = tasks.filter((task) => task.status === 'pending');
    if (pending.length === 0) {
      bot.sendMessage(chatId, "No pending tasks to cancel 💤");
      return;
    }
    for (const task of pending) {
      scheduler.cancel(task.id);
    }
    bot.sendMessage(chatId, `Cancelled ${pending.length} task(s) ✅🧹`);
    return;
  }

  const id = rawArg;
  const belongsToUser = tasks.some((task) => task.id === id);
  if (!belongsToUser) {
    bot.sendMessage(chatId, "I can't find that task id for you 🤔");
    return;
  }

  const cancelled = scheduler.cancel(id);
  if (cancelled) {
    bot.sendMessage(chatId, `Cancelled ✅\nTask ID: ${id}`);
  } else {
    bot.sendMessage(chatId, `Couldn't cancel that task 😬`);
  }
});

bot.onText(/\/data/, (msg, match) => {
  const chatId = msg.chat.id;

  const data = db.getUser(chatId)

  if (!data) {
    bot.sendMessage(chatId, "There is no user data 🫥");
    return
  }
  console.log(parsePhoenixToken(data.cookies.hcmex))
  const reply = [
    `🧾 User data`,
    ``,
    `🆔 User ID: ${data.userId}`,
    `📍 Location: ${data.geo.lat.toFixed(6)}, ${data.geo.long.toFixed(6)}`,
    `🏢 Domain: ${data.cookies.domain}`,
    `🍪 Cookies:`,
    `- _hcmex_key: ${data.cookies.hcmex ? 'set' : 'missing'}`,
    `- device_id: ${data.cookies.deviceId ? 'set' : 'missing'}`,
    `- geo: ${data.cookies.geo ? 'set' : 'missing'}`,
    `⏳ Expires: ${new Date(data.cookies.expires).toLocaleString()}`,
  ].join('\n');
  bot.sendMessage(chatId, reply);
});

bot.onText(/\/location/, (msg) => {
  const chatId = msg.chat.id;
  const data = db.getUser(chatId);

  if (!data) {
    bot.sendMessage(chatId, "You have to log in /start 🔐");
    return;
  }

  const { lat, long } = data.geo;
  const link = `https://www.google.com/search?q=${lat.toFixed(6)}%2C+${long.toFixed(6)}`;
  bot.sendMessage(chatId, link);
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

    }

    db.addUser(msg.chat.id, userData)

    const replymsg = `lat long ${geo.lat.toFixed(6)}, ${geo.long.toFixed(6)}\nhttps://www.google.com/search?q=${geo.lat.toFixed(6)}%2C+${geo.long.toFixed(6)}\n\ndomain ${cookies.domain}\nexpires on ${new Date(cookies.expires).toLocaleString(phoenix?.locale)}`

    bot.sendMessage(chatId, `✅ Parsed successfully!\n\n${replymsg}`, {
      parse_mode: 'Markdown'
    });

  } catch (error) {
    console.error('Error processing JSON:', error);
    bot.sendMessage(chatId, `❌ Error: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
  }
});

bot.on('location', (msg) => {
  const chatId = msg.chat.id;
  const location = msg.location;

  if (!location) return;

  const data = db.getUser(chatId);
  if (!data) {
    bot.sendMessage(chatId, "You have to log in /start 🔐");
    return;
  }

  const updatedGeo = {
    lat: location.latitude,
    long: location.longitude,
    accuracy: 10,
  };

  const encodedGeo = Buffer.from(JSON.stringify(updatedGeo)).toString('base64');

  const updatedUser: UserData = {
    ...data,
    geo: updatedGeo,
    cookies: {
      ...data.cookies,
      geo: encodedGeo,
    },
  };

  db.addUser(chatId, updatedUser);

  const link = `https://www.google.com/search?q=${updatedGeo.lat.toFixed(6)}%2C+${updatedGeo.long.toFixed(6)}`;
  bot.sendMessage(chatId, `📍 Location updated!\n${link}`);
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

setInterval(() => {
  runScheduledTasks().catch((error) => {
    console.error('Scheduler error:', error);
  });
}, 15000);

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
