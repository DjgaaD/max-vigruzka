"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const envPath1 = path_1.default.resolve(__dirname, '..', '.env');
const envPath2 = path_1.default.resolve(process.cwd(), '.env');
// override=true, чтобы переменные из pm2/systemd не ломали запуск
if (fs_1.default.existsSync(envPath1))
    dotenv_1.default.config({ path: envPath1, override: true });
else if (fs_1.default.existsSync(envPath2))
    dotenv_1.default.config({ path: envPath2, override: true });
else
    dotenv_1.default.config({ override: true });
const adminIdsRaw = process.env.ADMIN_MAX_USER_IDS || '';
exports.config = {
    port: Number(process.env.PORT) || 4000,
    db: {
        host: String(process.env.DB_HOST ?? 'localhost'),
        port: Number(String(process.env.DB_PORT ?? '5432')) || 5432,
        user: String(process.env.DB_USER ?? 'postgres'),
        password: String(process.env.DB_PASSWORD ?? 'postgres'),
        database: String(process.env.DB_NAME ?? 'max_vigruzka')
    },
    maxBotToken: process.env.MAX_BOT_TOKEN || '',
    adminMaxUserIds: adminIdsRaw ? adminIdsRaw.split(',').map((s) => Number(s.trim())).filter(Boolean) : [],
    adminLogin: String(process.env.ADMIN_LOGIN ?? ''),
    adminPassword: String(process.env.ADMIN_PASSWORD ?? '')
};
if (!exports.config.maxBotToken) {
    // В реальном окружении обязательно задаём токен бота
    // console.warn('MAX_BOT_TOKEN is not set');
}
