import express from 'express';
import cors from 'cors';
import { json } from 'express';
import { config } from './config';
import { initDb, pool } from './db';

const app = express();

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
    role: 'customer' | 'loader';
  };

  if (!max_user_id || !role) {
    return res.status(400).json({ error: 'max_user_id and role are required' });
  }

  const client = await pool.connect();
  try {
    let userResult = await client.query(
      'select * from users where max_user_id = $1',
      [max_user_id]
    );

    if (userResult.rowCount === 0) {
      userResult = await client.query(
        `insert into users (max_user_id, role, first_name, last_name, username)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [max_user_id, role, first_name || null, last_name || null, username || null]
      );
    } else {
      userResult = await client.query(
        `update users
         set first_name = $2, last_name = $3, username = $4
         where max_user_id = $1
         returning *`,
        [max_user_id, first_name || null, last_name || null, username || null]
      );
    }

    const row = userResult.rows[0];
    const ratingCount = Number(row.rating_count) || 0;
    const ratingSum = Number(row.rating_sum) || 0;
    const ratingAvg = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null;
    const user = {
      id: row.id,
      max_user_id: row.max_user_id,
      role: row.role,
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

