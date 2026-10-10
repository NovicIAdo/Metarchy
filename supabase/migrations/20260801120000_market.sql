-- Player↔player market: cosmetics change hands for GATO, with public comments
-- on a lot so the price is haggled in the open. Design: plan/Market-Plan.md.
--
-- The entitlement itself stays where it already lives — `purchases` — and a sale
-- MOVES the row. That is why this migration grants `delete` on purchases: the
-- seller must stop owning what the buyer starts owning, inside one transaction
-- with both wallet moves. `market_trades` is the audit trail of that instant,
-- not a second source of truth.
--
-- GATO is never burned (author, 2026-08-01): the fee recorded here belongs to
-- the stakers' revenue pool, and is 0 for the duration of the test.

create table market_listings (
  id         uuid primary key default gen_random_uuid(),
  seller     uuid not null references profiles (user_id) on delete cascade,
  item_id    text not null,
  price      bigint not null check (price > 0),
  status     text not null check (status in ('active', 'sold', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  buyer      uuid references profiles (user_id),
  sold_at    timestamptz
);

-- One item, one live lot. This partial unique index IS the escrow lock: while a
-- lot is active the seller cannot list the same item twice, and the equip gate
-- reads the same rows to refuse wearing what is on the shelf.
create unique index market_one_active on market_listings (seller, item_id) where status = 'active';
-- The shelf: active lots, newest first, id as a stable tiebreak so paging cannot
-- repeat or skip a row when two lots share a timestamp.
create index market_browse on market_listings (status, created_at desc, id);
create index market_seller on market_listings (seller, status);

create table market_trades (
  listing_id uuid primary key references market_listings (id) on delete cascade,
  seller     uuid not null references profiles (user_id) on delete cascade,
  buyer      uuid not null references profiles (user_id) on delete cascade,
  item_id    text not null,
  price      bigint not null,
  -- Seller's cut. Not burned — it accrues to the stakers' revenue pool.
  fee        bigint not null default 0,
  created_at timestamptz not null default now()
);
create index market_trades_seller on market_trades (seller, created_at desc);
create index market_trades_buyer on market_trades (buyer, created_at desc);

-- clock_timestamp(), not now(): now() is the TRANSACTION timestamp, so two
-- comments posted a millisecond apart can carry the identical value and the
-- thread then falls back to ordering by a random uuid — a haggle read out of
-- order. clock_timestamp() is the wall clock at the moment of the insert.
create table market_comments (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references market_listings (id) on delete cascade,
  author     uuid not null references profiles (user_id) on delete cascade,
  body       text not null check (length(body) between 1 and 280),
  created_at timestamptz not null default clock_timestamp()
);
create index market_comments_listing on market_comments (listing_id, created_at);

-- Cosmetics that fell out of a finished ranked game. Same idempotency contract
-- as gato_rewards: one row per (game, seat), so a recovered game that reaches
-- `finished` twice cannot drop twice. The row is written even when nothing
-- landed (item_id null = "rolled, owned everything already"), so "no drop" stays
-- distinguishable from "never rolled".
create table item_drops (
  game_id    uuid not null references games (id) on delete cascade,
  seat       smallint not null check (seat between 0 and 3),
  user_id    uuid not null references profiles (user_id) on delete cascade,
  item_id    text,
  created_at timestamptz not null default now(),
  primary key (game_id, seat)
);
create index item_drops_user on item_drops (user_id);

alter table market_listings enable row level security;
create policy server_all_market_listings on market_listings
  for all to metarchy_server using (true) with check (true);
grant select, insert, update on market_listings to metarchy_server;

alter table market_trades enable row level security;
create policy server_all_market_trades on market_trades
  for all to metarchy_server using (true) with check (true);
grant select, insert on market_trades to metarchy_server;

alter table market_comments enable row level security;
create policy server_all_market_comments on market_comments
  for all to metarchy_server using (true) with check (true);
grant select, insert, delete on market_comments to metarchy_server;

alter table item_drops enable row level security;
create policy server_all_item_drops on item_drops
  for all to metarchy_server using (true) with check (true);
grant select, insert on item_drops to metarchy_server;

-- A sale moves the entitlement row; the original grant was select+insert only.
grant delete on purchases to metarchy_server;
