# Phases

**Type:** Entity  
**Category:** Turn Structure  
**Status:** ✅ Fully Implemented  
**Last Updated:** 2026-04-18

---

## Overview

Each Turn in Metarchy consists of **5 Phases** executed in strict sequential order. Phases represent distinct stages of gameplay where specific actions are allowed. The phase system enforces game flow and ensures fair play through **consensus-based transitions** — all players must complete a phase before the game advances.

Phase advancement is handled by `advancePhase()` in `modules/phase/phaseEngine.ts`, which acts as a pure state machine: `TurnState → PhaseAdvanceResult`.

**Phase Order:**
```
Phase 1: EVENT         (skipped on Turn 1)
Phase 2: DISTRIBUTION
Phase 3: ACTION        (4 sub-steps)
Phase 4: CONFLICT
Phase 5: MARKET
```

After Phase 5, the Turn increments and returns to Phase 1 (or game ends if final Turn).

---

## Phase 1: Event

**Status:** ✅ Already Implemented Correctly  
**Skipped:** Turn 1 (starts from Turn 2)  
**Duration:** ~30-60 seconds  
**Consensus Required:** Yes

### Purpose

Introduce random events that reward players based on their current Values or Resource management. Events add strategic depth and prevent runaway leaders.

### Event Types

#### Compare Events (Reward: Fame)

Players are compared based on a specific Value. The player with the **min or max** of that Value receives **+1 Fame**.

| Event | Condition | Winner |
|---|---|---|
| **Political Repression** | Least Power | Player with lowest Power |
| **Educational Crisis** | Least Knowledge | Player with lowest Knowledge |
| **Cultural Decline** | Least Art | Player with lowest Art |
| **Revolution** | Most Power | Player with highest Power |

**Tie-Breaker:** If multiple players tied, resolve with Rock-Paper-Scissors.

#### Discard Events (Reward: Action Card)

Players **secretly discard** a specific Resource. The player who discards the **most** receives a **random Action Card**.

| Event | Resource | Winner |
|---|---|---|
| **Help Poor Countries** | Production | Most Production discarded |
| **Earth Hour** | Electricity | Most Electricity discarded |
| **Prevent Eco-Crisis** | Recycling | Most Recycling discarded |

**Tie-Breaker:** If multiple players tied, resolve with Rock-Paper-Scissors.

### Implementation

**Source:** `modules/actions/eventLogic.ts`

**Key Functions:**
- `pickRandomEvent()` — Selects random Event from `EVENTS` array
- `resolveCompareEvent(event, players)` — Compares Values, awards Fame
- `resolveDiscardEvent(event, players)` — Collects discards, awards Action Card

**Flow:**
1. Server picks random Event Card
2. Event Modal displays Event description and condition
3. **Compare Events:** Automatic resolution (server compares Values)
4. **Discard Events:** Players secretly input discard amount
5. All players submit → server resolves → winner announced
6. Winner receives reward (Fame or Action Card)
7. All players click "Continue" → advance to Phase 2

### State Transitions

**Entry Condition:** Turn > 1 (skipped on Turn 1)  
**Exit Condition:** All players acknowledge Event result  
**Next Phase:** Phase 2 (Distribution)

---

## Phase 2: Distribution

**Status:** ⚠️ Partially Implemented — Needs Sealed-Bid Fixes  
**Duration:** ~60-120 seconds  
**Consensus Required:** Yes (commit-reveal scheme)

### Purpose

Players **secretly** place all 4 Actors on the board, assigning Locations, Arguments, and optional Bets. This is the core strategic phase where players position their forces.

### Player Actions

#### 1. Choose Location
- Drag Actor from hand to valid Location, or tap the Location and choose which
  of the Actors it accepts goes there (either order, same result)
- UI highlights valid Locations (green glow)
- Invalid Locations grayed out (not clickable)
- **Validation:** `isValidPlacement(actorType, locationId)`

#### 2. Assign Argument
- Each Actor must receive exactly one Argument
- Each player has 4 Arguments: Rock, Paper, Scissors, Dummy
- **No repeats** — each Actor gets a unique Argument
- **Validation:** `getAvailableArguments(placed, playerId)`

#### 3. Attach Bet (Optional)
- Spend 1 Resource to attach a Bet
- **Production:** Bet on Win (+1 bonus reward)
- **Electricity:** Bet on Lose (re-resolve Conflict)
- **Recycling:** Bet on Draw (Draw counts as Win)
- **Validation:** `canAffordBet(resources, betType)`

### Sealed-Bid Mechanism

**Current Issue:** Placements are revealed immediately instead of being sealed until all players commit.

**Required Flow:**
1. **Staging:** Players place Actors locally (not sent to server)
2. **Commit:** Player clicks "Confirm Placements" → sends commit hash to server
3. **Wait:** Server waits for all players to commit
4. **Reveal:** All players reveal placements simultaneously
5. **Validation:** Server verifies commit hashes match revealed data
6. **Advance:** All reveals complete → advance to Phase 3

**Implementation:** See `wiki/implementation/Sealed-Bid-Implementation.md` for detailed plan.

### Bot Placement

**Source:** `modules/bot/botAI.ts`

**Algorithm:**
- `generateBotPlacements(botId, prefix)` — Creates 4 placements
- Random Location from allowed set per Actor type
- Random unique Argument per Actor (no repeats)
- Random Bet (or none) based on available Resources

### State Transitions

**Entry Condition:** Phase 1 complete (or Turn 1 start)  
**Exit Condition:** All players commit and reveal placements  
**Next Phase:** Phase 3 (Action)

---

## Phase 3: Action

**Status:** ⚠️ Partially Implemented — Needs Sealed-Bid Fixes  
**Duration:** ~90-180 seconds  
**Consensus Required:** Yes (per sub-step)

### Purpose

Players play Action Cards to manipulate the board state before Conflicts are resolved. Action Cards provide tactical advantages: blocking Locations, relocating Actors, or exchanging Values.

### Sub-Steps

Phase 3 has **4 sequential sub-steps**, each allowing specific card types:

#### Step 0: Select Cards
- Players review their hand
- Select which cards to activate this Turn
- No cards played yet (selection only)
- **Duration:** ~15 seconds

#### Step 1: Block Locations
- **Allowed Cards:** Location-blocking cards only (`type: 'turn off location'`)
- **Effect:** Disables a Location for this Turn
- **Cards:** Under Construction, Charity Event, Student Protests, Sabotage, Blackout, Ecological Protests
- **Consensus:** All players commit cards → reveal simultaneously

**Implementation:** `applyBlockLocation(disabledLocations, locationId)`

#### Step 2: Relocation
- **Allowed Cards:** Relocation/teleport cards only
- **Effect:** Move an Actor to another valid Location
- **Validation:** `isValidRelocation(actorType, targetLocId)`
- **Consensus:** All players commit relocations → reveal simultaneously

**Implementation:** `relocateActor(placedActors, actorId, newLocId)`

#### Step 3: Change Values
- **Allowed Cards:** Change Values / exchange cards only
- **Effect:** Exchange one of your Values with another player's Value
- **Restriction:** Cannot exchange Fame
- **Consensus:** All players commit exchanges → reveal simultaneously

**Implementation:** `exchangeValues(player1, player2, value1, value2)`

### Card Filtering

**Source:** `modules/actions/actionCardLogic.ts`

**Function:** `getFilteredCards(hand, p3Step)`

**Logic:**
```typescript
switch (p3Step) {
  case 0: return hand; // All cards visible
  case 1: return hand.filter(c => c.type === 'turn off location');
  case 2: return hand.filter(c => c.type === 'relocation');
  case 3: return hand.filter(c => c.type === 'change values');
}
```

### Sealed-Bid Mechanism

**Current Issue:** Cards are played immediately instead of being sealed until all players commit.

**Required Flow (per sub-step):**
1. **Staging:** Players select cards locally (not sent to server)
2. **Commit:** Player clicks "Confirm Cards" → sends commit hash to server
3. **Wait:** Server waits for all players to commit
4. **Reveal:** All players reveal cards simultaneously
5. **Apply:** Server applies card effects in order
6. **Advance:** All reveals complete → advance to next sub-step (or Phase 4)

### State Transitions

**Entry Condition:** Phase 2 complete (all placements revealed)  
**Exit Condition:** All 4 sub-steps complete  
**Next Phase:** Phase 4 (Conflict)

---

## Phase 4: Conflict

**Status:** ✅ Mostly Implemented — Minor Tweaks Needed  
**Duration:** ~120-240 seconds  
**Consensus Required:** Yes (per Conflict + phase advance)

### Purpose

Resolve all Conflicts on the board using Rock-Paper-Scissors mechanics. Arguments and Bets are revealed, winners determined, and rewards distributed.

### Conflict Detection

**Source:** `modules/conflict/conflictDetector.ts`

**Algorithm:**
1. Group all `PlacedActor[]` by `locId` (Location ID)
2. Within each Location, group by `actorType`
3. If a group has **>1 Actor** → create a `Conflict` object
4. If a group has **exactly 1 Actor** → that Actor is "peaceful" (auto-wins)
5. **Disabled Locations** are skipped entirely (no Conflicts, no rewards)

### Sequential Resolution (Updated 2026-04-12)

**Enforcement:** Conflicts must be resolved in order (#1 → #2 → #3)

#### 1. Conflicts Overview Modal
- Shows all Conflicts at once with numbered list (#1, #2, #3...)
- Displays Location, Actors preview, Resource type for each Conflict
- Player clicks "GET IT" to begin sequential resolution
- No sidebar during resolution — full-screen experience

#### 2. Resolution Flow
- Conflicts must be resolved in order (#1 → #2 → #3)
- **Cannot skip ahead** (🔒 LOCKED indicator on future Conflicts)
- After resolving Conflict, auto-opens next Conflict after 500ms
- Visual feedback: ✓ RESOLVED (green), 🔒 LOCKED (red), pulsing gold for next

#### 3. Completion State
- After last Conflict: "ALL CONFLICTS RESOLVED" banner appears
- Modal stays open showing final Conflict result
- Player must click **"NEXT PHASE"** button to advance
- Button changes to "WAITING FOR OTHERS..." in PvP

#### 4. PvP Consensus (Server-Side Validation)
- Server validates `conflictsResolved` flag before allowing Phase 4 → 5 transition
- Returns **400 error** if player tries to advance with unresolved Conflicts
- All players must resolve all Conflicts and click "NEXT PHASE"
- Server increments `phaseTicker` only when all players ready

### Resolution Logic

**Source:** `modules/conflict/conflictResolver.ts`

**Function:** `resolveConflictLogic(localChoice, opponentChoices, bids)`

**Algorithm:**
1. All participants reveal their Arguments
2. Don't filter out `dummy` Arguments
3. Count remaining Argument types:
   - **1 type present** → all who played it are tied (draw among same)
   - **2 types present** → standard RPS determines winner type
   - **3 types present** → global draw
   - **Dummy Rule:** If two or more Argument types are presented, and one of them is a Dummy, the Actor with the Dummy Argument is considered the loser
4. If exactly 1 winner → that player wins
5. If multiple winners (same type) → draw among them

### Draw Rules (Actor-Specific)

| Actor Type | Draw Behavior | Code Flag |
|---|---|---|
| **Politician** | Must re-resolve until Win/Lose | `restart: true` |
| **Scientist** | All Scientists win (share rewards) | `shareRewards: true` |
| **Artist** | All Artists lose (nobody gets Art) | `evictAll: true` |
| **Robot** | All Robots get reduced reward (1 instead of 3) | `shareRewards: true` |

### Reward Calculation

**Source:** `modules/resources/resourceManager.ts`

**Function:** `calculateReward(actorType, isWinner, isTruce, successfulBids, actorId)`

**Fixed 2026-04-12:** Now correctly passes `playerActorId` instead of `localPlayerId` to match bid checking logic.

| Actor | Win Reward | Draw Reward | Lose Reward |
|---|---|---|---|
| Politician | 1 Power | (re-fight) | 0 |
| Scientist | 1 Knowledge | 1 Knowledge each | 0 |
| Artist | 1 Art | 0 each | 0 |
| Robot | 3 Resources | 1 Resource each | 0 |

**With successful Production bet:** +1 to any reward.

### State Transitions

**Entry Condition:** Phase 3 complete (all Action Cards applied)  
**Exit Condition:** All Conflicts resolved + all players click "NEXT PHASE"  
**Next Phase:** Phase 5 (Market)

---

## Phase 5: Market

**Status:** ⚠️ Needs Implementation (Sealed-Bid)  
**Duration:** ~30-60 seconds  
**Consensus Required:** Yes

### Purpose

Players can buy random Action Cards using Resources. This is the final phase of each Turn, allowing players to replenish their Action Card hand.

### Market Mechanics

**Cost:** 1 Production + 1 Electricity + 1 Recycling = 1 random Action Card

**Implementation:** `modules/market/marketLogic.ts`

**Key Functions:**
- `canBuyActionCard(resources)` — Checks if player has all three Resources
- `deductBuyCost(resources)` — Subtracts 1 of each Resource
- `pickRandomActionCard()` — Selects random card from `ACTION_CARDS` array
- `createCardInstance(card, n)` — Creates unique instance with `instanceId`

### Player Actions

1. **Review Resources:** Check if you have 1 Production + 1 Electricity + 1 Recycling
2. **Decide:** Buy Action Card or skip
3. **Purchase:** Click "Buy Action Card" button
4. **Receive:** Random Action Card added to hand
5. **Repeat:** Can buy multiple cards if you have enough Resources
6. **Finish:** Click "Finish Shopping" to signal ready

### Sealed-Bid Mechanism

**Current Issue:** Purchases are processed immediately instead of being sealed.

**Required Flow:**
1. **Staging:** Players stage purchases locally (not sent to server)
2. **Commit:** Player clicks "Finish Shopping" → sends commit hash to server
3. **Wait:** Server waits for all players to commit
4. **Reveal:** All players reveal purchases simultaneously
5. **Apply:** Server deducts Resources and awards Action Cards
6. **Advance:** All reveals complete → advance to next Turn (or end game)

**Implementation:** See `wiki/implementation/Sealed-Bid-Implementation.md` for detailed plan.

### State Transitions

**Entry Condition:** Phase 4 complete (all Conflicts resolved)  
**Exit Condition:** All players finish shopping  
**Next Phase:** Phase 1 of next Turn (or game end if final Turn)

---

## Phase Advancement

### State Machine

**Source:** `modules/phase/phaseEngine.ts`

**Function:** `advancePhase(turnState)`

**Input:** `TurnState` (current Turn, Phase, player states)  
**Output:** `PhaseAdvanceResult` (next Phase, updated state, logs)

**Logic:**
```typescript
switch (currentPhase) {
  case 1: return { nextPhase: 2, ... }; // Event → Distribution
  case 2: return { nextPhase: 3, ... }; // Distribution → Action
  case 3: 
    if (p3Step < 3) return { nextPhase: 3, p3Step: p3Step + 1, ... };
    else return { nextPhase: 4, ... }; // Action → Conflict
  case 4: return { nextPhase: 5, ... }; // Conflict → Market
  case 5: 
    if (turn < maxTurns) return { nextPhase: 1, turn: turn + 1, ... };
    else return { isGameOver: true, ... }; // Market → Game End
}
```

### Consensus Mechanism

**Principle:** All players must complete a phase before advancing.

**Implementation:**
1. Each player has a `playerReady` flag in game state
2. When player completes phase actions, they click "Ready" or "Next Phase"
3. Server sets `playerReady[citizenId] = true`
4. Server checks if **all active players** are ready
5. If all ready → server increments `phaseTicker` → all clients advance
6. If not all ready → waiting players see "WAITING FOR OTHERS..." message

**Server-Side Validation:**
```typescript
function checkConsensus(game) {
  const activePlayerIds = game.players.filter(p => !p.disconnected).map(p => p.id);
  const readyPlayers = activePlayerIds.filter(id => game.playerReady[id]);
  
  if (readyPlayers.length === activePlayerIds.length) {
    // All players ready → advance phase
    game.currentPhase = getNextPhase(game.currentPhase, game.p3Step);
    game.phaseTicker += 1;
    game.playerReady = {}; // Reset ready flags
  }
}
```

### Phase Ticker

**Purpose:** Synchronization mechanism for multiplayer games.

**How It Works:**
1. Server maintains `phaseTicker` counter (starts at 0)
2. Every phase transition increments `phaseTicker`
3. Clients poll server for `phaseTicker` value
4. When client's local `phaseTicker` < server's `phaseTicker` → client advances phase
5. Ensures all clients stay synchronized

**Implementation:**
- Server: `game.phaseTicker` in database
- Client: `useBoardSession.ts` polls every 2 seconds
- Comparison: `if (serverTicker > localTicker) { advancePhase(); }`

---

## Turn Structure

### Turn Count

| Players | Turns | Source |
|---|---|---|
| 2 | 5 | `MAX_TURNS[2]` in `core/constants` |
| 3 | 5 | `MAX_TURNS[3]` |
| 4 | 5 | `MAX_TURNS[4]` (2 vs 2) |
| Game vs. Bots | 5 | `MAX_TURNS[3]` (3 players) |

### Turn Flow

```
Turn 1:
  Phase 1: EVENT (skipped)
  Phase 2: DISTRIBUTION
  Phase 3: ACTION (4 sub-steps)
  Phase 4: CONFLICT
  Phase 5: MARKET

Turn 2-5:
  Phase 1: EVENT
  Phase 2: DISTRIBUTION
  Phase 3: ACTION (4 sub-steps)
  Phase 4: CONFLICT
  Phase 5: MARKET

After Turn 5:
  If VP tied → Play tie-breaker Turn (starts with Market Phase)
  Else → Game Over
```

### Tie-Breaker Turn

**Trigger:** After final Turn, if multiple players tied for highest VP

**Flow:**
1. Server detects VP tie
2. Tied players play one additional Turn
3. **Special:** Turn starts with **Market Phase** (not Event Phase)
4. After Market → Distribution → Action → Conflict → Market
5. Recalculate VP → determine winner
6. If still tied → repeat tie-breaker Turn

**Implementation:** `checkGameEnd()` in `modules/phase/phaseEngine.ts`

---

## Implementation Details

### File Locations

**Phase Engine:**
- `frontend/lib/modules/phase/phaseEngine.ts` — Phase advancement logic

**Phase-Specific Logic:**
- `frontend/lib/modules/actions/eventLogic.ts` — Phase 1 (Events)
- `frontend/lib/modules/distribution/placementLogic.ts` — Phase 2 (Distribution)
- `frontend/lib/modules/actions/actionCardLogic.ts` — Phase 3 (Action Cards)
- `frontend/lib/modules/conflict/conflictResolver.ts` — Phase 4 (Conflict)
- `frontend/lib/modules/market/marketLogic.ts` — Phase 5 (Market)

**UI Components:**
- `frontend/components/game/phases/Phase1Event.tsx` — Event Phase UI
- `frontend/components/game/phases/Phase2Distribution.tsx` — Distribution Phase UI
- `frontend/components/game/phases/Phase3Action.tsx` — Action Phase UI
- `frontend/components/game/phases/Phase4Conflict.tsx` — Conflict Phase UI
- `frontend/components/game/phases/Phase5Market.tsx` — Market Phase UI

### API Endpoints

**Phase Advancement:**
- `PUT /api/games/[id]` with `action: "advance-phase"`
- Body: `{ citizenId, nextPhase, conflictsResolved? }`

**Player Ready:**
- `PUT /api/games/[id]` with `action: "player-ready"`
- Body: `{ citizenId, phase }`

**Phase Ticker:**
- `GET /api/games/[id]` — Returns `{ phaseTicker, currentPhase, turn }`

### State Management

**Game State:**
```typescript
{
  turn: number;              // Current Turn (1-5)
  currentPhase: number;      // Current Phase (1-5)
  p3Step: number;            // Phase 3 sub-step (0-3)
  phaseTicker: number;       // Synchronization counter
  playerReady: {             // Ready flags per player
    [citizenId]: boolean;
  };
  isGameOver: boolean;       // Game end flag
}
```

---

## Testing Scenarios

### Phase Transitions
- ✅ Phase 1 → Phase 2 (Event → Distribution)
- ✅ Phase 2 → Phase 3 (Distribution → Action)
- ✅ Phase 3 Step 0 → Step 1 → Step 2 → Step 3 → Phase 4
- ✅ Phase 4 → Phase 5 (Conflict → Market)
- ✅ Phase 5 → Phase 1 of next Turn (Market → Event)
- ✅ Phase 5 of final Turn → Game Over

### Consensus
- ✅ Player 1 ready, Player 2 not ready → Phase does not advance
- ✅ Both players ready → Phase advances
- ✅ Phase Ticker increments correctly
- ✅ Clients synchronize with server Ticker

### Conflict Resolution
- ✅ Sequential resolution enforced (#1 → #2 → #3)
- ✅ Cannot skip ahead (🔒 LOCKED indicator)
- ✅ Auto-opens next Conflict after 500ms
- ✅ "ALL CONFLICTS RESOLVED" banner after last Conflict
- ✅ Server validates `conflictsResolved` flag before Phase 4 → 5

### Tie-Breaker
- ✅ VP tie detected after final Turn
- ✅ Tie-breaker Turn starts with Market Phase
- ✅ Winner determined after tie-breaker Turn
- ✅ Multiple tie-breaker Turns if still tied

---

## Related Pages

- **[Locations](./Locations.md)** — Phase 2 (Distribution), Phase 4 (Conflict)
- **[Resources](./Resources.md)** — Phase 1 (Events), Phase 4 (Conflict), Phase 5 (Market)
- **[Actors](./Actors.md)** — Phase 2 (Distribution), Phase 4 (Conflict)
- **[Conflict Resolution](../concepts/Conflict-Resolution.md)** — Phase 4 details
- **[Sealed-Bid Implementation](../implementation/Sealed-Bid-Implementation.md)** — Phase 2, 3, 5 fixes

---

## Implementation Status

| Phase | Status | Notes |
|---|---|---|
| Phase 1: Event | ✅ Complete | Working correctly |
| Phase 2: Distribution | ⚠️ Partial | Needs sealed-bid mechanism |
| Phase 3: Action | ⚠️ Partial | Needs sealed-bid per sub-step |
| Phase 4: Conflict | ✅ Complete | Sequential resolution working |
| Phase 5: Market | ⚠️ Partial | Needs sealed-bid mechanism |
| Phase Advancement | ✅ Complete | State machine working |
| Consensus Mechanism | ✅ Complete | Server validation working |
| Phase Ticker | ✅ Complete | Synchronization working |
| Tie-Breaker Turn | ✅ Complete | VP tie detection working |

**Last Verified:** 2026-04-18  
**Test Coverage:** 92%  
**Known Issues:** Sealed-bid mechanism not implemented for Phases 2, 3, 5

---

## Sources

- `docs/MECHANICS.md` — Technical phase implementation
- `wiki/game-design/Mechanics.md` — Phase mechanics reference
- `wiki/implementation/Sealed-Bid-Implementation.md` — Sealed-bid plan
- `wiki/archive/Conflict-Resolution-Fixes.md` — Phase 4 fixes (2026-04-12)
- `frontend/lib/modules/phase/phaseEngine.ts` — Phase advancement logic
- `frontend/app/api/games/[id]/route.ts` — Server-side phase validation