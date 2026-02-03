import TelegramBot from 'node-telegram-bot-api';
import http from 'http';
import { config } from './config.js';
import { parsePhoenixToken } from './parse-phoenix-token-browser.js';
import { error } from 'console';
import { getCsrfTokes, parseJsonCookies } from './helperFunctions.js';
import { UserData } from './types.js';
import { Database } from './database.js';
import { SchedulerStore } from './schedulerStore.js';

const db = new Database()
const scheduler = new SchedulerStore()

let isRunningSchedule = false;

type Lang = 'en' | 'es';

const I18N = {
  en: {
    commands: {
      start: 'Get setup instructions and login steps',
      data: 'Show your saved account info',
      clocknow: 'Clock in right now',
      clockin: 'Schedule a future clock-in time',
      list: 'List your scheduled clock-ins',
      cancel: 'Cancel a scheduled clock-in',
      location: 'Show your saved location link',
    },
    start: 'Welcome! 👋\n\nHere is how to get started:\n1) Install the Chrome extension: https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc\n2) Export your cookies as a JSON file\n3) Send the JSON file to me using Telegram Web: https://web.telegram.org/\n\nAfter you are logged in, you can update your location anytime by sending a location from the Telegram location picker 📍',
    loginRequired: 'You have to log in /start 🔐',
    usageClockin: 'Usage: /clockin 14:00 or /clockin 5pm or /clockin 5:20pm ⏰',
    invalidClockin: 'Invalid time format 😅 Try /clockin 14:00, /clockin 5pm, or /clockin 5:20pm',
    scheduledClockin: '✅ Scheduled clock-in 🎉\nTime: {time}\nTask ID: {id}',
    clockedInNow: 'Clocked in successfully ✅',
    clockedInScheduled: '✅ Clocked in (scheduled) 🎯\nTime: {time}',
    scheduledFailed: '❌ Scheduled clock-in failed: {error}',
    clocknowError: '❌ Error: {error}',
    listHeader: 'Here are your scheduled clock-ins 📋',
    listEmpty: 'No scheduled clock-ins yet 💤',
    statusPending: 'pending',
    statusExecuted: 'executed',
    statusFailed: 'failed',
    cancelUsage: 'Usage: /cancel <task-id> or /cancel all 🧹',
    cancelNotFound: "I can't find that task id for you 🤔",
    cancelOk: 'Cancelled ✅\nTask ID: {id}',
    cancelAllNone: 'No pending tasks to cancel 💤',
    cancelAllOk: 'Cancelled {count} task(s) ✅🧹',
    cancelFail: "Couldn't cancel that task 😬",
    dataEmpty: 'There is no user data 🫥',
    dataHeader: '🧾 User data',
    dataUserId: '🆔 User ID: {userId}',
    dataLocation: '📍 Location: {lat}, {long} (accuracy {accuracy})',
    dataDomain: '🏢 Domain: {domain}',
    dataCookies: '🍪 Cookies:',
    dataCookieHcmex: '- _hcmex_key: {status}',
    dataCookieDevice: '- device_id: {status}',
    dataCookieGeo: '- geo: {status}',
    dataExpires: '⏳ Expires: {expires}',
    statusSet: 'set',
    statusMissing: 'missing',
    docInvalid: 'Please send a .json file',
    docTooLarge: 'File too large. Max 5MB.',
    docParsed: '✅ Parsed successfully!\n\n{details}',
    docError: '❌ Error: {error}',
    docDetails: 'lat long {lat}, {long}\n{link}\n\ndomain {domain}\nexpires on {expires}',
    docInvalidJson: 'Invalid JSON',
    locationUpdated: '📍 Location updated!\n{link}',
  },
  es: {
    commands: {
      start: 'Ver instrucciones de inicio y acceso',
      data: 'Mostrar tu informacion guardada',
      clocknow: 'Fichar ahora mismo',
      clockin: 'Programar un fichaje',
      list: 'Ver fichajes programados',
      cancel: 'Cancelar un fichaje programado',
      location: 'Mostrar enlace de ubicacion guardada',
    },
    start: 'Bienvenido! 👋\n\nComo empezar:\n1) Instala la extension de Chrome: https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc\n2) Exporta tus cookies como archivo JSON\n3) Enviame el JSON usando Telegram Web: https://web.telegram.org/\n\nDespues de iniciar sesion, puedes actualizar tu ubicacion enviando una ubicacion desde el selector de Telegram 📍',
    loginRequired: 'Tienes que iniciar sesion con /start 🔐',
    usageClockin: 'Uso: /clockin 14:00 o /clockin 5pm o /clockin 5:20pm ⏰',
    invalidClockin: 'Formato de hora invalido 😅 Prueba /clockin 14:00, /clockin 5pm, o /clockin 5:20pm',
    scheduledClockin: '✅ Fichaje programado 🎉\nHora: {time}\nID de tarea: {id}',
    clockedInNow: 'Fichado correctamente ✅',
    clockedInScheduled: '✅ Fichado (programado) 🎯\nHora: {time}',
    scheduledFailed: '❌ Fallo el fichaje programado: {error}',
    clocknowError: '❌ Error: {error}',
    listHeader: 'Estos son tus fichajes programados 📋',
    listEmpty: 'No hay fichajes programados 💤',
    statusPending: 'pendiente',
    statusExecuted: 'ejecutado',
    statusFailed: 'fallido',
    cancelUsage: 'Uso: /cancel <task-id> o /cancel all 🧹',
    cancelNotFound: 'No encuentro ese id de tarea 🤔',
    cancelOk: 'Cancelado ✅\nID de tarea: {id}',
    cancelAllNone: 'No hay tareas pendientes para cancelar 💤',
    cancelAllOk: 'Canceladas {count} tarea(s) ✅🧹',
    cancelFail: 'No pude cancelar esa tarea 😬',
    dataEmpty: 'No hay datos de usuario 🫥',
    dataHeader: '🧾 Datos de usuario',
    dataUserId: '🆔 ID de usuario: {userId}',
    dataLocation: '📍 Ubicacion: {lat}, {long} (precision {accuracy})',
    dataDomain: '🏢 Dominio: {domain}',
    dataCookies: '🍪 Cookies:',
    dataCookieHcmex: '- _hcmex_key: {status}',
    dataCookieDevice: '- device_id: {status}',
    dataCookieGeo: '- geo: {status}',
    dataExpires: '⏳ Expira: {expires}',
    statusSet: 'ok',
    statusMissing: 'falta',
    docInvalid: 'Por favor envia un archivo .json',
    docTooLarge: 'Archivo demasiado grande. Maximo 5MB.',
    docParsed: '✅ Parseado correctamente!\n\n{details}',
    docError: '❌ Error: {error}',
    docDetails: 'lat long {lat}, {long}\n{link}\n\ndominio {domain}\nexpira el {expires}',
    docInvalidJson: 'JSON invalido',
    locationUpdated: '📍 Ubicacion actualizada!\n{link}',
  },
} as const;

function getLangFromMessage(msg: TelegramBot.Message): Lang {
  const code = msg.from?.language_code?.toLowerCase() ?? 'en';
  return code.startsWith('es') ? 'es' : 'en';
}

function formatTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

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

function formatScheduleTime(date: Date, lang: Lang): string {
  const locale = lang === 'es' ? 'es-ES' : 'en-US';
  return date.toLocaleString(locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function performClockIn(chatId: number, data: UserData, lang: Lang, scheduledAt?: Date) {
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
    bot.sendMessage(chatId, formatTemplate(I18N[lang].clockedInScheduled, { time: formatScheduleTime(new Date(), lang) }));
  } else {
    bot.sendMessage(chatId, I18N[lang].clockedInNow);
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
        await performClockIn(task.userId, data, task.lang, task.scheduledTime);
        scheduler.markExecuted(task.id);
      } catch (error) {
        scheduler.markExecuted(task.id, error instanceof Error ? error.message : String(error));
        const errMsg = error instanceof Error ? error.message : String(error);
        bot.sendMessage(task.userId, formatTemplate(I18N[task.lang].scheduledFailed, { error: errMsg }));
      }
    }
  } finally {
    isRunningSchedule = false;
  }
}

const isDevelopment = config.nodeEnv === 'development';
const hasWebhookConfig = Boolean(config.webhookUrl);
const useWebhook = !isDevelopment && hasWebhookConfig;
const usePolling = isDevelopment || !hasWebhookConfig;

if (!isDevelopment && !hasWebhookConfig) {
  console.warn('WEBHOOK_URL is not set. Falling back to polling in production.');
}

// Create bot instance
const bot = new TelegramBot(config.telegramBotToken, {
  polling: usePolling,
});

console.log(`Bot started in ${config.nodeEnv} mode`);
console.log(`PORT=${config.port}`);
console.log(`WEBHOOK_URL=${config.webhookUrl ?? 'not set'}`);

// Define bot commands (EN + ES)
const botCommandsEn = [
  { command: 'start', description: I18N.en.commands.start },
  { command: 'data', description: I18N.en.commands.data },
  { command: 'clocknow', description: I18N.en.commands.clocknow },
  { command: 'clockin', description: I18N.en.commands.clockin },
  { command: 'list', description: I18N.en.commands.list },
  { command: 'cancel', description: I18N.en.commands.cancel },
  { command: 'location', description: I18N.en.commands.location },
];

const botCommandsEs = [
  { command: 'start', description: I18N.es.commands.start },
  { command: 'data', description: I18N.es.commands.data },
  { command: 'clocknow', description: I18N.es.commands.clocknow },
  { command: 'clockin', description: I18N.es.commands.clockin },
  { command: 'list', description: I18N.es.commands.list },
  { command: 'cancel', description: I18N.es.commands.cancel },
  { command: 'location', description: I18N.es.commands.location },
];

// Set bot commands in Telegram
bot.setMyCommands(botCommandsEn).catch(console.error);
bot.setMyCommands(botCommandsEs, { language_code: 'es' }).catch(console.error);

let webhookServer: http.Server | null = null;
const webhookPath = `/bot${config.telegramBotToken}`;

async function startWebhookServer() {
  if (!config.webhookUrl) return;

  const baseUrl = config.webhookUrl.replace(/\/$/, '');
  const fullWebhookUrl = `${baseUrl}${webhookPath}`;

  webhookServer = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        mode: useWebhook ? 'webhook' : 'polling',
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (req.method !== 'POST' || req.url !== webhookPath) {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        bot.processUpdate(update);
        res.writeHead(200);
        res.end('OK');
      } catch (error) {
        console.error('Webhook update error:', error);
        res.writeHead(400);
        res.end('Bad Request');
      }
    });
  });

  await bot.setWebHook(fullWebhookUrl);
  webhookServer.listen(config.port, () => {
    console.log(`Webhook server listening on port ${config.port}`);
    console.log(`Webhook set to ${fullWebhookUrl}`);
  });
}

if (useWebhook) {
  startWebhookServer().catch((error) => {
    console.error('Failed to start webhook server:', error);
  });
}

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const lang = getLangFromMessage(msg);
  bot.sendMessage(
    chatId,
    I18N[lang].start
  );
});

bot.onText(/\/clocknow/, async (msg, match) => {
  const chatId = msg.chat.id;
  const lang = getLangFromMessage(msg);

  const data = db.getUser(chatId)
  if (!data) {
    bot.sendMessage(chatId, I18N[lang].loginRequired);
    return
  }
  try {
    await performClockIn(chatId, data, lang);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    bot.sendMessage(chatId, formatTemplate(I18N[lang].clocknowError, { error: errMsg }));
  }
});

bot.onText(/\/clockin(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const lang = getLangFromMessage(msg);
  const rawInput = match?.[1]?.trim();

  if (!rawInput) {
    bot.sendMessage(chatId, I18N[lang].usageClockin);
    return;
  }

  const data = db.getUser(chatId)
  if (!data) {
    bot.sendMessage(chatId, I18N[lang].loginRequired);
    return;
  }

  const parsed = parseClockTime(rawInput);
  if (!parsed) {
    bot.sendMessage(chatId, I18N[lang].invalidClockin);
    return;
  }

  const scheduledTime = nextOccurrence(parsed.hours, parsed.minutes);
  const task = scheduler.add(chatId, scheduledTime, lang);

  bot.sendMessage(
    chatId,
    formatTemplate(I18N[lang].scheduledClockin, { time: formatScheduleTime(scheduledTime, lang), id: task.id })
  );
});

bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const lang = getLangFromMessage(msg);
  const tasks = scheduler.getByUser(chatId);

  if (tasks.length === 0) {
    bot.sendMessage(chatId, I18N[lang].listEmpty);
    return;
  }

  const lines = tasks.map((task) => {
    const statusEmoji = task.status === 'pending' ? '⏳' : task.status === 'executed' ? '✅' : '❌';
    const statusLabel = task.status === 'pending'
      ? I18N[lang].statusPending
      : task.status === 'executed'
        ? I18N[lang].statusExecuted
        : I18N[lang].statusFailed;
    return `${statusEmoji} ${task.id} — ${formatScheduleTime(task.scheduledTime, lang)} (${statusLabel})`;
  });

  bot.sendMessage(chatId, `${I18N[lang].listHeader}\n\n${lines.join('\n')}`);
});

bot.onText(/\/cancel(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const lang = getLangFromMessage(msg);
  const rawArg = match?.[1]?.trim();

  if (!rawArg) {
    bot.sendMessage(chatId, I18N[lang].cancelUsage);
    return;
  }

  const tasks = scheduler.getByUser(chatId);
  if (rawArg.toLowerCase() === 'all') {
    const pending = tasks.filter((task) => task.status === 'pending');
    if (pending.length === 0) {
      bot.sendMessage(chatId, I18N[lang].cancelAllNone);
      return;
    }
    for (const task of pending) {
      scheduler.cancel(task.id);
    }
    bot.sendMessage(chatId, formatTemplate(I18N[lang].cancelAllOk, { count: pending.length }));
    return;
  }

  const id = rawArg;
  const belongsToUser = tasks.some((task) => task.id === id);
  if (!belongsToUser) {
    bot.sendMessage(chatId, I18N[lang].cancelNotFound);
    return;
  }

  const cancelled = scheduler.cancel(id);
  if (cancelled) {
    bot.sendMessage(chatId, formatTemplate(I18N[lang].cancelOk, { id }));
  } else {
    bot.sendMessage(chatId, I18N[lang].cancelFail);
  }
});

bot.onText(/\/data/, (msg, match) => {
  const chatId = msg.chat.id;
  const lang = getLangFromMessage(msg);

  const data = db.getUser(chatId)

  if (!data) {
    bot.sendMessage(chatId, I18N[lang].dataEmpty);
    return
  }
  console.log(parsePhoenixToken(data.cookies.hcmex))
  const statusSet = I18N[lang].statusSet;
  const statusMissing = I18N[lang].statusMissing;
  const hcmexStatus = data.cookies.hcmex ? statusSet : statusMissing;
  const deviceStatus = data.cookies.deviceId ? statusSet : statusMissing;
  const geoStatus = data.cookies.geo ? statusSet : statusMissing;
  const reply = [
    I18N[lang].dataHeader,
    ``,
    formatTemplate(I18N[lang].dataUserId, { userId: data.userId }),
    formatTemplate(I18N[lang].dataLocation, {
      lat: data.geo.lat.toFixed(6),
      long: data.geo.long.toFixed(6),
      accuracy: data.geo.accuracy,
    }),
    formatTemplate(I18N[lang].dataDomain, { domain: data.cookies.domain }),
    I18N[lang].dataCookies,
    formatTemplate(I18N[lang].dataCookieHcmex, { status: hcmexStatus }),
    formatTemplate(I18N[lang].dataCookieDevice, { status: deviceStatus }),
    formatTemplate(I18N[lang].dataCookieGeo, { status: geoStatus }),
    formatTemplate(I18N[lang].dataExpires, {
      expires: new Date(data.cookies.expires).toLocaleString(lang === 'es' ? 'es-ES' : 'en-US'),
    }),
  ].join('\n');
  bot.sendMessage(chatId, reply);
});

bot.onText(/\/location/, (msg) => {
  const chatId = msg.chat.id;
  const lang = getLangFromMessage(msg);
  const data = db.getUser(chatId);

  if (!data) {
    bot.sendMessage(chatId, I18N[lang].loginRequired);
    return;
  }

  const { lat, long } = data.geo;
  const link = `https://www.google.com/search?q=${lat.toFixed(6)}%2C+${long.toFixed(6)}`;
  bot.sendMessage(chatId, link);
});

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const lang = getLangFromMessage(msg);
  const document = msg.document;

  if (!document?.file_name?.endsWith('.json')) {
    bot.sendMessage(chatId, I18N[lang].docInvalid);
    return;
  }

  if (document.file_size && document.file_size > 5 * 1024 * 1024) {
    bot.sendMessage(chatId, I18N[lang].docTooLarge);
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

    const link = `https://www.google.com/search?q=${geo.lat.toFixed(6)}%2C+${geo.long.toFixed(6)}`;
    const replymsg = formatTemplate(I18N[lang].docDetails, {
      lat: geo.lat.toFixed(6),
      long: geo.long.toFixed(6),
      link,
      domain: cookies.domain,
      expires: new Date(cookies.expires).toLocaleString(lang === 'es' ? 'es-ES' : 'en-US'),
    });

    bot.sendMessage(chatId, formatTemplate(I18N[lang].docParsed, { details: replymsg }), {
      parse_mode: 'Markdown'
    });

  } catch (error) {
    console.error('Error processing JSON:', error);
    const errMsg = error instanceof Error ? error.message : I18N[lang].docInvalidJson;
    bot.sendMessage(chatId, formatTemplate(I18N[lang].docError, { error: errMsg }));
  }
});

bot.on('location', (msg) => {
  const chatId = msg.chat.id;
  const lang = getLangFromMessage(msg);
  const location = msg.location;

  if (!location) return;

  const data = db.getUser(chatId);
  if (!data) {
    bot.sendMessage(chatId, I18N[lang].loginRequired);
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
  bot.sendMessage(chatId, formatTemplate(I18N[lang].locationUpdated, { link }));
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
}, 30000);

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('Stopping bot...');
  if (usePolling) {
    bot.stopPolling();
  }
  if (webhookServer) {
    webhookServer.close();
  }
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('Stopping bot...');
  if (usePolling) {
    bot.stopPolling();
  }
  if (webhookServer) {
    webhookServer.close();
  }
  process.exit(0);
});


export default bot;
