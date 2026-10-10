# Sealed-Bid Mechanism — Hidden Information Pattern

> **Category:** Concept  
> **Last updated:** 2026-04-18  
> **Sources:** BLOCKCHAIN_PHASE_FLOW_IMPLEMENTATION.md, AI_CONTEXT.md  
> **Status:** Complete

---

## Overview

The Sealed-Bid Mechanism is the core pattern for implementing hidden information in Metarchy's PvP multiplayer. It ensures players cannot see each other's choices until all players have committed, preserving the strategic depth of simultaneous decision-making.

**Pattern:** Local Staging → Commit Button → Server Consensus → Reveal

This pattern applies to three phases:
- **Phase 2 (Distribution):** Actor placements
- **Phase 3 (Action):** Card selections, relocations, exchanges
- **Phase 5 (Market):** Resource purchases

---

## The Problem

**Without Sealing:**
- Players can see each other's choices in real-time
- Second player has information advantage
- Strategic depth is destroyed
- Game becomes reactive instead of simultaneous

**Example:**
```
Player 1 places Politician at Square
Player 2 sees this immediately → places Artist at Theatre (avoids conflict)
Player 1 has no counter-play opportunity
```

---

## The Solution: Four-Step Pattern

### Step 1: Local Staging

**Client-side only** — choices stored in local state, not sent to server.

```typescript
// Local state (not synced)
const [stagedActors, setStagedActors] = useState<ActorPlacement[]>([]);

// Player makes choices
function stageActor(actor: ActorType, location: LocationType) {
  setStagedActors(prev => [...prev, { actor, location }]);
  // NOT sent to server yet
}
```

**UI Indicators:**
- Staged choices shown with visual distinction (opacity, border)
- "STAGED" label or icon
- Other players see nothing

---

### Step 2: Commit Button

**Explicit user action** — player confirms they're done and locks in choices.

```typescript
// Commit button sends to server
async function commitPlacements() {
  await fetch('/api/game/commit-placements', {
    method: 'POST',
    body: JSON.stringify({
      gameId,
      playerId,
      placements: stagedActors
    })
  });
  
  setIsCommitted(true); // Disable further changes
}
```

**UI Changes:**
- Button: "DONE - LOCK IN PLACEMENTS"
- After commit: Show "Waiting for other players..."
- Disable all placement controls
- Show committed players count: "2/3 players ready"

---

### Step 3: Server Consensus

**Server waits** for all players to commit before revealing.

```typescript
// Server-side logic
async function handleCommitPlacements(gameId, playerId, placements) {
  // Store in sealed state (not visible to other players)
  await storeSealedPlacements(gameId, playerId, placements);
  
  // Check if all players committed
  const allCommitted = await checkAllPlayersCommitted(gameId);
  
  if (allCommitted) {
    // Reveal to all players
    await revealAllPlacements(gameId);
    
    // Advance phase
    await advanceToNextPhase(gameId);
  }
  
  return { committed: true, allReady: allCommitted };
}
```

**Server State:**
```typescript
interface GameState {
  // Visible to all
  phase: number;
  turn: number;
  
  // Sealed (only visible after consensus)
  sealedPlacements: {
    [playerId: string]: {
      placements: ActorPlacement[];
      committedAt: string;
      revealed: boolean;
    }
  };
}
```

---

### Step 4: Reveal

**Simultaneous reveal** — all choices become visible at once.

```typescript
// Client polling detects reveal
useEffect(() => {
  const interval = setInterval(async () => {
    const state = await fetchGameState(gameId);
    
    if (state.sealedPlacements.revealed) {
      // Show all placements
      setRevealedPlacements(state.placements);
      
      // Show announcement modal
      showModal("PLACEMENTS REVEALED - Conflicts will now be resolved");
    }
  }, 2000);
  
  return () => clearInterval(interval);
}, [gameId]);
```

**UI Changes:**
- Modal: "PLACEMENTS REVEALED"
- Board updates with all actors visible
- Proceed to next step (conflict resolution)

---

## Implementation by Phase

### Phase 2: Distribution (Actor Placements)

**Priority:** CRITICAL  
**Status:** Not yet implemented

**Changes Needed:**

1. **Add Local State:**
```typescript
const [stagedActors, setStagedActors] = useState<ActorPlacement[]>([]);
const [isCommitted, setIsCommitted] = useState(false);
```

2. **Modify Placement UI:**
- Stage actors locally (don't send to server)
- Show "STAGED" indicator
- Add "DONE - LOCK IN PLACEMENTS" button

3. **Create API Endpoint:**
```typescript
// app/api/game/commit-placements/route.ts
POST /api/game/commit-placements
{
  gameId: string;
  playerId: string;
  placements: ActorPlacement[];
}
```

4. **Add Announcement Modal:**
```
"DISTRIBUTION PHASE - Place your actors"
"Click DONE when ready"
"Other players cannot see your choices"
```

5. **Reveal Logic:**
- Wait for all players to commit
- Reveal board simultaneously
- Show "PLACEMENTS REVEALED" modal

---

### Phase 3: Action (Card Selections)

**Priority:** HIGH  
**Status:** Not yet implemented

**Three Sub-Steps to Seal:**

**Step 0: Card Selection**
```typescript
// Seal card choices
const [stagedCard, setStagedCard] = useState<CardType | null>(null);
```

**Step 1: Relocations**
```typescript
// Seal relocation choices
const [stagedRelocations, setStagedRelocations] = useState<Relocation[]>([]);
```

**Step 2: Exchanges**
```typescript
// Seal exchange choices
const [stagedExchanges, setStagedExchanges] = useState<Exchange[]>([]);
```

Each sub-step follows the same pattern:
1. Local staging
2. Commit button
3. Server consensus
4. Reveal

---

### Phase 5: Market (Purchases)

**Priority:** MEDIUM  
**Status:** Not yet implemented

**Changes Needed:**

1. **Seal Purchase Choices:**
```typescript
const [stagedPurchases, setStagedPurchases] = useState<Purchase[]>([]);
```

2. **Commit Button:**
- "DONE - LOCK IN PURCHASES"
- Wait for all players

3. **Reveal:**
- Show all purchases simultaneously
- Update resources for all players

---

## Consensus Mechanism

### All-Players-Ready Pattern

**Core Principle:** Never auto-advance. Always wait for explicit acknowledgment.

```typescript
// Server tracks ready state
interface ConsensusState {
  playersReady: Set<string>;
  totalPlayers: number;
  consensusReached: boolean;
}

function checkConsensus(state: ConsensusState): boolean {
  return state.playersReady.size === state.totalPlayers;
}
```

### Client Polling

```typescript
// Poll every 2 seconds for consensus
useEffect(() => {
  if (!isCommitted) return;
  
  const interval = setInterval(async () => {
    const state = await fetchGameState(gameId);
    
    if (state.consensusReached) {
      // Consensus reached, reveal and advance
      handleReveal(state);
    } else {
      // Update waiting UI
      setPlayersReady(state.playersReady.size);
    }
  }, 2000);
  
  return () => clearInterval(interval);
}, [isCommitted, gameId]);
```

---

## UI/UX Guidelines

### Visual States

**1. Staging (Before Commit):**
- Choices visible to player only
- Opacity: 0.7 or border: dashed
- Label: "STAGED" or "DRAFT"
- Button: "DONE - LOCK IN [ACTION]" (enabled)

**2. Committed (Waiting):**
- Choices locked (cannot change)
- Show "Waiting for other players..."
- Show progress: "2/3 players ready"
- Button: "DONE - LOCK IN [ACTION]" (disabled)

**3. Revealed (After Consensus):**
- All choices visible to all players
- Modal: "[ACTION] REVEALED"
- Proceed to next step

### Announcement Modals

**Phase 2 Start:**
```
"DISTRIBUTION PHASE"
"Place your actors on the board"
"Other players cannot see your choices"
"Click DONE when ready"
```

**Phase 2 Reveal:**
```
"PLACEMENTS REVEALED"
"All actors are now visible"
"Conflicts will be resolved next"
```

**Phase 3 Start:**
```
"ACTION PHASE"
"Select your card and actions"
"Choices are hidden until all players commit"
```

---

## Race Condition Prevention

### Problem: Polling Overwrites Local State

**Scenario:**
```
1. Player commits placements
2. Server stores sealed placements
3. Client polls game state
4. Server returns old state (before reveal)
5. Client overwrites local state with stale data
6. Player's placements disappear
```

### Solution: Separate Sealed State

```typescript
// Don't mix sealed and revealed state
interface GameState {
  // Always visible
  phase: number;
  turn: number;
  resources: Resources;
  
  // Only visible after reveal
  placements?: ActorPlacement[]; // undefined until revealed
  
  // Sealed state (separate)
  sealed: {
    phase2: {
      committed: boolean;
      playersReady: number;
      revealed: boolean;
    }
  }
}
```

### Client Logic

```typescript
// Don't overwrite local state until revealed
function handlePollingUpdate(serverState: GameState) {
  if (serverState.sealed.phase2.revealed) {
    // Safe to update local state
    setPlacements(serverState.placements);
  } else if (isCommitted) {
    // Keep local staged state, don't overwrite
    // Just update waiting UI
    setPlayersReady(serverState.sealed.phase2.playersReady);
  }
}
```

---

## Testing Checklist

**For Each Sealed Phase:**

- [ ] Player 1 stages choices → Player 2 sees nothing
- [ ] Player 1 commits → Player 2 still sees nothing
- [ ] Player 2 stages different choices → Player 1 sees nothing
- [ ] Player 2 commits → Both see reveal modal
- [ ] All choices revealed simultaneously
- [ ] No race conditions (polling doesn't overwrite)
- [ ] Cannot change choices after commit
- [ ] Progress indicator shows "X/Y players ready"
- [ ] Announcement modals appear at correct times
- [ ] Game advances only after consensus

---

## Common Pitfalls

### ❌ Don't: Send Choices Immediately

```typescript
// BAD: Sends to server on every change
function placeActor(actor, location) {
  await updateGameState({ placements: [...placements, { actor, location }] });
}
```

### ✅ Do: Stage Locally, Commit Explicitly

```typescript
// GOOD: Stage locally, commit on button click
function stageActor(actor, location) {
  setStagedActors(prev => [...prev, { actor, location }]);
}

function commitPlacements() {
  await fetch('/api/game/commit-placements', { body: stagedActors });
}
```

### ❌ Don't: Auto-Advance on First Commit

```typescript
// BAD: Advances when first player commits
if (player.committed) {
  advancePhase();
}
```

### ✅ Do: Wait for All Players

```typescript
// GOOD: Wait for consensus
if (allPlayersCommitted()) {
  revealAndAdvance();
}
```

### ❌ Don't: Mix Sealed and Revealed State

```typescript
// BAD: Same field for sealed and revealed
gameState.placements = sealedPlacements; // Visible too early!
```

### ✅ Do: Separate Sealed State

```typescript
// GOOD: Separate sealed and revealed
gameState.sealedPlacements = { [playerId]: placements, revealed: false };
gameState.placements = undefined; // Only set after reveal
```

---

## Related Pages

- [[PvP-Consensus]] — All-players-ready synchronization pattern
- [[Polling-vs-Consensus]] — When to use polling vs explicit consensus
- [[Phase-Flow-Analysis]] — Turn structure and state transitions
- [[Actors]] — What gets sealed in Phase 2
- [[Phases]] — Which phases need sealing
- [[BLOCKCHAIN_PHASE_FLOW_IMPLEMENTATION]] — Complete implementation spec

---

## Implementation Status

**Phase 2 (Distribution):**
- ⚠️ Not yet implemented
- See `docs/BLOCKCHAIN_PHASE_FLOW_IMPLEMENTATION.md` lines 88-186

**Phase 3 (Action):**
- ⚠️ Not yet implemented
- See `docs/BLOCKCHAIN_PHASE_FLOW_IMPLEMENTATION.md` lines 188-312

**Phase 5 (Market):**
- ⚠️ Not yet implemented
- See `docs/BLOCKCHAIN_PHASE_FLOW_IMPLEMENTATION.md` lines 314-398

---

## Sources

- `docs/BLOCKCHAIN_PHASE_FLOW_IMPLEMENTATION.md` — Complete sealed-bid specification
- `docs/AI_CONTEXT.md` — Current priorities and status
- `docs/BUGS_HISTORY.md` — Race condition fixes (P4, P5, P6)
- `docs/PVP_PHASE_FLOW_ANALYSIS.md` — Phase flow analysis