# `@metarchy/engine` — Rules Engine

> The single implementation of Metarchy's rules. Pure TypeScript, no I/O, no framework
> dependencies. Consumed by the game server (authority), the client (hints/staging
> validation), bots, and tests.
> Rules source: `docs/metarchy-rules.md` (canon). Wildcard value name: **Fame**.

---

## 1. Required Properties

| Property | Meaning | Enforced by |
|---|---|---|
| **Pure** | No side effects; reducers return new state | code review + lint rules (no `Math.random`, `Date.now`, `fetch`, timers) |
| **Deterministic** | `(state₀, intents[], seed)` → identical result everywhere | injected seeded RNG; stable iteration/sort order everywhere |
| **Integer-only** | All quantities are integers (resources, VP, seq) | types + tests |
| **Serializable** | `GameState` is plain JSON data with a canonical serialization (sorted keys) | needed for snapshots, replays, and the proof trail |
| **Versioned** | `RULES_VERSION` constant; stored per game | replays use the engine version that recorded the game |

## 2. Core API

```ts
// Full truth — exists only on the server
interface GameState { /* turn, phase, sub-state, decks, seats, board, inventories, log cursor … */ }

// What one seat is allowed to see (hidden info already removed)
interface PlayerView { /* my hand/placements/bets, public board, opponents' public data, phase deadlines */ }

// Player input. Everything a player can do is an Intent.
type Intent =
  | { type: 'event.ack' } | { type: 'event.discard'; amount: number }
  | { type: 'distribution.commit'; placements: Placement[] }            // all 4 actors at once
  | { type: 'action.selectCards'; cardInstanceIds: string[] }
  | { type: 'action.block'; locationId: LocationId }
  | { type: 'action.relocate'; actorId: ActorId; to: LocationId }
  | { type: 'action.exchange'; give: ValueType; from: SeatId; take: ValueType }
  | { type: 'conflict.reveal.ack' } | { type: 'conflict.rps'; choice: Rps }
  | { type: 'conflict.result.ack' }
  | { type: 'market.buy' } | { type: 'market.done' }
  | { type: 'tiebreak.rps'; choice: Rps }
  | { type: 'system.timeout'; seat: SeatId }        // injected by the server, not by players
  | { type: 'system.eliminate'; seat: SeatId; reason: 'disconnect' | 'forfeit' }

// Everything that happened, with visibility for server-side filtering
interface EngineEvent { seq: number; type: string; payload: unknown; visibility: 'public' | SeatId[] }

// The only mutation path. No injected RNG: the seed lives in GameState.meta
// (server-only, stripped from every PlayerView) and rngCursor counts consumed
// draws, so each draw is a pure function of the state itself — replayable from
// any snapshot.
applyIntent(state: GameState, seat: SeatId, intent: Intent):
  { ok: true; state: GameState; events: EngineEvent[] } | { ok: false; error: RuleViolation }

projectView(state: GameState, seat: SeatId): PlayerView
legalIntents(state: GameState, seat: SeatId): IntentSpec[]   // drives UI affordances, bots, and validation
```

`legalIntents` is the anti-drift mechanism: the server rejects anything outside it, the
client renders only what it offers, bots choose from it. One function, three consumers.

## 3. Visibility Model

Every `EngineEvent` carries visibility. The server broadcasts each event only to seats
listed (or everyone for `public`). Examples:

| Fact | Visibility |
|---|---|
| "Seat 2 committed placements" | public (fact of commitment) |
| Seat 2's placements/arguments/bets before reveal | seat 2 only |
| Board after distribution reveal: actors + locations | public; **arguments and bets stay hidden until Phase 4 reveal** (per rulebook) |
| Discard-event amounts before reveal | own seat only |
| Which Action Card a player drew | that seat only (others see the count) |
| Conflict reveal: arguments + bets of participants | public at reveal moment |
| 2v2 team mode: ally's sealed placements/arguments/bets, hand, resources, values | own seat + ally's seat (full openness between allies, per rulebook) |

## 4. Turn & Phase State Machine

```
GAME
 └─ TURN n (n = 1..5, plus tie-breaker turns)
     ├─ P1 EVENT            (skipped on Turn 1; skipped if Event Deck is empty)
     │    draw card (RNG, no reshuffle — 7 cards total for the whole game)
     │    ├─ compare event: compute winner from Values → Fame; tie → RPS tie-break rounds
     │    └─ discard event: sealed discard amounts → reveal → winner draws Action Card;
     │                      tie → RPS tie-break rounds; all players ack
     ├─ P2 DISTRIBUTION     sealed: each seat commits all 4 placements (location, unique
     │    argument incl. Dummy, optional bet with affordability check) → when all seats
     │    committed → reveal actors+locations (arguments/bets remain hidden)
     ├─ P3 ACTION
     │    ├─ step 0 SELECT   sealed card selection (0..N cards) → reveal counts/types;
     │    │                  steps with no cards selected by anyone are skipped
     │    ├─ step 1 BLOCK    selected block cards disable their hardwired locations
     │    │                  automatically (no further input exists) → announced
     │    ├─ step 2 RELOCATE sealed relocation targets (any actor, own or opponent's, to
     │    │                  a location valid for its type) → collisions (same actor,
     │    │                  different destinations) → player-vs-player RPS tie-break;
     │    │                  loser's card is discarded without effect → apply → announce
     │    └─ step 3 EXCHANGE exchange own Value ↔ another player's Value (never Fame);
     │                       applied in deterministic seat order; a card with no valid
     │                       target returns to hand (per rulebook)
     ├─ P4 CONFLICT
     │    detect conflicts (group actors by location, then by actor type; skip disabled
     │    locations); deterministic conflict order (location order, then actor type);
     │    per conflict → CONFLICT SUB-MACHINE (below); peaceful actors auto-win;
     │    all players ack results
     │    └─ if final turn: SCORING (below)
     └─ P5 MARKET           sealed buying: repeat { buy (1 Product + 1 Electricity +
          1 Recycling → server draws random Action Card) | done }; applied when all done
          → next turn
```

### Conflict sub-machine (per conflict)

```
ROUND 1 (arguments from distribution; the only round where bets apply)
  1. Reveal arguments + bets of all participants (public event)
  2. Compute per-actor outcome (Win/Lose/Draw) — multi-player RPS rules:
     · Dummy loses to any of R/P/S present; Dummy vs only Dummy = draw
     · 1 argument type present → draw among all
     · 2 types → standard RPS decides winning type
     · 3 types (R+P+S) → global draw
     · per-actor outcomes follow rulebook §Conflict Resolution examples
  3. Apply bets (Round 1 only; bet resources were consumed at placement):
     · Win bet + Win → +1 extra reward
     · Draw bet + Draw → outcome becomes Win for the bettor; non-betting draw
       participants are denied draw rewards
     · Lose bet + Lose → round-1 rewards cancelled; losers WITHOUT a Lose bet are
       eliminated from the conflict; new resolution round among bettor + winners
  4. Apply actor draw rules to remaining draws:
     · Politician → new RPS round (fresh choices) until Win/Lose
     · Scientist → all draw participants receive 1 Knowledge
     · Artist → nobody receives Art
     · Robot → 1 resource each
ROUNDS 2+ (triggered by Politician draws or Lose bets): fresh RPS choices from the
  involved seats, standard rules, no bets.
POLITICIAN DEADLOCK RULE (rulebook): after 10 unresolved Politician re-fight rounds,
  a Player-level RPS tie-break starts (up to 10 more rounds); if still unresolved,
  ALL involved Politicians lose (nobody creates Power). Per-round server deadlines
  (timeout → random choice) make actually reaching the cap practically impossible.
REWARDS: Politician/Scientist/Artist 1 Value; Robot 3 resources of the location type
  (draw: per rules above; +1 on successful Win bet). Applied atomically at conflict end.
```

### Scoring & tie-breaker (final turn, end of Phase 4)

```
VP = min(Power, Art, Knowledge) after greedy Fame distribution
single leader  → game over (Phase 5 is not played)
multiple leaders → non-leaders are ELIMINATED (game over for them, ranked by VP);
  leaders continue the SAME turn's Phase 5 (Market), then play one full additional
  turn (Event phase included if the Event Deck is not empty), VP recounted at the end
  of its Phase 4 → recurse until a single winner
```

## 5. Randomness & Decks

- Single seeded RNG stream per game: counter-based (splitmix32-style avalanche over
  `hash(seed) + cursor`), with the seed in `GameState.meta` (server-only) and the
  cursor in `GameState.rngCursor` — every draw is a pure function of the state. Seed
  generated at game start; its hash is published at game start, the seed itself at
  game end (see [Blockchain-Portability.md](Blockchain-Portability.md)).
- RNG consumers: event-card draws (7-card deck, no reshuffle), action-card draws
  (15-card deck: 6 block + 6 relocation + 3 exchange), bot decisions (separate stream
  derived from the same seed to keep replays stable), timeout auto-choices.
- Deck state lives in `GameState`; draws remove cards.

## 6. Edge Cases — Resolved 2026-07-07 (now in the rulebook)

| # | Case | Canonical resolution |
|---|---|---|
| 1 | Action deck runs out (15 cards; market + discard events consume them) | ✅ Deck is never reshuffled; when empty, Action Cards can no longer be obtained or purchased — Market "Buy" unavailable, Discard-Event winner gets no reward |
| 2 | Discard event where every player discards 0 | ✅ All discarded equally → all meet the winning condition → RPS Conflict Resolution between all players; the winner counts as having discarded the most and takes the reward |
| 3 | Politician re-fight liveness | ✅ Deadlock rule: 10 Politician re-fight rounds → 10 Player-level tie-break rounds → all involved Politicians lose. Server per-round deadlines (timeout → random R/P/S) keep the game moving |
| 4 | Eliminated/disconnected seat mid-game | ✅ ALL of the player's Actors, Resources, Values, and Action Cards leave the game with the player (removed from the board at the next resolution point; committed sealed data discarded) |
| 5 | 2v2 team mode | ✅ Fully resolved: ally full visibility + team chat; **shared team pool of Values** (VP counted per team from the pool; Fame pooled); Resources and Action Cards stay personal; allied same-type Actors DO conflict; cards playable on self or ally; Change Values exchanges only between team pools (never inside a team) |

## 7. Testing Strategy

1. **Rulebook fixtures:** every worked example in `docs/metarchy-rules.md` (2-player and
   3-player bet examples, Dummy cases, Electricity chains) becomes a literal table test.
2. **Phase-machine tests:** full-turn scripts asserting event sequences and view filtering
   (a seat must never receive another seat's hidden data — tested at the event level).
3. **Property tests (fast-check):** resource conservation per conflict; VP monotonic in
   Fame; `legalIntents` ∘ `applyIntent` never errors; determinism (same seed+intents →
   same state hash); serialization round-trip.
4. **Full-game simulation:** random bots play thousands of complete games; assert
   termination, invariants, and absence of rule violations.

## 8. Versioning

`RULES_VERSION` (semver) exported by the package and stored on every game row. Replays
and dispute checks run the engine version that recorded the game. Rule changes bump the
version and add migration notes to the rulebook.
