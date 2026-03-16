import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { json } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { initDb, pool } from './db';

// Type definition for user database row
interface UserRow {
  id: number;
  max_user_id: number;
  role: 'customer' | 'loader' | 'admin';
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  rating_sum: number;
  rating_count: number;
  is_blocked: boolean;
  block_reason: string | null;
  block_until: string | null;
  created_at: string;
}

// Type definition for user with additional properties
interface UserWithStats extends UserRow {
  rating_count: number;
  rating_avg: number | null;
  auctions_count?: number;
  bids_count?: number;
  active_orders_count?: number;
}

// Добавляем логирование в файл
const logFile = path.join(__dirname, '../logs/app.log');
if (!fs.existsSync(path.dirname(logFile))) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
}

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = (...args) => {
  const message = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  fs.appendFileSync(logFile, message);
  originalConsoleLog(...args);
};

console.error = (...args) => {
  const message = `[${new Date().toISOString()}] ERROR: ${args.join(' ')}\n`;
  fs.appendFileSync(logFile, message);
  originalConsoleError(...args);
};

console.warn = (...args) => {
  const message = `[${new Date().toISOString()}] WARN: ${args.join(' ')}\n`;
  fs.appendFileSync(logFile, message);
  originalConsoleWarn(...args);
};

const app = express();

const ADMIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const adminTokens = new Map<string, number>();

// Функция для отправки сообщения через MAX API
async function sendMaxMessage(userId: number, text: string, auctionId?: number) {
  if (!config.maxBotToken) {
    console.warn('MAX_BOT_TOKEN не настроен, пропускаю отправку сообщения');
    return;
  }

  console.log(`Отправка сообщения пользователю ${userId}, auctionId: ${auctionId}`);

  const messagePayload = {
    text,
    // Кнопку убираем, так как deeplink в мини‑приложение сейчас работает нестабильно.
    // При необходимости можно будет вернуть attachments с inline_keyboard.
    attachments: undefined
  };

  try {
    const response = await fetch(`https://platform-api.max.ru/messages?user_id=${userId}`, {
      method: 'POST',
      headers: {
        // В MAX access_token передаётся прямо в заголовке Authorization без Bearer/OAuth
        // см. dev.max.ru/docs-api/methods/POST/messages
        'Authorization': config.maxBotToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(messagePayload)
    });

    console.log(`Ответ API для пользователя ${userId}:`, response.status, response.statusText);

    if (!response.ok) {
      console.error(`Ошибка отправки сообщения пользователю ${userId}:`, response.status, response.statusText);
      const errorText = await response.text();
      console.error('Текст ошибки:', errorText);
    } else {
      console.log(`Сообщение успешно отправлено пользователю ${userId}`);
    }
  } catch (error) {
    console.error(`Ошибка при отправке сообщения пользователю ${userId}:`, error);
  }
}

function createAdminToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
  return token;
}

function isAdminTokenValid(token: string): boolean {
  const exp = adminTokens.get(token);
  if (!exp || exp < Date.now()) {
    if (exp) adminTokens.delete(token);
    return false;
  }
  return true;
}

app.use(cors());
app.use(json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Простейшая авторизация по MAX user (валидировать initData нужно отдельно)
app.post('/auth/max', async (req, res) => {
  const { max_user_id, first_name, last_name, username, role } = req.body as {
    max_user_id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    role: 'customer' | 'loader' | 'admin';
  };

  if (!max_user_id || !role) {
    return res.status(400).json({ error: 'max_user_id and role are required' });
  }

  const isAdminRequest = role === 'admin';
  if (isAdminRequest && !config.adminMaxUserIds.includes(Number(max_user_id))) {
    return res.status(403).json({ error: 'admin_access_denied' });
  }

  const client = await pool.connect();
  try {
    let userResult = await client.query(
      'select * from users where max_user_id = $1',
      [max_user_id]
    );

    if (userResult.rowCount === 0) {
      const insertRole = isAdminRequest ? 'admin' : role;
      userResult = await client.query(
        `insert into users (max_user_id, role, first_name, last_name, username)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [max_user_id, insertRole, first_name || null, last_name || null, username || null]
      );
    } else {
      const updates = isAdminRequest
        ? 'first_name = $2, last_name = $3, username = $4, role = \'admin\''
        : 'first_name = $2, last_name = $3, username = $4';
      userResult = await client.query(
        `update users set ${updates} where max_user_id = $1 returning *`,
        [max_user_id, first_name || null, last_name || null, username || null]
      );
    }

    const row = userResult.rows[0];
    const ratingCount = Number(row.rating_count) || 0;
    const ratingSum = Number(row.rating_sum) || 0;
    const ratingAvg = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null;
    const roleReturn = isAdminRequest ? 'admin' : row.role;
    const user = {
      id: row.id,
      max_user_id: row.max_user_id,
      role: roleReturn,
      first_name: row.first_name,
      last_name: row.last_name,
      username: row.username,
      rating_avg: ratingAvg,
      rating_count: ratingCount,
      created_at: row.created_at
    };
    res.json({ user });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Профиль пользователя (рейтинг, блокировка)
app.get('/users/profile', async (req, res) => {
  const userId = Number(req.query.user_id);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `select id, max_user_id, role, first_name, last_name, username,
              rating_sum, rating_count, created_at, is_blocked, block_reason
       from users where id = $1`,
      [userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'user not found' });
    }
    const row = result.rows[0];
    if (row.is_blocked) {
      return res.status(403).json({ error: 'user_blocked', block_reason: row.block_reason });
    }
    const ratingCount = Number(row.rating_count) || 0;
    const ratingSum = Number(row.rating_sum) || 0;
    const ratingAvg = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null;
    res.json({
      user: {
        id: row.id,
        max_user_id: row.max_user_id,
        role: row.role,
        first_name: row.first_name,
        last_name: row.last_name,
        username: row.username,
        rating_avg: ratingAvg,
        rating_count: ratingCount,
        created_at: row.created_at
      }
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Создание аукциона заказчиком
app.post('/auctions', async (req, res) => {
  const { user_id, title, description, street, house, flat, cargo_params, date_time, auction_ends_at } = req.body as {
    user_id: number;
    title: string;
    description?: string;
    street?: string;
    house?: string;
    flat?: string;
    cargo_params?: unknown;
    date_time: string;
    auction_ends_at: string;
  };

  if (!user_id || !title || !date_time || !auction_ends_at) {
    return res.status(400).json({ error: 'user_id, title, date_time, auction_ends_at are required' });
  }

  const client = await pool.connect();
  try {
    const userRes = await client.query('select * from users where id = $1', [user_id]);
    if (userRes.rowCount === 0) {
      return res.status(400).json({ error: 'user not found' });
    }
    const user = userRes.rows[0];
    if (user.role !== 'customer') {
      return res.status(403).json({ error: 'only customers can create auctions' });
    }

    const result = await client.query(
      `insert into auctions (customer_id, title, description, street, house, flat, cargo_params, date_time, auction_ends_at, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
       returning *`,
      [user_id, title, description || null, street || null, house || null, flat || null, cargo_params || null, date_time, auction_ends_at]
    );

    const auction = result.rows[0];

    // Получаем всех грузчиков для рассылки
    const loadersResult = await client.query(
      'select max_user_id, first_name, last_name from users where role = $1 and is_blocked = false',
      ['loader']
    );

    console.log(`Найдено грузчиков: ${loadersResult.rowCount}`);
    console.log('Грузчики:', loadersResult.rows);

    // Рассылаем уведомления грузчикам
    const shortAddress = street ? `\n🏙 Адрес: ${street}` : '';
    const messageText =
      `🚚 Новая заявка на перевозку!\n\n` +
      `📋 ${title}${description ? '\n' + description : ''}${shortAddress}\n` +
      `⏰ Дата: ${new Date(date_time).toLocaleString('ru-RU')}\n` +
      `⏳ Торги до: ${new Date(auction_ends_at).toLocaleString('ru-RU')}\n\n` +
      `Чтобы сделать ставку:\n` +
      `1️⃣ Откройте чат с ботом «Аукцион грузчиков» в MAX.\n` +
      `2️⃣ Нажмите кнопку мини‑приложения внизу чата.\n` +
      `3️⃣ В разделе «Доступные заявки» выберите эту заявку и укажите свою цену.`;

    for (const loader of loadersResult.rows) {
      await sendMaxMessage(loader.max_user_id, messageText, auction.id);
    }

    console.log(`Рассылка завершена: отправлено ${loadersResult.rowCount} уведомлений грузчикам`);

    res.json({ auction: result.rows[0] });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Список аукционов заказчика
app.get('/auctions/my', async (req, res) => {
  const userId = Number(req.query.user_id);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `select * from auctions
       where customer_id = $1
       order by created_at desc`,
      [userId]
    );
    res.json({ auctions: result.rows });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Оплата заявки заказчиком (триггер)
app.post('/auctions/:id/pay', async (req, res) => {
  const auctionId = Number(req.params.id);
  const { user_id } = req.body as { user_id?: number };
  if (!auctionId || !user_id) {
    return res.status(400).json({ error: 'auction id and user_id are required' });
  }

  const client = await pool.connect();
  try {
    const auctionRes = await client.query(
      `select a.*, 
              c.max_user_id as customer_max_user_id,
              c.first_name as customer_first_name,
              c.last_name as customer_last_name,
              c.username  as customer_username,
              l.max_user_id as loader_max_user_id,
              l.first_name as loader_first_name,
              l.last_name as loader_last_name,
              l.username  as loader_username
       from auctions a
       join users c on c.id = a.customer_id
       left join users l on l.id = a.winner_loader_id
       where a.id = $1`,
      [auctionId]
    );
    if (auctionRes.rowCount === 0) {
      return res.status(404).json({ error: 'auction not found' });
    }
    const auction = auctionRes.rows[0];
    if (auction.customer_id !== user_id) {
      return res.status(403).json({ error: 'only owner can pay' });
    }
    if (auction.status !== 'finished' || auction.payment_status !== 'waiting_payment') {
      return res.status(400).json({ error: 'auction is not waiting for payment' });
    }
    if (!auction.winner_loader_id) {
      return res.status(400).json({ error: 'no winner for this auction' });
    }

    const bidsRes = await client.query(
      'select * from bids where auction_id = $1 and loader_id = $2 order by amount asc, created_at asc limit 1',
      [auctionId, auction.winner_loader_id]
    );
    if (bidsRes.rowCount === 0) {
      return res.status(400).json({ error: 'winner bid not found' });
    }
    const winnerBid = bidsRes.rows[0];

    // Получаем процент сервиса
    const feeRes = await client.query('select service_fee_percent from service_settings where id = 1');
    const feePercent = Number(feeRes.rows[0]?.service_fee_percent) || 10;
    const price = Number(winnerBid.amount);
    const payout = Math.round(price * (1 - feePercent / 100) * 100) / 100;

    await client.query(
      'update auctions set payment_status = $2, status = $3, loader_payout = $4 where id = $1',
      [auctionId, 'paid', 'paid', payout]
    );

    // Сообщение заказчику с контактами грузчика
    if (auction.customer_max_user_id && auction.loader_first_name) {
      const customerName =
        (auction.customer_first_name || '') +
        (auction.customer_last_name ? ' ' + auction.customer_last_name : '');
      const loaderName =
        (auction.loader_first_name || '') +
        (auction.loader_last_name ? ' ' + auction.loader_last_name : '');
      const fullAddressParts = [auction.street, auction.house, auction.flat && `кв. ${auction.flat}`].filter(Boolean);
      const textLines = [
        customerName ? `Здравствуйте, ${customerName}!` : 'Здравствуйте!',
        '',
        `Вы оплатили заявку «${auction.title}».`,
        '',
        `Грузчик: ${loaderName}` + (auction.loader_username ? ` (@${auction.loader_username})` : ''),
        `Сумма: ${price}`,
        fullAddressParts.length ? `Адрес: ${fullAddressParts.join(', ')}` : '',
        '',
        'Созвонитесь с грузчиком и согласуйте детали работ.'
      ].filter(Boolean);
      await sendMaxMessage(auction.customer_max_user_id, textLines.join('\n'), auctionId);
    }

    // Сообщение грузчику о победе и оплате
    if (auction.loader_max_user_id) {
      const customerName =
        (auction.customer_first_name || '') +
        (auction.customer_last_name ? ' ' + auction.customer_last_name : '');
      const fullAddressParts = [auction.street, auction.house, auction.flat && `кв. ${auction.flat}`].filter(Boolean);
      const textLines = [
        `Поздравляем! Вы выиграли заявку «${auction.title}».`,
        '',
        customerName ? `Заказчик: ${customerName}` + (auction.customer_username ? ` (@${auction.customer_username})` : '') : '',
        `Сумма: ${price}`,
        fullAddressParts.length ? `Адрес: ${fullAddressParts.join(', ')}` : '',
        '',
        'Заказчик произвёл оплату в сервисе. Свяжитесь с ним и выполните работу.'
      ].filter(Boolean);
      await sendMaxMessage(auction.loader_max_user_id, textLines.join('\n'), auctionId);
    }

    res.json({ ok: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Удаление заявки заказчиком (можно удалить только свою и только пока она active)
app.delete('/auctions/:id', async (req, res) => {
  const auctionId = Number(req.params.id);
  const { user_id } = req.body as { user_id?: number };
  if (!auctionId || !user_id) {
    return res.status(400).json({ error: 'auction id and user_id are required' });
  }

  const client = await pool.connect();
  try {
    const auctionRes = await client.query(
      'select * from auctions where id = $1 and customer_id = $2',
      [auctionId, user_id]
    );
    if (auctionRes.rowCount === 0) {
      return res.status(404).json({ error: 'auction not found or not owned by user' });
    }
    const auction = auctionRes.rows[0];
    if (auction.status !== 'active') {
      return res.status(400).json({ error: 'only active auctions can be deleted' });
    }

    await client.query('delete from auctions where id = $1', [auctionId]);
    res.json({ ok: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Список активных аукционов для грузчиков
app.get('/auctions/active', async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `select a.*, u.first_name, u.last_name, u.username,
              (select count(*) from bids where auction_id = a.id) as bids_count
       from auctions a
       join users u on a.customer_id = u.id
       where a.status = 'active' and a.auction_ends_at > now()
       order by a.created_at desc`
    );
    res.json({ auctions: result.rows });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Список активных заявок для админа
app.get('/admin/auctions/active', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const client = await pool.connect();
  try {
    const result = await client.query(
      `select a.*, u.first_name, u.last_name, u.username,
              (select count(*) from bids where auction_id = a.id) as bids_count
       from auctions a
       join users u on a.customer_id = u.id
       where a.status in ('active','paid')
       order by a.created_at desc`
    );
    res.json({ auctions: result.rows });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Список завершённых заявок для админа
app.get('/admin/auctions/completed', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const client = await pool.connect();
  try {
    const result = await client.query(
      `select a.*, u.first_name, u.last_name, u.username,
              (select count(*) from bids where auction_id = a.id) as bids_count
       from auctions a
       join users u on a.customer_id = u.id
       where a.status in ('finished','completed','cancelled')
       order by a.created_at desc`
    );
    res.json({ auctions: result.rows });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Создание ставки грузчиком
app.post('/bids', async (req, res) => {
  const { auction_id, loader_id, amount } = req.body as {
    auction_id: number;
    loader_id: number;
    amount: number;
  };

  if (!auction_id || !loader_id || !amount || amount <= 0) {
    return res.status(400).json({ error: 'auction_id, loader_id and positive amount are required' });
  }

  const client = await pool.connect();
  try {
    // Проверяем, что грузчик существует и не заблокирован
    const loaderResult = await client.query(
      'select * from users where id = $1 and role = $2 and is_blocked = false',
      [loader_id, 'loader']
    );
    if (loaderResult.rowCount === 0) {
      return res.status(404).json({ error: 'loader not found or blocked' });
    }

    // Проверяем, что аукцион активен и не завершен
    const auctionResult = await client.query(
      'select * from auctions where id = $1 and status = $2 and auction_ends_at > now()',
      [auction_id, 'active']
    );
    if (auctionResult.rowCount === 0) {
      return res.status(404).json({ error: 'auction not found or not active' });
    }

    // Создаем или обновляем ставку
    const result = await client.query(
      `insert into bids (auction_id, loader_id, amount)
       values ($1, $2, $3)
       on conflict (auction_id, loader_id) 
       do update set amount = $3, created_at = now()
       returning *`,
      [auction_id, loader_id, amount]
    );

    res.json({ bid: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Грузчик отмечает, что работы выполнены
app.post('/auctions/:id/complete-from-loader', async (req, res) => {
  const auctionId = Number(req.params.id);
  const { loader_id } = req.body as { loader_id?: number };
  if (!auctionId || !loader_id) {
    return res.status(400).json({ error: 'auction id and loader_id are required' });
  }

  const client = await pool.connect();
  try {
    const auctionRes = await client.query(
      `select a.*, 
              c.max_user_id as customer_max_user_id,
              c.first_name as customer_first_name,
              c.last_name as customer_last_name
       from auctions a
       join users c on c.id = a.customer_id
       where a.id = $1`,
      [auctionId]
    );
    if (auctionRes.rowCount === 0) {
      return res.status(404).json({ error: 'auction not found' });
    }
    const auction = auctionRes.rows[0];
    if (auction.winner_loader_id !== loader_id) {
      return res.status(403).json({ error: 'only winner loader can mark complete' });
    }
    if (auction.payment_status !== 'paid') {
      return res.status(400).json({ error: 'auction is not paid yet' });
    }

    await client.query('update auctions set loader_marked_done = true where id = $1', [auctionId]);

    if (auction.customer_max_user_id) {
      const customerName =
        (auction.customer_first_name || '') +
        (auction.customer_last_name ? ' ' + auction.customer_last_name : '');
      const textLines = [
        customerName ? `Здравствуйте, ${customerName}!` : 'Здравствуйте!',
        '',
        `Грузчик по заявке «${auction.title}» отметил, что работы выполнены.`,
        'Пожалуйста, зайдите в мини‑приложение и подтвердите выполнение работ.'
      ];
      await sendMaxMessage(auction.customer_max_user_id, textLines.join('\n'), auctionId);
    }

    res.json({ ok: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Заказчик подтверждает выполнение работ
app.post('/auctions/:id/confirm-complete', async (req, res) => {
  const auctionId = Number(req.params.id);
  const { user_id } = req.body as { user_id?: number };
  if (!auctionId || !user_id) {
    return res.status(400).json({ error: 'auction id and user_id are required' });
  }

  const client = await pool.connect();
  try {
    const auctionRes = await client.query(
      `select a.*, 
              c.max_user_id as customer_max_user_id,
              l.max_user_id as loader_max_user_id
       from auctions a
       join users c on c.id = a.customer_id
       left join users l on l.id = a.winner_loader_id
       where a.id = $1`,
      [auctionId]
    );
    if (auctionRes.rowCount === 0) {
      return res.status(404).json({ error: 'auction not found' });
    }
    const auction = auctionRes.rows[0];
    if (auction.customer_id !== user_id) {
      return res.status(403).json({ error: 'only owner can confirm' });
    }
    if (auction.payment_status !== 'paid') {
      return res.status(400).json({ error: 'auction must be paid to complete' });
    }
    if (!auction.winner_loader_id) {
      return res.status(400).json({ error: 'no winner loader' });
    }

    await client.query('begin');
    await client.query(
      'update auctions set payment_status = $2, status = $3, customer_confirmed_done = true where id = $1',
      [auctionId, 'completed', 'completed']
    );
    if (auction.loader_payout != null) {
      await client.query(
        'update users set balance = coalesce(balance, 0) + $2 where id = $1',
        [auction.winner_loader_id, auction.loader_payout]
      );
    }
    await client.query('commit');

    if (auction.loader_max_user_id) {
      const textLines = [
        `Заказчик подтвердил выполнение работ по заявке «${auction.title}».`,
        auction.loader_payout != null ? `На ваш внутренний счёт зачислено: ${auction.loader_payout}` : ''
      ].filter(Boolean);
      await sendMaxMessage(auction.loader_max_user_id, textLines.join('\n'), auctionId);
    }

    res.json({ ok: true });
  } catch (e) {
    await pool.query('rollback').catch(() => {});
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// --- Вход в админку по логину/паролю (для браузера с сайта) ---
app.get('/admin/auth/status', (_req, res) => {
  res.json({ configured: !!(config.adminLogin && config.adminPassword) });
});

app.post('/admin/auth', (req, res) => {
  const login = typeof req.body?.login === 'string' ? req.body.login.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
  if (!config.adminLogin || !config.adminPassword) {
    return res.status(503).json({ error: 'admin_login_not_configured' });
  }
  if (login !== config.adminLogin || password !== config.adminPassword) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = createAdminToken();
  res.json({ token });
});

// --- Админ-панель: авторизация через Bearer token (сайт) или admin_user_id (MAX) ---
async function requireAdmin(req: express.Request): Promise<{ ok: true } | { ok: false; status: number; body: object }> {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (bearer && isAdminTokenValid(bearer)) return { ok: true };

  const adminUserId = Number(req.query.admin_user_id);
  if (!adminUserId) return { ok: false, status: 401, body: { error: 'admin auth required (Bearer token or admin_user_id)' } };
  const client = await pool.connect();
  try {
    const r = await client.query('select role from users where id = $1', [adminUserId]);
    if (r.rowCount === 0) return { ok: false, status: 404, body: { error: 'user not found' } };
    if (r.rows[0].role !== 'admin') return { ok: false, status: 403, body: { error: 'admin_only' } };
    return { ok: true };
  } finally {
    client.release();
  }
}

// Список всех пользователей с краткой статистикой
app.get('/admin/users', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const client = await pool.connect();
  try {
    const users = await client.query(
      `select u.id, u.max_user_id, u.role, u.first_name, u.last_name, u.username,
              u.rating_sum, u.rating_count, u.created_at, u.is_blocked, u.block_reason, u.block_until
       from users u where u.role != 'admin'
       order by u.created_at desc`
    );
    const list = users.rows.map((u: UserRow) => ({
      id: u.id,
      max_user_id: u.max_user_id,
      role: u.role,
      first_name: u.first_name,
      last_name: u.last_name,
      username: u.username,
      rating_count: Number(u.rating_count) || 0,
      rating_avg: (Number(u.rating_count) || 0) > 0 ? Math.round((Number(u.rating_sum) / Number(u.rating_count)) * 10) / 10 : null,
      created_at: u.created_at,
      is_blocked: u.is_blocked,
      block_reason: u.block_reason,
      block_until: u.block_until
    }));

    const withStats = await Promise.all(list.map(async (u: any) => {
      const auc = await client.query('select count(*) as c from auctions where customer_id = $1', [u.id]);
      const bids = await client.query('select count(*) as c from bids where loader_id = $1', [u.id]);
      const activeAuc = await client.query("select count(*) as c from auctions where customer_id = $1 and status in ('active','paid')", [u.id]);
      return {
        ...u,
        auctions_count: Number(auc.rows[0]?.c) || 0,
        bids_count: Number(bids.rows[0]?.c) || 0,
        active_orders_count: Number(activeAuc.rows[0]?.c) || 0
      };
    }));

    res.json({ users: withStats });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Детали пользователя: заявки, ставки
app.get('/admin/users/:id', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const targetId = Number(req.params.id);
  if (!targetId) return res.status(400).json({ error: 'user id required' });

  const client = await pool.connect();
  try {
    const u = await client.query(
      'select * from users where id = $1',
      [targetId]
    );
    if (u.rowCount === 0) return res.status(404).json({ error: 'user not found' });
    const user = u.rows[0];

    const auctions = await client.query('select * from auctions where customer_id = $1 order by created_at desc', [targetId]);
    const bids = await client.query('select b.*, a.title as auction_title from bids b join auctions a on a.id = b.auction_id where b.loader_id = $1 order by b.created_at desc', [targetId]);
    const ratingsGiven = await client.query('select r.*, u2.first_name, u2.last_name from ratings r join users u2 on u2.id = r.to_user_id where r.from_user_id = $1 order by r.created_at desc', [targetId]);
    const ratingsReceived = await client.query('select r.*, u2.first_name, u2.last_name from ratings r join users u2 on u2.id = r.from_user_id where r.to_user_id = $1 order by r.created_at desc', [targetId]);

    res.json({
      user: {
        id: user.id,
        max_user_id: user.max_user_id,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        rating_sum: user.rating_sum,
        rating_count: user.rating_count,
        created_at: user.created_at,
        is_blocked: user.is_blocked,
        block_reason: user.block_reason,
        block_until: user.block_until
      },
      auctions: auctions.rows,
      bids: bids.rows,
      ratings_given: ratingsGiven.rows,
      ratings_received: ratingsReceived.rows
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Детали аукциона: заказчик, все ставки, лидер/победитель
app.get('/admin/auctions/:id', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const auctionId = Number(req.params.id);
  if (!auctionId) return res.status(400).json({ error: 'auction id required' });

  const client = await pool.connect();
  try {
    const auctionRes = await client.query(
      `select a.*, u.first_name, u.last_name, u.username,
              u.rating_sum, u.rating_count
       from auctions a
       join users u on u.id = a.customer_id
       where a.id = $1`,
      [auctionId]
    );
    if (auctionRes.rowCount === 0) return res.status(404).json({ error: 'auction not found' });
    const auctionRow = auctionRes.rows[0];
    const customerRatingCount = Number(auctionRow.rating_count) || 0;
    const customerRatingSum = Number(auctionRow.rating_sum) || 0;
    const customerRatingAvg =
      customerRatingCount > 0 ? Math.round((customerRatingSum / customerRatingCount) * 10) / 10 : null;

    const bidsRes = await client.query(
      `select b.*, u.first_name, u.last_name, u.username,
              u.rating_sum, u.rating_count
       from bids b
       join users u on u.id = b.loader_id
       where b.auction_id = $1
       order by b.amount asc, b.created_at asc`,
      [auctionId]
    );

    const bids = bidsRes.rows.map((b: any) => {
      const rc = Number(b.rating_count) || 0;
      const rs = Number(b.rating_sum) || 0;
      const ra = rc > 0 ? Math.round((rs / rc) * 10) / 10 : null;
      return {
        id: b.id,
        auction_id: b.auction_id,
        loader_id: b.loader_id,
        amount: b.amount,
        created_at: b.created_at,
        loader: {
          id: b.loader_id,
          first_name: b.first_name,
          last_name: b.last_name,
          username: b.username,
          rating_avg: ra,
          rating_count: rc
        }
      };
    });

    const leaderBid = bids.length > 0 ? bids[0] : null;
    const isFinished = ['finished', 'paid', 'completed'].includes(auctionRow.status);
    const winnerBid = isFinished ? leaderBid : null;

    res.json({
      auction: {
        id: auctionRow.id,
        title: auctionRow.title,
        description: auctionRow.description,
        cargo_params: auctionRow.cargo_params,
        date_time: auctionRow.date_time,
        auction_ends_at: auctionRow.auction_ends_at,
        status: auctionRow.status,
        created_at: auctionRow.created_at
      },
      customer: {
        id: auctionRow.customer_id,
        first_name: auctionRow.first_name,
        last_name: auctionRow.last_name,
        username: auctionRow.username,
        rating_avg: customerRatingAvg,
        rating_count: customerRatingCount
      },
      bids,
      leader_bid: leaderBid,
      winner_bid: winnerBid
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Блокировка / разблокировка
app.post('/admin/users/:id/block', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const targetId = Number(req.params.id);
  const { blocked, reason, until } = req.body as { blocked: boolean; reason?: string; until?: string };

  if (typeof blocked !== 'boolean') return res.status(400).json({ error: 'blocked (boolean) required' });

  const client = await pool.connect();
  try {
    if (blocked) {
      await client.query(
        'update users set is_blocked = true, block_reason = $2, block_until = $3 where id = $1',
        [targetId, reason || null, until ? new Date(until).toISOString() : null]
      );
    } else {
      await client.query(
        'update users set is_blocked = false, block_reason = null, block_until = null where id = $1',
        [targetId]
      );
    }
    const u = await client.query('select id, is_blocked, block_reason, block_until from users where id = $1', [targetId]);
    res.json({ user: u.rows[0] });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Статистика по сервису
app.get('/admin/stats', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const client = await pool.connect();
  try {
    const usersTotal = await client.query("select count(*) as c from users where role != 'admin'");
    const customers = await client.query("select count(*) as c from users where role = 'customer'");
    const loaders = await client.query("select count(*) as c from users where role = 'loader'");
    const auctionsTotal = await client.query('select count(*) as c from auctions');
    const auctionsActive = await client.query("select count(*) as c from auctions where status in ('active','paid')");
    const bidsTotal = await client.query('select count(*) as c from bids');
    const ratingsTotal = await client.query('select count(*) as c from ratings');
    const feeRes = await client.query('select service_fee_percent from service_settings where id = 1');

    res.json({
      users_total: Number(usersTotal.rows[0]?.c) || 0,
      customers_count: Number(customers.rows[0]?.c) || 0,
      loaders_count: Number(loaders.rows[0]?.c) || 0,
      auctions_total: Number(auctionsTotal.rows[0]?.c) || 0,
      auctions_active: Number(auctionsActive.rows[0]?.c) || 0,
      bids_total: Number(bidsTotal.rows[0]?.c) || 0,
      ratings_total: Number(ratingsTotal.rows[0]?.c) || 0,
      service_fee_percent: Number(feeRes.rows[0]?.service_fee_percent) || 10
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Удаление заявки админом
app.delete('/admin/auctions/:id', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const auctionId = Number(req.params.id);
  if (!auctionId) return res.status(400).json({ error: 'auction id required' });

  const client = await pool.connect();
  try {
    const exists = await client.query('select id from auctions where id = $1', [auctionId]);
    if (exists.rowCount === 0) {
      return res.status(404).json({ error: 'auction not found' });
    }
    await client.query('delete from auctions where id = $1', [auctionId]);
    res.json({ ok: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

async function finishAuctionInternally(auctionId: number): Promise<{ ok: true } | { ok: false; code: 'not_found' | 'not_active' | 'internal'; error: string }> {
  const client = await pool.connect();
  try {
    const auctionRes = await client.query(
      `select a.*, u.max_user_id as customer_max_user_id,
              u.first_name as customer_first_name,
              u.last_name as customer_last_name
       from auctions a
       join users u on u.id = a.customer_id
       where a.id = $1`,
      [auctionId]
    );
    if (auctionRes.rowCount === 0) {
      return { ok: false, code: 'not_found', error: 'auction not found' };
    }
    const auction = auctionRes.rows[0];
    if (auction.status !== 'active') {
      return { ok: false, code: 'not_active', error: 'auction is not active' };
    }

    // Определяем победившую ставку
    const bidsRes = await client.query(
      `select b.*, u.first_name, u.last_name, u.username
       from bids b
       join users u on u.id = b.loader_id
       where b.auction_id = $1
       order by b.amount asc, b.created_at asc`,
      [auctionId]
    );

    let winner: any | null = null;
    if (bidsRes.rowCount > 0) {
      winner = bidsRes.rows[0];
    }

    const updated = await client.query(
      'update auctions set status = $2, auction_ends_at = now(), winner_loader_id = $3, payment_status = $4 where id = $1 returning *',
      [auctionId, 'finished', winner ? winner.loader_id : null, winner ? 'waiting_payment' : null]
    );

    if (auction.customer_max_user_id) {
      if (!winner) {
        const text =
          `Заявка «${auction.title}» завершена.\n\n` +
          `К сожалению, ни один грузчик не сделал ставку.`;
        await sendMaxMessage(auction.customer_max_user_id, text, auctionId);
      } else {
        const customerName =
          (auction.customer_first_name || '') +
          (auction.customer_last_name ? ' ' + auction.customer_last_name : '');
        const loaderName =
          (winner.first_name || '') +
          (winner.last_name ? ' ' + winner.last_name : '');
        const textLines = [
          customerName ? `Здравствуйте, ${customerName}!` : 'Здравствуйте!',
          '',
          `Ваша заявка «${auction.title}» завершена.`,
          '',
          `Победившая ставка: ${winner.amount}.`,
          loaderName ? `Грузчик: ${loaderName}.` : 'Грузчик выбран.',
          winner.username ? `Контакты MAX: @${winner.username}` : '',
          '',
          'Нажмите кнопку, чтобы открыть мини‑приложение и перейти к оплате за получение контактов.'
        ].filter(Boolean);
        await sendMaxMessage(auction.customer_max_user_id, textLines.join('\n'), auctionId);
      }
    }

    console.log(`Auction ${auctionId} finished internally`);
    return { ok: true };
  } catch (e) {
    console.error('finishAuctionInternally error', e);
    return { ok: false, code: 'internal', error: 'internal error' };
  } finally {
    client.release();
  }
}

// Принудительное завершение заявки админом
app.post('/admin/auctions/:id/finish', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const auctionId = Number(req.params.id);
  if (!auctionId) return res.status(400).json({ error: 'auction id required' });

  const result = await finishAuctionInternally(auctionId);
  if (result.ok) {
    return res.json({ ok: true });
  }
  if (result.code === 'not_found') {
    return res.status(404).json({ error: result.error });
  }
  if (result.code === 'not_active') {
    return res.status(400).json({ error: result.error });
  }
  return res.status(500).json({ error: result.error });
});

// Массовая рассылка по роли
app.post('/admin/broadcast', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const { role, text } = req.body as { role?: 'customer' | 'loader'; text?: string };
  if (!role || (role !== 'customer' && role !== 'loader')) {
    return res.status(400).json({ error: 'role must be customer or loader' });
  }
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const client = await pool.connect();
  try {
    const usersRes = await client.query(
      'select max_user_id from users where role = $1 and is_blocked = false and max_user_id is not null',
      [role]
    );
    let sent = 0;
    for (const row of usersRes.rows) {
      await sendMaxMessage(row.max_user_id, text);
      sent += 1;
    }
    res.json({ ok: true, role, recipients: usersRes.rowCount, sent });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Настройка процента сервиса
app.get('/admin/service-fee', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const client = await pool.connect();
  try {
    const feeRes = await client.query('select service_fee_percent from service_settings where id = 1');
    res.json({ service_fee_percent: Number(feeRes.rows[0]?.service_fee_percent) || 10 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

app.post('/admin/service-fee', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const { percent } = req.body as { percent?: number };
  const value = Number(percent);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return res.status(400).json({ error: 'percent must be between 0 and 100' });
  }

  const client = await pool.connect();
  try {
    await client.query(
      `insert into service_settings (id, service_fee_percent)
       values (1, $1)
       on conflict (id) do update set service_fee_percent = excluded.service_fee_percent`,
      [value]
    );
    res.json({ ok: true, service_fee_percent: value });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// Тестовая рассылка уведомлений всем активным грузчикам
app.post('/admin/test-notify-loaders', async (req, res) => {
  const check = await requireAdmin(req);
  if (!check.ok) return res.status(check.status).json(check.body);

  const client = await pool.connect();
  try {
    const loadersResult = await client.query(
      'select max_user_id, first_name, last_name from users where role = $1 and is_blocked = false',
      ['loader']
    );
    const text = 'Тестовое уведомление от админа MAX: проверка доставки сообщений грузчикам. Если вы видите это сообщение, бот настроен правильно.';

    let sent = 0;
    for (const loader of loadersResult.rows) {
      await sendMaxMessage(loader.max_user_id, text);
      sent += 1;
    }

    res.json({ ok: true, loaders: loadersResult.rowCount, sent });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

async function start() {
  await initDb();

  // Автоматическое закрытие заявок после окончания торгов
  setInterval(async () => {
    try {
      const client = await pool.connect();
      try {
        const toClose = await client.query(
          `select id from auctions
           where status = 'active'
             and auction_ends_at <= now()
           order by auction_ends_at asc
           limit 20`
        );
        for (const row of toClose.rows) {
          const id = Number(row.id);
          if (!id) continue;
          console.log(`Auto-finishing auction ${id} by time`);
          await finishAuctionInternally(id);
        }
      } finally {
        client.release();
      }
    } catch (e) {
      console.error('Auto-finisher error', e);
    }
  }, 60_000);

  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on port ${config.port}`);
  });
}

start().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server', e);
  process.exit(1);
});

