-- Persisted chat (author backlog #3): a global room every registered player can
-- write to, and player↔player private messages. Distinct from the in-game chat,
-- which is relayed per room and never stored. Server-only data, written over the
-- authenticated socket; the rules (255 chars, one global message per minute, 10
-- flags from 10 different players) live in protocol chat.ts and are enforced by
-- the server — the checks here are the second line, so a bad write cannot land
-- even if a code path forgets.

-- `room` is the conversation key, derived by the server and never accepted from
-- a client: 'global', or 'dm:<lower uuid>:<higher uuid>' so both directions of a
-- private conversation land in one room. `recipient_id` is the addressee of a
-- DM (null in the global room) and is what makes the participant test a plain
-- column read rather than a string parse.
create table chat_messages (
  id           uuid primary key,
  room         text not null,
  author_id    uuid not null references profiles (user_id) on delete cascade,
  recipient_id uuid references profiles (user_id) on delete cascade,
  -- Threads are exactly one level deep (the author drew YouTube comments): a
  -- reply to a reply is re-parented to the same top-level message by the server.
  parent_id    uuid references chat_messages (id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 255),
  created_at   timestamptz not null default now(),
  -- Soft removal by flags. A hard delete would lose the moderation trail and
  -- orphan the thread underneath, so a removed message stays as a tombstone:
  -- unservable as content, still the anchor of its replies.
  hidden_at    timestamptz,
  constraint chat_messages_scope_check check ((room = 'global') = (recipient_id is null)),
  -- Writing to yourself is not a conversation; the server refuses it too.
  constraint chat_messages_not_self_check check (recipient_id is distinct from author_id)
);

-- The room page (top-level, newest first) and the thread fetch are the only two
-- read patterns.
create index chat_messages_room_idx on chat_messages (room, created_at desc);
create index chat_messages_parent_idx on chat_messages (parent_id);
-- The rolling one-per-minute window is a lookup by (author, room, time).
create index chat_messages_author_idx on chat_messages (author_id, room, created_at desc);

-- 10 flags from 10 DIFFERENT players remove a message: the primary key IS that
-- rule, so a second flag from the same player can never count twice.
create table chat_flags (
  message_id uuid not null references chat_messages (id) on delete cascade,
  user_id    uuid not null references profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- One reaction per (message, player), switchable — the primary key forbids
-- holding a like and a dislike on the same message, and forbids stacking either.
-- Counters are always count(*) over these rows; there is no counter column to
-- drift away from the truth.
create table chat_reactions (
  message_id uuid not null references chat_messages (id) on delete cascade,
  user_id    uuid not null references profiles (user_id) on delete cascade,
  reaction   text not null check (reaction in ('like', 'dislike')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- Both are read per message while paging a room.
create index chat_reactions_message_idx on chat_reactions (message_id, reaction);

alter table chat_messages enable row level security;
create policy server_all_chat_messages on chat_messages
  for all to metarchy_server using (true) with check (true);
grant select, insert, update on chat_messages to metarchy_server;

alter table chat_flags enable row level security;
create policy server_all_chat_flags on chat_flags
  for all to metarchy_server using (true) with check (true);
grant select, insert on chat_flags to metarchy_server;

alter table chat_reactions enable row level security;
create policy server_all_chat_reactions on chat_reactions
  for all to metarchy_server using (true) with check (true);
grant select, insert, update, delete on chat_reactions to metarchy_server;
