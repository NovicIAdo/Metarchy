-- Chat blocking + DM read cursors (author backlog: a player may close a private
-- conversation, and a new DM must surface as an unread dot).
--
-- `chat_blocks`: blocker refuses to receive DMs from blocked. One direction —
-- blocking silences what reaches ME; it says nothing about what the other side
-- receives. The blocked writer is told at send time (the server checks before
-- the INSERT), which is the only honest moment: silently dropping would read as
-- a delivered message that never arrived.
create table chat_blocks (
  blocker    uuid not null references profiles (user_id) on delete cascade,
  blocked    uuid not null references profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint chat_blocks_not_self_check check (blocker <> blocked)
);

-- Per-participant read cursor for a private room: the last moment I opened that
-- conversation. A message newer than the cursor is unread; the conversation
-- list compares the latest message against it to raise the dot. Global room has
-- no cursor — it is a feed, not a queue, and "unread" means nothing there.
create table chat_reads (
  user_id  uuid not null references profiles (user_id) on delete cascade,
  room     text not null,
  read_at  timestamptz not null default now(),
  primary key (user_id, room)
);

alter table chat_blocks enable row level security;
create policy server_all_chat_blocks on chat_blocks
  for all to metarchy_server using (true) with check (true);
grant select, insert, delete on chat_blocks to metarchy_server;

alter table chat_reads enable row level security;
create policy server_all_chat_reads on chat_reads
  for all to metarchy_server using (true) with check (true);
grant select, insert, update on chat_reads to metarchy_server;
