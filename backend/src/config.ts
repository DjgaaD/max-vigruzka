import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 4000,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'max_vigruzka'
  },
  maxBotToken: process.env.MAX_BOT_TOKEN || ''
};

if (!config.maxBotToken) {
  // В реальном окружении обязательно задаём токен бота
  // console.warn('MAX_BOT_TOKEN is not set');
}

