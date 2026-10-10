# Game Server

> `apps/server` — the authoritative multiplayer server. Node.js 22 + Fastify + `ws`,
> deployed on Fly.io. Owns all game state mutation; everything else (client, bots,
> persistence) hangs off the loop described here.

---

## 1. Responsibilities

- WebSocket gateway: authentication (Supabase JWT), sessions, heartbeat, resume
- Game rooms: one in-memory, single-writer room per active game running `@metarchy/engine`
- Matchmaking queues and private invite games (see [Platform-Services.md](Platform-Services.md))
- Server-side bots (same intent pipeline as humans)
- Persistence: event log + snapshots to Postgres; crash recovery by replay
- Ratings updates on game end (Glicko-2)
- Proof trail: move-commitment hashes, RNG seed commitment ([Blockchain-Portability.md](Blockchain-Portability.md))

Non-goals: no game logic outside `@metarchy/engine`; no rendering concerns; no direct
DB access from clients.

## 2. Room Model — the concurrency answer

The legacy prototype's worst failure mode was concurrent read-modify-write on shared
state (JSON "fat PUT"). The MVP eliminates it structurally:

- A **GameRoom** is an in-memory object owning one game's `GameState`.
- All inputs to a room (player intents, timer fires, disconnect notices) go through a
  **single FIFO queue** processed one at a time — a single-writer event loop per game.
  No locks, no lost updates, simultaneous commits become sequential by construction.
- Room lifecycle: `created → lobby → active → finished | aborted`. Finished rooms flush
  final state, update ratings, then unload.

```
intent ──► validate (auth, seat, legalIntents) ──► engine.applyIntent
       ──► append events to Postgres log (batch, same order)
       ──► broadcast each event to seats per its visibility
       ──► arm/annul phase timers indicated by the new state
```

If the engine returns `RuleViolation`, the sender gets a typed error; state is untouched.

## 3. WebSocket Protocol

Defined as zod schemas in `@metarchy/protocol`. Envelope: `{ t: string, seq?: number, p?: payload }`.

**Client → Server**

| Message | Purpose |
|---|---|
| `hello { accessToken, resume?: { gameId, lastEventSeq } }` | authenticate; optionally resume a live game |
| `queue.join { mode }` / `queue.leave` | matchmaking |
| `game.create { mode, private: true }` / `game.join { inviteCode }` / `lobby.ready` | private games |
| `intent { gameId, intent }` | any in-game action (one envelope for all `Intent` types) |
| `game.forfeit { gameId }` | explicit give-up → `system.eliminate { forfeit }` (§6) |
| `game.resync { gameId }` | request a full `game.sync` |
| `chat.team { gameId, text }` | 2v2 team chat — relayed only to the ally's seat |
| `ping` | heartbeat (also keeps Capacitor webview sockets alive) |

**Server → Client**

| Message | Purpose |
|---|---|
| `welcome { profile, activeGame? }` | post-auth state |
| `pong` | heartbeat reply |
| `queue.status { position, widenedRange }` / `match.found { gameId, seats }` | matchmaking |
| `game.created { gameId, mode, seat, inviteCode? }` | direct reply to `game.create` / `game.join` |
| `lobby.state { gameId, mode, players, seatsTotal }` | lobby membership/readiness broadcast |
| `game.started { gameId, mode, seat, players }` | per-seat game start notification |
| `game.event { gameId, seq, event }` | visibility-filtered `EngineEvent` stream — the primary channel |
| `game.sync { gameId, seq, playerView }` | full resync (on join, resume gap, or client request) |
| `deadline { gameId, phaseRef, endsAt }` | server-clock deadlines for UI timers |
| `presence { gameId, seat, connected, graceEndsAt? }` | seat connectivity for disconnect UI (§6) |
| `chat.message { gameId, fromSeat, text }` | team-chat delivery (2v2) |
| `error { code, message, details? }` | typed errors |

**Ordering & resume.** Events per game are strictly ordered by `seq`. The room keeps a
ring buffer of recent filtered events per seat; on `resume`, the server replays from
`lastEventSeq + 1`, or sends `game.sync` if the gap exceeds the buffer. Client applies
events idempotently by `seq`.

## 4. Sealed Submissions & Readiness

The rulebook's "all players ready / sealed until everyone commits" pattern is enforced
server-side:

- Sealed inputs (placements, discard amounts, card selections, relocations, purchases)
  are ordinary intents; the engine stores them in `GameState` and emits only a public
  "seat N committed" event. **The sealed content is never broadcast** — reveal happens
  when the engine transitions and emits reveal events.
- Readiness (`ack` intents) gates transitions exactly as the engine's state machine
  dictates; the server adds nothing but deadlines.

## 5. Timers & Timeout Policy

All deadlines are server-authoritative; clients only render them. Defaults (config, not
rules — tune in playtesting):

| Waiting for | Deadline | On timeout (as `system.timeout` intent) |
|---|---|---|
| Event ack / reveal ack / result ack | 10 s | auto-ack (user rule: Get It! never holds the game longer) |
| Discard amount | 45 s | discard 0 |
| Distribution commit | 120 s | commit the empty set — the deadline never places actors for the player (user rule); the client auto-commits whatever the player staged |
| Action step inputs | 45 s / step | play nothing / skip |
| Conflict RPS round | 30 s | random Rock/Paper/Scissors |
| Market | 60 s | done |

## 6. Disconnects, Elimination, Forfeit

- Socket drop starts a **60-second grace timer** (rule from the design docs); other
  players see "Player X disconnected — 0:45". Reconnect within grace = seamless resume.
- Grace expiry → `system.eliminate { reason: 'disconnect' }`:
  - 2-player game → remaining player wins;
  - 3+ players → seat eliminated, game continues; their board presence is removed at the
    next resolution point (engine edge-case #4).
- Explicit "give up" → same elimination path with `reason: 'forfeit'`.
- Ranked games: elimination counts as a loss for rating purposes.

## 7. Bots

- Bots are server-side seat controllers implementing `chooseIntent(view, legalIntents, rng)`.
- They run inside the room loop with small humanized delays; they use exactly the same
  intent pipeline and see only their own `PlayerView` — a bot cannot cheat any more than
  a human can, and vs-bot games exercise the same code paths as PvP.
- MVP strategy: `random-legal`, with the interface ready for heuristic strategies
  (bet/argument tendencies, location pressure) later.

## 8. Persistence & Crash Recovery

- **During play:** state lives in memory; every applied intent's events are appended to
  `game_events` in the same order (batched fsync-friendly writes); a `game_snapshots`
  row is written at each phase boundary.
- **Recovery:** on boot, rooms for `active` games are rebuilt as
  `latest snapshot + replay of subsequent events` — determinism makes this exact.
- **Finish:** final snapshot, results into `games`/`game_players`, rating updates, RNG
  seed reveal appended to the log.

## 9. Validation & Anti-Cheat Checklist (MVP trust model)

The server is trusted (like any online board-game operator); *players* are not:

- JWT verified on `hello` (Supabase JWKS); seat ↔ user binding checked on every intent
- Every intent must be in `legalIntents(state, seat)` — placement validity, unique
  arguments, bet affordability, card ownership, phase/step gating all come for free
- Sealed data never serialized to any client payload (asserted in tests at event level)
- Rate limiting per connection; payloads validated by zod before touching a room
- No client-supplied randomness anywhere; server RNG only

## 10. Scaling Path

MVP: **one Fly machine** (region `fra`, next to the Supabase project in eu-central-1), which comfortably handles thousands of
concurrent turn-based games (rooms are tiny state + rare events). Documented path when
needed, in order:

1. Vertical bump (RAM/CPU) — rooms are cheap
2. Multiple machines with game-to-machine routing: WS connect with `gameId` → route via
   `fly-replay` header to the owning machine (games pinned to machines; matchmaking
   assigns on creation)
3. Cross-machine matchmaking via Postgres queue table (swap of the in-memory queue,
   interface unchanged)

No Redis or message broker until step 3 demands it.
