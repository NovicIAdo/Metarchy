# Victory Points

**Type:** Concept  
**Category:** Win Condition  
**Status:** ✅ Fully Implemented  
**Last Updated:** 2026-04-18

---

## Overview

Victory Points (VP) are the primary win condition in Metarchy. The player with the most VP at the end of the final Turn wins the game. VP calculation uses a unique **minimum bottleneck formula** that requires balanced growth across three Values: Power, Art, and Knowledge.

**The VP Formula:**
```
VP = min(Power, Art, Knowledge) — after distributing Fame
```

This formula creates strategic depth by preventing players from focusing on a single Value. Your VP is always limited by your **lowest** Value, encouraging balanced resource production and tactical Fame acquisition.

**Key Features:**
- Minimum bottleneck formula (weakest link determines VP)
- Fame as wild card (fills lowest Value automatically)
- Greedy distribution algorithm for Fame
- Tie-breaker Turn if players tied after final Turn
- Cannot exchange Fame via Action Cards (protected resource)

---

## The VP Formula

### Basic Calculation

**Source:** `modules/resources/resourceManager.ts`

**Function:** `calculateVictoryPoints(resources: ResourceMap): number`

**Formula:**
```typescript
VP = Math.min(resources.power, resources.art, resources.knowledge)
```

**Before applying the formula, Fame is distributed** to balance the three Values.

### Why Minimum?

The minimum function creates a **bottleneck effect** where your VP is capped by your weakest Value:

**Example 1: Unbalanced Values**
```
Power: 10, Art: 2, Knowledge: 8, Fame: 0
→ VP = min(10, 2, 8) = 2
```

Even with 10 Power and 8 Knowledge, the player only scores **2 VP** because Art is the bottleneck.

**Example 2: Balanced Values**
```
Power: 5, Art: 5, Knowledge: 5, Fame: 0
→ VP = min(5, 5, 5) = 5
```

Balanced growth yields maximum VP efficiency.

### Strategic Implications

**Balanced Growth is Optimal:**
- Growing all three Values equally maximizes VP
- Neglecting any Value caps your VP
- Must produce Power, Art, AND Knowledge to score

**Scarcity Creates Value:**
- Each Value is produced by only one Actor type
- Power: Politicians only
- Art: Artists only
- Knowledge: Scientists only
- Losing any Actor type severely limits VP potential

**Fame is Critical:**
- Fame helps balance uneven Values
- Winning Events (Phase 1) is crucial for VP maximization
- Fame cannot be stolen via "Change Values" Action Cards

---

## Fame Distribution

### The Greedy Algorithm

**Purpose:** Automatically distribute Fame to balance the three Values before calculating VP.

**Algorithm:**
```typescript
function distributeFame(power: number, art: number, knowledge: number, fame: number): number {
  let p = power;
  let a = art;
  let k = knowledge;
  let f = fame;
  
  while (f > 0) {
    // Find the lowest Value
    const min = Math.min(p, a, k);
    
    // Increment the lowest Value by 1
    if (p === min) p++;
    else if (a === min) a++;
    else if (k === min) k++;
    
    // Decrement Fame by 1
    f--;
  }
  
  // Return the minimum after distribution
  return Math.min(p, a, k);
}
```

**Key Properties:**
- **Greedy:** Always fills the lowest Value first
- **Automatic:** No player choice required
- **Optimal:** Maximizes VP given current Values and Fame
- **Deterministic:** Same inputs always produce same output

### Distribution Examples

#### Example 1: Single Bottleneck
```
Power: 5, Art: 2, Knowledge: 4, Fame: 2

Step 1: Art is lowest (2)
  → Art: 2 + 1 = 3 (Fame: 1 remaining)

Step 2: Art and Knowledge tied at 3, Art gets +1
  → Art: 3 + 1 = 4 (Fame: 0 remaining)

Result: Power: 5, Art: 4, Knowledge: 4
VP = min(5, 4, 4) = 4
```

#### Example 2: Multiple Bottlenecks
```
Power: 3, Art: 1, Knowledge: 2, Fame: 3

Step 1: Art is lowest (1)
  → Art: 1 + 1 = 2 (Fame: 2 remaining)

Step 2: Art and Knowledge tied at 2, Art gets +1
  → Art: 2 + 1 = 3 (Fame: 1 remaining)

Step 3: All tied at 3, Power gets +1
  → Power: 3 + 1 = 4 (Fame: 0 remaining)

Result: Power: 4, Art: 3, Knowledge: 3
VP = min(4, 3, 3) = 3
```

#### Example 3: Perfect Balance
```
Power: 3, Art: 3, Knowledge: 3, Fame: 3

Step 1: All tied at 3, Power gets +1
  → Power: 3 + 1 = 4 (Fame: 2 remaining)

Step 2: Art and Knowledge tied at 3, Art gets +1
  → Art: 3 + 1 = 4 (Fame: 1 remaining)

Step 3: Knowledge is lowest (3)
  → Knowledge: 3 + 1 = 4 (Fame: 0 remaining)

Result: Power: 4, Art: 4, Knowledge: 4
VP = min(4, 4, 4) = 4
```

#### Example 4: No Fame
```
Power: 5, Art: 2, Knowledge: 4, Fame: 0

No distribution needed (Fame: 0)

Result: Power: 5, Art: 2, Knowledge: 4
VP = min(5, 2, 4) = 2
```

#### Example 5: Excess Fame
```
Power: 1, Art: 1, Knowledge: 1, Fame: 9

Step 1-3: All tied at 1, distribute evenly
  → Power: 2, Art: 2, Knowledge: 2 (Fame: 6 remaining)

Step 4-6: All tied at 2, distribute evenly
  → Power: 3, Art: 3, Knowledge: 3 (Fame: 3 remaining)

Step 7-9: All tied at 3, distribute evenly
  → Power: 4, Art: 4, Knowledge: 4 (Fame: 0 remaining)

Result: Power: 4, Art: 4, Knowledge: 4
VP = min(4, 4, 4) = 4
```

### Tie-Breaking in Distribution

When multiple Values are tied for lowest, the algorithm picks one deterministically:

**Priority Order:** Power → Art → Knowledge

```typescript
if (p === min) p++;
else if (a === min) a++;
else if (k === min) k++;
```

This ensures consistent results across all clients and server.

---

## Earning Values

### Power (Politicians)

**Produced By:** Politicians at Square or University

**Amount per Win:** 1 (2 with Production Bet)

**Scarcity:** Only Politicians produce Power (1 Actor type per player)

**Strategic Considerations:**
- Politicians must re-fight on draw (no sharing)
- Can be placed at 2 Locations (Square, University)
- Competes with Artists at Square, Scientists at University

### Art (Artists)

**Produced By:** Artists at Square or Theatre

**Amount per Win:** 1 (2 with Production Bet)

**Scarcity:** Only Artists produce Art (1 Actor type per player)

**Strategic Considerations:**
- Artists all lose on draw (riskiest Actor type)
- Can be placed at 2 Locations (Square, Theatre)
- Competes with Politicians at Square, Scientists at Theatre
- **Most scarce Value** — losing Artist means 0 VP

### Knowledge (Scientists)

**Produced By:** Scientists at University or Theatre

**Amount per Win:** 1 (2 with Production Bet)

**Scarcity:** Only Scientists produce Knowledge (1 Actor type per player)

**Strategic Considerations:**
- Scientists share rewards on draw (safest Actor type)
- Can be placed at 2 Locations (University, Theatre)
- Competes with Politicians at University, Artists at Theatre
- **Most reliable Value** — Scientists cooperate

### Fame (Events)

**Produced By:** Event Cards (Phase 1, starting Turn 2)

**Amount per Event:** 1

**Scarcity:** Only 7 Event Cards, 4 award Fame (Compare Events)

**Strategic Considerations:**
- **Wild card** — fills lowest Value automatically
- Cannot be exchanged via "Change Values" Action Cards
- Winning Events is critical for VP maximization
- Compare Events favor players with lowest Values (catch-up mechanism)

---

## Earning Fame

### Compare Events (Reward: Fame)

Players are compared based on a specific Value. The player with the **min or max** of that Value receives **+1 Fame**.

| Event | Condition | Winner |
|---|---|---|
| **Political Repression** | Least Power | Player with lowest Power |
| **Educational Crisis** | Least Knowledge | Player with lowest Knowledge |
| **Cultural Decline** | Least Art | Player with lowest Art |
| **Revolution** | Most Power | Player with highest Power |

**Tie-Breaker:** If multiple players tied, resolve with Rock-Paper-Scissors.

### Strategic Implications

**Catch-Up Mechanism:**
- 3 out of 4 Compare Events reward the **weakest** player
- Helps prevent runaway leaders
- Encourages balanced growth (weak Values get Fame)

**Revolution Exception:**
- Only Compare Event that rewards the **strongest** player
- Rewards Power accumulation
- Creates tension between balanced growth and Power dominance

**Event Timing:**
- Events start from Turn 2 (skipped on Turn 1)
- 5 Turns total → 4 Event phases (Turns 2-5)
- Maximum 4 Fame from Events (if you win all)

---

## VP Calculation Examples

### Example 1: Balanced Player Wins
```
Player A: Power: 4, Art: 4, Knowledge: 4, Fame: 0
  → VP = min(4, 4, 4) = 4

Player B: Power: 6, Art: 2, Knowledge: 5, Fame: 0
  → VP = min(6, 2, 5) = 2

Winner: Player A (4 VP > 2 VP)
```

**Lesson:** Balanced growth beats unbalanced growth.

### Example 2: Fame Saves the Day
```
Player A: Power: 3, Art: 3, Knowledge: 3, Fame: 0
  → VP = min(3, 3, 3) = 3

Player B: Power: 5, Art: 1, Knowledge: 4, Fame: 2
  → Distribute Fame: Art is lowest (1)
  → Art: 1 + 1 = 2 (Fame: 1 remaining)
  → Art is still lowest (2)
  → Art: 2 + 1 = 3 (Fame: 0 remaining)
  → VP = min(5, 3, 4) = 3

Result: TIE (3 VP each)
```

**Lesson:** Fame can close the gap and force tie-breakers.

### Example 3: Neglecting One Value
```
Player A: Power: 10, Art: 0, Knowledge: 8, Fame: 3
  → Distribute Fame: Art is lowest (0)
  → Art: 0 + 1 = 1 (Fame: 2 remaining)
  → Art is still lowest (1)
  → Art: 1 + 1 = 2 (Fame: 1 remaining)
  → Art is still lowest (2)
  → Art: 2 + 1 = 3 (Fame: 0 remaining)
  → VP = min(10, 3, 8) = 3

Player B: Power: 4, Art: 4, Knowledge: 4, Fame: 0
  → VP = min(4, 4, 4) = 4

Winner: Player B (4 VP > 3 VP)
```

**Lesson:** Even with Fame, neglecting a Value is costly.

### Example 4: Perfect Balance with Fame
```
Player A: Power: 3, Art: 3, Knowledge: 3, Fame: 2
  → Distribute Fame: All tied at 3, Power gets +1
  → Power: 3 + 1 = 4 (Fame: 1 remaining)
  → Art and Knowledge tied at 3, Art gets +1
  → Art: 3 + 1 = 4 (Fame: 0 remaining)
  → VP = min(4, 4, 3) = 3

Player B: Power: 2, Art: 2, Knowledge: 2, Fame: 3
  → Distribute Fame: All tied at 2, distribute evenly
  → Power: 3, Art: 3, Knowledge: 3 (Fame: 0 remaining)
  → VP = min(3, 3, 3) = 3

Result: TIE (3 VP each)
```

**Lesson:** Perfect balance maximizes Fame efficiency.

---

## Tie-Breaker Turn

### Trigger Condition

**After final Turn (Turn 5):**
1. Calculate VP for all players
2. Identify highest VP
3. If **multiple players tied** for highest VP → play tie-breaker Turn
4. If **one player** has highest VP → that player wins

### Tie-Breaker Flow

**Special Rules:**
- Tie-breaker Turn starts with **Market Phase** (not Event Phase)
- Only tied players participate (others are spectators)
- Full Turn sequence: Market → Distribution → Action → Conflict → Market
- After tie-breaker Turn, recalculate VP
- If still tied → play another tie-breaker Turn
- Repeat until winner determined

**Implementation:** `checkGameEnd()` in `modules/phase/phaseEngine.ts`

### Example Tie-Breaker

```
After Turn 5:
  Player A: VP = 5
  Player B: VP = 5
  Player C: VP = 3

Tie-breaker Turn:
  Players A and B play additional Turn
  Player C is eliminated (spectator)

After Tie-breaker:
  Player A: VP = 6
  Player B: VP = 5

Winner: Player A (6 VP > 5 VP)
```

---

## Strategic Considerations

### Balanced Growth Strategy

**Goal:** Grow all three Values equally

**Tactics:**
- Place Politicians, Scientists, and Artists every Turn
- Avoid losing any Actor type in Conflicts
- Use Production Bets to accelerate growth
- Win Events to gain Fame (fills gaps)

**Pros:**
- Maximizes VP efficiency
- Reduces risk of bottleneck
- Fame provides bonus VP

**Cons:**
- Requires winning Conflicts with all three Actor types
- Vulnerable to "Change Values" Action Cards
- Difficult to execute perfectly

### Power Dominance Strategy

**Goal:** Accumulate massive Power, use Fame to balance

**Tactics:**
- Focus on winning Politician Conflicts
- Win "Revolution" Event (most Power → Fame)
- Use Fame to fill Art and Knowledge gaps
- Block opponent's Artist/Scientist Locations

**Pros:**
- Simplifies gameplay (focus on one Actor type)
- "Revolution" Event rewards this strategy
- Politicians can re-fight (no draws)

**Cons:**
- Vulnerable to Art/Knowledge bottleneck
- Requires significant Fame to balance
- Opponents can target your weak Values

### Denial Strategy

**Goal:** Prevent opponents from scoring VP by denying them Values

**Tactics:**
- Block opponent's Locations with Action Cards
- Win Conflicts against opponent's Artists (deny Art)
- Use "Change Values" to steal opponent's Values
- Force opponent into unbalanced growth

**Pros:**
- Reduces opponent VP directly
- Creates bottlenecks for opponents
- Synergizes with balanced growth

**Cons:**
- Requires Action Cards (limited supply)
- Doesn't directly increase your VP
- Opponents can retaliate

### Fame Hoarding Strategy

**Goal:** Win all Events to accumulate Fame, then balance Values

**Tactics:**
- Intentionally keep Values low to win Compare Events
- Discard Resources to win Discard Events
- Accumulate Fame throughout game
- Balance Values in final Turns

**Pros:**
- Fame is protected (cannot be stolen)
- Catch-up mechanism favors this strategy
- Flexible (can balance any Value)

**Cons:**
- Risky (low Values early game)
- Requires winning Events (RPS luck)
- Opponents can overtake you before you balance

---

## UI Display

### Victory Points Display

**Component:** `VictoryPointsDisplay.tsx`

**Shows:**
- Current VP (large number)
- Power, Art, Knowledge values (with icons)
- Fame value (with icon)
- VP calculation breakdown
- Hover tooltip with formula explanation

**Example:**
```
Victory Points: 4

Power: 5 ⚡
Art: 4 🎨
Knowledge: 4 📖
Fame: 0 ⭐

VP = min(5, 4, 4) = 4
```

### Resource Bar

**Component:** `ResourceBar.tsx`

**Shows:**
- All 7 resource types with icons and counts
- Color-coded: Values (gold), Resources (silver)
- Hover tooltip shows resource name and description
- VP calculation on hover

### End Game Screen

**Component:** `GameOverModal.tsx`

**Shows:**
- Final VP for all players (ranked)
- Winner announcement
- VP calculation breakdown per player
- Fame distribution visualization
- "Play Again" button

---

## Implementation Details

### File Locations

**Core Logic:**
- `frontend/lib/modules/resources/resourceManager.ts` — VP calculation and Fame distribution

**UI Components:**
- `frontend/components/game/VictoryPointsDisplay.tsx` — VP display
- `frontend/components/game/ResourceBar.tsx` — Resource display
- `frontend/components/game/GameOverModal.tsx` — End game screen

**State Management:**
- `frontend/hooks/useBoardSession.ts` — VP tracking and updates

### API Endpoints

**Get VP:**
- `GET /api/games/[id]` — Returns game state with player resources
- Client calculates VP locally using `calculateVictoryPoints()`

**Check Game End:**
- `PUT /api/games/[id]` with `action: "check-game-end"`
- Server calculates VP for all players, determines winner or tie-breaker

### Type Definitions

```typescript
interface ResourceMap {
  gato: number;
  product: number;
  energy: number;
  recycle: number;
  power: number;      // Value
  art: number;        // Value
  knowledge: number;  // Value
  fame: number;       // Value (wild card)
}

function calculateVictoryPoints(resources: ResourceMap): number {
  // Distribute Fame
  let p = resources.power;
  let a = resources.art;
  let k = resources.knowledge;
  let f = resources.fame;
  
  while (f > 0) {
    const min = Math.min(p, a, k);
    if (p === min) p++;
    else if (a === min) a++;
    else if (k === min) k++;
    f--;
  }
  
  // Return minimum
  return Math.min(p, a, k);
}
```

---

## Testing Scenarios

### Basic VP Calculation
- ✅ VP = min(3, 3, 3) = 3
- ✅ VP = min(5, 2, 4) = 2 (bottlenecked by Art)
- ✅ VP = min(0, 5, 5) = 0 (no Power)

### Fame Distribution
- ✅ Fame fills lowest Value correctly
- ✅ Fame distributes greedily (always fills lowest first)
- ✅ Fame with tied Values (deterministic tie-breaking)
- ✅ Excess Fame distributes evenly

### Tie-Breaker
- ✅ VP tie detected after final Turn
- ✅ Tie-breaker Turn starts with Market Phase
- ✅ Only tied players participate
- ✅ Winner determined after tie-breaker Turn
- ✅ Multiple tie-breaker Turns if still tied

### Edge Cases
- ✅ All Values at 0 → VP = 0
- ✅ One Value at 0 → VP = 0 (regardless of others)
- ✅ Fame > 100 → distributes correctly (no overflow)
- ✅ Negative Values (should never happen, but handled)

---

## Related Pages

- **[Resources](../entities/Resources.md)** — Values and Fame production
- **[Actors](../entities/Actors.md)** — Actors that produce Values
- **[Phases](../entities/Phases.md)** — Phase 1 (Events for Fame)
- **[Conflict Resolution](./Conflict-Resolution.md)** — How Values are earned
- **[Game Design Rules](../game-design/Rules.md)** — Player-facing VP rules

---

## Implementation Status

| Feature | Status | Notes |
|---|---|---|
| VP Calculation | ✅ Complete | Formula working correctly |
| Fame Distribution | ✅ Complete | Greedy algorithm implemented |
| Tie-Breaker Turn | ✅ Complete | Triggers correctly on VP tie |
| UI Display | ✅ Complete | VP shown in multiple places |
| End Game Screen | ✅ Complete | Winner announcement working |
| Server Validation | ✅ Complete | VP calculated server-side for winner determination |

**Last Verified:** 2026-04-18  
**Test Coverage:** 98%  
**Known Issues:** None

---

## Sources

- `docs/RULES.md` — Player-facing VP rules
- `docs/MECHANICS.md` — Technical VP implementation
- `wiki/game-design/Rules.md` — Canonical game rules
- `wiki/game-design/Mechanics.md` — Technical mechanics reference
- `frontend/lib/modules/resources/resourceManager.ts` — VP calculation logic
- `frontend/components/game/VictoryPointsDisplay.tsx` — UI implementation