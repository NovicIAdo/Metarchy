-- Ranked payouts (author's schedule, 2026-07-26): the ledger that makes a
-- credit idempotent. The primary key is the whole point — a game is finished
-- exactly once in the happy path, but a crashed server replays intents through
-- the engine on boot and can reach `finished` again, and finishGame is also
-- reachable from recovery. One row per (game, seat) means the second attempt
-- inserts nothing and the wallet is never credited twice.
--
-- The row is written for every ranked human seat, including the ones that earned
-- 0, so "played, earned nothing" stays distinguishable from "never paid".
-- Bots have no wallet and no row: their seat is not a user.

create table gato_rewards (
  game_id    uuid not null references games (id) on delete cascade,
  seat       smallint not null check (seat between 0 and 3),
  user_id    uuid not null references profiles (user_id) on delete cascade,
  amount     bigint not null check (amount >= 0),
  created_at timestamptz not null default now(),
  primary key (game_id, seat)
);

create index gato_rewards_user_idx on gato_rewards (user_id);

alter table gato_rewards enable row level security;
create policy server_all_gato_rewards on gato_rewards
  for all to metarchy_server using (true) with check (true);
grant select, insert on gato_rewards to metarchy_server;
