-- Per-user starred replays: pins past games into a favorites filter in the
-- replay gallery so players can revisit them for study without hunting through
-- the archive. Server-only data — written over the authenticated socket.

create table replay_stars (
  user_id    uuid not null references profiles (user_id) on delete cascade,
  game_id    uuid not null references games (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

-- FK cascade from games and per-game star probes scan by game_id.
create index replay_stars_game_idx on replay_stars (game_id);

alter table replay_stars enable row level security;
create policy server_all_replay_stars on replay_stars
  for all to metarchy_server using (true) with check (true);
grant select, insert, delete on replay_stars to metarchy_server;
