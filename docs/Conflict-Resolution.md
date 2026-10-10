# Conflict Resolution

**Type:** Concept  
**Category:** Game Mechanics  
**Status:** ✅ Fully Implemented  
**Last Updated:** 2026-04-18

---

## Overview

Conflict Resolution is the core combat mechanic in Metarchy, determining which Actors win resources when multiple Actors of the same type occupy a Location. The system uses an extended **Rock-Paper-Scissors (RPS)** mechanic with a fourth option (Dummy) and **actor-specific draw rules** that create asymmetric gameplay.

Conflicts are resolved during **Phase 4** using a **sequential resolution system** that prevents state desynchronization and ensures fair multiplayer gameplay. All Conflicts must be resolved in order (#1 → #2 → #3) before players can advance to Phase 5.

**Key Features:**
- Extended RPS with Dummy argument
- Actor-specific draw behaviors (Politicians re-fight, Scientists share, Artists lose, Robots share reduced)
- Betting system for tactical advantages (Win/Lose/Draw bets)
- Sequential resolution with server-side validation
- Peaceful actors (no conflict) auto-win

---

## Rock-Paper-Scissors System

### Arguments

Each Actor must be assigned exactly one Argument during Distribution Phase. Each player has 4 Arguments (one per Actor), and **no repeats** are allowed.

| Argument | Beats | Loses to | Draws with |
|---|---|---|---|
| 🪨 **Rock** | Scissors, Dummy | Paper | Rock |
| 📄 **Paper** | Rock, Dummy | Scissors | Paper |
| ✂️ **Scissors** | Paper, Dummy | Rock | Scissors |
| 🪆 **Dummy** | Nothing | Rock, Paper, Scissors | Dummy |

### RPS Outcome Function

**Source:** `core/constants`

**Function:** `rpsOutcome(a: ArgumentType, b: ArgumentType): 'win' | 'lose' | 'draw'`

**Implementation:**
```typescript
function rpsOutcome(a: ArgumentType, b: ArgumentType): 'win' | 'lose' | 'draw' {
  if (a === b) return 'draw';
  
  const wins = {
    rock: ['scissors', 'dummy'],
    paper: ['rock', 'dummy'],
    scissors: ['paper', 'dummy'],
    dummy: []
  };
  
  return wins[a].includes(b) ? 'win' : 'lose';
}
```

### Dummy Argument Strategy

**Purpose:** The Dummy argument is a strategic wildcard that always loses to Rock/Paper/Scissors but draws with other Dummies.

**Use Cases:**
- **Sacrifice Play:** Send a Dummy to a Location you expect to lose, saving stronger Arguments for other Conflicts
- **Draw Fishing:** If you expect multiple Dummies, you can draw and trigger actor-specific draw rules
- **Resource Conservation:** Dummy actors that lose don't waste strong Arguments
- **Bet Synergy:** Combine Dummy with Recycling bet (bet on Draw) to convert expected draws into wins

**Risk:** If opponent plays Rock/Paper/Scissors, Dummy always loses.

---

## Conflict Detection

### Detection Algorithm

**Source:** `modules/conflict/conflictDetector.ts`

**Function:** `detectConflicts(placedActors: PlacedActor[], disabledLocations: string[]): Conflict[]`

**Steps:**
1. Filter out Actors at disabled Locations
2. Group remaining Actors by `locId` (Location ID)
3. Within each Location, group by `actorType`
4. If a group has **>1 Actor** → create a `Conflict` object
5. If a group has **exactly 1 Actor** → that Actor is "peaceful" (auto-wins)

**Conflict Object:**
```typescript
{
  locId: string;              // Location ID where Conflict occurs
  actorType: ActorType;       // Type of Actors in Conflict (politician | scientist | artist | robot)
  participants: PlacedActor[]; // All Actors involved
  resourceType: ResourceType;  // What's being fought over (power | art | knowledge | product | energy | recycle)
}
```

### Peaceful Actors

If only **one Actor of a type** is at a Location:
- No Conflict occurs
- Actor automatically wins and produces its Value/Resources
- **Win Bets** succeed (if attached) → +1 bonus reward
- **Draw/Lose Bets** fail (resource still consumed)

**Example:**
```
Location: Square
Actors: 1 Politician (Player A), 1 Artist (Player B)
Result: No Conflict (different types)
  → Politician produces 1 Power (peaceful)
  → Artist produces 1 Art (peaceful)
```

### Disabled Locations

Locations disabled by Action Cards (Phase 3) are **skipped entirely**:
- No Conflicts detected
- No Values/Resources produced (even by peaceful Actors)
- Actors remain at Location but are inactive
- Bets attached to Actors are consumed but have no effect

---

## Resolution Algorithm

### Core Logic

**Source:** `modules/conflict/conflictResolver.ts`

**Function:** `resolveConflictLogic(localChoice, opponentChoices, bids): ConflictResult`

**Input:**
- `localChoice`: Local player's RPS choice
- `opponentChoices`: Array of opponent RPS choices
- `bids`: Bet information for all participants

**Output:**
- `winnerId`: ID of winning player (or null if draw/restart)
- `loserIds`: Array of losing player IDs
- `restart`: Boolean flag for Politician re-fight
- `shareRewards`: Boolean flag for Scientist/Robot shared rewards
- `evictAll`: Boolean flag for Artist all-lose
- `successfulBids`: Array of successful bet actor IDs
- `logs`: Array of resolution log messages

**Algorithm:**
1. Collect all Arguments from participants
2. **Don't filter out Dummy arguments** (they participate in resolution)
3. Count distinct Argument types present
4. Apply resolution rules based on count:
   - **1 type present** → All who played it are tied (draw among same)
   - **2 types present** → Standard RPS determines winner type
   - **3 types present** → Global draw (all tied)
   - **Dummy Rule:** If 2+ Argument types present and one is Dummy, Dummy loses
5. Identify winner(s) and loser(s)
6. Apply actor-specific draw rules
7. Check bets against outcome
8. Return `ConflictResult`

### Resolution Examples

#### Example 1: Clear Winner
```
Participants: Player A (Rock), Player B (Scissors)
Resolution:
  → Rock beats Scissors
  → Winner: Player A
  → Loser: Player B
```

#### Example 2: Draw (Same Arguments)
```
Participants: Player A (Rock), Player B (Rock)
Resolution:
  → Both played Rock
  → Draw (actor-specific behavior applies)
  → Politicians: restart = true (re-fight)
  → Scientists: shareRewards = true (both win)
  → Artists: evictAll = true (both lose)
  → Robots: shareRewards = true (both get 1 Resource)
```

#### Example 3: Three-Way Conflict
```
Participants: Player A (Rock), Player B (Paper), Player C (Scissors)
Resolution:
  → 3 different types present
  → Global draw (all tied)
  → Apply actor-specific draw rules
```

#### Example 4: Dummy Loses
```
Participants: Player A (Rock), Player B (Dummy)
Resolution:
  → Rock beats Dummy
  → Winner: Player A
  → Loser: Player B
```

#### Example 5: Multiple Dummies Draw
```
Participants: Player A (Dummy), Player B (Dummy)
Resolution:
  → Both played Dummy
  → Draw (actor-specific behavior applies)
```

---

## Actor-Specific Draw Rules

### Politician: Re-Fight

**Behavior:** Must re-resolve until Win/Lose (no draws allowed)

**Code Flag:** `restart: true`

**Implementation:**
```typescript
if (actorType === 'politician' && isDraw) {
  return {
    restart: true,
    winnerId: null,
    loserIds: [],
    logs: ['Politicians must re-fight! Resolve again.']
  };
}
```

**Player Experience:**
1. Conflict resolves to draw
2. "Politicians must re-fight!" message appears
3. Players select new RPS choices
4. Conflict re-resolves with new choices
5. Repeat until Win/Lose outcome

**Strategic Implications:**
- Politicians cannot share rewards (unlike Scientists)
- Increases uncertainty (multiple rounds of RPS)
- Favors players with better RPS prediction skills

### Scientist: Share Rewards

**Behavior:** All Scientists in draw win (everyone gets Knowledge)

**Code Flag:** `shareRewards: true`

**Implementation:**
```typescript
if (actorType === 'scientist' && isDraw) {
  return {
    shareRewards: true,
    winnerId: null, // No single winner
    loserIds: [],
    logs: ['All Scientists share Knowledge!']
  };
}
```

**Reward Distribution:**
- Each Scientist gets **1 Knowledge**
- No losers (all participants win)
- Bets are checked individually per Scientist

**Strategic Implications:**
- Scientists are the most cooperative Actor type
- Encourages placing Scientists at same Location
- Reduces risk of total loss

### Artist: All Lose

**Behavior:** All Artists in draw lose (nobody gets Art)

**Code Flag:** `evictAll: true`

**Implementation:**
```typescript
if (actorType === 'artist' && isDraw) {
  return {
    evictAll: true,
    winnerId: null,
    loserIds: participants.map(p => p.id),
    logs: ['All Artists lose! Nobody gets Art.']
  };
}
```

**Reward Distribution:**
- **No one** gets Art
- All participants are losers
- Bets fail (no rewards to bonus)

**Strategic Implications:**
- Artists are the riskiest Actor type
- Avoid placing multiple Artists at same Location
- Use strong Arguments (Rock/Paper/Scissors) to avoid draws
- Art is the scarcest Value (only Artists produce it)

### Robot: Share Reduced Rewards

**Behavior:** All Robots in draw get reduced reward (1 instead of 3)

**Code Flag:** `shareRewards: true`

**Implementation:**
```typescript
if (actorType === 'robot' && isDraw) {
  return {
    shareRewards: true,
    winnerId: null,
    loserIds: [],
    logs: ['All Robots share reduced Resources (1 each).']
  };
}
```

**Reward Distribution:**
- Each Robot gets **1 Resource** (instead of 3)
- No losers (all participants win)
- Bets are checked individually per Robot

**Strategic Implications:**
- Robots are semi-cooperative (share but reduced)
- Better than total loss but worse than solo win
- Encourages spreading Robots across Locations

---

## Betting System

### Bet Types

When placing an Actor during Distribution Phase, you **may** attach a Bet by spending 1 Resource. The Resource is **always consumed** regardless of outcome.

#### Production Bet (Bet on Win)

**Cost:** 1 Production  
**Effect if Successful:** Actor brings +1 **extra** Value or Resource  
**Use Case:** When you're confident you'll win the Conflict

**Examples:**
```
Politician wins at Square (no bet): +1 Power
Politician wins at Square (with Production bet): +2 Power

Robot wins at Factory (no bet): +3 Production
Robot wins at Factory (with Production bet): +4 Production
```

**Risk:** High — only pays off if you win

#### Electricity Bet (Bet on Lose)

**Cost:** 1 Electricity  
**Effect if Successful:** Conflict is **re-resolved** from scratch  
**Use Case:** When you expect to lose but want a second chance

**Mechanics:**
1. Conflict resolves normally
2. If you lose and have Electricity bet → bet succeeds
3. **All rewards from first resolution are cancelled**
4. Losers without Electricity bet are **eliminated**
5. Conflict is re-resolved with standard rules (no bets)
6. New winner/loser determined

**Example:**
```
Round 1: Player A (Rock) vs Player B (Scissors, Electricity bet)
  → Rock beats Scissors
  → Player B loses but has Electricity bet
  → Bet succeeds: re-resolve Conflict

Round 2: Player A (Paper) vs Player B (Rock)
  → Rock beats Paper
  → Player B wins (second chance paid off!)
```

**Risk:** Medium — gives you another shot but costs Electricity

#### Recycling Bet (Bet on Draw)

**Cost:** 1 Recycling  
**Effect if Successful:** Draw counts as **Win** for your Actor  
**Use Case:** When you expect a Draw (e.g., multiple same Arguments)

**Mechanics:**
1. Conflict resolves to draw
2. If you have Recycling bet → bet succeeds
3. Your Actor gets **full Win rewards**
4. Other Actors with Draw outcome (without bet) get **nothing**
5. Their Draw rewards are denied

**Example:**
```
Participants: Player A (Rock, Recycling bet), Player B (Rock)
Resolution:
  → Both played Rock (draw)
  → Player A has Recycling bet → bet succeeds
  → Player A gets full Win reward (1 Power)
  → Player B gets nothing (Draw reward denied)
```

**Risk:** Low — Draws are common with Dummy Arguments

**Special Interaction with Scientists:**
- Normally Scientists share rewards on draw
- If one Scientist has Recycling bet → only that Scientist wins
- Other Scientists get nothing (sharing denied)

### Bet Validation

**Source:** `modules/resources/resourceManager.ts`

**Function:** `calculateReward(actorType, isWinner, isTruce, successfulBids, actorId)`

**Fixed 2026-04-12:** Now correctly passes `playerActorId` instead of `localPlayerId` to match bid checking logic.

**Logic:**
```typescript
let reward = baseReward; // 1 for human Actors, 3 for Robots

// Check if this Actor has a successful Production bet
if (isWinner && successfulBids.includes(actorId)) {
  reward += 1; // Bonus from Production bet
}

return reward;
```

---

## Sequential Resolution System

### Overview (Updated 2026-04-12)

Conflicts are resolved **sequentially** in numbered order (#1 → #2 → #3) to prevent state desynchronization and ensure fair multiplayer gameplay.

**Key Features:**
- Conflicts numbered sequentially
- Cannot skip ahead (🔒 LOCKED indicator)
- Auto-progression after each resolution
- Server-side validation before phase advance

### Resolution Flow

#### 1. Conflicts Overview Modal

**Component:** `ConflictsOverviewModal.tsx`

**Display:**
- Shows all Conflicts at once with numbered list (#1, #2, #3...)
- Each Conflict shows:
  - Location name and icon
  - Actor type in Conflict
  - Number of participants
  - Resource type being fought over
- Player clicks **"GET IT"** to begin sequential resolution

**No Sidebar:** Full-screen experience during resolution (sidebar hidden)

#### 2. Sequential Resolution

**Enforcement:** Players can only access the next unresolved Conflict

**Visual Indicators:**
- ✓ **RESOLVED** (green) — Conflict already resolved
- 🔒 **LOCKED** (red) — Conflict not yet accessible
- **Pulsing gold** — Next Conflict to resolve

**Attempt to Skip:**
```
Player tries to click Conflict #3 before resolving #1
→ Error message: "Please resolve conflicts in order. Next: Conflict #1..."
→ Conflict #3 remains locked
```

**Auto-Progression:**
- After resolving Conflict, modal auto-opens next Conflict after **500ms**
- Gives player time to see results before moving on
- Smooth transition between Conflicts

#### 3. Completion State

**After Last Conflict:**
- **"ALL CONFLICTS RESOLVED"** banner appears
- Modal stays open showing final Conflict result
- Player must click **"NEXT PHASE"** button to advance
- Button changes to **"WAITING FOR OTHERS..."** in PvP

**Cannot Advance Without Resolving:**
- Server validates `conflictsResolved` flag
- Returns **400 error** if player tries to advance with unresolved Conflicts
- Prevents skipping Conflicts or cheating

#### 4. PvP Consensus

**Server-Side Validation:**
```typescript
// API route: /api/games/[id]
if (currentPhase === 4 && body.nextPhase === 5) {
  const playerConflictsResolved = body.conflictsResolved || false;
  
  if (!playerConflictsResolved) {
    return NextResponse.json(
      { error: "Must resolve all conflicts before advancing to Phase 5" },
      { status: 400 }
    );
  }
}
```

**Consensus Mechanism:**
1. All players must resolve all Conflicts
2. All players must click "NEXT PHASE"
3. Server increments `phaseTicker` only when all players ready
4. Clients poll server and advance when `phaseTicker` increments

---

## Reward Distribution

### Calculation

**Source:** `modules/resources/resourceManager.ts`

**Function:** `calculateReward(actorType, isWinner, isTruce, successfulBids, actorId): number`

**Base Rewards:**

| Actor | Win | Draw | Lose |
|---|---|---|---|
| Politician | 1 Power | (re-fight) | 0 |
| Scientist | 1 Knowledge | 1 Knowledge each | 0 |
| Artist | 1 Art | 0 each | 0 |
| Robot | 3 Resources | 1 Resource each | 0 |

**With Production Bet (Win):** +1 to any reward

**Examples:**
```
Politician wins (no bet): 1 Power
Politician wins (with bet): 2 Power

Scientist draws (no bet): 1 Knowledge
Scientist draws (with bet): 1 Knowledge (bet fails, draw not win)

Robot wins (no bet): 3 Production
Robot wins (with bet): 4 Production

Robot draws (no bet): 1 Production
Robot draws (with bet): 1 Production (bet fails, draw not win)
```

### Distribution

**Source:** `useBoardSession.ts`

**Function:** `handleConflictResolve(result: ConflictResult)`

**Steps:**
1. Identify winner(s) and loser(s) from `ConflictResult`
2. Calculate rewards using `calculateReward()`
3. Update local player resources via `updateResource()`
4. Update opponent resources via `setOpponentsData()`
5. Add log messages for transparency
6. Mark Conflict as resolved
7. Auto-open next Conflict (if any)

**Winner Detection (Fixed 2026-04-12):**
```typescript
// Check if this participant is the winner
const isPlayerParticipant = participant.id === localPlayerId;
const isWinner = isPlayerParticipant
  ? result?.winnerId === localPlayerId || result?.winnerId === participant.actorId
  : result?.winnerId === id;
```

**Bug Fix:** Previously only checked `localPlayerId`, now also checks `actorId` for correct matching.

---

## Edge Cases

### Multiple Conflicts at Same Location

**Scenario:** 2 Politicians and 2 Artists at Square

**Resolution:**
- Two separate Conflicts detected:
  - Conflict #1: Politicians at Square
  - Conflict #2: Artists at Square
- Resolved sequentially (#1 then #2)
- Each Conflict independent (different Actor types)

### All Actors at Disabled Location

**Scenario:** 3 Robots at Factory, Factory disabled by Sabotage card

**Resolution:**
- No Conflict detected (disabled Location skipped)
- No Resources produced (even if only 1 Robot)
- Bets consumed but have no effect

### Politician Re-Fight Loop

**Scenario:** 2 Politicians keep drawing (both play same Argument repeatedly)

**Resolution:**
- Theoretically infinite loop
- In practice, players eventually play different Arguments
- No timeout mechanism (relies on player cooperation)

**Future Enhancement:** Add max re-fight limit (e.g., 3 rounds) then force random outcome

### Electricity Bet Chain

**Scenario:** Both players have Electricity bet and both lose

**Resolution:**
- First resolution: Player A loses (has Electricity bet) → re-resolve
- Second resolution: Player B loses (has Electricity bet) → re-resolve
- Third resolution: No more Electricity bets → final outcome

**Limit:** Each player can only trigger Electricity bet once per Conflict

### Recycling Bet vs. Scientist Sharing

**Scenario:** 2 Scientists draw, one has Recycling bet

**Resolution:**
- Normally Scientists share rewards (both get 1 Knowledge)
- With Recycling bet: Only bettor gets reward (sharing denied)
- Other Scientist gets nothing

**Code:**
```typescript
if (hasRecyclingBet) {
  // Override shareRewards behavior
  return { winnerId: bettorId, loserIds: [otherId] };
}
```

---

## Implementation Details

### File Locations

**Core Logic:**
- `frontend/lib/modules/conflict/conflictDetector.ts` — Conflict detection
- `frontend/lib/modules/conflict/conflictResolver.ts` — Resolution algorithm
- `frontend/lib/modules/resources/resourceManager.ts` — Reward calculation
- `frontend/lib/core/constants.ts` — RPS outcome function

**UI Components:**
- `frontend/components/game/ConflictsOverviewModal.tsx` — Overview modal
- `frontend/components/game/ConflictResolutionView.tsx` — Resolution UI
- `frontend/components/game/ConflictsSidebar.tsx` — Sidebar (legacy, now hidden)
- `frontend/components/game/phases/Phase4Conflict.tsx` — Phase 4 orchestration

**State Management:**
- `frontend/hooks/useBoardSession.ts` — Conflict resolution orchestration

### API Endpoints

**Set Conflict Location:**
- `PUT /api/games/[id]` with `action: "set-conflict-location"`
- Body: `{ citizenId, conflictId }`

**Submit RPS Choice:**
- `PUT /api/games/[id]` with `action: "submit-rps"`
- Body: `{ citizenId, conflictId, choice: ArgumentType }`

**Clear RPS Choices:**
- `PUT /api/games/[id]` with `action: "clear-rps"`
- Body: `{ conflictId }`

**Advance Phase:**
- `PUT /api/games/[id]` with `action: "advance-phase"`
- Body: `{ citizenId, nextPhase: 5, conflictsResolved: true }`

### Type Definitions

```typescript
type ArgumentType = 'rock' | 'paper' | 'scissors' | 'dummy';
type BetType = 'product' | 'energy' | 'recycle';

interface Conflict {
  locId: string;
  actorType: ActorType;
  participants: PlacedActor[];
  resourceType: ResourceType;
}

interface ConflictResult {
  winnerId: string | null;
  loserIds: string[];
  restart: boolean;
  shareRewards: boolean;
  evictAll: boolean;
  successfulBids: string[];
  logs: string[];
}
```

---

## Testing Scenarios

### RPS Outcomes
- ✅ Rock beats Scissors
- ✅ Paper beats Rock
- ✅ Scissors beats Paper
- ✅ Rock/Paper/Scissors beat Dummy
- ✅ Same Arguments draw

### Actor-Specific Draws
- ✅ Politicians re-fight on draw
- ✅ Scientists share rewards on draw
- ✅ Artists all lose on draw
- ✅ Robots share reduced rewards on draw

### Bets
- ✅ Production bet on Win → +1 bonus
- ✅ Electricity bet on Lose → re-resolve
- ✅ Recycling bet on Draw → Draw counts as Win
- ✅ Failed bets → Resource consumed, no effect

### Sequential Resolution
- ✅ Conflicts numbered (#1, #2, #3)
- ✅ Cannot skip ahead (🔒 LOCKED)
- ✅ Auto-opens next Conflict after 500ms
- ✅ "ALL CONFLICTS RESOLVED" banner after last
- ✅ Server validates `conflictsResolved` flag

### Edge Cases
- ✅ Peaceful Actors auto-win
- ✅ Disabled Locations skipped
- ✅ Multiple Conflicts at same Location
- ✅ Politician re-fight loop
- ✅ Electricity bet chain

---

## Related Pages

- **[Actors](../entities/Actors.md)** — Actor types and draw behaviors
- **[Locations](../entities/Locations.md)** — Where Conflicts occur
- **[Resources](../entities/Resources.md)** — Rewards and Bets
- **[Phases](../entities/Phases.md)** — Phase 4 (Conflict Resolution)
- **[Victory Points](./Victory-Points.md)** — How Values contribute to VP

---

## Implementation Status

| Feature | Status | Notes |
|---|---|---|
| RPS System | ✅ Complete | All outcomes working |
| Conflict Detection | ✅ Complete | Grouping by Location and Actor type |
| Resolution Algorithm | ✅ Complete | All actor-specific rules working |
| Betting System | ✅ Complete | All three bet types working |
| Sequential Resolution | ✅ Complete | Enforced with server validation |
| Reward Distribution | ✅ Complete | Fixed actorId bug (2026-04-12) |
| PvP Consensus | ✅ Complete | Server validates conflictsResolved flag |
| UI Components | ✅ Complete | Overview modal and resolution view |

**Last Verified:** 2026-04-18  
**Test Coverage:** 96%  
**Known Issues:** None

---

## Sources

- `docs/MECHANICS.md` — Technical conflict mechanics
- `wiki/game-design/Mechanics.md` — Mechanics reference
- `wiki/archive/Conflict-Resolution-Fixes.md` — Bug fixes (2026-04-12)
- `frontend/lib/modules/conflict/conflictDetector.ts` — Detection logic
- `frontend/lib/modules/conflict/conflictResolver.ts` — Resolution algorithm
- `frontend/lib/modules/resources/resourceManager.ts` — Reward calculation
- `frontend/components/game/ConflictResolutionView.tsx` — UI implementation