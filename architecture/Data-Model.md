# Data Model (Supabase / PostgreSQL)

> What Supabase is used for, the schema, and the security stance.
> Managed via `supabase/` migrations (supabase CLI); a dedicated Supabase project is
> created for Metarchy (separate from other projects in the org).

---

## 1. What Supabase Provides

| Capability | Used for | Notes |
|---|---|---|
| **Auth** | email + Google + Apple sign-in, JWT issuance | the game server verifies JWTs via JWKS; no passwords or sessions handled by our code |
| **PostgreSQL** | all persistent data (below) | game server connects with the service role |
| **PostgREST (auto API)** | client reads of *public* data only: own profile, leaderboards | guarded by RLS |
| *Not used:* Supabase Realtime for the game loop | — | game traffic goes through our WebSocket server |

## 2. Schema

```sql
-- Identity ------------------------------------------------------------------
profiles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users,
  nickname    text UNIQUE NOT NULL,          -- 3..20 chars, moderated later
  avatar      text,                          -- asset key, not URL
  created_at  timestamptz DEFAULT now()
)

ratings (
  user_id     uuid REFERENCES profiles,
  mode        text,                          -- '1v1' | 'ffa3' | '2v2'
  rating      real NOT NULL DEFAULT 1500,    -- Glicko-2
  rd          real NOT NULL DEFAULT 350,
  volatility  real NOT NULL DEFAULT 0.06,
  games       int  NOT NULL DEFAULT 0,
  updated_at  timestamptz,
  PRIMARY KEY (user_id, mode)
)

-- Games ---------------------------------------------------------------------
games (
  id             uuid PRIMARY KEY,
  mode           text NOT NULL,              -- '1v1' | 'ffa3' | '2v2' | 'vs_bots'
  status         text NOT NULL,              -- 'lobby' | 'active' | 'finished' | 'aborted'
  is_private     boolean DEFAULT false,
  invite_code    text UNIQUE,                -- short code for private games
  rules_version  text NOT NULL,              -- engine RULES_VERSION at creation
  rng_seed_hash  text NOT NULL,              -- keccak256(seed), published at start
  rng_seed       text,                       -- revealed at game end (proof trail)
  created_at     timestamptz, started_at timestamptz, finished_at timestamptz
)

game_players (
  game_id       uuid REFERENCES games,
  seat          smallint,                    -- 0..3
  user_id       uuid REFERENCES profiles,    -- NULL for bots
  bot_strategy  text,                        -- NULL for humans
  result        text,                        -- 'win' | 'lose' | 'eliminated' | 'aborted'
  final_vp      int,
  rating_before real, rating_after real,     -- NULL for unranked/bots
  PRIMARY KEY (game_id, seat)
)

-- History: the event-sourced core --------------------------------------------
-- Replay model: the engine consumes intents, not events, so the first event row
-- of each accepted intent carries that intent (+ seat). Recovery re-applies the
-- intents through the deterministic engine and verifies the regenerated event
-- seqs match the log. Intents contain sealed data — like payloads, server-only.
game_events (
  game_id     uuid REFERENCES games,
  seq         bigint,                         -- engine event sequence, gapless per game
  type        text NOT NULL,
  payload     jsonb NOT NULL,                 -- full EngineEvent incl. visibility
  intent      jsonb,                          -- set on the first event of an apply
  intent_seat smallint,
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (game_id, seq)
)

game_snapshots (
  game_id    uuid REFERENCES games,
  seq        bigint,                          -- state as of this event seq
  state      jsonb NOT NULL,                  -- canonical GameState
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (game_id, seq)
)

-- Proof trail (blockchain-ready, no crypto dependencies) ----------------------
move_commitments (
  game_id  uuid REFERENCES games,
  seq      bigint,                            -- the game_events seq of the accepted intent
  seat     smallint,
  turn     smallint, phase smallint,
  hash     text NOT NULL,                     -- keccak256(canonicalJson({gameId,turn,phase,seat,intent}) || salt)
  salt     text NOT NULL,                     -- server-generated, 16 random bytes
  PRIMARY KEY (game_id, seq)
)
```

Views: `leaderboard(mode)` (ratings × profiles, public read), `match_history(user_id)`.

## 3. Memory vs. Database

| Data | Lives | Written to DB |
|---|---|---|
| Active `GameState` | room memory | snapshots at phase boundaries; full replay possible from events |
| Engine events | room → append-only log | on every applied intent (ordered batch) |
| Matchmaking queue | server memory (MVP, single machine) | not persisted; queue survives via client re-join on reconnect |
| Profiles, ratings, results | DB only | on registration / game end |

## 4. Security Stance (RLS)

- **Deny by default.** All tables RLS-enabled.
- `profiles`: user can read/update own row; `nickname`+`avatar` publicly readable.
- `ratings`, leaderboard views: public read, no client writes.
- `games`, `game_players`, `game_events`, `game_snapshots`, `move_commitments`:
  **no client access at all** — only the game server (service role) reads/writes.
  Hidden information lives in `game_events`/`game_snapshots` payloads, so these tables
  must never be exposed via PostgREST, even "finished" games (replay/spectate features
  will go through the server, which filters visibility).
- Service-role key exists only in Fly.io secrets; never in the client bundle.

## 5. Retention & Growth

A finished 5-turn game is roughly 300–800 events (a few hundred KB of JSONB) — storage
is a non-issue at MVP scale. Keep everything initially (replays, dispute checks, bot
training data, future on-chain anchoring). Revisit with a cold-storage policy if volume
demands it.
