# Metarchy — Game Specification (Engine Level)

> **Purpose:** the implementation reference for `@metarchy/engine`. This document
> formalizes `docs/metarchy-rules.md` (the canonical rulebook) into exact identifiers,
> state, algorithms, and test fixtures. If this spec and the rulebook ever disagree,
> the rulebook wins and this spec must be fixed.
> **Interpretations:** where the rulebook is silent, this spec decides and records the
> decision in [§14 Interpretations Log](#14-interpretations-log).
> **Architecture context:** `architecture/Engine.md` (engine contract),
> `architecture/Game-Server.md` (who calls this and when).

---

## 1. Identifiers & Constants

```ts
type SeatId       = 0 | 1 | 2 | 3
type Mode         = '1v1' | 'ffa3' | '2v2' | 'vs_bots'
type ActorType    = 'politician' | 'scientist' | 'artist' | 'robot'
type ArgumentType = 'rock' | 'paper' | 'scissors' | 'dummy'
type Rps          = 'rock' | 'paper' | 'scissors'          // tie-breaks & re-fights: no dummy
type LocationId   = 'square' | 'theatre' | 'university' | 'factory' | 'power_plant' | 'dump'
type ValueType    = 'power' | 'art' | 'knowledge' | 'fame'
type ResourceType = 'product' | 'electricity' | 'recycling'
type BetType      = 'win' | 'lose' | 'draw'                // paid with product/electricity/recycling
type Outcome      = 'win' | 'lose' | 'draw'

MAX_TURNS = 5                      // all modes; tie-breaker turns extend past 5
SEATS_PER_MODE = { '1v1': 2, 'ffa3': 3, '2v2': 4, 'vs_bots': 2..3 }
```

### 1.1 Locations

| LocationId | Accepts | Produces (by actor) | Blocked by card |
|---|---|---|---|
| `square` | politician, artist | power / art | `construction_work` |
| `theatre` | scientist, artist | knowledge / art | `charity_event` |
| `university` | politician, scientist | power / knowledge | `student_protests` |
| `factory` | robot | product ×3 | `sabotage` |
| `power_plant` | robot | electricity ×3 | `cable_stolen` |
| `dump` | robot | recycling ×3 | `environmental_protests` |

`ALLOWED_LOCATIONS: politician → [square, university]; scientist → [university, theatre];
artist → [square, theatre]; robot → [factory, power_plant, dump]`

### 1.2 Arguments (RPS matrix)

`beats: rock → {scissors, dummy}; paper → {rock, dummy}; scissors → {paper, dummy}; dummy → {}`
Same type ↔ same type = draw. `dummy` draws only with `dummy`.

### 1.3 Bets

| BetType | Costs 1 | Effect when successful (evaluated once, in conflict round 1 only) |
|---|---|---|
| `win` | product | +1 additional reward unit (value, or 1 resource for robot), earned **once, at the moment the bet succeeds**; if other rules pull the actor into a further resolution, that resolution runs purely by the standard rules and only determines the base reward — the already-earned +1 stays with the player (rulebook examples) |
| `lose` | electricity | round-1 base rewards cancelled; losers **without** a successful lose bet are eliminated from the conflict with nothing; new resolution round among {lose-bettors + win/tied-win actors}, no bets |
| `draw` | recycling | bettor's `draw` becomes `win`; other actors of the same draw group **without** a draw bet are denied their draw reward (get nothing) |

The bet resource is deducted at placement commit and never returned. A failed bet has no effect.

### 1.4 Decks

**Event Deck — 7 cards, one game, never reshuffled:**

| id | Kind | Rule |
|---|---|---|
| `political_repression` | compare | least `power` → +1 fame |
| `educational_crisis` | compare | least `knowledge` → +1 fame |
| `cultural_decline` | compare | least `art` → +1 fame |
| `revolution` | compare | least **total of all Values** (power+art+knowledge+fame) → +1 fame |
| `help_poor_countries` | discard | secretly discard any amount of `product`; most discarded → 1 random Action Card |
| `earth_hour` | discard | same with `electricity` |
| `prevent_eco_crisis` | discard | same with `recycling` |

**Action Deck — 15 cards, one game, never reshuffled; obtained/played cards never return.
When empty: Market "buy" unavailable; discard-event winner receives nothing.**

| id | Count | Type | Effect |
|---|---|---|---|
| `construction_work`, `charity_event`, `student_protests`, `sabotage`, `cable_stolen`, `environmental_protests` | 1 each | block | disable the mapped location for the current turn |
| `relocation` | 6 | relocation | move **any** actor (own, ally's, or opponent's) to another location valid for its type |
| `change_values` | 3 | exchange | exchange 1 own(-team) Value ↔ 1 other-player(-team) Value; never `fame` |

### 1.5 Starting state (per seat)

4 actors (one of each type), 4 arguments available (one of each type per turn),
resources `{product: 1, electricity: 1, recycling: 1}`, values `{power: 0, art: 0, knowledge: 0, fame: 0}`,
empty hand. (Prototype's `gato` currency is dropped.)

### 1.6 Rewards table

| Actor | Win | Draw | Lose |
|---|---|---|---|
| politician | 1 power | → re-fight (see §8.6) | 0 |
| scientist | 1 knowledge | 1 knowledge each | 0 |
| artist | 1 art | 0 (nobody) | 0 |
| robot | 3 × location resource | 1 × location resource each | 0 |

Successful `win` bet: +1 of the same reward unit. Peaceful (unopposed) actor = Win.

---

## 2. Game State

```ts
interface GameState {
  meta: { gameId, mode, rulesVersion, seats: SeatMeta[], teams?: [SeatId[], SeatId[]] }
  turn: number                       // 1-based; may exceed MAX_TURNS via tie-breakers
  isTieBreakerTurn: boolean
  phase: PhaseState                  // discriminated union, §5–§10
  eventDeck: EventCardId[]           // shuffled at game start (seeded RNG)
  actionDeck: ActionCardId[]         // shuffled at game start
  board: {
    placements: Placement[]          // {actorId, seat, actorType, locationId, argument, bet?}
    disabledLocations: LocationId[]  // reset each turn
  }
  inventories: PerSeat<{ resources, hand: CardInstance[] }>
  values: PerSeat<Values> | PerTeam<Values>   // per team in 2v2 (shared pool)
  eliminated: SeatId[]               // eliminated/left players (assets already removed)
  activeSeats: SeatId[]              // participants of the current turn (tie-breaker shrinks this)
  rngCursor: number                  // draws consumed (for audit)
  seq: number                        // last emitted event seq
}
```

State invariants (asserted in tests): value/resource counts ≥ 0 and integer; a seat's 4
placements have 4 distinct arguments; ≤1 bet per placement; placements only in
`ALLOWED_LOCATIONS`; eliminated seats own nothing and appear in no placement;
`activeSeats ⊆ seats − eliminated`.

## 3. Turn Structure

```
Turn 1:                P2 → P3 → P4 → P5
Turns 2..last:         P1 → P2 → P3 → P4 → P5      (P5 skipped on the last turn unless tie)
Last turn, end of P4:  scoring (§10). Tie → leaders keep playing THIS turn's P5,
                       then a full extra turn (P1 if event deck non-empty → P2 → P3 → P4
                       [scoring] → P5 only if tied again) — recursively.
P1 is skipped whenever the event deck is empty (7 cards cover turns 2–8).
disabledLocations resets at the start of every turn.
```

## 4. Intent & Event Catalog

Intents (client → engine; each valid only in its phase/sub-state, from the correct seat,
and present in `legalIntents`):

| Intent | Phase | Payload / validation |
|---|---|---|
| `event.ack` | P1 | acknowledge event display / result |
| `event.discard` | P1 discard | `amount ∈ [0 .. owned(resource)]`; sealed |
| `tiebreak.rps` | P1 tie, P3 relocation collision, P4 politician deadlock | `choice: Rps`; sealed per round |
| `distribution.commit` | P2 | exactly 4 placements; valid locations; 4 distinct arguments; bets affordable (resources deducted here); sealed |
| `action.selectCards` | P3.0 | subset of own hand; sealed |
| `action.relocate` | P3.2 | own selected relocation card; any actor on board; target ∈ ALLOWED_LOCATIONS(actor), ≠ current; sealed |
| `action.exchange` | P3.3 | own selected exchange card; own(-team) value count > 0; target seat/team value count > 0; value ≠ fame; in 2v2 target = opposing team only |
| `conflict.reveal.ack`, `conflict.rps`, `conflict.result.ack` | P4 | per conflict; `conflict.rps` only when a re-resolution round requests it |
| `market.buy` | P5 | resources ≥ {1,1,1} and actionDeck non-empty; repeatable; sealed until `market.done` |
| `market.done` | P5 | finish shopping |
| `system.timeout`, `system.eliminate` | any | server-injected only (deadline expiry, disconnect, forfeit) |

Events (engine → clients, visibility-filtered): `event.drawn`, `event.deckEmpty`,
`event.discardCommitted(seat)`, `event.discardsRevealed`, `event.resolved`,
`tiebreak.roundStarted/choicesRevealed/resolved`, `distribution.committed(seat)`,
`distribution.revealed` (actors+locations public; arguments/bets omitted),
`action.selectionCommitted(seat)`, `action.selectionsRevealed` (counts+types),
`action.locationBlocked`, `action.relocated`, `action.relocationCollision`,
`action.exchanged`, `conflict.detected(list)`, `conflict.revealed(args+bets)`,
`conflict.roundResolved`, `conflict.rewards`, `market.bought(seat: count; card → owner only)`,
`turn.advanced`, `scoring.result`, `player.eliminated`, `game.finished`.

## 5. Phase 1 — Event

1. If `eventDeck` empty → emit `event.deckEmpty`, go to P2. Else draw top card (deck was
   shuffled once at game start with the seeded RNG).
2. **Compare event:** compute the qualifying metric per competitor (per seat; per team
   in 2v2 — team value pools). Unique winner → +1 fame (to seat's/team's pool) after
   all `event.ack`. Tie → tie-break (§11) among tied competitors; winner takes fame.
3. **Discard event:** every active seat submits sealed `event.discard` (0 allowed;
   resources deducted at reveal). Reveal all amounts. Unique max → winner. Tie
   (including the all-zero case — everyone discarded equally, so all qualify) →
   tie-break (§11) among tied seats; the tie-break winner counts as having discarded
   the most. Winner receives 1 random Action Card **if the action deck is non-empty**,
   otherwise nothing. Discarded resources are gone regardless.

## 6. Phase 2 — Distribution

Sealed `distribution.commit` from every active seat: all 4 actors placed in one intent.
Validation per §4; bet resources deducted at commit. When the last seat commits →
`distribution.revealed`: placements become public as `(actorId, seat, actorType,
locationId)`; **arguments and bets stay hidden until P4 reveal**. In 2v2 the ally sees
the full sealed content immediately (visibility, not game state).

## 7. Phase 3 — Action (sub-steps 0–3)

**Step 0 SELECT.** Sealed `action.selectCards` (any subset of hand, 0 allowed). On full
commit → reveal selected card types/counts per seat. Steps 1–3 run only if at least one
card of that step's type was selected anywhere; each runs for its selectors only.

**Step 1 BLOCK.** Block cards are hardwired to their locations (§1.4, rulebook §7), so
the step applies automatically: every selected block card disables its mapped location
— no `action.block` intent exists. Duplicates are idempotent (a location is either
disabled or not).
Disabled locations: no conflicts, no production (even peaceful actors), bets at those
locations are consumed with no effect; relocation out of (and into) them is allowed.

**Step 2 RELOCATE.** Sealed `action.relocate` per relocation card. On reveal:
- **Collision** = two or more seats moved the **same actor** to **different**
  destinations → tie-break (§11) among those seats; winner's relocation applies,
  losers' cards are discarded with no effect. Same actor, same destination: all apply
  trivially (all cards consumed).
- Relocations move the actor **with its hidden argument and bet unchanged**.
- New same-type co-locations created here conflict in P4 as usual.

**Step 3 EXCHANGE.** Per exchange card, sequentially in seat order (lowest active seat
first; a seat's own multiple cards in commit order): pick own(-team) value (count>0, not
fame) and a target's value (count>0, not fame; in 2v2 — opposing team's pool only).
Counts are re-validated at application time; if the giver has no eligible value or no
valid target exists, the card **returns to hand** (not consumed).

## 8. Phase 4 — Conflict

### 8.1 Detection

Ignore disabled locations. Group `placements` by `(locationId, actorType)`. Group size
≥ 2 → a Conflict (allied actors conflict like any others). Size 1 → peaceful: outcome
Win, rewards per §1.6; `win` bet succeeds (+1), `draw`/`lose` bets fail.
Conflict ordering (fixed): location order `square, theatre, university, factory,
power_plant, dump`, then actor order `politician, scientist, artist, robot`.
Conflicts are revealed and resolved strictly sequentially; every involved seat must
`conflict.result.ack` before the next opens (server enforces deadlines).

### 8.2 Round-1 base outcomes (N participants)

Let `T` = set of distinct argument types among participants.

```
if |T| == 1                         → every participant: draw
else if T == {rock, paper, scissors} → every participant: draw          (circular)
else:
  if dummy ∈ T → every dummy participant: lose (clear loser); T' = T − {dummy}
     (if now one participant remains → it wins; if several of one type → draw among them;
      if T' == {rock,paper,scissors} → all three-type participants: draw)
  if |T'| == 2 → participants of the beating type: win; of the beaten type: lose
```

Equivalently per actor: `lose` if beaten by at least one non-circular opponent set,
`win` if it beats someone and nobody beats it, `draw` otherwise — with the special
all-three-types-circular case forced to draw. **Tied winners** (several actors of the
same winning type) have outcome `draw` *among themselves* and settle per the actor's
draw rule (§8.5): politicians re-fight (this is what the rulebook's generic
"Conflict Resolution is needed" wording describes), scientists each take knowledge,
artists all take nothing, robots take 1 each (I-1, author-confirmed).

### 8.3 Bets (round 1 only)

Evaluate each participant's bet against its §8.2 outcome (`success` iff bet type ==
outcome), then apply in this order:

1. **Draw bets:** each successful one converts that actor's `draw` → `win`; every other
   member of the same draw group without a successful draw bet → denied (their draw
   reward becomes nothing; for politicians it cancels the re-fight they would have had
   with the bettor). If conversions yield **multiple** `win` actors → a new resolution
   round (§8.4) among them determines the single base winner (bets already burned).
2. **Lose bets:** any successful one → all round-1 base rewards are cancelled; losers
   without a successful lose bet leave with nothing; new resolution round among
   {successful lose-bettors + all win/tied-win actors}, no bets.
3. **Win bets:** each successful one applies its effect once, right here: the bettor
   earns `+1 reward unit`. Later resolution rounds run purely by the standard rules and
   determine only the *base* reward; the earned +1 is never revisited. Final reward =
   base by final outcome + earned bonus (TC-B1..B3: a round-1 win-bettor who loses the
   re-resolution still returns with 1).

All bets are burned after this step regardless of success.

### 8.4 Re-resolution rounds

Triggered by draw-bet multi-win, lose bets, or politician draws. Participants submit
fresh sealed `conflict.rps` (rock/paper/scissors only — no dummy, per rulebook modal).
Standard §8.2 logic (minus dummy), **no bets**. A round's standing draws settle by the
actor's draw rule (§8.5, I-8): politicians repeat until a single winner (subject to
§8.6); scientist/artist/robot draws stand — exactly the rulebook's TC-B1..B3 draw
branches. Losers of a round drop out with nothing.

### 8.5 Draw settlement by actor type

Applied when a draw stands after §8.3: politician → §8.6 re-fight loop; scientist →
1 knowledge each; artist → nothing for anyone; robot → 1 location-resource each.

### 8.6 Politician deadlock rule

Politician draws re-fight via §8.4. After **10** unresolved politician re-fight rounds
→ a **player-level** tie-break (§11) among the owners, up to **10** more rounds, its
winner's politician wins. If still unresolved after those 10 → **all involved
politicians lose**: nobody creates power. A win bet that succeeded in round 1 still
pays its +1 power — a successful bet always delivers what it promises, on any final
outcome (I-2, author-confirmed; rulebook).

### 8.7 Rewards

Applied atomically per conflict at its end: base reward by final outcome (§1.6) + win-bet
modifiers. Values go to the seat's pool (team pool in 2v2); resources to the seat.

## 9. Phase 5 — Market

Sealed shopping per seat: any number of `market.buy` (each requires
`{product ≥ 1, electricity ≥ 1, recycling ≥ 1}` and a non-empty action deck at **apply**
time), then `market.done`. Applied on full consensus in seat order, deducting resources
and drawing random cards (seeded RNG); a buy that can no longer be satisfied (deck
emptied by an earlier seat this phase) is refunded/void. Others see only purchase
counts. Skipped on the last turn unless a tie-breaker is running (§10).

## 10. Scoring & Tie-Breaker (end of P4 on the last turn)

```
fameDistribute(v): while v.fame > 0: m = min(v.power, v.art, v.knowledge)
                   bump the FIRST of [power, art, knowledge] equal to m; v.fame--
VP(v) = min(v.power, v.art, v.knowledge) after fameDistribute
```

Computed per seat (per team in 2v2). Single leader → `game.finished` (winner + ranking
by VP; P5 not played). Multiple leaders → non-leaders are **eliminated** (ranked by
VP; their assets leave the game, §12); `activeSeats` = leaders; the same turn's P5 runs
for leaders; then an extra turn (P1 only if event deck non-empty) with scoring again at
its P4 — recursive until a single winner. In 2v2, "leader" is a team; a team is
eliminated as a whole.

## 11. Player-Level Tie-Break (Conflict Resolution between Players)

Used by: event ties (compare & discard, including all-zero discards), relocation
collisions, politician deadlock stage 2. Rounds of sealed `tiebreak.rps`
(rock/paper/scissors) among the tied parties; §8.2 logic (no dummy, no bets); losers
drop out; repeat among survivors until one winner. No round cap (server deadlines +
random auto-choice guarantee liveness; only the politician context has the capped
semantics of §8.6). In 2v2, when the tied parties are teams (compare events), **all
four players** play the tie-break together — allies may coordinate their choices via
team chat. Losers are eliminated round by round as usual; as soon as every remaining
player belongs to one team, that team wins the tie (I-3, author-confirmed).

## 12. Elimination

On `system.eliminate` (tie-breaker loss, forfeit, disconnect timeout) or scoring
elimination: the seat leaves `activeSeats`; **all** its actors (staged and placed),
resources, values (in 2v2 the personal share is nothing — the pool belongs to the team;
a fully-eliminated team's pool leaves with it), and action cards are removed from the
game. Pending sealed data is discarded; consensus counters recompute over remaining
active seats. A 2-player game (or a game reduced to one side) ends immediately in favor
of the remaining side.

## 13. Modes

| Mode | Seats | Specifics |
|---|---|---|
| `1v1` | 2 | baseline |
| `ffa3` | 3 | 3-way conflicts per §8.2 |
| `2v2` | 4 (teams [0,2] vs [1,3]) | shared team value pools; ally full visibility (sealed data visible to ally); team chat; exchanges cross-team only; compare events on team pools; scoring/elimination per team |
| `vs_bots` | 1 human + 1–2 bots | bots are ordinary seats driven server-side; unranked |

## 14. Interpretations Log

All items below were ruled on by the game author on 2026-07-07 and are folded into the
rulebook. The author also gave a **universal dispute rule** (now in the rulebook's
Gaming Terminology): *if an Actor's draw behavior is specified, follow it exactly; any
situation the rules don't describe, where two or more players claim a victory or a
reward, is resolved by a player-level Conflict Resolution (RPS). Everything happens
simultaneously, and simultaneous-action collisions resolve the same way.* I-4..I-7 are
implementation-level defaults consistent with that rule.

| id | Ruling | Status |
|---|---|---|
| I-1 | Author's model, now stated explicitly in the rulebook: the Argument-comparison layer determines who wins, who loses, and **between whom** the Conflict Resolution continues; the Actor rules then define **how** it settles at equal arguments — two scientists both create knowledge, artists create nothing, robots take 1 each, politicians replay until win/lose. Draw-bet conversions producing multiple wins explicitly replay per rulebook (TC-B4). | ✅ confirmed |
| I-2 | A bet that succeeded in round 1 **always delivers its effect**, whatever the final outcome: a win-bettor who loses the re-resolution still takes the +1 (TC-B1), and in the politician deadlock "all lose" a successful round-1 win bet still pays +1 power. Author's formulation (2026-07-08): no special case — the bet's effect is applied once when it succeeds; any second Conflict Resolution simply runs by the standard rules and sets only the base reward. | ✅ confirmed |
| I-3 | 2v2 compare-event tie-break: **all four players** play together (allies may coordinate via team chat); round-by-round elimination until all survivors are from one team — that team wins. | ✅ confirmed |
| I-4 | Exchange cards apply in seat order; a card whose preconditions fail at apply time returns to hand. | ✅ default under the universal rule |
| I-5 | Market buys apply in seat order; a buy invalidated by deck exhaustion within the same phase is void, buyer keeps the resources. | ✅ default under the universal rule |
| I-6 | Relocation into a disabled location is legal (rules only restrict actor/location type pairs). | ✅ default under the universal rule |
| I-7 | Same actor relocated by multiple cards to the **same** destination: no collision, all cards consumed. | ✅ default under the universal rule |
| I-8 | Draws in **re-resolution rounds** settle by the actor's draw rule, same as round 1: rulebook TC-B1..B3 spell this out for artists/scientists/politicians ("If there is a Draw between P1 and P2 …"); robots likewise (TC-B4 re-resolution: win → 3, draw → 1 each — now stated in the rulebook). Only politicians replay. | ✅ author-confirmed 2026-07-08 |
| I-9 | The rulebook's bet examples ("P1 with Rock … Outcome: P1 Win" vs. Paper) contradicted the rulebook's own argument matrix (Rock loses to Paper). The matrix is normative; the examples' argument labels were corrected in place (P1 now holds Paper vs. Rock). Bet mechanics unchanged. | ✅ author-confirmed 2026-07-08: typos in the examples; paper beats rock everywhere |

## 15. Test Fixtures (from the rulebook — normative)

Conflict outcomes (§8.2): TC-C1 R/S/P → all draw · TC-C2 R/R/R → all draw · TC-C3
P,P vs S → S wins, papers lose · TC-C4 S, D, R → D clear loser, R beats S → R wins ·
TC-C5 R,R vs S → S loses; rocks tied-win → per I-1 · TC-C6 D/D/D → all draw.

Bets: TC-B1 artist P+winbet vs artist R+losebet → P1 win+bonus, P2 lose-bet success →
re-resolution; outcomes per rulebook (winner 2 art / split 1-1 / draw 1-0) · TC-B2 same
for scientists (draw branch: 2 vs 1) · TC-B3 same for politicians (draw branch:
re-fight to the end) · TC-B4 robot D+drawbet vs robot D+drawbet → both convert to win →
re-resolution without bets · TC-B5 robot R vs robot D+losebet → lose bet success →
re-resolution without bets · TC-B6 3p: R, S, D+losebet → S eliminated with nothing;
re-resolution R vs D-owner · TC-B7 3p: R, D+drawbet, D+drawbet → dummies lose to R
(bets fail vs the field) → R wins alone · TC-B8 3p electricity: P(no bet), R+losebet,
R(no bet) → betless loser eliminated; re-resolution P vs bettor.

Scoring: TC-V1 (5,2,4)+0f → 2 · TC-V2 (5,2,4)+2f → 4 · TC-V3 (3,1,2)+3f → 3 · TC-V4
(1,1,1)+9f → 4 · TC-V5 (10,0,8)+3f → 3. Tie-breaker flow, event-deck depletion (turn 9+
has no events), action-deck depletion, all-zero discard, politician 10+10 deadlock, and
elimination asset-removal each get dedicated scenario tests.

Every fixture cites its rulebook line at implementation time; the engine test suite
fails if a fixture and the rulebook example diverge.
