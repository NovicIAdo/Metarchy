# Self-Hosting Migration (Supabase → own server)

> Decision (author, 2026-07-11): no paid Supabase tier for production. After the
> MVP proves itself, the backend moves to our own server; development continues
> so that only this migration and cosmetics remain. This note pins down exactly
> what the migration consists of — and what is already portable by construction.

## Already portable (no work at migration time)

- **Game store** — plain SQL behind the `GameStore` interface; runs today on
  node-postgres *and* embedded PGlite from the same `supabase/migrations/*.sql`.
  Any Postgres 15+ works: point `DATABASE_URL` at it (`MIGRATE_ON_BOOT=1`
  applies the schema; `PG_POOL_SIZE` sizes the pool). Crash recovery,
  proof trail and the kill-9 e2e are Supabase-agnostic.
- **JWT verification** — the server validates *any* issuer via `jose`:
  `SUPABASE_JWKS_JSON` / `SUPABASE_JWT_SECRET` / `SUPABASE_URL` are just key
  sources (the Stage-6 load test authenticated 2 000 users through the JWKS
  escape hatch against a non-Supabase issuer). A self-hosted auth service only
  needs to publish a JWKS and mint the same claim shape
  (`sub`, `aud=authenticated`, `role=authenticated`).
- **Hosting** — the game server is a single stateless-boot Docker image
  (rooms rebuild from the DB); Fly.io today, any Docker host tomorrow.

## The actual migration surface (3 couplings)

1. **Auth service + user records** (the big one). Today: Supabase Auth (email
   + Google OAuth, confirmations, password reset) and the `auth.users` table.
   Options, in increasing effort: self-hosted GoTrue (same API — the client's
   `@supabase/supabase-js` auth calls keep working against a swapped URL);
   another OIDC provider; or own auth. User migration = export `auth.users`
   (ids, emails, password hashes — GoTrue hashes are bcrypt and portable to a
   GoTrue self-host; third-party OAuth users just re-link by email).
   **Keep user ids stable** — `profiles.user_id` and ratings key on them.
2. **`profiles.user_id → auth.users` FK** — points into the auth schema.
   On a self-host with GoTrue the FK carries over; with own auth, repoint it at
   the new users table (or drop it — the server is the only writer since the
   2026-07-11 security pass).
3. **Client's direct PostgREST read** — exactly one: the leaderboard
   (`LeaderboardScreen` reads the `leaderboard` view with the anon key).
   Either run PostgREST on the self-host (it's open source) or add a tiny
   server endpoint (`GET /leaderboard`) and delete the Supabase client usage
   there. Everything else already flows through our WebSocket.

## Practical order when the day comes

1. Stand up Postgres; restore a dump of `public.*`; run `migrate` to verify.
2. Stand up auth (GoTrue self-host is the path of least change), import users,
   publish JWKS; point the game server's verifier at it.
3. Swap the client's auth URL + leaderboard read; drop the anon-key dependency.
4. Move DNS; keep the old Supabase project read-only for a rollback window.

Sizing note: per the Stage-6 load test, 1 000 concurrent real-paced games need
~100–200 applied intents/s ≈ ~500 DB writes/s after the write-path slimming
(commitment folded into the events insert, snapshot retention) — comfortably a
single modest Postgres box in the same DC as the game server.
