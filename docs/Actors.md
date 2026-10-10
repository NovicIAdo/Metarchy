# Actors — The Four Player Units

> **Category:** Entity  
> **Last updated:** 2026-04-18  
> **Sources:** RULES.md, MECHANICS.md, metarchy-rules.md  
> **Status:** Complete

---

## Overview

Actors are the four unit types each player controls in Metarchy. Each player has exactly one of each actor type: **Politician**, **Scientist**, **Artist**, and **Robot**. Actors are placed at [[Locations]] during Phase 2 (Distribution), where they produce [[Resources]] and engage in [[Conflict-Resolution]] when multiple actors occupy the same location.

**Key Mechanic:** Each actor has unique conflict behavior (draw rules) and produces different resource types, making strategic placement critical.

---

## The Four Actors

### 1. Politician

**Values Produced:** Power  
**Allowed Locations:** Square, University  
**Draw Rule:** Must re-resolve (keep fighting until someone wins)

**Strategic Notes:**
- Only actor that produces Power (required for Victory Points)
- Draw rule means conflicts always have a winner
- Limited to 2 locations (most restrictive)
- High-stakes placement due to Power scarcity

**Conflict Behavior:**
```
If Politician vs Politician → Draw → Re-resolve immediately
Continue until one wins (no ties allowed)
```

---

### 2. Scientist

**Values Produced:** Knowledge  
**Allowed Locations:** University, Theatre  
**Draw Rule:** All win (share the location value)

**Strategic Notes:**
- Only actor that produces Knowledge (required for Victory Points)
- Draw rule encourages cooperation/shared rewards
- Can go to University (competes with Politician) or Theatre (competes with Artist)
- Safest actor due to win-sharing

**Conflict Behavior:**
```
If Scientist vs Scientist → Draw → Both get full location value
All Scientists win together (no losers)
```

---

### 3. Artist

**Values Produced:** Art  
**Allowed Locations:** Square, Theatre  
**Draw Rule:** All lose (nobody gets rewards)

**Strategic Notes:**
- Only actor that produces Art (required for Victory Points)
- Draw rule creates high-risk standoffs
- Can go to Square (competes with Politician) or Theatre (competes with Scientist)
- Most dangerous actor due to mutual destruction

**Conflict Behavior:**
```
If Artist vs Artist → Draw → Nobody gets anything
All Artists lose together (total loss)
```

---

### 4. Robot

**Values Produced:** Product, Electricity, Recycling (material resources)  
**Allowed Locations:** Factory, Power Plant, Dump  
**Draw Rule:** Share reduced reward (split location value)

**Strategic Notes:**
- Only actor that produces material resources (used for betting/market)
- Draw rule provides guaranteed but reduced rewards
- Most locations available (3 options)
- Reliable but lower-value actor

**Conflict Behavior:**
```
If 2 Robots → Each gets 50% of location value
If 3 Robots → Each gets 33% of location value
Reward splits evenly among all Robots
```

---

## Actor Comparison Table

| Actor | Values | Locations | Draw Rule | Risk Level |
|---|---|---|---|---|
| **Politician** | Power | Square, University | Re-resolve | High |
| **Scientist** | Knowledge | University, Theatre | All win | Low |
| **Artist** | Art | Square, Theatre | All lose | Very High |
| **Robot** | Product/Electricity/Recycling | Factory, Power Plant, Dump | Share reduced | Medium |

---

## Placement Rules

### Phase 2: Distribution

**Sealed Placement (PvP):**
1. Players stage actors locally (hidden from opponents)
2. Click "DONE - LOCK IN PLACEMENTS" button
3. Server waits for all players to commit
4. Board reveals simultaneously after consensus

**Current Status:** ⚠️ Not yet implemented (see [[Sealed-Bid-Mechanism]])

**Bot Games:**
- Placements are visible immediately (no sealing needed)
- Bot places actors using AI logic

### Placement Constraints

- Each player places exactly 4 actors (one of each type)
- Each actor can only go to its allowed locations
- Multiple actors can occupy the same location (triggers conflict)
- Cannot place same actor twice (only one Politician per player)

---

## Conflict Resolution

When multiple actors occupy the same location, conflicts are resolved using Rock-Paper-Scissors mechanics with betting.

### Conflict Priority

1. **Check actor types:** Different actors → RPS resolution
2. **Check draw rules:** Same actor type → Apply draw rule
3. **Distribute rewards:** Winner(s) get location value + loser's bet

### Draw Rule Summary

```typescript
// Politician vs Politician
if (bothPoliticians) {
  reResolve(); // Keep fighting until winner
}

// Scientist vs Scientist
if (bothScientists) {
  bothWin(); // Share full rewards
}

// Artist vs Artist
if (bothArtists) {
  bothLose(); // Nobody gets anything
}

// Robot vs Robot (2 players)
if (bothRobots) {
  split50_50(); // Each gets half
}

// Robot vs Robot vs Robot (3 players)
if (threeRobots) {
  split33_33_33(); // Each gets third
}
```

See [[Conflict-Resolution]] for complete RPS mechanics and betting rules.

---

## Strategic Considerations

### Value Scarcity

Each actor produces unique values needed for [[Victory-Points]]:
- **VP = min(Power, Art, Knowledge)** after distributing Fame
- Must balance all three values (weakest link determines score)
- Losing any actor means zero production of that value type

### Risk vs Reward

**High Risk:**
- Politician (must win, no draws)
- Artist (mutual destruction on draw)

**Low Risk:**
- Scientist (win-sharing)
- Robot (guaranteed reduced rewards)

### Location Competition

**Contested Locations:**
- **Square:** Politician vs Artist (high stakes)
- **University:** Politician vs Scientist (Power vs Knowledge)
- **Theatre:** Scientist vs Artist (Knowledge vs Art)

**Robot-Only Locations:**
- **Factory, Power Plant, Dump:** Only Robots compete (lower stakes)

---

## Code References

### Actor Type Definition

```typescript
// lib/modules/core/types.ts
export type ActorType = 'politician' | 'scientist' | 'artist' | 'robot';

export interface Actor {
  type: ActorType;
  playerId: string;
  location?: LocationType;
  bet?: number;
}
```

### Actor Constants

```typescript
// lib/modules/core/constants.ts
export const ACTOR_LOCATIONS: Record<ActorType, LocationType[]> = {
  politician: ['square', 'university'],
  scientist: ['university', 'theatre'],
  artist: ['square', 'theatre'],
  robot: ['factory', 'powerPlant', 'dump']
};

export const ACTOR_VALUES: Record<ActorType, ResourceType[]> = {
  politician: ['power'],
  scientist: ['knowledge'],
  artist: ['art'],
  robot: ['product', 'electricity', 'recycling']
};
```

### Draw Rule Logic

```typescript
// lib/modules/game/conflict.ts
function applyDrawRule(actors: Actor[]): ConflictResult {
  const actorType = actors[0].type;
  
  if (actorType === 'politician') {
    return { outcome: 'reResolve', winners: [] };
  }
  
  if (actorType === 'scientist') {
    return { outcome: 'allWin', winners: actors };
  }
  
  if (actorType === 'artist') {
    return { outcome: 'allLose', winners: [] };
  }
  
  if (actorType === 'robot') {
    const sharePercent = 1 / actors.length;
    return { outcome: 'share', winners: actors, sharePercent };
  }
}
```

---

## Related Pages

- [[Locations]] — Where actors can be placed
- [[Resources]] — What actors produce
- [[Conflict-Resolution]] — How conflicts are resolved
- [[Sealed-Bid-Mechanism]] — Hidden placement pattern for PvP
- [[Victory-Points]] — How actor values convert to score
- [[Phases]] — When actors are placed (Phase 2: Distribution)

---

## Implementation Status

**✅ Complete:**
- Actor types and properties defined
- Draw rules implemented
- Conflict resolution working
- Bot placement logic

**🔨 In Progress:**
- Sealed placement for PvP (Phase 2)

**🔲 Not Started:**
- Actor NFT integration (blockchain phase)
- Actor visual customization

---

## Sources

- `docs/RULES.md` — Player-facing rules for actors
- `docs/MECHANICS.md` — Detailed actor mechanics with code references
- `docs/metarchy-rules.md` — Alternative rules documentation
- `lib/modules/core/types.ts` — Actor type definitions
- `lib/modules/core/constants.ts` — Actor constants
- `lib/modules/game/conflict.ts` — Draw rule implementation