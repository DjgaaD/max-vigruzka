import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  // Страхуемся: пароль в pg должен быть строкой
  password: String(config.db.password ?? ''),
  database: config.db.database
});

export async function initDb() {
  await pool.query(`
    create table if not exists users (
      id bigserial primary key,
      max_user_id bigint not null unique,
      role varchar(16) not null check (role in ('customer', 'loader', 'admin')),
      first_name text,
      last_name text,
      username text,
      rating_sum integer default 0,
      rating_count integer default 0,
      is_blocked boolean default false,
      block_reason text,
      created_at timestamptz default now()
    );

    create table if not exists auctions (
      id bigserial primary key,
      customer_id bigint not null references users(id),
      title text not null,
      description text,
      street text,
      house text,
      flat text,
      cargo_params jsonb,
      date_time timestamptz not null,
      auction_ends_at timestamptz not null,
      status varchar(16) not null check (status in ('active', 'finished', 'paid', 'completed', 'cancelled')),
      winner_loader_id bigint references users(id),
      payment_status varchar(16) check (payment_status in ('waiting_payment', 'paid', 'completed')),
      loader_payout numeric(12,2),
      loader_marked_done boolean default false,
      customer_confirmed_done boolean default false,
      created_at timestamptz default now()
    );

    create table if not exists bids (
      id bigserial primary key,
      auction_id bigint not null references auctions(id) on delete cascade,
      loader_id bigint not null references users(id),
      amount numeric(12,2) not null,
      created_at timestamptz default now(),
      unique (auction_id, loader_id)
    );

    create table if not exists ratings (
      id bigserial primary key,
      auction_id bigint not null references auctions(id) on delete cascade,
      from_user_id bigint not null references users(id),
      to_user_id bigint not null references users(id),
      score integer not null check (score between 1 and 5),
      comment text,
      created_at timestamptz default now()
    );

    create table if not exists support_tickets (
      id bigserial primary key,
      user_id bigint not null references users(id),
      subject text not null,
      message text not null,
      status varchar(16) not null default 'open',
      created_at timestamptz default now()
    );
  `);
  await pool.query(`
    alter table users add column if not exists block_until timestamptz;
    alter table users add column if not exists balance numeric(14,2) default 0;
    alter table auctions add column if not exists street text;
    alter table auctions add column if not exists house text;
    alter table auctions add column if not exists flat text;
    alter table auctions add column if not exists winner_loader_id bigint references users(id);
    alter table auctions add column if not exists payment_status varchar(16);
    alter table auctions add column if not exists loader_payout numeric(12,2);
    alter table auctions add column if not exists loader_marked_done boolean default false;
    alter table auctions add column if not exists customer_confirmed_done boolean default false;
  `).catch(() => { /* columns may already exist in older PG */ });

  await pool.query(`
    create table if not exists service_settings (
      id integer primary key default 1,
      service_fee_percent numeric(5,2) not null default 10
    );
    insert into service_settings (id, service_fee_percent)
    values (1, 10)
    on conflict (id) do nothing;
  `).catch(() => { /* table may already exist */ });
}

