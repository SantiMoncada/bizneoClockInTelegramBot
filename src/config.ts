import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

interface Config {
  telegramBotToken: string;
  nodeEnv: string;
  port: number;
  webhookUrl?: string;
  dataDir: string;
}

function getConfig(): Config {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required in environment variables');
  }

  const railwayPublicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const inferredWebhookUrl = railwayPublicDomain
    ? `https://${railwayPublicDomain}`
    : undefined;

  return {
    telegramBotToken,
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    webhookUrl: process.env.WEBHOOK_URL || inferredWebhookUrl,
    dataDir: process.env.DATA_DIR || 'data',
  };
}

export const config = getConfig();

export function resolveDataPath(filename: string): string {
  return path.join(config.dataDir, filename);
}
