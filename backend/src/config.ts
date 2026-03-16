import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

const envPath1 = path.resolve(__dirname, '..', '.env');
const envPath2 = path.resolve(process.cwd(), '.env');
// override=true, чтобы переменные из pm2/systemd не ломали запуск
if (fs.existsSync(envPath1)) dotenv.config({ path: envPath1, override: true });
else if (fs.existsSync(envPath2)) dotenv.config({ path: envPath2, override: true });
else dotenv.config({ override: true });

const adminIdsRaw = process.env.ADMIN_MAX_USER_IDS || '';
export const config = {
  port: Number(process.env.PORT) || 4000,
  db: {
    host: String(process.env.DB_HOST ?? 'localhost'),
    port: Number(String(process.env.DB_PORT ?? '5432')) || 5432,
    user: String(process.env.DB_USER ?? 'postgres'),
    password: String(process.env.DB_PASSWORD ?? 'postgres'),
    database: String(process.env.DB_NAME ?? 'max_vigruzka')
  },
  maxBotToken: process.env.MAX_BOT_TOKEN || '',
  adminMaxUserIds: adminIdsRaw ? adminIdsRaw.split(',').map((s) => Number(s.trim())).filter(Boolean) : [] as number[],
  adminLogin: String(process.env.ADMIN_LOGIN ?? ''),
  adminPassword: String(process.env.ADMIN_PASSWORD ?? '')
};

if (!config.maxBotToken) {
  // В реальном окружении обязательно задаём токен бота
  // console.warn('MAX_BOT_TOKEN is not set');
}

