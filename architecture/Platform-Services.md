# Platform Services

> Auth, matchmaking, ratings, deployment, and operations — everything around the game
> loop. Runs inside `apps/server` unless stated otherwise.

---

## 1. Authentication & Identity

- **Supabase Auth** with email (+ verification), Google, Apple, and signed Solana wallet login.
  No guest mode in MVP: ratings and matchmaking require stable identity, and the
  Players may start with email or a wallet and explicitly add another login method.
- First login → nickname + avatar selection → `profiles` row.
- Client obtains a JWT via the Supabase SDK; the game server verifies it (JWKS) on the
  WebSocket `hello` and resolves its subject to the canonical profile `user_id`.
  Private server-owned aliases preserve that player's inventory, GATO, ratings,
  nickname, and email-granted cosmetics. Independent profiles are never merged.
  No custom password/session
  code anywhere in the project.
- Browser wallets use Wallet Standard, with guarded Phantom/Solflare compatibility.
  Android uses the official Solana Mobile MWA SDK; Seeker players select Seed Vault
  Wallet in the OS chooser. A fresh, verified SIWS message establishes a normal
  Supabase session; no SOL, transaction, or app-side private key is required.
- Explicit linking uses an isolated Auth session and a five-minute, single-use
  server challenge. Account-wide MFA applies to every linked principal. See
  [Solana wallet setup and device acceptance](../docs/Solana-Wallet-Login.md).

## 2. Game Modes

| Mode | Players | Ranked | Notes |
|---|---|---|---|
| `1v1` | 2 | ✅ | primary ranked ladder |
| `ffa3` | 3 | ✅ | pairwise rating updates by final VP ranking |
| `2v2` | 4 | later | rules complete (shared team Values pool, ally visibility, team chat); ships after `1v1`/`ffa3` |
| `vs_bots` | 1 human + 1–2 bots | ❌ | practice/onboarding; identical game pipeline |
| private | 2–4 by invite code | ❌ | friends games; no rating stakes |

All modes: 5 turns (`MAX_TURNS = 5`) per the rulebook.

## 3. Matchmaking

- Per-mode in-memory queue (single machine in MVP; see Game-Server.md §10 for the
  cross-machine path).
- Match window: start at ±150 rating, widen by +50 every 10 s, cap at ±600.
- After 60 s without a match: offer an immediate unranked bot game while staying in
  queue (configurable).
- On match: create game, notify seats (`match.found` + push notification on mobile),
  30 s accept window; decline/timeout returns others to the head of the queue.
- Private games: 6-character invite code, lobby with ready checks, optional bot fill.

## 4. Ratings (Glicko-2)

- Stored per `(user, mode)`; defaults 1500 / RD 350 / vol 0.06; each finished game is
  processed as its own rating period.
- `1v1`: standard update. `ffa3`: each pair of players is scored as a mini-match by
  final VP ranking (equal VP = draw), all pairs applied in one update. `2v2` (later):
  team rating = average; both members receive the team result.
- Eliminations (disconnect timeout, forfeit) count as losses in ranked.
- Provisional badge while RD > 110 (~first 10 games). Leaderboard = public view over
  `ratings` (Data-Model.md).

## 5. Deployment & Environments

| Component | Where | Notes |
|---|---|---|
| Game server | Fly.io, region `fra` (paired with the Supabase project in eu-central-1) | Docker image; `fly.toml` in `infra/`; WS-friendly; health check = `/healthz` + room-loop liveness |
| Web client | static hosting (Cloudflare Pages, or a Fly static app if we prefer one provider) | minor decision at infra setup |
| Database/Auth | Supabase — dedicated Metarchy project | migrations via `supabase/` in CI |
| Environments | `staging` + `production` (separate Fly apps + Supabase projects) | staging is where e2e runs against real infra |

Secrets: Fly secrets (Supabase service key, push credentials); GitHub Actions OIDC/token
for deploys; nothing secret in the client bundle.

CI (GitHub Actions): lint → typecheck → engine/unit tests → build → Playwright e2e
(against a spun-up server) → deploy `main` to staging; production deploy on tag.

## 6. Observability & Operations

- **Logs:** pino structured logs; per-game correlation via `gameId` (the event log in
  Postgres is itself the primary game-level audit trail).
- **Errors:** Sentry on client and server.
- **Metrics (MVP-minimal):** active rooms, queue depths, match latency, WS connections,
  intent-error rates, DB write latency. Fly metrics + a lightweight `/metrics` endpoint.
- **Admin (post-MVP, authenticated):** internal panel over server APIs — inspect a
  game's event log, abort a stuck game, moderate nicknames. Never direct DB from a
  browser. (The legacy prototype's unauthenticated admin endpoints are explicitly not
  carried forward.)

## 7. Push Notifications (mobile)

Server-side push service (APNs + FCM) triggered by room events for backgrounded
players: match found, your-turn deadlines, game finished. Token registration flows
through the authenticated WS session; tokens stored per device in Postgres (added to
schema at implementation time).
