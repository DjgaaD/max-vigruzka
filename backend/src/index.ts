import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { json } from 'express';
import { config } from './config';
import { initDb, pool } from './db';

const app = express();

const ADMIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const adminTokens = new Map<string, number>();

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
  const { user_id, title, description, cargo_params, date_time, auction_ends_at } = req.body as {
    user_id: number;
    title: string;
    description?: string;
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
      `insert into auctions (customer_id, title, description, cargo_params, date_time, auction_ends_at, status)
       values ($1, $2, $3, $4, $5, $6, 'active')
       returning *`,
      [user_id, title, description || null, cargo_params || null, date_time, auction_ends_at]
    );

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
    const list = users.rows.map((u) => ({
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

    const withStats = await Promise.all(list.map(async (u) => {
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

    res.json({
      users_total: Number(usersTotal.rows[0]?.c) || 0,
      customers_count: Number(customers.rows[0]?.c) || 0,
      loaders_count: Number(loaders.rows[0]?.c) || 0,
      auctions_total: Number(auctionsTotal.rows[0]?.c) || 0,
      auctions_active: Number(auctionsActive.rows[0]?.c) || 0,
      bids_total: Number(bidsTotal.rows[0]?.c) || 0,
      ratings_total: Number(ratingsTotal.rows[0]?.c) || 0
    });
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

