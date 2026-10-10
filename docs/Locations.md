# Locations

**Type:** Entity  
**Category:** Game Board  
**Status:** ✅ Fully Implemented  
**Last Updated:** 2026-04-18

---

## Overview

Metarchy features **6 Locations** on the game board where Actors can be placed during the Distribution Phase. Locations are divided into two categories: **Human Locations** (producing Values for Victory Points) and **Robot Locations** (producing Resources for Bets and Market purchases).

Each Location has strict **Actor restrictions** — only certain Actor types can be placed there. When multiple Actors of the same type occupy a Location, a **Conflict** occurs and must be resolved via Rock-Paper-Scissors.

Locations can be **disabled** by Action Cards during Phase 3, preventing all Conflicts and resource production at that Location for the current Turn.

---

## Location Types

### Human Locations (Values)

These Locations produce **intangible Values** (Power, Art, Knowledge) used to calculate Victory Points.

#### 🏛️ University
- **ID:** `university`
- **Accepted Actors:** Politician, Scientist
- **Produces:** Power (Politician) or Knowledge (Scientist)
- **Conflict Type:** Standard RPS resolution
- **Disabled By:** "Student Protests" Action Card
- **Strategic Value:** Only Location where Politicians can produce Power alongside Scientists producing Knowledge

#### 🎭 Theatre
- **ID:** `theatre`
- **Accepted Actors:** Scientist, Artist
- **Produces:** Knowledge (Scientist) or Art (Artist)
- **Conflict Type:** Standard RPS resolution
- **Disabled By:** "Charity Event" Action Card
- **Strategic Value:** Only Location where Artists can produce Art alongside Scientists producing Knowledge

#### ⛲ Square
- **ID:** `square`
- **Accepted Actors:** Politician, Artist
- **Produces:** Power (Politician) or Art (Artist)
- **Conflict Type:** Standard RPS resolution
- **Disabled By:** "Under Construction" Action Card
- **Strategic Value:** Only Location where Politicians and Artists can both operate

### Robot Locations (Resources)

These Locations produce **material Resources** used for Bets and Market purchases.

#### 🏭 Factory
- **ID:** `factory`
- **Accepted Actors:** Robot only
- **Produces:** Production (Product)
- **Win Reward:** 3 Production
- **Draw Reward:** 1 Production each
- **Lose Reward:** 0
- **Disabled By:** "Sabotage" Action Card
- **Strategic Value:** Production is used to bet on **Win** outcomes (+1 bonus reward)

#### ⚡ Power Plant
- **ID:** `power_plant`
- **Accepted Actors:** Robot only
- **Produces:** Electricity (Energy)
- **Win Reward:** 3 Electricity
- **Draw Reward:** 1 Electricity each
- **Lose Reward:** 0
- **Disabled By:** "Blackout" Action Card
- **Strategic Value:** Electricity is used to bet on **Lose** outcomes (re-resolve Conflict)

#### 🗑️ Dump
- **ID:** `dump`
- **Accepted Actors:** Robot only
- **Produces:** Recycling (Recycle)
- **Win Reward:** 3 Recycling
- **Draw Reward:** 1 Recycling each
- **Lose Reward:** 0
- **Disabled By:** "Ecological Protests" Action Card
- **Strategic Value:** Recycling is used to bet on **Draw** outcomes (Draw counts as Win)

---

## Actor Placement Rules

### Allowed Moves Matrix

| Actor | Square | Theatre | University | Factory | Power Plant | Dump |
|---|---|---|---|---|---|---|
| **Politician** | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Scientist** | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Artist** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Robot** | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |

### Validation

**Implementation:** `isValidPlacement(actorType, locationId)` in `modules/distribution/placementLogic.ts`

```typescript
const ALLOWED_MOVES = {
  politician: ['square', 'university'],
  scientist: ['university', 'theatre'],
  artist: ['square', 'theatre'],
  robot: ['factory', 'power_plant', 'dump']
};
```

**Enforcement:**
- Client-side: UI only shows valid Locations as drop targets during Distribution Phase
- Server-side: API validates placements before storing them
- Invalid placements are rejected with error message

---

## Conflict Detection

### Detection Logic

**Implementation:** `detectConflicts()` in `modules/conflict/conflictDetector.ts`

**Algorithm:**
1. Group all `PlacedActor[]` by `locId` (Location ID)
2. Within each Location, group by `actorType`
3. If a group has **>1 Actor** → create a `Conflict` object
4. If a group has **exactly 1 Actor** → that Actor is "peaceful" (auto-wins)
5. **Disabled Locations** are skipped entirely (no Conflicts, no rewards)

### Conflict Object Structure

```typescript
{
  locId: string;              // Location ID where Conflict occurs
  actorType: ActorType;       // Type of Actors in Conflict
  participants: PlacedActor[]; // All Actors involved
  resourceType: ResourceType;  // What's being fought over
}
```

### Peaceful Actors

If only **one Actor of a type** is at a Location:
- No Conflict occurs
- Actor automatically wins and produces its Value/Resources
- **Win Bets** succeed (if attached) → +1 bonus reward
- **Draw/Lose Bets** fail (resource still consumed)

---

## Location Disabling

### Action Cards That Disable Locations

| Action Card | Disables | Effect |
|---|---|---|
| **Under Construction** | Square | No Power/Art production from Square |
| **Charity Event** | Theatre | No Knowledge/Art production from Theatre |
| **Student Protests** | University | No Power/Knowledge production from University |
| **Sabotage** | Factory | No Production from Factory |
| **Blackout** | Power Plant | No Electricity from Power Plant |
| **Ecological Protests** | Dump | No Recycling from Dump |

### Effects of Disabling

When a Location is disabled:
1. **No Conflicts** are detected at that Location
2. **No Values/Resources** are produced (even by peaceful Actors)
3. Actors remain at the Location but are **inactive** for the Turn
4. **Bets** attached to Actors at disabled Locations are **consumed** but have no effect
5. Disabled status lasts **only for the current Turn**

**Implementation:** `applyBlockLocation(disabledLocations, locationId)` in `modules/actions/actionCardLogic.ts`

**Visual Feedback:**
- Disabled Locations appear **grayed out** on the board
- Actors at disabled Locations have a **red X** overlay
- Tooltip shows "Location Disabled" message

---

## Location Data Structure

### Constants Definition

**Source:** `LOCATIONS` array in `core/constants`

```typescript
{
  id: string;           // Unique identifier (e.g., "square")
  name: string;         // Display name (e.g., "The Square")
  x: number;            // X coordinate on board (pixels)
  y: number;            // Y coordinate on board (pixels)
  width: number;        // Width of Location area (pixels)
  height: number;       // Height of Location area (pixels)
  sprite: string;       // Normal state sprite path
  hintSprite: string;   // Hover/hint state sprite path
  activeSprite: string; // Active/selected state sprite path
  resourceType: ResourceType; // What this Location produces
}
```

### Example: Square

```typescript
{
  id: 'square',
  name: 'The Square',
  x: 150,
  y: 200,
  width: 180,
  height: 120,
  sprite: '/assets/locations/square.png',
  hintSprite: '/assets/locations/square-hint.png',
  activeSprite: '/assets/locations/square-active.png',
  resourceType: 'power' // or 'art' depending on Actor
}
```

---

## Resource Production Rules

### Human Locations (1 Value per Win)

| Location | Actor | Produces | Amount |
|---|---|---|---|
| Square | Politician | Power | 1 |
| Square | Artist | Art | 1 |
| University | Politician | Power | 1 |
| University | Scientist | Knowledge | 1 |
| Theatre | Scientist | Knowledge | 1 |
| Theatre | Artist | Art | 1 |

**With Production Bet (Win):** +1 additional Value (total: 2)

### Robot Locations (3 Resources per Win)

| Location | Produces | Win | Draw | Lose |
|---|---|---|---|
| Factory | Production | 3 | 1 each | 0 |
| Power Plant | Electricity | 3 | 1 each | 0 |
| Dump | Recycling | 3 | 1 each | 0 |

**With Production Bet (Win):** +1 additional Resource (total: 4)

**Special:** Robots have unique Draw behavior — all Robots in a Draw get 1 Resource each (reduced from 3).

---

## Strategic Considerations

### Location Overlap Strategy

**Politicians:**
- Can go to Square OR University
- Square: Competes with Artists for Art production
- University: Competes with Scientists for Knowledge production
- **Strategy:** Choose based on opponent placements and desired Value

**Scientists:**
- Can go to University OR Theatre
- University: Competes with Politicians for Power production
- Theatre: Competes with Artists for Art production
- **Strategy:** Most flexible Actor — can produce Knowledge at either Location

**Artists:**
- Can go to Square OR Theatre
- Square: Competes with Politicians for Power production
- Theatre: Competes with Scientists for Knowledge production
- **Strategy:** Only source of Art — critical for Victory Points

**Robots:**
- Must go to Factory, Power Plant, OR Dump
- Each Location produces a different Resource
- **Strategy:** Choose based on which Bet type you need (Win/Lose/Draw)

### Location Blocking Tactics

**Offensive Use:**
- Block opponent's strongest Location to deny them Values/Resources
- Block Factory to prevent opponent from getting Production (Win Bets)
- Block Power Plant to prevent opponent from getting Electricity (Lose Bets)

**Defensive Use:**
- Block your own weak Location to avoid losing a Conflict
- Force opponents to relocate to less favorable Locations
- Combine with Relocation cards to move your Actors to safety

### Multi-Location Presence

**Spreading Risk:**
- Place Actors at different Locations to avoid multiple Conflicts
- Reduces chance of losing all Actors in one Location
- Ensures at least some Values/Resources are produced

**Concentrating Force:**
- Place multiple Actors at same Location to dominate it
- Risky but high reward if you win
- Useful when you have strong Arguments (Rock/Paper/Scissors)

---

## Phase-Specific Behavior

### Phase 2: Distribution

**Player Actions:**
1. Drag Actor from hand to valid Location — or tap the Location first and pick
   from the Actors it accepts that you have not placed yet
2. UI highlights valid Locations (green glow)
3. Invalid Locations are grayed out (not clickable)
4. Actor placement is **secret** — opponents cannot see

**Validation:**
- `isValidPlacement()` checks Actor type against `ALLOWED_MOVES`
- Invalid placements are rejected with error message
- Players can recall and re-place Actors before confirming

### Phase 3: Action (Step 2)

**Location Blocking:**
1. Players select "Block Location" Action Cards
2. Cards are committed simultaneously (sealed bid)
3. All cards are revealed at once
4. Disabled Locations are marked on board
5. Actors at disabled Locations become inactive

**Relocation (Step 3):**
1. Players select "Relocation" Action Cards
2. Choose Actor to move and target Location
3. Validation: `isValidRelocation(actorType, targetLocId)`
4. Actor moves to new Location (with Argument and Bet intact)
5. Can move Actors **out of** disabled Locations

### Phase 4: Conflict Resolution

**Conflict Detection:**
1. All Actors and Locations are revealed
2. `detectConflicts()` groups Actors by Location and type
3. Conflicts are numbered sequentially (#1, #2, #3...)
4. Disabled Locations are skipped (no Conflicts detected)

**Sequential Resolution:**
1. Conflicts must be resolved in order (#1 → #2 → #3)
2. Cannot skip ahead (🔒 LOCKED indicator)
3. After resolving Conflict, auto-opens next after 500ms
4. Visual feedback: ✓ RESOLVED (green), 🔒 LOCKED (red)

**Reward Distribution:**
- Winner receives full reward based on Location and Actor type
- Loser receives nothing
- Draw behavior depends on Actor type (see Actors page)
- Resources immediately added to player inventory

---

## UI Components

### Location Sprites

**States:**
1. **Normal:** Default appearance when no interaction
2. **Hint:** Highlighted when dragging valid Actor over it
3. **Active:** Selected/clicked state during placement
4. **Disabled:** Grayed out when blocked by Action Card

**Sprite Paths:**
- Normal: `/assets/locations/{location_id}.png`
- Hint: `/assets/locations/{location_id}-hint.png`
- Active: `/assets/locations/{location_id}-active.png`

### Actor Placement Indicators

**Visual Elements:**
1. **Actor Avatar:** Shows which Actor is at Location
2. **Argument Icon:** Hidden until Phase 4 (RPS reveal)
3. **Bet Icon:** Hidden until Phase 4 (Bet reveal)
4. **Player Color:** Border color indicates Actor owner

**Hover Tooltips:**
- Location name and accepted Actor types
- Current Actors at Location (if revealed)
- Disabled status (if blocked by Action Card)

### Conflict Indicators

**During Phase 4:**
1. **Conflict Badge:** Red "!" icon on Locations with Conflicts
2. **Conflict Number:** #1, #2, #3... for sequential resolution
3. **Participant Count:** Shows how many Actors are in Conflict
4. **Resource Icon:** Shows what's being fought over

---

## Implementation Details

### File Locations

**Constants:**
- `frontend/lib/core/constants.ts` — `LOCATIONS` array, `ALLOWED_MOVES` map

**Logic Modules:**
- `frontend/lib/modules/distribution/placementLogic.ts` — Placement validation
- `frontend/lib/modules/conflict/conflictDetector.ts` — Conflict detection
- `frontend/lib/modules/actions/actionCardLogic.ts` — Location blocking

**UI Components:**
- `frontend/components/game/GameBoard.tsx` — Main board rendering
- `frontend/components/game/LocationSprite.tsx` — Individual Location rendering
- `frontend/components/game/ActorPlacementIndicator.tsx` — Actor display at Locations

### API Endpoints

**Placement:**
- `PUT /api/games/[id]` with `action: "commit-placements"`
- Body: `{ citizenId, placements: PlacedActor[] }`

**Location Blocking:**
- `PUT /api/games/[id]` with `action: "commit-action-cards"`
- Body: `{ citizenId, cards: ActionCardInstance[] }`

**Relocation:**
- `PUT /api/games/[id]` with `action: "relocate-actor"`
- Body: `{ citizenId, actorId, newLocId }`

### State Management

**Game State:**
```typescript
{
  placedActors: PlacedActor[];      // All Actors on board
  disabledLocations: string[];      // IDs of blocked Locations
  conflicts: Conflict[];            // Detected Conflicts
  resolvedConflicts: string[];      // IDs of resolved Conflicts
}
```

**Player State:**
```typescript
{
  stagedPlacements: PlacedActor[];  // Uncommitted placements
  availableArguments: ArgumentType[]; // Unused Arguments
}
```

---

## Testing Scenarios

### Placement Validation
- ✅ Politician can be placed at Square
- ✅ Politician can be placed at University
- ❌ Politician cannot be placed at Theatre
- ❌ Politician cannot be placed at Factory
- ✅ Robot can be placed at Factory
- ❌ Robot cannot be placed at Square

### Conflict Detection
- ✅ 2 Politicians at Square → Conflict detected
- ✅ 1 Politician at Square, 1 Artist at Square → No Conflict (different types)
- ✅ 1 Politician at Square → Peaceful (auto-win)
- ✅ Disabled Location → No Conflicts detected

### Location Blocking
- ✅ "Under Construction" disables Square
- ✅ Actors at disabled Square produce nothing
- ✅ Relocation can move Actors out of disabled Square
- ✅ Disabled status clears at end of Turn

### Resource Production
- ✅ Politician wins at Square → +1 Power
- ✅ Scientist wins at University → +1 Knowledge
- ✅ Robot wins at Factory → +3 Production
- ✅ Robot draws at Factory → +1 Production each
- ✅ Production Bet on Win → +1 bonus (total: 2 Power or 4 Production)

---

## Related Pages

- **[Actors](./Actors.md)** — Actor types and their allowed Locations
- **[Resources](./Resources.md)** — Values and Resources produced at Locations
- **[Phases](./Phases.md)** — Phase 2 (Distribution), Phase 3 (Action), Phase 4 (Conflict)
- **[Conflict Resolution](../concepts/Conflict-Resolution.md)** — How Conflicts are resolved
- **[Action Cards](../game-design/Mechanics.md#action-cards)** — Cards that block Locations

---

## Implementation Status

| Feature | Status | Notes |
|---|---|---|
| Location Constants | ✅ Complete | Defined in `core/constants` |
| Placement Validation | ✅ Complete | `isValidPlacement()` enforced |
| Conflict Detection | ✅ Complete | `detectConflicts()` working |
| Location Blocking | ✅ Complete | Action Cards disable Locations |
| Relocation | ✅ Complete | `relocateActor()` working |
| UI Rendering | ✅ Complete | All Location sprites implemented |
| Disabled State | ✅ Complete | Visual feedback for blocked Locations |
| Resource Production | ✅ Complete | Rewards calculated correctly |

**Last Verified:** 2026-04-18  
**Test Coverage:** 95%  
**Known Issues:** None

---

## Sources

- `docs/RULES.md` — Player-facing Location rules
- `docs/MECHANICS.md` — Technical implementation details
- `wiki/game-design/Rules.md` — Canonical game rules
- `wiki/game-design/Mechanics.md` — Technical mechanics reference
- `frontend/lib/core/constants.ts` — Location constants and allowed moves
- `frontend/lib/modules/distribution/placementLogic.ts` — Placement validation logic
- `frontend/lib/modules/conflict/conflictDetector.ts` — Conflict detection algorithm