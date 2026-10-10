-- Achievements (author's list, 2026-07-27). One row per (user, achievement) and
-- the primary key IS the idempotency guarantee, exactly like gato_rewards: a
-- badge is granted on every finish that satisfies it, so the second, third and
-- thousandth qualifying game insert nothing and `earned_at` keeps pointing at
-- the moment it was first earned. That is what makes "first win" trivially
-- correct — it is granted on EVERY win, and only the first one lands.
--
-- The catalog (ids, thresholds, i18n keys) lives in packages/protocol/src/
-- achievements.ts, not here: this table stores nothing but "who has which id".
-- No enum, no FK to a catalog table — ids are added over time and a deploy must
-- never have to migrate the schema to ship a badge. Ids are forever; see the
-- header of that file.
--
-- No GATO is paid for an achievement (the author has not decided yet), so there
-- is deliberately no amount column and no ledger relationship to wallets.

create table achievements (
  user_id        uuid not null references profiles (user_id) on delete cascade,
  achievement_id text not null,
  earned_at      timestamptz not null default now(),
  -- Which game earned it, when a game did. Counters (play.*) are facts about the
  -- whole archive rather than about one match, so they carry null. ON DELETE SET
  -- NULL, not CASCADE: the badge outlives the game it came from — snapshot/game
  -- retention must never take a player's achievements with it.
  game_id        uuid references games (id) on delete set null,
  primary key (user_id, achievement_id)
);

-- The only read path: every badge of one user, for their profile and for the
-- public profile of another player.
create index achievements_user_idx on achievements (user_id, earned_at);

alter table achievements enable row level security;
create policy server_all_achievements on achievements
  for all to metarchy_server using (true) with check (true);
grant select, insert on achievements to metarchy_server;
