"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.initDb = initDb;
const pg_1 = require("pg");
const config_1 = require("./config");
exports.pool = new pg_1.Pool({
    host: config_1.config.db.host,
    port: config_1.config.db.port,
    user: config_1.config.db.user,
    // Страхуемся: пароль в pg должен быть строкой
    password: String(config_1.config.db.password ?? ''),
    database: config_1.config.db.database
});
async function initDb() {
    await exports.pool.query(`
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
      cargo_params jsonb,
      date_time timestamptz not null,
      auction_ends_at timestamptz not null,
      status varchar(16) not null check (status in ('active', 'finished', 'paid', 'completed', 'cancelled')),
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
    await exports.pool.query(`
    alter table users add column if not exists block_until timestamptz;
  `).catch(() => { });
}
