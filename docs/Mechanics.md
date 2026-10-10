# Metarchy — Game Mechanics (Technical Reference)

This document describes every game mechanic in precise technical terms, mapping rules to their implementation in code. Use this as the source of truth when implementing or refactoring game logic.

---

## 1. Turn Structure

A game consists of **N turns** determined by player count:

| Players | Turns | Source |
|---|---|---|
| 2 | 5 | `MAX_TURNS[2]` in `core/constants` |
| 3 | 5 | `MAX_TURNS[3]` |
| 4 | 5 | `MAX_TURNS[4]` (2 vs 2) |
| Game vs. Bots | 5 | `MAX_TURNS[3]` (3 players) |

Each turn has 5 phases executed in strict order:

```
Phase 1: EVENT         (skipped on Turn 1)
Phase 2: DISTRIBUTION
Phase 3: ACTION        (4 sub-steps)
Phase 4: CONFLICT
Phase 5: MARKET
```

Phase advancement is handled by `advancePhase()` in `modules/phase/phaseEngine.ts`. The function is a pure state machine: `TurnState → PhaseAdvanceResult`.

After Phase 4 of the last turn, if players tie for Victory Points, an extra tie-breaker Turn is played (starting with Market Phase specifically for the tied players). Otherwise, `isGameOver = true`.

---

## 2. Actors

Each player starts with 4 Actors. Defined in `DEFAULT_ACTORS` (`core/constants`):

| Actor | Type key | Values Produced | Allowed Locations |
|---|---|---|---|
| Politician | `politician` | Power | `square`, `university` |
| Scientist | `scientist` | Knowledge | `university`, `theatre` |
| Artist | `artist` | Art | `square`, `theatre` |
| Robot | `robot` | Product / Energy / Recycle (depends on location) | `factory`, `power_plant`, `dump` |

**Location constraints** are defined in `ALLOWED_MOVES` and enforced by `isValidPlacement()` in `modules/distribution/placementLogic.ts`.

### Actor Data Structure (`PlacedActor`)
```typescript
{
    actorId: string;       // Unique ID (e.g. "a1", "bot1_a3")
    playerId: string;      // Owner's player ID
    locId: string;         // Target location ID
    type: ArgumentType;    // Assigned argument: rock | paper | scissors | dummy
    actorType: ActorType;  // politician | scientist | artist | robot
    name: string;          // Display name
    avatar: string;        // Full actor sprite path
    headAvatar: string;    // Head-only sprite path
    isOpponent?: boolean;  // True for non-local players
    bid?: BetType;         // Optional bet: product | energy | recycle
}
```

---

## 3. Arguments (RPS System)

Each Actor must receive exactly one Argument. Each player has 4 arguments — one per actor, no repeats.

| Argument | Beats | Loses to | Draws with |
|---|---|---|---|
| Rock | Scissors, Dummy | Paper | Rock |
| Paper | Rock, Dummy | Scissors | Paper |
| Scissors | Paper, Dummy | Rock | Scissors |
| Dummy | — | Rock, Paper, Scissors | Dummy |

**Implementation:** `rpsOutcome(a, b)` in `core/constants` returns `'win' | 'lose' | 'draw'`.

Available arguments are tracked by `getAvailableArguments()` in `modules/distribution` — filters out already-assigned arguments for the current player.

---

## 4. Locations

6 locations defined in `LOCATIONS` array (`core/constants`):

| Location | ID | Resource Type | Accepted Actors |
|---|---|---|---|
| The Square | `square` | power (intangible) | Politician, Artist |
| The Theatre | `theatre` | art (intangible) | Scientist, Artist |
| University | `university` | knowledge (intangible) | Politician, Scientist |
| Factory | `factory` | product (material) | Robot |
| Power Plant | `power_plant` | electricity (material) | Robot |
| Dump | `dump` | recycling (material) | Robot |

Each location has coordinates (x, y), dimensions, sprite paths (normal, hint, active), and a resource type.

---

## 5. Resources & Values

### Values (Intangible)
Used to form Victory Points:
- **Power** — produced by Politicians at Square/University
- **Art** — produced by Artists at Theatre/Square
- **Knowledge** — produced by Scientists at University/Theatre
- **Fame** — earned via Events; acts as wild card for VP calculation

### Resources (Material)
Used for Bets and Market purchases:
- **Production** (`product`) — from Factory; used to bet on **Win**
- **Electricity** (`energy`) — from Power Plant; used to bet on **Lose**
- **Recycling** (`recycle`) — from Dump; used to bet on **Draw**

### Initial Resources
```typescript
// core/constants — DEFAULT_RESOURCES
{ gato: 1000, product: 1, energy: 1, recycle: 1, power: 0, art: 0, knowledge: 0, fame: 0 }

// All players (including bots) use the same DEFAULT_RESOURCES
```

---

## 6. Bets

When placing an Actor, a player MAY attach a Bet by spending 1 Resource:

| Bet Resource | Bet On | Effect if Successful |
|---|---|---|
| Production (`product`) | Win | Actor returns with **+1 additional** Value or Resource |
| Electricity (`energy`) | Lose | **All rewards from round 1 are cancelled.** Losers without Electricity bet are eliminated. The entire conflict is re-resolved from scratch (standard rules, no bets). |
| Recycling (`recycle`) | Draw | Draw counts as **Win** for this Actor. Other Actors with Draw outcome (without Bet on Draw) get **nothing** — their Draw rewards are denied. |

**Important:** The bet resource is always consumed regardless of outcome.

---

## 7. Conflict Detection & Resolution

### Detection
`detectConflicts()` in `modules/conflict/conflictDetector.ts`:
1. Groups all `PlacedActor[]` by `locId`
2. Within each location, groups by `actorType`
3. If a group has >1 actor → creates a `Conflict` object
4. If a group has exactly 1 actor → that actor is "peaceful" (auto-wins)
5. Disabled locations are skipped entirely

### Phase 4 Flow (Updated 2026-04-12)

**1. Conflicts Overview Modal** (`ConflictsOverviewModal.tsx`):
- Shows all conflicts at once with numbered list (#1, #2, #3...)
- Displays location, actors preview, resource type for each conflict
- Player clicks "GET IT" to begin sequential resolution
- No sidebar during resolution - full-screen experience

**2. Sequential Resolution** (enforced):
- Conflicts must be resolved in order (#1 → #2 → #3)
- Cannot skip ahead (🔒 LOCKED indicator on future conflicts)
- After resolving conflict, auto-opens next conflict after 500ms
- Visual feedback: ✓ RESOLVED (green), 🔒 LOCKED (red), pulsing gold for next

**3. Completion State**:
- After last conflict: "ALL CONFLICTS RESOLVED" banner appears
- Modal stays open showing final conflict result
- Player must click "NEXT PHASE" button to advance
- Button changes to "WAITING FOR OTHERS..." in PvP

**4. PvP Consensus** (server-side validation):
- Server validates `conflictsResolved` flag before allowing Phase 4 → 5 transition
- Returns 400 error if player tries to advance with unresolved conflicts
- All players must resolve all conflicts and click "NEXT PHASE"
- Server increments `phaseTicker` only when all players ready

### Resolution Logic
`resolveConflictLogic()` in `modules/conflict/conflictResolver.ts`:

**Input:** local player's RPS choice, opponent choices, bid information
**Output:** `ConflictResult` with winner, draw/restart flags, bid results, logs

**Resolution Algorithm:**
1. All participants reveal their Arguments
2. Don't filter out `dummy` arguments
3. Count remaining argument types:
   - 1 type present → all who played it are tied (draw among same)
   - 2 types present → standard RPS determines winner type
   - 3 types present → global draw
   - If two or more argument types are presented, and one of them is a Dummy, the Actor with the Dummy Argument is considered the loser.
4. If exactly 1 winner → that player wins
5. If multiple winners (same type) → draw among them

### Draw Rules (Actor-Specific)

| Actor Type | Draw Behavior | Code Flag |
|---|---|---|
| **Politician** | Must re-resolve until Win/Lose | `restart: true` |
| **Scientist** | All scientists win (share rewards) | `shareRewards: true` |
| **Artist** | All artists lose (nobody gets Art) | `evictAll: true` |
| **Robot** | All robots get reduced reward (1 instead of 3) | `shareRewards: true` |

### Reward Calculation
`calculateReward()` in `modules/resources/resourceManager.ts`:

**Fixed 2026-04-12:** Now correctly passes `playerActorId` instead of `localPlayerId` to match bid checking logic.

| Actor | Win Reward | Draw Reward | Lose Reward |
|---|---|---|---|
| Politician | 1 Power | (re-fight) | 0 |
| Scientist | 1 Knowledge | 1 Knowledge each | 0 |
| Artist | 1 Art | 0 each | 0 |
| Robot | 3 Resources | 1 Resource each | 0 |

With successful Production bet: +1 to any reward.

**Reward Distribution:**
- `handleConflictResolve()` in `useBoardSession.ts` awards resources after each conflict
- Winner detection checks both `localPlayerId` and `playerActorId` for correct matching
- Resources immediately added to player inventory via `updateResource()`
- Bot opponents receive rewards via `setOpponentsData()` state update

---

## 8. Victory Points

`calculateVictoryPoints()` in `modules/resources/resourceManager.ts`:

```
VP = min(Power, Knowledge, Art) — after distributing Fame
```

**Fame distribution algorithm** (greedy):
1. While Fame > 0:
   - Find which of {Power, Knowledge, Art} is the lowest
   - Increment that value by 1
   - Decrement Fame by 1
2. Return `min(Power, Knowledge, Art)`

---

## 9. Phase 1: Events

Starting from Turn 2, a random Event Card is drawn. 7 events defined in `EVENTS` (`core/constants`):

### Compare Events (reward: Fame)
The player with the **min or max** of a specific value gets Fame:
- **Political Repression** — least Power → Fame
- **Educational Crisis** — least Knowledge → Fame
- **Cultural Decline** — least Art → Fame
- **Revolution** — least total Values → Fame

### Discard Events (reward: Action Card)
Players secretly discard resources. Whoever discards the most gets a random Action Card:
- **Help Poor Countries** — discard Product
- **Earth Hour** — discard Energy
- **Prevent Eco-Crisis** — discard Recycling

**Implementation:** `pickRandomEvent()`, `resolveCompareEvent()`, `resolveDiscardEvent()` in `modules/actions/eventLogic.ts`.

If tied, a Conflict Resolution (RPS) determines the winner.

---

## 10. Phase 2: Distribution

Players secretly place all 4 Actors on the board:
1. Choose Location (validated by `ALLOWED_MOVES`)
2. Assign Argument (each actor gets a unique one)
3. Optionally attach Bet (costs 1 resource)

**Implementation:** `modules/distribution/placementLogic.ts`
- `isValidPlacement(actorType, locationId)` — checks allowed moves
- `createPlacedActor(...)` — builds the `PlacedActor` struct
- `getAvailableArguments(placed, playerId)` — returns unused arguments
- `recallActor(placed, actorId)` — removes a placed actor

### Bot Placement
`generateBotPlacements()` in `modules/bot/botAI.ts`:
- Random location from allowed set
- Random unique argument per actor
- Random bid (or none)

---

## 11. Phase 3: Action Cards (4 sub-steps)

Phase 3 has 4 sequential sub-steps, each allowing a specific card type:

| Step | Name | Allowed Cards |
|---|---|---|
| 0 | SELECT CARDS | Players select cards to activate |
| 1 | BLOCK LOCATIONS | Location-blocking cards only (`type: 'turn off location'`) |
| 2 | RELOCATION | Relocation/teleport cards only |
| 3 | CHANGE VALUES | Change Values / exchange cards only |

**Implementation:** `getFilteredCards(hand, p3Step)` in `modules/actions/actionCardLogic.ts`.

### Card Effects

**Block Location** (6 cards — one per location):
- `applyBlockLocation(disabledLocations, locationId)` — adds location to disabled list
- Actors in disabled locations produce no values, have no conflicts

**Relocation** (6 cards in deck):
- `isValidRelocation(actorType, targetLocId)` — validates new location
- `relocateActor(placedActors, actorId, newLocId)` — moves actor

**Change Values** (3 cards in deck):
- Exchange one of your Values (Power/Art/Knowledge) with another player's Value

---

## 12. Phase 5: Market

Players can buy random Action Cards using resources.

**Cost:** 1 Product + 1 Energy + 1 Recycle = 1 random Action Card

**Implementation:** `modules/market/marketLogic.ts`
- `canBuyActionCard(resources)` — checks affordability
- `deductBuyCost(resources)` — subtracts costs
- `pickRandomActionCard()` — random card from `ACTION_CARDS` array
- `createCardInstance(card, n)` — creates unique instance with `instanceId`

---

## 13. Action Card Inventory

8 unique Action Cards defined in `ACTION_CARDS` (`core/constants`):

| Card | Type | Effect |
|---|---|---|
| Under Construction | Block | Disables Square |
| Charity Event | Block | Disables Theatre |
| Student Protests | Block | Disables University |
| Sabotage | Block | Disables Factory |
| Blackout | Block | Disables Power Plant |
| Ecological Protests | Block | Disables Dump |
| Relocation | Action | Move any one actor (own or opponent's) to another valid location |
| Change of Values | Action | Exchange one Value with another player (cannot exchange Fame) |

Full deck in rules: 15 cards (6 block + 6 relocation + 3 change values).
Technical implementation: Uses 8 definitions (6 block + 1 relocation + 1 change values) that are duplicated to form the 15-card deck.

---

## 14. Bot AI

Bot decision-making in `modules/bot/botAI.ts` (pure functions):
- `pickRandomArgument()` — random from `[rock, paper, scissors, dummy]`
- `pickRandomBet()` — random from `[product, energy, recycle, undefined]`
- `pickRandomLocation(actorType)` — random valid location
- `generateBotPlacements(botId, prefix)` — full 4-actor placement
- `pickBotConflictChoice()` — random RPS for conflict resolution

Stateful bot orchestration remains in `lib/game/BotAI.ts` (legacy, uses `setTimeout` + React setState).

---

## 15. Commit-Reveal Scheme (Smart Contract)

On-chain fairness guarantee implemented in `MetarchyGame.sol`:

```
Distribution Phase:
  1. commitMove(gameId, keccak256(gameId, turn, phase, moveData, salt))
     → All commits → auto-advance to DISTRIBUTION_REVEAL

  2. revealMove(gameId, moveData, salt)
     → Contract verifies: keccak256(...) == stored hash
     → All reveals → auto-advance to ACTION phase

After ACTION → CONFLICT → MARKET → next turn (EVENT)
```

Player state is reset between phases (commitHash zeroed, revealed flag cleared).
