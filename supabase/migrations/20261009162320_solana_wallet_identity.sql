-- Explicit game-account linking. Auth principals resolve directly to a profile;
-- independent player profiles are never merged. This schema is not exposed by
-- the Data API, and clients receive neither schema usage nor table privileges.
create schema if not exists metarchy_private;
revoke all on schema metarchy_private from public;

create table metarchy_private.auth_principals (
  auth_user_id uuid primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  linked_at timestamptz not null default now(),
  unique (auth_user_id, user_id)
);
create index auth_principals_profile_idx on metarchy_private.auth_principals (user_id);

create table metarchy_private.solana_wallets (
  address text primary key check (char_length(address) between 1 and 44),
  auth_user_id uuid not null,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  linked_at timestamptz not null default now(),
  foreign key (auth_user_id, user_id)
    references metarchy_private.auth_principals (auth_user_id, user_id) on delete cascade
);
create index solana_wallets_profile_idx on metarchy_private.solana_wallets (user_id);

create table metarchy_private.wallet_link_challenges (
  id uuid primary key,
  primary_auth_user_id uuid not null,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  request jsonb not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index wallet_link_challenges_expiry_idx on metarchy_private.wallet_link_challenges (expires_at);

-- Local Auth-free backends remember email grants only from a verified canonical
-- principal's JWT. Aliases cannot replace the canonical cosmetic grant identity.
create table metarchy_private.profile_auth_emails (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  email text
);

alter table metarchy_private.auth_principals enable row level security;
alter table metarchy_private.solana_wallets enable row level security;
alter table metarchy_private.wallet_link_challenges enable row level security;
alter table metarchy_private.profile_auth_emails enable row level security;
revoke all on all tables in schema metarchy_private from public;

-- The server needs only the UUIDs with verified factors. The owner-backed view
-- deliberately exposes no factor IDs, types, phone numbers, or TOTP secrets.
-- Its private schema and revoked PUBLIC/client privileges prevent an API path.
-- Bare PGlite has no Auth service: the empty view preserves the same SQL API.
do $$ begin
  if to_regclass('auth.mfa_factors') is not null then
    execute 'create view metarchy_private.verified_mfa_users with (security_barrier = true) as
      select distinct user_id from auth.mfa_factors where status = ''verified''';
    execute 'create view metarchy_private.auth_policy_status as select true as available';
  else
    execute 'create view metarchy_private.verified_mfa_users as
      select null::uuid as user_id where false';
    execute 'create view metarchy_private.auth_policy_status as select false as available';
  end if;
  if to_regclass('auth.users') is not null then
    -- A narrow private owner-backed view supplies canonical email grants without
    -- exposing any Auth credential columns or granting Auth table/schema access.
    execute 'create view metarchy_private.canonical_auth_emails with (security_barrier = true) as select id as user_id, email from auth.users';
    alter table metarchy_private.auth_principals add constraint auth_principals_auth_fkey
      foreign key (auth_user_id) references auth.users (id) on delete cascade;
    alter table metarchy_private.wallet_link_challenges add constraint wallet_challenge_auth_fkey
      foreign key (primary_auth_user_id) references auth.users (id) on delete cascade;
  else
    execute 'create view metarchy_private.canonical_auth_emails with (security_invoker = true) as select user_id, email from metarchy_private.profile_auth_emails';
  end if;
end $$;
revoke all on metarchy_private.verified_mfa_users from public;
revoke all on metarchy_private.auth_policy_status from public;
revoke all on metarchy_private.canonical_auth_emails from public;

do $$ begin
  if exists (select from pg_roles where rolname = 'anon') then
    revoke all on schema metarchy_private from anon;
    revoke all on all tables in schema metarchy_private from anon;
  end if;
  if exists (select from pg_roles where rolname = 'authenticated') then
    revoke all on schema metarchy_private from authenticated;
    revoke all on all tables in schema metarchy_private from authenticated;
  end if;
  if exists (select from pg_roles where rolname = 'metarchy_server') then
    grant usage on schema metarchy_private to metarchy_server;
    grant select, insert on metarchy_private.auth_principals to metarchy_server;
    grant select, insert on metarchy_private.solana_wallets to metarchy_server;
    grant select, insert, update, delete on metarchy_private.wallet_link_challenges to metarchy_server;
    grant select on metarchy_private.verified_mfa_users to metarchy_server;
    grant select on metarchy_private.auth_policy_status to metarchy_server;
    grant select on metarchy_private.canonical_auth_emails to metarchy_server;
    grant select, insert, update on metarchy_private.profile_auth_emails to metarchy_server;
    create policy server_principals on metarchy_private.auth_principals
      for all to metarchy_server using (true) with check (true);
    create policy server_solana_wallets on metarchy_private.solana_wallets
      for all to metarchy_server using (true) with check (true);
    create policy server_wallet_challenges on metarchy_private.wallet_link_challenges
      for all to metarchy_server using (true) with check (true);
    create policy server_profile_auth_emails on metarchy_private.profile_auth_emails
      for all to metarchy_server using (true) with check (true);
  end if;
end $$;
