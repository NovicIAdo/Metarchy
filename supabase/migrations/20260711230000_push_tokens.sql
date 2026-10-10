-- FCM device tokens for "your turn" pushes (Stage 5). Server-only data: written
-- on push.register over the authenticated socket, read when a waited-on player
-- is disconnected, deleted when FCM reports the token gone — hence the DELETE
-- grant on exactly this table (operational data, not audit trail).

create table push_tokens (
  token      text primary key,
  user_id    uuid not null references profiles (user_id) on delete cascade,
  platform   text not null default 'android',
  updated_at timestamptz not null default now()
);

create index push_tokens_user_idx on push_tokens (user_id);

alter table push_tokens enable row level security;
create policy server_all_push_tokens on push_tokens
  for all to metarchy_server using (true) with check (true);
grant select, insert, update, delete on push_tokens to metarchy_server;
