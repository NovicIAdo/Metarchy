-- Snapshot retention (perf pass) prunes superseded rows inside writeSnapshot,
-- which needs DELETE on exactly this table. The server role stays delete-less
-- everywhere else: game_events and move_commitments are the immutable audit
-- trail; snapshots are derived state, safe to discard once superseded.

grant delete on game_snapshots to metarchy_server;
