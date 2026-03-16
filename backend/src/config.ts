import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

const envPath1 = path.resolve(__dirname, '..', '.env');
const envPath2 = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath1)) dotenv.config({ path: envPath1 });
else if (fs.existsSync(envPath2)) dotenv.config({ path: envPath2 });
else dotenv.config();

const adminIdsRaw = process.env.ADMIN_MAX_USER_IDS || '';
export const config = {
  port: Number(process.env.PORT) || 4000,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'postgres',
    database: process.env.DB_NAME || 'max_vigruzka'
  },
  maxBotToken: process.env.MAX_BOT_TOKEN || '',
  adminMaxUserIds: adminIdsRaw ? adminIdsRaw.split(',').map((s) => Number(s.trim())).filter(Boolean) : [] as number[],
  adminLogin: process.env.ADMIN_LOGIN || '',
  adminPassword: process.env.ADMIN_PASSWORD || ''
};

if (!config.maxBotToken) {
  // В реальном окружении обязательно задаём токен бота
  // console.warn('MAX_BOT_TOKEN is not set');
}

