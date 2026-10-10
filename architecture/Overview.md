# Metarchy — Architecture Overview (MVP)

> **Status:** MVP with optional Solana wallet authentication; gameplay remains off-chain
> **Canonical game rules:** `docs/metarchy-rules.md` (when any document contradicts it, the rulebook wins; clarifications are added to the rulebook)
> **Document map:** [Engine](Engine.md) · [Game Server](Game-Server.md) · [Data Model](Data-Model.md) · [Client](Client.md) · [Platform Services](Platform-Services.md) · [Blockchain Portability](Blockchain-Portability.md) · [legacy/](legacy/README.md)

---

## 1. Scope

**MVP includes:**
- Full Metarchy game loop (5 turns × 5 phases, conflicts, bets, events, action cards, market, tie-breakers) for 2–4 players
- PvP with matchmaking, ratings, and private invite games; games vs server-side bots
- Accounts: email / Google / Apple / signed Solana wallet (Supabase Auth); explicitly linked methods share a canonical player profile
- Platforms: browser (first-class), iOS and Android apps (Capacitor) — one codebase

**MVP excludes (deferred to the blockchain phase):**
- On-chain commitments, VRF, NFT actors, token economy
- The MVP still records a verifiable proof trail (move hashes, committed RNG seed) so the blockchain layer can be attached later without reworking the game — see [Blockchain-Portability.md](Blockchain-Portability.md)

## 2. Principles

1. **Server-authoritative.** The game server is the only entity that mutates game state. Clients send *intents*; the server validates them, runs the rules engine, and broadcasts results. A client bug or a cheating client cannot corrupt a game.
2. **Hidden information never leaves the server.** Sealed placements, arguments, bets, discard amounts, and other players' cards are filtered out of every payload a client receives. Secrecy is enforced by the protocol, not by the UI.
3. **One rules engine, written once.** `@metarchy/engine` is a pure, deterministic TypeScript package with no I/O and no framework dependencies. The server uses it as the source of truth; the client uses it for legal-move hints and staging validation; bots use it to enumerate options; tests exercise it directly.
4. **Deterministic and replayable.** All randomness comes from a seeded RNG owned by the server. `(initial state, intent log, seed)` always reproduces the same game — the basis for crash recovery, debugging, and future on-chain verification.
5. **Event-sourced game history.** Every game appends an ordered event log (plus periodic snapshots) to Postgres. The log doubles as audit trail, replay source, and the future blockchain anchoring input.
6. **One TypeScript codebase, three platforms.** The web client is the product; Capacitor wraps the same build for iOS/Android. No engine/editor in the development loop — the whole project is plain text, buildable and testable headlessly (chosen explicitly for AI-assisted development).

## 3. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Language | TypeScript 5.x everywhere | one language across engine, server, client, tests |
| Rules engine | `@metarchy/engine` — pure TS | zero dependencies; vitest + fast-check tests |
| Protocol | `@metarchy/protocol` — zod schemas | shared client↔server message and DTO definitions |
| Game server | Node.js 22, Fastify, `ws` (WebSocket) | authoritative loop, matchmaking, ratings, bots |
| Database & auth | Supabase (PostgreSQL + Auth) | email/Google/Apple/Solana sign-in; private canonical account links; RLS deny-by-default |
| Client | Vite, React 19, PixiJS 8 (board), Framer Motion (UI), zustand (state) | SPA |
| Mobile shells | Capacitor 8 | push notifications, native sign-in, Android Solana MWA, deep links |
| Hosting | Fly.io (game server, region `fra` near Supabase eu-central-1), static hosting for the web client | single machine in MVP; scaling path documented |
| Testing | vitest, fast-check, Playwright (e2e: N browser contexts playing a full game) | rulebook examples become table tests |
| CI/CD | GitHub Actions | lint, typecheck, tests, deploy |
| Hashing (proof trail) | keccak-256 via `@noble/hashes` | wallet signing stays outside the game engine/protocol |

## 4. System Diagram

```
   Browser            iOS app             Android app
  (React SPA)     (Capacitor shell)    (Capacitor shell)
      │                  │                  │
      │   Supabase Auth SDK (email / Google / Apple) ──────► Supabase Auth (JWT)
      │                  │                  │
      └───────────── WebSocket (JWT-authenticated) ─────────┐
                         │                                  │
              ┌──────────▼──────────────────────────────────▼───┐
              │           GAME SERVER (Fly.io, Node/TS)         │
              │                                                 │
              │  Gateway: WS sessions, auth, resume, heartbeat  │
              │  Matchmaking: queues, invite codes              │
              │  Game Rooms: one in-memory room per game,       │
              │    single-writer loop → @metarchy/engine        │
              │  Bots: server-side players (same engine)        │
              │  Ratings: Glicko-2 updates on game end          │
              │  ProofTrail: move hashes + seeded RNG           │
              │  ProofAnchor: no-op in MVP (blockchain later)   │
              └──────────────────┬──────────────────────────────┘
                                 │ SQL (service role)
              ┌──────────────────▼──────────────────────────────┐
              │        Supabase PostgreSQL                      │
              │  profiles · ratings · games · game_players      │
              │  game_events (log) · game_snapshots ·           │
              │  move_commitments                               │
              └─────────────────────────────────────────────────┘
```

## 5. Monorepo Layout

```
metarchy/                      (pnpm workspaces)
├── packages/
│   ├── engine/                # pure game rules: state machine, reducers, validators, RNG
│   └── protocol/              # zod schemas: WS messages, intents, player views, DTOs
├── apps/
│   ├── server/                # Fastify + ws: gateway, rooms, matchmaking, ratings, bots
│   └── client/                # Vite + React + PixiJS; Capacitor config for ios/android
├── e2e/                       # Playwright: multi-client full-game scenarios
├── supabase/                  # migrations, RLS policies (supabase CLI)
├── infra/                     # Dockerfile, fly.toml, GitHub Actions
├── docs/                      # game design (metarchy-rules.md = canon)
└── architecture/              # this documentation
```

Dependency rule: `engine` depends on nothing; `protocol` may depend on `engine` types; `server` and `client` depend on both; nothing depends on `server` or `client`.

## 6. Decision Log (vs. legacy architecture)

| # | Legacy (prototype / crypto design) | MVP decision | Why |
|---|---|---|---|
| 1 | Game logic ran on the client; clients reported outcomes and awarded themselves resources via API | Server-authoritative engine; clients send intents only | PvP integrity — the old model was trivially cheatable from DevTools |
| 2 | Next.js API routes + JSON files / Vercel KV, read-modify-write "fat PUT" | Dedicated Node game server + Postgres; single-writer room per game | Atomicity: simultaneous commits are the game's core scenario; file/KV RMW loses updates |
| 3 | 2–3 s polling | WebSocket push with event sequence numbers and resume | Latency, sealed reveals, no race conditions, mobile battery |
| 4 | Hidden info shipped to all clients, hidden by UI | Per-seat visibility filtering on the server | Secrets must not be present in network payloads at all |
| 5 | Blockchain layer in scope (Avalanche, Chainlink VRF, client AES, wallets) | Deferred entirely; deterministic engine + hash trail + `ProofAnchor` interface kept | MVP speed; the crypto design also had open issues (see `legacy/README.md`) |
| 6 | `useBoardSession` god-hook (~2 800 lines) orchestrated everything | Pure `@metarchy/engine` package + thin client stores | Testability; reuse across server, client, bots |
| 7 | Guest `citizenId` (forgeable), admin endpoints without auth | Supabase Auth (email/Google/Apple), JWT-verified WS; admin behind auth | Real identity is required for ratings anyway |
| 8 | No matchmaking or ratings | Queue + Glicko-2 + private invite codes | Product requirement (real players) |
| 9 | Unity/Unreal considered for the client | TypeScript web stack + Capacitor | AI-assisted development (all-text codebase, MCP ecosystem), browser as first-class platform, one language |
| 10 | Terminology drift (Fame/Glory/Слава), contradicting rule docs | `docs/metarchy-rules.md` is canon; wildcard value is **Fame** | Single source of truth for the spec and the engine |

## 7. Build Order (high level)

1. `engine` + exhaustive rule tests (rulebook examples as fixtures) — the hard, risky part first
2. `server` game room + protocol + bots → a full game playable via test clients
3. `client` board UI (browser) → playable PvP and vs-bots
4. Auth, matchmaking, ratings, reconnect polish
5. Capacitor shells (iOS/Android), push notifications, store packaging
6. (Later, separate phase) blockchain layer per [Blockchain-Portability.md](Blockchain-Portability.md)

The detailed plan lives in the development plan document (next deliverable after this architecture is approved).
