# Resources

**Type:** Entity  
**Category:** Game Economy  
**Status:** ✅ Fully Implemented  
**Last Updated:** 2026-04-18

---

## Overview

Metarchy features **7 resource types** divided into two categories: **Values** (intangible, used for Victory Points) and **Resources** (material, used for Bets and Market purchases).

The distinction between Values and Resources is fundamental to the game's economy:
- **Values** (Power, Art, Knowledge, Fame) → Victory Points
- **Resources** (Production, Electricity, Recycling) → Tactical advantages

All players start with the same initial resources: **1 Production, 1 Electricity, 1 Recycling** and **0 of all Values**.

---

## Resource Categories

### Values (Intangible)

Values are used to calculate **Victory Points (VP)** at the end of the game. The VP formula is:

```
VP = min(Power, Art, Knowledge) — after distributing Fame
```

#### 👑 Power
- **Produced By:** Politicians
- **Locations:** Square, University
- **Amount per Win:** 1 (2 with Production Bet)
- **Strategic Role:** Represents political influence and authority
- **Scarcity:** Only Politicians produce Power (1 Actor type)

#### 🎨 Art
- **Produced By:** Artists
- **Locations:** Square, Theatre
- **Amount per Win:** 1 (2 with Production Bet)
- **Strategic Role:** Represents cultural output and creativity
- **Scarcity:** Only Artists produce Art (1 Actor type)
- **Special:** Artists lose on Draw (nobody gets Art)

#### 📖 Knowledge
- **Produced By:** Scientists
- **Locations:** University, Theatre
- **Amount per Win:** 1 (2 with Production Bet)
- **Strategic Role:** Represents scientific advancement and education
- **Scarcity:** Only Scientists produce Knowledge (1 Actor type)
- **Special:** Scientists share rewards on Draw (all get Knowledge)

#### ⭐ Fame
- **Produced By:** Event Cards (Phase 1)
- **Locations:** N/A (awarded via Events)
- **Amount per Event:** 1
- **Strategic Role:** Wild card — fills your lowest Value
- **Special:** Cannot be exchanged via "Change Values" Action Cards

### Resources (Material)

Resources are used for **Bets** (tactical advantages in Conflicts) and **Market purchases** (buying Action Cards).

#### ⚙️ Production (Product)
- **Produced By:** Robots at Factory
- **Amount per Win:** 3 (4 with Production Bet)
- **Amount per Draw:** 1 each
- **Bet Usage:** Bet on **Win** → +1 bonus reward if successful
- **Market Usage:** 1 Production + 1 Electricity + 1 Recycling = 1 Action Card
- **Strategic Role:** Offensive resource — rewards winning

#### 🔋 Electricity (Energy)
- **Produced By:** Robots at Power Plant
- **Amount per Win:** 3 (4 with Production Bet)
- **Amount per Draw:** 1 each
- **Bet Usage:** Bet on **Lose** → Conflict is re-resolved if successful
- **Market Usage:** 1 Production + 1 Electricity + 1 Recycling = 1 Action Card
- **Strategic Role:** Defensive resource — second chance on loss

#### ♻️ Recycling (Recycle)
- **Produced By:** Robots at Dump
- **Amount per Win:** 3 (4 with Production Bet)
- **Amount per Draw:** 1 each
- **Bet Usage:** Bet on **Draw** → Draw counts as Win if successful
- **Market Usage:** 1 Production + 1 Electricity + 1 Recycling = 1 Action Card
- **Strategic Role:** Tactical resource — converts draws to wins

---

## Initial Resources

### Starting Inventory

**Source:** `DEFAULT_RESOURCES` in `core/constants`

```typescript
{
  gato: 1000,        // Currency (unused in current version)
  product: 1,        // Production
  energy: 1,         // Electricity
  recycle: 1,        // Recycling
  power: 0,          // Power
  art: 0,            // Art
  knowledge: 0,      // Knowledge
  fame: 0            // Fame
}
```

**All players** (including bots) start with identical resources. This ensures fair competition and strategic depth.

### Why These Starting Values?

- **1 of each Resource:** Allows each player to make **1 Bet** in the first Turn
- **0 of all Values:** Players must earn Values through gameplay
- **No Fame:** Fame is only earned via Events (starting Turn 2)
- **1000 Gato:** Reserved for future currency mechanics (not currently used)

---

## Resource Production

### Value Production (Human Actors)

| Actor | Location | Value | Win | Draw | Lose |
|---|---|---|---|---|---|
| Politician | Square | Power | 1 | Re-fight | 0 |
| Politician | University | Power | 1 | Re-fight | 0 |
| Scientist | University | Knowledge | 1 | 1 each | 0 |
| Scientist | Theatre | Knowledge | 1 | 1 each | 0 |
| Artist | Square | Art | 1 | 0 each | 0 |
| Artist | Theatre | Art | 1 | 0 each | 0 |

**With Production Bet (Win):** +1 additional Value (total: 2)

### Resource Production (Robots)

| Location | Resource | Win | Draw | Lose |
|---|---|---|---|
| Factory | Production | 3 | 1 each | 0 |
| Power Plant | Electricity | 3 | 1 each | 0 |
| Dump | Recycling | 3 | 1 each | 0 |

**With Production Bet (Win):** +1 additional Resource (total: 4)

**Special:** Robots have unique Draw behavior — all Robots in a Draw get 1 Resource each (reduced from 3).

---

## Victory Point Calculation

### The VP Formula

**Implementation:** `calculateVictoryPoints()` in `modules/resources/resourceManager.ts`

```typescript
VP = min(Power, Art, Knowledge) — after distributing Fame
```

### Fame Distribution Algorithm

**Greedy Algorithm:**
1. While Fame > 0:
   - Find which of {Power, Art, Knowledge} is the **lowest**
   - Increment that Value by 1
   - Decrement Fame by 1
2. Return `min(Power, Art, Knowledge)`

### Examples

#### Example 1: Balanced Values
```
Power: 3, Art: 3, Knowledge: 3, Fame: 0
→ VP = min(3, 3, 3) = 3
```

#### Example 2: Unbalanced Values, No Fame
```
Power: 5, Art: 2, Knowledge: 4, Fame: 0
→ VP = min(5, 2, 4) = 2
```

#### Example 3: Fame Fills Lowest Value
```
Power: 5, Art: 2, Knowledge: 4, Fame: 2
→ Distribute Fame: Art is lowest (2)
→ Art: 2 + 1 = 3 (Fame: 1 remaining)
→ Art and Knowledge tied at 3, Art gets +1
→ Art: 3 + 1 = 4 (Fame: 0 remaining)
→ VP = min(5, 4, 4) = 4
```

#### Example 4: Fame Balances All Values
```
Power: 3, Art: 1, Knowledge: 2, Fame: 3
→ Art is lowest (1), +1 → Art: 2 (Fame: 2)
→ Art and Knowledge tied at 2, Art gets +1 → Art: 3 (Fame: 1)
→ All tied at 3, Power gets +1 → Power: 4 (Fame: 0)
→ VP = min(4, 3, 3) = 3
```

### Strategic Implications

**Balanced Growth:**
- Best strategy is to grow all three Values equally
- Fame helps balance uneven Values
- Neglecting any Value caps your VP

**Fame as Wild Card:**
- Fame is extremely valuable — fills gaps automatically
- Winning Events (Phase 1) is critical for VP maximization
- Cannot be stolen via "Change Values" Action Cards

**Minimum Bottleneck:**
- Your VP is limited by your **lowest** Value
- Having 10 Power but 0 Art = 0 VP
- Must produce all three Values to score

---

## Resource Usage

### Bets (Phase 2: Distribution)

When placing an Actor, you **may** attach a Bet by spending 1 Resource. The Resource is **always consumed** regardless of outcome.

#### Production Bet (Bet on Win)
- **Cost:** 1 Production
- **Effect if Successful:** Actor brings +1 **extra** Value or Resource
- **Use Case:** When you're confident you'll win the Conflict
- **Risk:** High — only pays off if you win

**Example:**
```
Politician wins at Square (no bet): +1 Power
Politician wins at Square (with Production bet): +2 Power
Robot wins at Factory (no bet): +3 Production
Robot wins at Factory (with Production bet): +4 Production
```

#### Electricity Bet (Bet on Lose)
- **Cost:** 1 Electricity
- **Effect if Successful:** Conflict is **re-resolved** from scratch
- **Use Case:** When you expect to lose but want a second chance
- **Risk:** Medium — gives you another shot

**Mechanics:**
1. All rewards from first resolution are **cancelled**
2. Losers without Electricity bet are **eliminated**
3. Conflict is re-resolved with standard rules (no bets)
4. New winner/loser determined

#### Recycling Bet (Bet on Draw)
- **Cost:** 1 Recycling
- **Effect if Successful:** Draw counts as **Win** for your Actor
- **Use Case:** When you expect a Draw (e.g., multiple same Arguments)
- **Risk:** Low — Draws are common with Dummy Arguments

**Mechanics:**
1. Your Actor with Recycling bet gets full Win rewards
2. Other Actors with Draw outcome (without bet) get **nothing**
3. Their Draw rewards are denied

### Market Purchases (Phase 5)

**Cost:** 1 Production + 1 Electricity + 1 Recycling = 1 random Action Card

**Implementation:** `modules/market/marketLogic.ts`
- `canBuyActionCard(resources)` — checks affordability
- `deductBuyCost(resources)` — subtracts costs
- `pickRandomActionCard()` — random card from deck

**Strategic Considerations:**
- Requires **all three** Resource types
- Must balance Bet usage vs. Market purchases
- Action Cards provide tactical advantages (block Locations, relocate Actors, exchange Values)

---

## Resource Management

### Earning Resources

**Phase 1: Events**
- Win Compare Event → +1 Fame
- Win Discard Event → +1 random Action Card

**Phase 2: Distribution**
- Place Actors at Locations (secretly)
- Optionally attach Bets (costs Resources)

**Phase 4: Conflict Resolution**
- Win Conflicts → earn Values/Resources
- Peaceful Actors (no Conflict) → auto-win

**Phase 5: Market**
- Spend Resources to buy Action Cards

### Spending Resources

**Bets (Phase 2):**
- 1 Production → Bet on Win
- 1 Electricity → Bet on Lose
- 1 Recycling → Bet on Draw

**Market (Phase 5):**
- 1 Production + 1 Electricity + 1 Recycling → 1 Action Card

**Action Cards (Phase 3):**
- No Resource cost (cards are free to play once acquired)

### Resource Scarcity

**Limited Production:**
- Only Robots produce Resources (3 Actors per player)
- Must choose which Resource to prioritize (Factory, Power Plant, or Dump)
- Conflicts reduce Resource production (only winner gets full reward)

**Bet vs. Market Trade-off:**
- Using Resources for Bets → tactical advantage in Conflicts
- Saving Resources for Market → acquire Action Cards
- Must balance short-term (Bets) vs. long-term (Action Cards)

**Resource Denial:**
- Block opponent's Robot Locations (Factory, Power Plant, Dump)
- Force opponent to spend Resources on Bets
- Prevent opponent from buying Action Cards

---

## Resource Tracking

### Data Structure

**Player Resources:**
```typescript
{
  gato: number;       // Currency (unused)
  product: number;    // Production
  energy: number;     // Electricity
  recycle: number;    // Recycling
  power: number;      // Power
  art: number;        // Art
  knowledge: number;  // Knowledge
  fame: number;       // Fame
}
```

### State Management

**Implementation:** `modules/resources/resourceManager.ts`

**Key Functions:**
- `updateResource(resources, type, amount)` — Add/subtract resources
- `canAffordBet(resources, betType)` — Check if player can afford Bet
- `deductBetCost(resources, betType)` — Subtract Bet cost
- `calculateReward(actorType, isWinner, isTruce, successfulBids, actorId)` — Calculate Conflict rewards
- `calculateVictoryPoints(resources)` — Calculate VP from Values

### UI Display

**Resource Bar:**
- Shows all 7 resource types with icons and counts
- Color-coded: Values (gold), Resources (silver)
- Hover tooltip shows resource name and description

**Inventory Panel:**
- Detailed view of all resources
- Shows resource production history
- Displays VP calculation breakdown

---

## Implementation Details

### File Locations

**Constants:**
- `frontend/lib/core/constants.ts` — `DEFAULT_RESOURCES`, resource type definitions

**Logic Modules:**
- `frontend/lib/modules/resources/resourceManager.ts` — All resource logic
- `frontend/lib/modules/conflict/conflictResolver.ts` — Reward calculation
- `frontend/lib/modules/market/marketLogic.ts` — Market purchases

**UI Components:**
- `frontend/components/game/ResourceBar.tsx` — Resource display
- `frontend/components/game/InventoryPanel.tsx` — Detailed inventory
- `frontend/components/game/VictoryPointsDisplay.tsx` — VP calculation

### API Endpoints

**Update Resources:**
- `PUT /api/games/[id]` with `action: "update-resources"`
- Body: `{ citizenId, resources: ResourceMap }`

**Award Rewards:**
- `PUT /api/games/[id]` with `action: "award-conflict-rewards"`
- Body: `{ citizenId, rewards: { [actorId]: number } }`

**Market Purchase:**
- `PUT /api/games/[id]` with `action: "buy-action-card"`
- Body: `{ citizenId, cost: { product: 1, energy: 1, recycle: 1 } }`

### Type Definitions

```typescript
type ResourceType = 
  | 'gato' 
  | 'product' 
  | 'energy' 
  | 'recycle' 
  | 'power' 
  | 'art' 
  | 'knowledge' 
  | 'fame';

type ValueType = 'power' | 'art' | 'knowledge' | 'fame';
type MaterialType = 'product' | 'energy' | 'recycle';
type BetType = 'product' | 'energy' | 'recycle';

interface ResourceMap {
  gato: number;
  product: number;
  energy: number;
  recycle: number;
  power: number;
  art: number;
  knowledge: number;
  fame: number;
}
```

---

## Testing Scenarios

### Resource Production
- ✅ Politician wins at Square → +1 Power
- ✅ Scientist wins at University → +1 Knowledge
- ✅ Artist wins at Theatre → +1 Art
- ✅ Robot wins at Factory → +3 Production
- ✅ Robot draws at Factory → +1 Production each

### Bets
- ✅ Production Bet on Win → +1 bonus (Politician: 2 Power, Robot: 4 Production)
- ✅ Electricity Bet on Lose → Conflict re-resolved
- ✅ Recycling Bet on Draw → Draw counts as Win
- ✅ Failed Bet → Resource consumed, no effect

### Victory Points
- ✅ VP = min(3, 3, 3) = 3
- ✅ VP = min(5, 2, 4) = 2 (bottlenecked by Art)
- ✅ Fame fills lowest Value correctly
- ✅ Fame distributes greedily (always fills lowest first)

### Market
- ✅ Can buy Action Card with 1+1+1 Resources
- ✅ Cannot buy without all three Resource types
- ✅ Resources deducted correctly after purchase
- ✅ Random Action Card awarded

---

## Related Pages

- **[Actors](./Actors.md)** — Actors that produce Values and Resources
- **[Locations](./Locations.md)** — Locations where Resources are produced
- **[Phases](./Phases.md)** — Phase 1 (Events), Phase 4 (Conflict), Phase 5 (Market)
- **[Conflict Resolution](../concepts/Conflict-Resolution.md)** — How rewards are calculated
- **[Victory Points](../concepts/Victory-Points.md)** — Detailed VP calculation

---

## Implementation Status

| Feature | Status | Notes |
|---|---|---|
| Resource Constants | ✅ Complete | Defined in `core/constants` |
| Resource Manager | ✅ Complete | All functions implemented |
| Reward Calculation | ✅ Complete | Fixed 2026-04-12 (actorId bug) |
| VP Calculation | ✅ Complete | Fame distribution working |
| Bet System | ✅ Complete | All three Bet types working |
| Market Purchases | ✅ Complete | Buy Action Cards working |
| UI Display | ✅ Complete | Resource Bar and Inventory Panel |
| State Persistence | ✅ Complete | Resources saved to database |

**Last Verified:** 2026-04-18  
**Test Coverage:** 98%  
**Known Issues:** None

---

## Sources

- `docs/RULES.md` — Player-facing resource rules
- `docs/MECHANICS.md` — Technical implementation details
- `wiki/game-design/Rules.md` — Canonical game rules
- `wiki/game-design/Mechanics.md` — Technical mechanics reference
- `frontend/lib/core/constants.ts` — Resource constants
- `frontend/lib/modules/resources/resourceManager.ts` — Resource management logic
- `frontend/lib/modules/conflict/conflictResolver.ts` — Reward calculation