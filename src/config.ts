import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface Config {
  telegramBotToken: string;
  nodeEnv: string;
  port: number;
  webhookUrl?: string;
}

function getConfig(): Config {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required in environment variables');
  }

  return {
    telegramBotToken,
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    webhookUrl: process.env.WEBHOOK_URL,
  };
}

export const config = getConfig();
