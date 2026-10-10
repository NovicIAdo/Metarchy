-- Metarchy initial schema — architecture/Data-Model.md.
-- Written to run on Supabase AND on bare Postgres/PGlite (tests): Supabase-only
-- objects (auth.users FK, auth.uid() policies, anon/authenticated roles) are
-- guarded so the same file is the single source of truth everywhere.

-- Roles referenced by grants/policies (exist on Supabase; created inert elsewhere).
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  -- The game server's dedicated least-privilege role. LOGIN + password are
  -- granted at deploy time (never in a migration).
  if not exists (select from pg_roles where rolname = 'metarchy_server') then
    create role metarchy_server nologin;
  end if;
end $$;

-- Identity ------------------------------------------------------------------

create table profiles (
  user_id    uuid primary key,
  nickname   text unique not null check (char_length(nickname) between 3 and 20),
  avatar     text,
  created_at timestamptz not null default now()
);

do $$ begin
  if exists (select from pg_namespace where nspname = 'auth') then
    alter table profiles
      add constraint profiles_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete cascade;
  end if;
end $$;

create table ratings (
  user_id    uuid not null references profiles (user_id) on delete cascade,
  mode       text not null check (mode in ('1v1', 'ffa3', '2v2')),
  rating     real not null default 1500,
  rd         real not null default 350,
  volatility real not null default 0.06,
  games      int  not null default 0,
  updated_at timestamptz,
  primary key (user_id, mode)
);

-- Games ---------------------------------------------------------------------

create table games (
  id             uuid primary key,
  mode           text not null check (mode in ('1v1', 'ffa3', '2v2', 'vs_bots')),
  status         text not null check (status in ('lobby', 'active', 'finished', 'aborted')),
  is_private     boolean not null default false,
  invite_code    text unique,
  rules_version  text not null,
  rng_seed_hash  text not null,
  rng_seed       text,             -- revealed at game end (proof trail)
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);

create index games_status_idx on games (status);

create table game_players (
  game_id       uuid not null references games (id) on delete cascade,
  seat          smallint not null check (seat between 0 and 3),
  user_id       uuid references profiles (user_id),  -- null for bots
  bot_strategy  text,                                -- null for humans
  result        text check (result in ('win', 'lose', 'eliminated', 'aborted')),
  final_vp      int,
  rating_before real,
  rating_after  real,
  primary key (game_id, seat)
);

create index game_players_user_idx on game_players (user_id);

-- History: the event-sourced core ---------------------------------------------
-- Replay model: the first event row of each accepted intent carries that intent
-- (and its seat); recovery re-applies intents through the deterministic engine
-- and verifies the regenerated event seqs match the log.

create table game_events (
  game_id     uuid not null references games (id) on delete cascade,
  seq         bigint not null,
  type        text not null,
  payload     jsonb not null,       -- full EngineEvent incl. visibility
  intent      jsonb,                -- set on the first event of an apply
  intent_seat smallint,
  created_at  timestamptz not null default now(),
  primary key (game_id, seq)
);

create table game_snapshots (
  game_id    uuid not null references games (id) on delete cascade,
  seq        bigint not null,       -- state as of this event seq
  state      jsonb not null,        -- canonical GameState (server-only!)
  created_at timestamptz not null default now(),
  primary key (game_id, seq)
);

-- Proof trail (blockchain-ready, no crypto dependencies) -----------------------

create table move_commitments (
  game_id uuid not null references games (id) on delete cascade,
  seq     bigint not null,          -- game_events seq of the accepted intent
  seat    smallint not null,
  turn    smallint not null,
  phase   smallint not null,
  hash    text not null,            -- keccak256(canonicalJson({gameId,turn,phase,seat,intent}) || salt)
  salt    text not null,
  primary key (game_id, seq)
);

-- Views -------------------------------------------------------------------------

create view leaderboard as
  select r.mode, p.nickname, p.avatar, r.rating, r.rd, r.games, r.user_id
  from ratings r
  join profiles p using (user_id)
  where r.games > 0
  order by r.mode, r.rating desc;

create view match_history as
  select gp.user_id, g.id as game_id, g.mode, g.status, gp.seat, gp.result,
         gp.final_vp, gp.rating_before, gp.rating_after, g.finished_at
  from game_players gp
  join games g on g.id = gp.game_id
  where g.status in ('finished', 'aborted');

-- Security stance (Data-Model.md §4): deny by default -----------------------------

alter table profiles         enable row level security;
alter table ratings          enable row level security;
alter table games            enable row level security;
alter table game_players     enable row level security;
alter table game_events      enable row level security;
alter table game_snapshots   enable row level security;
alter table move_commitments enable row level security;

-- Public reads: profiles (nickname/avatar) and ratings.
create policy profiles_public_read on profiles for select using (true);
create policy ratings_public_read  on ratings  for select using (true);

-- Users manage their own profile row (Supabase only — needs auth.uid()).
do $$ begin
  if exists (select from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'auth' and p.proname = 'uid') then
    execute 'create policy profiles_own_insert on profiles for insert '
         || 'with check (auth.uid() = user_id)';
    execute 'create policy profiles_own_update on profiles for update '
         || 'using (auth.uid() = user_id) with check (auth.uid() = user_id)';
  end if;
end $$;

-- The game server role: full access to game data, nothing exposed to clients.
create policy server_all_profiles     on profiles         for all to metarchy_server using (true) with check (true);
create policy server_all_ratings      on ratings          for all to metarchy_server using (true) with check (true);
create policy server_all_games        on games            for all to metarchy_server using (true) with check (true);
create policy server_all_players      on game_players     for all to metarchy_server using (true) with check (true);
create policy server_all_events       on game_events      for all to metarchy_server using (true) with check (true);
create policy server_all_snapshots    on game_snapshots   for all to metarchy_server using (true) with check (true);
create policy server_all_commitments  on move_commitments for all to metarchy_server using (true) with check (true);

-- Grants: PostgREST roles read only what RLS already allows; the server role
-- gets table privileges (RLS still applies, via the policies above).
grant usage on schema public to anon, authenticated, metarchy_server;
grant select on profiles, ratings, leaderboard to anon, authenticated;
grant select, insert, update on profiles, ratings, games, game_players,
  game_events, game_snapshots, move_commitments to metarchy_server;
grant select on leaderboard, match_history to metarchy_server;
