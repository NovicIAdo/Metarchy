-- Security pass (Stage 6): profile writes go through the game server only.
-- The own-row insert/update policies let a client hit PostgREST directly and
-- bypass validateNickname (reserved names, blocklist, charset) — uniqueness was
-- the only rule the DB itself enforced. The server writes as metarchy_server
-- (server_all_profiles), so client-side write policies are dead weight + a hole.
-- `if exists` keeps this a no-op on PGlite, where init.sql never created them.

drop policy if exists profiles_own_insert on profiles;
drop policy if exists profiles_own_update on profiles;
