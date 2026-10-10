# Metarchy — Game Concept

## Overview

**Metarchy** is a blockchain-based NFT turn-based strategy game set in a dystopian neural-network world. Players compete for dominance by sending Actors to Locations, gathering Values and Resources, resolving Conflicts via hidden-information mechanics (Rock-Paper-Scissors with strategic depth), and ultimately accumulating Victory Points.

The game combines psychological deduction, resource management, and tactical maneuvering into a compact 5-turn session for 2–3 players.

## Core Fantasy

Players are political operatives in a fractured cyberpunk society where four archetypes — **Politicians**, **Scientists**, **Artists**, and **Robots** — compete for control of key urban zones. The world is governed by intangible currencies (Power, Art, Knowledge) and material resources (Production, Electricity, Recycling). To win, you must balance your influence across all three spheres of value — no single path leads to victory.

## Design Pillars

### 1. Hidden Information
All player decisions (Actor placement, Arguments, Bets) are made secretly and simultaneously. Players only see their own distribution during the Distribution Phase. This creates a core loop of prediction, deception, and adaptation.

### 2. Rock-Paper-Scissors with Strategic Depth
The basic RPS mechanic is elevated by:
- **Dummy** argument (loses to everything, draws with itself) — enabling deliberate sacrifice plays
- **Bets** using Resources — gambling on conflict outcomes for amplified rewards
- **Actor-specific Draw rules** — Scientists all win on draw, Artists all lose, Politicians must re-fight, Robots share diminished rewards

### 3. Asymmetric Actor Roles
Each Actor type has unique value production, distinct Location access, and different Draw behavior. This forces players to make meaningful trade-offs every turn.

### 4. Resource Tension
Resources serve dual purposes: they can be spent as Bets in conflicts (consumed win or lose) or saved to buy Action Cards. This creates constant tension between tactical aggression and strategic investment.

### 5. Blockchain as Proof Layer
The blockchain serves as an impartial referee for the commit-reveal scheme. Encrypted moves are committed on-chain before reveal, preventing tampering. The game is designed to be chain-agnostic — any EVM-compatible blockchain works.

## Target Experience

| Aspect | Design Target |
|---|---|
| **Session length** | 15–30 minutes (5 turns) |
| **Player count** | 2–3 players (or 2v2 team mode) |
| **Skill curve** | Easy to learn (RPS), deep to master (bets, action cards, events) |
| **Replay value** | High — randomized events, action card deck, opponent mind-games |
| **Aesthetic** | Cyberpunk / dystopian neural network — dark UI with golden accents |

## Victory Condition

**Victory Points** = sets of `{1 Power + 1 Art + 1 Knowledge}`.

The special **Glory** value (earned via Events) acts as a wild card — it fills whichever Value the player has the least of, optimizing VP calculation.

The player with the most Victory Points after the final turn wins. Ties trigger an additional turn.

## Blockchain Integration

| Component | Role |
|---|---|
| **MetarchyTokens** (ERC-1155) | Actors, Arguments, Resources, Action Cards — all as on-chain tokens |
| **MetarchyGame** (Solidity) | Session management, commit-reveal scheme, phase state machine |
| **Game Server** | Independent third party — encrypts/decrypts moves, creates on-chain transactions |
| **Frontend** | Next.js client — connects to wallets via RainbowKit/wagmi |

## Game Phases (per Turn)

```
Turn N
 ├─ Phase 1: EVENT        (Random event, starting from Turn 2)
 ├─ Phase 2: DISTRIBUTION (Secret actor placement + arguments + bets)
 ├─ Phase 3: ACTION       (Action cards: block locations → relocate → exchange values)
 ├─ Phase 4: CONFLICT     (Reveal arguments, resolve RPS, apply bets)
 └─ Phase 5: MARKET       (Buy action cards with resources)
```

## Key Differentiators

- **Not a card game** — it's a spatial strategy on a hex map with location-based production
- **Not pure RPS** — the bet/actor/draw-rule system creates layer upon layer of strategic decisions
- **Blockchain-native but chain-agnostic** — proof-of-fairness without locking to a specific chain
- **Compact format** — entire game fits in 5 turns, suitable for competitive matchmaking
- **NFT actors with personality** — each Actor type has distinct art, behavior, and narrative flavor
