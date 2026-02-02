import TelegramBot from 'node-telegram-bot-api';
import { config } from './config.js';

// Create bot instance
const bot = new TelegramBot(config.telegramBotToken, {
  polling: config.nodeEnv === 'development',
});

console.log(`Bot started in ${config.nodeEnv} mode`);

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    'Welcome! 👋\n\nI am your Telegram bot built with TypeScript.\n\nAvailable commands:\n/start - Show this message\n/help - Get help\n/echo <text> - Echo your message'
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
