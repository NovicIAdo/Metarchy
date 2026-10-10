# PvP-Consensus — All-Players-Ready Synchronization

> **Category:** Concept  
> **Last updated:** 2026-04-18  
> **Sources:** BUGS_HISTORY.md, AI_CONTEXT.md, PVP_PHASE_FLOW_ANALYSIS.md  
> **Status:** Complete

---

## Overview

PvP-Consensus is the synchronization pattern that ensures all players explicitly acknowledge state changes before the game advances. It prevents auto-advance bugs, race conditions, and ensures fair multiplayer gameplay.

**Core Principle:** Never auto-advance. Always wait for explicit acknowledgment from all players.

This pattern is used throughout Metarchy's PvP multiplayer:
- Phase transitions (Event → Distribution → Action → Conflict → Market)
- Conflict-to-conflict progression (multiple conflicts in Phase 4)
- Sealed-bid reveals (after all players commit)

---

## The Problem

**Without Consensus:**
- Game auto-advances when first player acts
- Second player misses their turn
- State changes happen without player awareness
- Resources/phase reset unexpectedly
- Players see different game states

**Example Bug (P1 from BUGS_HISTORY):**
```
Player 1 clicks "NEXT CONFLICT" → Game advances immediately
Player 2 still viewing previous conflict → Misses current conflict
Player 2's resources reset → Lost progress
```

---

## The Solution: All-Players-Ready Pattern

### Server-Side State

```typescript
interface ConsensusState {
  playersReady: Set<string>;
  totalPlayers: number;
  consensusReached: boolean;
  waitingFor: string[]; // Player IDs not yet ready
}

function checkConsensus(state: ConsensusState): boolean {
  return state.playersReady.size === state.totalPlayers;
}

function addPlayerReady(state: ConsensusState, playerId: string): void {
  state.playersReady.add(playerId);
  state.consensusReached = checkConsensus(state);
  state.waitingFor = getAllPlayerIds().filter(id => !state.playersReady.has(id));
}
```

### Client-Side Polling

```typescript
// Poll every 2 seconds for consensus
useEffect(() => {
  if (!isReady) return; // Only poll after player clicks ready
  
  const interval = setInterval(async () => {
    const state = await fetchGameState(gameId);
    
    if (state.consensusReached) {
      // All players ready, advance
      handleAdvance(state);
      clearInterval(interval);
    } else {
      // Update waiting UI
      setPlayersReady(state.playersReady.size);
      setTotalPlayers(state.totalPlayers);
    }
  }, 2000);
  
  return () => clearInterval(interval);
}, [isReady, gameId]);
```

---

## Implementation Patterns

### Pattern 1: Phase Transitions

**Use Case:** Moving from one phase to another (e.g., Event → Distribution)

**Flow:**
1. Phase completes (e.g., Event card revealed)
2. Show "NEXT PHASE" button to all players
3. Each player clicks button → sends ready signal to server
4. Server waits for all players to be ready
5. Server advances phase when consensus reached
6. All players poll and detect phase change

**Code:**
```typescript
// Client: Player clicks ready
async function handleNextPhase() {
  await fetch('/api/game/phase-ready', {
    method: 'POST',
    body: JSON.stringify({ gameId, playerId })
  });
  
  setIsReady(true); // Start polling
}

// Server: Track ready state
async function handlePhaseReady(gameId: string, playerId: string) {
  const game = await getGame(gameId);
  
  game.phaseConsensus.playersReady.add(playerId);
  
  if (game.phaseConsensus.playersReady.size === game.players.length) {
    // Consensus reached, advance phase
    game.phase += 1;
    game.phaseConsensus.playersReady.clear(); // Reset for next phase
    await saveGame(game);
  }
  
  return { ready: true, consensusReached: game.phaseConsensus.playersReady.size === game.players.length };
}
```

---

### Pattern 2: Conflict-to-Conflict Progression

**Use Case:** Multiple conflicts in Phase 4, must resolve sequentially

**Flow:**
1. Conflict resolves (winner determined, resources distributed)
2. Show "NEXT CONFLICT" button to all players
3. Each player clicks button → sends ready signal
4. Server waits for all players
5. Server advances to next conflict when consensus reached
6. All players see next conflict simultaneously

**Code:**
```typescript
// Client: Player clicks next conflict
async function handleNextConflict() {
  await fetch('/api/game/conflict-ready', {
    method: 'POST',
    body: JSON.stringify({ 
      gameId, 
      playerId,
      currentConflictId: conflict.id 
    })
  });
  
  setIsConflictReady(true);
}

// Server: Track conflict consensus
async function handleConflictReady(gameId: string, playerId: string, conflictId: string) {
  const game = await getGame(gameId);
  
  // Ensure all players ready for same conflict (prevent race conditions)
  if (game.currentConflictId !== conflictId) {
    return { error: 'Conflict mismatch' };
  }
  
  game.conflictConsensus.playersReady.add(playerId);
  
  if (game.conflictConsensus.playersReady.size === game.players.length) {
    // Consensus reached, advance to next conflict
    const nextConflict = getNextConflict(game);
    
    if (nextConflict) {
      game.currentConflictId = nextConflict.id;
    } else {
      // No more conflicts, advance to next phase
      game.phase += 1;
    }
    
    game.conflictConsensus.playersReady.clear();
    await saveGame(game);
  }
  
  return { 
    ready: true, 
    consensusReached: game.conflictConsensus.playersReady.size === game.players.length 
  };
}
```

---

### Pattern 3: Sealed-Bid Reveals

**Use Case:** After all players commit sealed choices, reveal simultaneously

**Flow:**
1. Players stage choices locally (hidden)
2. Each player clicks "DONE - LOCK IN" button
3. Server stores sealed choices (not visible to other players)
4. Server waits for all players to commit
5. Server reveals all choices when consensus reached
6. All players see reveal modal simultaneously

**Code:**
```typescript
// Client: Player commits sealed choices
async function commitChoices(choices: any[]) {
  await fetch('/api/game/commit-sealed', {
    method: 'POST',
    body: JSON.stringify({ 
      gameId, 
      playerId,
      phase: currentPhase,
      choices 
    })
  });
  
  setIsCommitted(true);
}

// Server: Store sealed and check consensus
async function handleCommitSealed(gameId: string, playerId: string, phase: number, choices: any[]) {
  const game = await getGame(gameId);
  
  // Store sealed choices (not visible to other players)
  game.sealedChoices[phase] = game.sealedChoices[phase] || {};
  game.sealedChoices[phase][playerId] = {
    choices,
    committedAt: new Date().toISOString(),
    revealed: false
  };
  
  const committedPlayers = Object.keys(game.sealedChoices[phase]);
  
  if (committedPlayers.length === game.players.length) {
    // Consensus reached, reveal all choices
    for (const pid of committedPlayers) {
      game.sealedChoices[phase][pid].revealed = true;
    }
    
    // Apply choices to game state
    applyRevealedChoices(game, phase);
    await saveGame(game);
  }
  
  return { 
    committed: true, 
    consensusReached: committedPlayers.length === game.players.length 
  };
}
```

---

## UI/UX Guidelines

### Visual States

**1. Waiting for Player Action:**
```
Button: "NEXT CONFLICT" (enabled)
Status: ""
```

**2. Player Ready, Waiting for Others:**
```
Button: "NEXT CONFLICT" (disabled)
Status: "Waiting for other players... (1/2 ready)"
Progress: Show player avatars with checkmarks
```

**3. Consensus Reached:**
```
Button: Hidden or disabled
Status: "All players ready! Advancing..."
Animation: Brief transition animation
```

### Button Labels

**Phase Transitions:**
- "NEXT PHASE"
- "CONTINUE TO DISTRIBUTION"
- "CONTINUE TO ACTION"

**Conflict Progression:**
- "NEXT CONFLICT"
- "CONTINUE"

**Sealed-Bid Commits:**
- "DONE - LOCK IN PLACEMENTS"
- "DONE - LOCK IN ACTIONS"
- "DONE - LOCK IN PURCHASES"

### Progress Indicators

**Text-Based:**
```
"Waiting for other players... (2/3 ready)"
```

**Visual:**
```
Player 1: ✅ Ready
Player 2: ✅ Ready
Player 3: ⏳ Waiting...
```

**Progress Bar:**
```
[████████░░] 2/3 players ready
```

---

## Race Condition Prevention

### Problem: Polling Overwrites State

**Scenario:**
```
1. Player clicks "NEXT CONFLICT" → sends ready signal
2. Server stores ready state
3. Client polls game state (2 seconds later)
4. Server returns state before consensus
5. Client overwrites local state → button re-enables
6. Player confused, clicks again → duplicate requests
```

### Solution: Track Local Ready State

```typescript
// Don't rely solely on server state
const [isLocallyReady, setIsLocallyReady] = useState(false);

function handleReady() {
  setIsLocallyReady(true); // Immediately disable button
  sendReadySignal(); // Send to server
}

// Polling doesn't overwrite local state
function handlePollingUpdate(serverState: GameState) {
  if (serverState.consensusReached) {
    // Consensus reached, advance
    handleAdvance(serverState);
    setIsLocallyReady(false); // Reset for next consensus
  } else {
    // Update progress only, don't re-enable button
    setPlayersReady(serverState.playersReady.size);
  }
}

// Button disabled if locally ready OR server consensus reached
<button disabled={isLocallyReady || consensusReached}>
  NEXT CONFLICT
</button>
```

---

## Logging for Debugging

### Client-Side Logs

```typescript
// Log consensus events
console.log('[Consensus] Player ready:', { 
  playerId, 
  phase, 
  conflictId,
  timestamp: new Date().toISOString() 
});

console.log('[Consensus] Polling update:', { 
  playersReady: state.playersReady.size,
  totalPlayers: state.totalPlayers,
  consensusReached: state.consensusReached
});

console.log('[Consensus] Consensus reached, advancing:', { 
  fromPhase: currentPhase,
  toPhase: nextPhase,
  timestamp: new Date().toISOString()
});
```

### Server-Side Logs

```typescript
// Add to sessionLogs array
sessionLogs.push({
  timestamp: new Date().toISOString(),
  source: 'server',
  playerId,
  playerName: player.name,
  phase: game.phase,
  turn: game.turn,
  category: 'consensus',
  event: 'player-ready',
  data: {
    readyCount: game.consensusState.playersReady.size,
    totalPlayers: game.players.length,
    waitingFor: game.consensusState.waitingFor
  }
});

// When consensus reached
sessionLogs.push({
  timestamp: new Date().toISOString(),
  source: 'server',
  phase: game.phase,
  turn: game.turn,
  category: 'consensus',
  event: 'consensus-reached',
  data: {
    allPlayersReady: true,
    advancingTo: nextState
  }
});
```

See [[Session-Logging]] for complete logging structure.

---

## Testing Checklist

**For Each Consensus Point:**

- [ ] Player 1 clicks ready → button disables immediately
- [ ] Player 1 sees "Waiting for other players... (1/2 ready)"
- [ ] Player 2 still sees enabled button
- [ ] Player 2 clicks ready → button disables
- [ ] Both players see "All players ready!"
- [ ] Game advances simultaneously for both players
- [ ] No race conditions (polling doesn't re-enable buttons)
- [ ] No duplicate requests (clicking multiple times has no effect)
- [ ] Logs show correct sequence of events
- [ ] Resources/state persist through consensus

---

## Common Pitfalls

### ❌ Don't: Auto-Advance on First Player

```typescript
// BAD: Advances when first player ready
if (player.isReady) {
  advancePhase();
}
```

### ✅ Do: Wait for All Players

```typescript
// GOOD: Wait for consensus
if (allPlayersReady()) {
  advancePhase();
}
```

### ❌ Don't: Rely Only on Server State

```typescript
// BAD: Button state controlled by server
<button disabled={serverState.isReady}>
  NEXT
</button>
```

### ✅ Do: Track Local State

```typescript
// GOOD: Local state prevents re-enabling
<button disabled={isLocallyReady || serverState.consensusReached}>
  NEXT
</button>
```

### ❌ Don't: Allow Mismatched Consensus

```typescript
// BAD: Players ready for different conflicts
game.conflictConsensus.playersReady.add(playerId);
```

### ✅ Do: Validate Consensus Context

```typescript
// GOOD: Ensure all players ready for same conflict
if (game.currentConflictId !== requestedConflictId) {
  return { error: 'Conflict mismatch' };
}
game.conflictConsensus.playersReady.add(playerId);
```

---

## Bot Games vs PvP

### Bot Games: No Consensus Needed

```typescript
// Bot games can auto-advance
if (game.isBotGame) {
  // Bot acts immediately, no waiting
  advancePhase();
} else {
  // PvP requires consensus
  waitForAllPlayers();
}
```

### Why Bots Don't Need Consensus

- Bot has no UI to update
- Bot doesn't need time to review state
- Bot acts instantly via AI logic
- No risk of missing turns or state changes

See [[Bot-vs-PvP]] for complete comparison.

---

## Related Pages

- [[Sealed-Bid-Mechanism]] — Uses consensus for commit/reveal pattern
- [[Polling-vs-Consensus]] — When to use polling vs explicit consensus
- [[Phase-Flow-Analysis]] — Where consensus points occur in game flow
- [[Session-Logging]] — How to log consensus events for debugging
- [[Conflict-Resolution]] — Uses consensus for conflict-to-conflict progression

---

## Implementation Status

**✅ Complete:**
- Phase 4 conflict-to-conflict consensus (P1 bug fixed)
- Conflict resolution consensus mechanism
- Server-side consensus tracking

**🔨 In Progress:**
- Phase 2, 3, 5 sealed-bid consensus (part of sealed-bid implementation)

**🔲 Not Started:**
- Phase transition consensus (Event → Distribution, etc.)
- Disconnection handling (timeout after 1 minute)

---

## Sources

- `docs/BUGS_HISTORY.md` — P1, P2, P3, P7 bugs (consensus failures)
- `docs/AI_CONTEXT.md` — Current status and priorities
- `docs/PVP_PHASE_FLOW_ANALYSIS.md` — Phase flow and consensus points
- `docs/SESSION_2026-04-12_SUMMARY.md` — Conflict consensus implementation