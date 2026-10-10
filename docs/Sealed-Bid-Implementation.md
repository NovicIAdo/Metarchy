# Blockchain-Style Phase Flow Implementation Plan

**Date:** 2026-04-12  
**Status:** IMPLEMENTATION PLAN  
**Goal:** Implement sealed-bid, simultaneous-action game flow for all phases

---

## Core Principles

### 1. **Sealed Actions**
- Players' actions are HIDDEN from other players until all commit
- Actions stored locally, not sent to server until "DONE" clicked
- No real-time visibility of other players' moves

### 2. **State Immutability**
- Game state changes ONLY when ALL players commit
- Before commit: players can change their mind
- After commit: actions locked, waiting for consensus

### 3. **Consensus-Based Transitions**
- Server waits for ALL active players to signal ready
- Server processes all actions simultaneously
- Server increments `phaseTicker` to trigger state change
- All clients detect ticker change and update

### 4. **Disconnection Handling**
- 1-minute grace period for reconnection
- Timer shown to other players: "Player X disconnected - 0:45 remaining"
- After 1 minute: player eliminated, game continues without them
- 2-player game: remaining player wins
- 3+ player game: continues with remaining players

---

## Phase-by-Phase Implementation

### **Phase 1: Event Phase**

#### Current Status: ✅ ALREADY IMPLEMENTED CORRECTLY

#### Flow:
```
1. ANNOUNCEMENT
   ↓
   Server draws random event card
   Broadcasts to all players
   
2. DISPLAY
   ↓
   Modal shows event card
   Explains conditions (discard resources, compare values, etc.)
   
3. COMMIT
   ↓
   Player clicks "GET IT"
   Sends phase-ready signal
   Button changes to "WAITING FOR OTHERS..."
   
4. CONSENSUS
   ↓
   Server waits for all players
   Shows: "2/4 players ready"
   
5. STATE TRANSITION
   ↓
   All ready → Server processes event
   Determines winner (or tie-breaker needed)
   Increments phaseTicker
   
6. RESULT
   ↓
   Show event outcome
   Winner gets Fame/Action Card
   If tie → Tie-breaker RPS modal
   Click "GET IT" → Phase 2
```

#### No Changes Needed

---

### **Phase 2: Distribution Phase**

#### Current Status: ⚠️ PARTIALLY IMPLEMENTED - NEEDS FIXES

#### Issues:
1. ❌ Players can see each other placing actors in real-time (if polling is active)
2. ❌ No clear "DONE" button - uses "NEXT PHASE" which is confusing
3. ❌ No visual feedback that actions are staged (not committed)

#### Required Flow:
```
1. ANNOUNCEMENT
   ↓
   Modal: "DISTRIBUTION PHASE"
   "Place your 4 actors on the board"
   "Choose locations, arguments, and optional bets"
   "Other players CANNOT see your placements"
   Button: "START PLACING"
   
2. ACTION COLLECTION (LOCAL ONLY)
   ↓
   Player clicks actor → location → argument → optional bet
   Actions stored in LOCAL state (not sent to server)
   UI shows: "STAGED: 2/4 actors placed"
   Player can undo/modify placements
   Board shows ONLY player's own actors (no opponents visible)
   
3. COMMIT
   ↓
   When all 4 actors placed:
   Button appears: "DONE - LOCK IN PLACEMENTS"
   Player clicks → sends all placements to server in ONE request
   Button changes to "WAITING FOR OTHERS..."
   Placements now locked (cannot modify)
   
4. CONSENSUS
   ↓
   Server stores placements per player
   Waits for all players to commit
   Shows: "2/4 players ready"
   
5. STATE TRANSITION
   ↓
   All ready → Server merges all placements
   Creates final board state
   Increments phaseTicker
   
6. REVEAL
   ↓
   Modal: "PLACEMENTS REVEALED"
   Shows full board with ALL actors
   "Your Politician at Square vs Player2's Politician"
   "Your Robot at Factory (no conflict)"
   Button: "CONTINUE TO ACTION PHASE"
```

#### Implementation Changes:

**Client-Side:**
```typescript
// useBoardSession.ts
const [stagedActors, setStagedActors] = useState<PlacedActor[]>([]);
const [actorsCommitted, setActorsCommitted] = useState(false);

const handleActorPlace = (actor, location, argument, bet) => {
  // Store locally, don't send to server yet
  setStagedActors(prev => [...prev, { actor, location, argument, bet }]);
};

const handleCommitPlacements = async () => {
  // Send all placements at once
  await fetch(`/api/games/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      action: "commit-placements",
      citizenId: localPlayerId,
      placements: stagedActors,
    }),
  });
  setActorsCommitted(true);
  setIsWaitingForPlayers(true);
};
```

**Server-Side:**
```typescript
// route.ts
if (action === "commit-placements") {
  // Store placements (hidden from other players)
  if (!state.stagedPlacements) state.stagedPlacements = {};
  state.stagedPlacements[body.citizenId] = body.placements;
  
  // Mark player ready
  state.playerReady[body.citizenId] = true;
  
  // Check consensus
  if (allPlayersReady) {
    // Merge all placements into final board
    state.placedActors = mergePlacements(state.stagedPlacements);
    state.stagedPlacements = {}; // Clear staged
    state.phaseTicker += 1;
    state.currentPhase = 3;
  }
}
```

---

### **Phase 3: Action Phase (4 Sub-Steps)**

#### Current Status: ⚠️ PARTIALLY IMPLEMENTED - NEEDS FIXES

#### Issues:
1. ❌ No clear announcement modal for each sub-step
2. ❌ Players can see each other's card selections in real-time
3. ❌ No "DONE" button for each sub-step

#### Required Flow for Each Sub-Step:

```
STEP 0: SELECT CARDS
─────────────────────
1. ANNOUNCEMENT
   ↓
   Modal: "ACTION PHASE - STEP 0"
   "Select Action Cards to play this turn"
   "Cards: Relocation, Block Location, Change Values"
   Button: "START SELECTING"
   
2. ACTION COLLECTION
   ↓
   Player selects cards from inventory
   Selections stored locally
   UI shows: "Selected: 2 Relocation, 1 Block"
   Can deselect/change
   
3. COMMIT
   ↓
   Button: "DONE - LOCK IN CARDS"
   Sends selections to server
   Button → "WAITING FOR OTHERS..."
   
4. CONSENSUS → STATE TRANSITION
   ↓
   All ready → Server determines which steps to run
   If no Block cards: skip Step 1
   If no Relocation: skip Step 2
   If no Change Values: skip Step 3
   
5. REVEAL
   ↓
   Modal: "CARDS PLAYED"
   "Player1: 2 Relocation"
   "Player2: 1 Block Location"
   Button: "CONTINUE"

STEP 1: BLOCK LOCATIONS (if any Block cards played)
─────────────────────
1. ANNOUNCEMENT
   ↓
   Modal: "STEP 1 - BLOCK LOCATIONS"
   "Players who played Block cards: select locations"
   
2. ACTION COLLECTION
   ↓
   Players who played Block cards select locations
   Others see: "WAITING FOR BLOCKS..."
   
3. COMMIT → CONSENSUS → TRANSITION
   ↓
   All Block players ready → Server applies blocks
   
4. REVEAL
   ↓
   "Locations blocked: Square, Factory"

STEP 2: RELOCATION (if any Relocation cards played)
─────────────────────
1. ANNOUNCEMENT
   ↓
   Modal: "STEP 2 - RELOCATION"
   "Players who played Relocation: move actors"
   
2. ACTION COLLECTION
   ↓
   Players select actor → new location
   Stored locally
   Can change mind
   
3. COMMIT
   ↓
   "DONE - LOCK IN RELOCATIONS"
   
4. CONSENSUS
   ↓
   Check for relocation conflicts
   If 2+ players move same actor → Tie-breaker RPS
   
5. STATE TRANSITION
   ↓
   Apply all relocations
   Update board state
   
6. REVEAL
   ↓
   "Relocations completed"
   Show updated board

STEP 3: CHANGE VALUES (if any Change Values cards played)
─────────────────────
1. ANNOUNCEMENT
   ↓
   Modal: "STEP 3 - EXCHANGE VALUES"
   
2. ACTION COLLECTION
   ↓
   Player selects: "Give Power, Take Knowledge from Player2"
   Stored locally
   
3. COMMIT → CONSENSUS → TRANSITION
   ↓
   All exchanges locked → Server applies
   
4. REVEAL
   ↓
   "Exchanges completed"
   Show updated values
```

---

### **Phase 4: Conflicts Resolution**

#### Current Status: ✅ MOSTLY IMPLEMENTED - MINOR TWEAKS NEEDED

#### Current Flow (Already Good):
```
1. ANNOUNCEMENT
   ↓
   Conflicts Overview Modal
   Shows all conflicts (#1, #2, #3)
   Button: "GET IT"
   
2. SEQUENTIAL RESOLUTION
   ↓
   Conflict #1 opens
   Players choose RPS (hidden until all commit)
   Resolve → Auto-open #2
   Repeat for all conflicts
   
3. COMPLETION
   ↓
   "ALL CONFLICTS RESOLVED" banner
   Button: "NEXT PHASE"
   
4. COMMIT
   ↓
   Player clicks NEXT PHASE
   Sends phase-ready with conflictsResolved=true
   
5. CONSENSUS → TRANSITION
   ↓
   All ready → Phase 5
```

#### Minor Tweaks Needed:
- Add "ANNOUNCEMENT" modal before overview (optional)
- Ensure RPS choices are sealed (already implemented)
- Server validates all conflicts resolved (already implemented)

---

### **Phase 5: Market Phase**

#### Current Status: ⚠️ NEEDS IMPLEMENTATION

#### Issues:
1. ❌ Players can see each other buying cards in real-time
2. ❌ No clear "DONE" button
3. ❌ No sealed-bid mechanism

#### Required Flow:
```
1. ANNOUNCEMENT
   ↓
   Modal: "MARKET PHASE"
   "Buy Action Cards: 1 Product + 1 Electricity + 1 Recycling"
   "Other players CANNOT see your purchases"
   Button: "OPEN MARKET"
   
2. ACTION COLLECTION (LOCAL)
   ↓
   Player clicks "BUY" → draws random card
   Card stored locally (not sent to server)
   Player can buy multiple cards
   UI shows: "Purchased: 2 cards (not revealed to others)"
   
3. COMMIT
   ↓
   Player clicks "DONE - FINISH SHOPPING"
   Sends all purchases to server in ONE request
   Button → "WAITING FOR OTHERS..."
   
4. CONSENSUS
   ↓
   Server waits for all players
   
5. STATE TRANSITION
   ↓
   All ready → Server processes all purchases
   Updates inventories
   Removes cards from deck
   Increments phaseTicker
   
6. REVEAL (Optional)
   ↓
   Modal: "MARKET CLOSED"
   "You bought: 2 Action Cards"
   "Player2 bought: 1 Action Card" (count only, not which cards)
   Button: "NEXT TURN" or "GAME OVER"
```

#### Implementation:
```typescript
// Client
const [stagedPurchases, setStagedPurchases] = useState<string[]>([]);

const handleBuyCard = () => {
  const card = drawRandomCard(); // Local only
  setStagedPurchases(prev => [...prev, card.id]);
};

const handleFinishShopping = async () => {
  await fetch(`/api/games/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      action: "commit-purchases",
      citizenId: localPlayerId,
      purchases: stagedPurchases,
    }),
  });
  setIsWaitingForPlayers(true);
};

// Server
if (action === "commit-purchases") {
  // Store purchases (hidden)
  if (!state.stagedPurchases) state.stagedPurchases = {};
  state.stagedPurchases[body.citizenId] = body.purchases;
  
  state.playerReady[body.citizenId] = true;
  
  if (allPlayersReady) {
    // Apply all purchases
    Object.entries(state.stagedPurchases).forEach(([pid, cards]) => {
      state.playerInventories[pid].push(...cards);
    });
    state.stagedPurchases = {};
    state.phaseTicker += 1;
    state.turn += 1;
    state.currentPhase = 1; // Next turn
  }
}
```

---

## UI Components Needed

### 1. **Phase Announcement Modal**
```typescript
<PhaseAnnouncementModal
  phase={phase}
  step={p3Step}
  title="DISTRIBUTION PHASE"
  description="Place your 4 actors on the board..."
  instructions={[
    "Choose locations for each actor",
    "Select arguments (Rock/Paper/Scissors)",
    "Optionally add bets",
    "Other players CANNOT see your placements"
  ]}
  onStart={() => setShowAnnouncement(false)}
/>
```

### 2. **Staged Actions Indicator**
```typescript
<StagedActionsPanel>
  <h3>STAGED ACTIONS (Not Committed)</h3>
  <ul>
    <li>✓ Politician → Square (Rock, Product bet)</li>
    <li>✓ Scientist → University (Paper)</li>
    <li>⏳ 2 more actors to place</li>
  </ul>
  <button disabled={!allActorsPlaced}>
    DONE - LOCK IN PLACEMENTS
  </button>
</StagedActionsPanel>
```

### 3. **Waiting for Consensus Screen**
```typescript
<WaitingForConsensusModal>
  <h2>WAITING FOR OTHER PLAYERS...</h2>
  <PlayerReadyList>
    <PlayerStatus player="You" ready={true} />
    <PlayerStatus player="Player2" ready={true} />
    <PlayerStatus player="Player3" ready={false} />
    <PlayerStatus player="Player4" ready={false} />
  </PlayerReadyList>
  <p>2/4 players ready</p>
</WaitingForConsensusModal>
```

### 4. **Disconnection Timer**
```typescript
<DisconnectionAlert>
  <h3>⚠️ Player3 Disconnected</h3>
  <Timer>0:45 remaining</Timer>
  <p>If Player3 doesn't reconnect, they will be eliminated</p>
</DisconnectionAlert>
```

---

## Server-Side Changes

### 1. **New API Actions**
```typescript
// Commit placements (Phase 2)
action: "commit-placements"
body: { citizenId, placements: PlacedActor[] }

// Commit card selections (Phase 3 Step 0)
action: "commit-card-selections"
body: { citizenId, selectedCards: string[] }

// Commit relocations (Phase 3 Step 2)
action: "commit-relocations"
body: { citizenId, relocations: Relocation[] }

// Commit exchanges (Phase 3 Step 3)
action: "commit-exchanges"
body: { citizenId, exchanges: Exchange[] }

// Commit purchases (Phase 5)
action: "commit-purchases"
body: { citizenId, purchases: string[] }
```

### 2. **Staged State Storage**
```typescript
gameState: {
  // Existing
  phaseTicker: number,
  playerReady: { [citizenId]: boolean },
  currentPhase: number,
  turn: number,
  
  // NEW: Staged actions (hidden until consensus)
  stagedPlacements: { [citizenId]: PlacedActor[] },
  stagedCardSelections: { [citizenId]: string[] },
  stagedRelocations: { [citizenId]: Relocation[] },
  stagedExchanges: { [citizenId]: Exchange[] },
  stagedPurchases: { [citizenId]: string[] },
  
  // NEW: Disconnection tracking
  playerLastSeen: { [citizenId]: timestamp },
  playerDisconnected: { [citizenId]: boolean },
}
```

### 3. **Consensus Handler**
```typescript
function checkConsensus(state, action) {
  const activePlayerIds = state.activePlayerIds.filter(
    id => !state.playerDisconnected[id]
  );
  
  const readyPlayers = Object.keys(state.playerReady).filter(
    id => activePlayerIds.includes(id)
  );
  
  if (readyPlayers.length >= activePlayerIds.length) {
    // Process staged actions
    processActions(state, action);
    
    // Clear staged data
    clearStagedData(state);
    
    // Advance state
    state.phaseTicker += 1;
    state.playerReady = {};
    
    return true;
  }
  
  return false;
}
```

### 4. **Disconnection Monitor**
```typescript
// Background job (runs every 10 seconds)
function checkDisconnections(gameId) {
  const game = getGame(gameId);
  const now = Date.now();
  
  game.players.forEach(player => {
    const lastSeen = game.gameState.playerLastSeen[player.id];
    const timeSinceLastSeen = now - lastSeen;
    
    if (timeSinceLastSeen > 60000) { // 1 minute
      // Eliminate player
      game.gameState.playerDisconnected[player.id] = true;
      game.gameState.activePlayerIds = game.gameState.activePlayerIds.filter(
        id => id !== player.id
      );
      
      // Notify other players
      broadcastToPlayers(gameId, {
        type: "player-eliminated",
        playerId: player.id,
        reason: "disconnection",
      });
      
      // Check if game should end
      if (game.gameState.activePlayerIds.length === 1) {
        endGame(gameId, game.gameState.activePlayerIds[0]);
      }
    }
  });
}
```

---

## Implementation Priority

### Priority 1: Phase 2 (Distribution) - CRITICAL
- Most important for sealed-bid gameplay
- Players must not see each other's placements
- Implement staged placements + commit button

### Priority 2: Phase 3 (Action) - HIGH
- Multiple sub-steps need proper flow
- Card selections must be hidden
- Each sub-step needs announcement + commit

### Priority 3: Phase 5 (Market) - MEDIUM
- Purchases must be hidden
- Implement staged purchases + commit

### Priority 4: Disconnection Handling - MEDIUM
- 1-minute timer
- Player elimination
- Game continuation logic

### Priority 5: UI Polish - LOW
- Announcement modals
- Staged actions panel
- Waiting screens
- Disconnection alerts

---

## Testing Checklist

### Phase 2 (Distribution)
- [ ] Player A places actors - Player B cannot see them
- [ ] Player A can modify placements before clicking DONE
- [ ] After clicking DONE, placements locked
- [ ] Both players click DONE → board revealed
- [ ] Revealed board shows all actors correctly

### Phase 3 (Action)
- [ ] Step 0: Card selections hidden until all commit
- [ ] Step 1: Block locations applied after consensus
- [ ] Step 2: Relocations hidden until all commit
- [ ] Step 3: Exchanges hidden until all commit
- [ ] Skipping works (no cards selected → skip step)

### Phase 4 (Conflicts)
- [ ] Already tested - working correctly

### Phase 5 (Market)
- [ ] Purchases hidden until all commit
- [ ] Card counts visible, but not which cards
- [ ] All purchases applied simultaneously

### Disconnection
- [ ] Player disconnects → 1-minute timer starts
- [ ] Player reconnects within 1 min → game continues
- [ ] Player doesn't reconnect → eliminated
- [ ] 2-player game: remaining player wins
- [ ] 3+ player game: continues without disconnected player

---

## Conclusion

This implementation transforms Metarchy into a true blockchain-style game where:
- ✅ All actions are sealed until consensus
- ✅ State changes atomically when all players commit
- ✅ No real-time visibility of opponent moves
- ✅ Players can change mind before committing
- ✅ Proper disconnection handling

**Estimated Implementation Time:** 3-4 days for full implementation + testing