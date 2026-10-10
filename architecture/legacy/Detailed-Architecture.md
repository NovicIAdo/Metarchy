# Metarchy — Detailed Architecture

> **Purpose:** Complete technical architecture reference for developers
> **Audience:** Engineers working on codebase structure, refactoring, or system design
> **Last updated:** 2026-04-13

---

## Table of Contents

1. [System Layers](#system-layers)
2. [Directory Structure](#directory-structure)
3. [Module Architecture](#module-architecture)
4. [API Routes](#api-routes)
5. [Service Layer](#service-layer)
6. [State Management](#state-management)
7. [Key Architecture Decisions](#key-architecture-decisions)
8. [Module Audit Scorecard](#module-audit-scorecard)

---

## System Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                          FRONTEND                               │
│    Next.js 14 (App Router) + React 18 + Tailwind + Framer      │
│                                                                 │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────────────────────┐ │
│  │  Pages    │ │  Components  │ │   Pure Game Engine          │ │
│  │  (app/)   │ │  (components │ │   (lib/modules/)            │ │
│  │          │ │   /game/)    │ │   9 modules, ~1400 lines    │ │
│  └──────────┘ └──────────────┘ └─────────────────────────────┘ │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────────────────────┐ │
│  │ Context  │ │  Custom Hook │ │   Legacy Wrappers           │ │
│  │(context/)│ │  useBoardSes │ │   (lib/game/)               │ │
│  │          │ │  sion (2800L)│ │   PhaseEngine, BotAI        │ │
│  └──────────┘ └──────────────┘ └─────────────────────────────┘ │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────────────────────┐ │
│  │ Services │ │  API Routes  │ │   Data Layer                │ │
│  │(lib/     │ │  (app/api/)  │ │   Vercel KV / Local JSON    │ │
│  │services/)│ │  8 routes    │ │                             │ │
│  └──────────┘ └──────────────┘ └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                     SMART CONTRACTS (not connected)              │
│              Solidity ^0.8.20 (Foundry)                         │
│   ┌──────────────────┐  ┌────────────────────────────────────┐ │
│   │ MetarchyTokens   │  │       MetarchyGame                │ │
│   │ (ERC-1155)       │  │ (Session + Commit-Reveal)          │ │
│   └──────────────────┘  └────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
Meta_scratch/
├── docs/
│   ├── AI_CONTEXT.md (master status, quick start)
│   ├── ARCHITECTURE_DETAILED.md (this file)
│   ├── BUGS_HISTORY.md (all fixed bugs)
│   ├── SESSION_HISTORY.md (session log archive)
│   ├── CONCEPT.md, ARCH.md, MECHANICS.md, UI_SYSTEM.md, ROADMAP.md
│   ├── metarchy-rules.md (complete rulebook)
│   ├── PVP_PHASE_FLOW_ANALYSIS.md (292 lines)
│   ├── CONFLICT_RESOLUTION_FIXES_SUMMARY.md (371 lines)
│   └── BLOCKCHAIN_PHASE_FLOW_IMPLEMENTATION.md (692 lines)
├── contracts/src/
│   ├── MetarchyGame.sol              # On-chain game + commit-reveal
│   └── MetarchyTokens.sol            # ERC-1155 token contract
├── frontend/
│   ├── app/
│   │   ├── page.tsx                  # Landing / Lobby Hub
│   │   ├── providers.tsx             # GameStateProvider wrapper
│   │   ├── admin/                    # Admin dashboard (games, citizens)
│   │   ├── api/                      # 8 REST API routes
│   │   │   ├── games/                # CRUD for games
│   │   │   ├── admin/                # Admin endpoints
│   │   │   └── citizen/              # Citizen registration
│   │   ├── game/
│   │   │   ├── create/               # Create game session
│   │   │   ├── join/                 # Join game browser
│   │   │   ├── lobby/[id]/           # Pre-game lobby + chat
│   │   │   └── board/[id]/page.tsx   # Main game board (thin, ~483 lines)
│   │   └── dashboard/                # Legacy — superseded by root page
│   ├── hooks/
│   │   └── useBoardSession.ts        # ⚠️ GOD HOOK — 2797 lines, 55 state vars
│   ├── components/game/
│   │   ├── MapContainer.tsx           # Hex map with drag/zoom (~393 lines)
│   │   ├── ConflictResolutionView.tsx # RPS battle arena (~853 lines)
│   │   ├── phases/                    # Phase-specific orchestrators
│   │   │   ├── Phase1Event.tsx
│   │   │   ├── Phase2Distribution.tsx
│   │   │   ├── Phase3Action.tsx
│   │   │   ├── Phase3Exchange.tsx
│   │   │   ├── Phase4Conflict.tsx
│   │   │   └── Phase5Market.tsx
│   │   ├── ActionCardsPanel.tsx       # Card carousel
│   │   ├── BidRadialMenu.tsx          # Resource bet selector
│   │   ├── RSPRadialMenu.tsx          # RPS token selector
│   │   ├── BuyActionCardModal.tsx     # 3D card flip purchase
│   │   ├── ExchangeModal.tsx          # Value exchange UI
│   │   ├── MarketOfferModal.tsx       # Market trade offer
│   │   ├── MarketRevealModal.tsx      # Trade reveal + matching
│   │   ├── GameHeader.tsx             # Turn/phase indicator
│   │   ├── GameLog.tsx                # Action log stream
│   │   ├── GameResources.tsx          # SVG resource bar
│   │   ├── NewPlayersPanel.tsx        # Player avatar HUD
│   │   ├── ConflictsSidebar.tsx       # Draggable conflict list
│   │   ├── InventoryStatsModal.tsx    # Cards + leaderboard
│   │   ├── SettingsModal.tsx          # Volume + give up
│   │   └── ...
│   ├── context/
│   │   ├── GameStateContext.tsx        # Global state provider
│   │   └── TooltipContext.tsx          # Cursor tooltip state
│   ├── lib/
│   │   ├── services/                  # Strategy pattern: KV vs Local
│   │   │   ├── GameService.ts         # Interface
│   │   │   ├── LocalGameService.ts    # JSON file persistence
│   │   │   ├── KVGameService.ts       # Vercel KV persistence
│   │   │   ├── CitizenService.ts      # Interface
│   │   │   ├── LocalCitizenService.ts
│   │   │   ├── KVCitizenService.ts
│   │   │   └── index.ts              # Auto-selects by env var
│   │   ├── types.ts                   # Server-side Game/Player types (still needed)
│   │   ├── logUtils.ts                # UTC log formatting
│   │   ├── utils.ts                   # cn() Tailwind merger
│   │   ├── game/                      # ⚠️ Legacy wrappers
│   │   │   ├── PhaseEngine.ts         # Phase advancement (stateful, 170 lines)
│   │   │   ├── BotAI.ts              # Bot orchestration (stateful, 714 lines)
│   │   │   └── ConflictResolver.ts    # 🗑️ DEAD CODE — zero importers
│   │   └── modules/                   # ⭐ Pure game engine
│   │       ├── core/                  # Types + constants
│   │       ├── phase/                 # Phase state machine
│   │       ├── distribution/          # Actor placement
│   │       ├── conflict/              # Conflict detection + resolution
│   │       ├── actions/               # Action cards + events
│   │       ├── resources/             # VP + rewards
│   │       ├── market/                # Card purchasing
│   │       ├── player/               # Player identity
│   │       └── bot/                   # Bot decision functions
│   ├── data/
│   │   ├── gameConstants.ts           # ⚠️ Deprecated shim (10 importers remain)
│   │   └── getConflicts.ts            # 🗑️ Dead code
│   └── public/                        # Static assets (actors, events, etc.)
```

---

## Module Architecture

Pure-function engine with no React dependencies. ~1400 total lines across 9 modules.

| Module | Files | Key Exports | Status |
|---|---|---|---|
| **core** | `types.ts`, `constants.ts` | `LOCATIONS`, `ACTORS`, `ALLOWED_MOVES`, `EVENTS`, `ACTION_CARDS`, `rpsOutcome()` | ✅ Complete |
| **phase** | `phaseEngine.ts` | `advancePhase()`, `getMaxTurns()` | ✅ Complete (but unused — legacy wrapper used instead) |
| **distribution** | `placementLogic.ts` | `isValidPlacement()`, `createPlacedActor()`, `getAvailableArguments()`, `recallActor()` | ✅ Complete |
| **conflict** | `conflictDetector.ts`, `conflictResolver.ts` | `detectConflicts()`, `resolveConflictLogic()` | ✅ Complete (DRY issues) |
| **actions** | `actionCardLogic.ts`, `eventLogic.ts` | `getFilteredCards()`, `relocateActor()`, `pickRandomEvent()`, `resolveCompareEvent()` | ✅ Complete (impure RNG) |
| **resources** | `resourceManager.ts` | `calculateVictoryPoints()`, `getActorRewardType()`, `calculatePhase4Rewards()` | ✅ Complete |
| **market** | `marketLogic.ts` | `canBuyActionCard()`, `deductBuyCost()`, `pickRandomActionCard()` | ✅ Complete (impure RNG) |
| **player** | `playerManager.ts` | `getLocalPlayerId()`, `buildPlayerList()`, `initOpponentData()` | ✅ Complete |
| **bot** | `botAI.ts` | `generateBotPlacements()`, `pickBotConflictChoice()` | ⚠️ Minimal (orphaned — legacy BotAI.ts used instead) |

---

## API Routes

| Method | Endpoint | Purpose | Status |
|---|---|---|---|
| GET/POST | `/api/citizen` | Citizen lookup/registration | ✅ Working |
| GET | `/api/admin/citizens` | Admin: list all citizens | ✅ Working (no auth) |
| PUT/DELETE | `/api/admin/citizens/[id]` | Admin: update/delete citizen | ✅ Working (no auth) |
| GET/POST | `/api/games` | List/create games | ✅ Working |
| GET/PUT | `/api/games/[id]` | Get/update game (fat PUT — handles join, sync, conflicts) | ✅ Working |
| POST | `/api/games/[id]/ready` | Toggle ready + start game | ✅ Working |
| POST | `/api/games/[id]/chat` | Send chat message | ✅ Working |
| PUT/DELETE/PATCH | `/api/admin/games/[id]` | Admin: manage games | ✅ Working (no auth) |
| GET/POST | `/api/games/[id]/logs` | Get/add session logs | ✅ Working |

---

## Service Layer

Clean strategy pattern auto-selects backend by environment:
- **Production:** `KVGameService` + `KVCitizenService` (Vercel KV)
- **Development:** `LocalGameService` + `LocalCitizenService` (JSON files)
- Selection: `process.env.KV_REST_API_URL` ? KV : Local

---

## State Management

### Global State (React Context — `GameStateContext`)

- Player identity (name, address, citizenId, avatar) — persisted to `localStorage`
- Resources (8 types)
- Lobby state (room, players, status)
- Games list (polled every 3s)
- Event deck state

### Local State (`useBoardSession` hook — 55 `useState` variables)

- Turn/Phase/Step tracking
- Placed actors, conflicts, disabled locations
- Action card hand, discard piles
- Opponent data (resources, inventories)
- Game-over / tie-breaker state
- All UI interaction state (selection, hovering, pending placements)

---

## Key Architecture Decisions

1. **Game engine is pure functions** — `frontend/lib/modules/` contains stateless pure functions. However, the legacy wrappers (`lib/game/`) are still the active callers in most cases.

2. **`useBoardSession` is the God Hook** — 2,797 lines, 55 state vars, 21 callbacks. This is the #1 refactoring target. It orchestrates ALL game logic, server sync, and bot AI.

3. **Board page is thin** — `game/board/[id]/page.tsx` is now ~483 lines (presentation only). The heavy lifting moved to `useBoardSession`.

4. **Legacy wrappers still active** — `PhaseEngine.ts` (170 lines) and `BotAI.ts` (714 lines) are dynamically imported by `useBoardSession`. They mutate React state directly via 15-18 passed setters. `ConflictResolver.ts` is dead code.

5. **Smart contracts exist but aren't connected** — `MetarchyGame.sol` and `MetarchyTokens.sol` implement commit-reveal and ERC-1155 but the frontend uses API routes only. wagmi/viem are in dependencies but unused server-side.

6. **Blockchain is chain-agnostic** — designed for any EVM chain. Target: Avalanche C-Chain.

7. **Game-First Priority** — Game must be fully playable without blockchain. Blockchain is a secondary verification layer.

8. **PvP uses polling** — 3-second interval `setInterval` polling to `/api/games/{id}`. No WebSockets yet.

9. **Service strategy pattern** — Vercel KV for production, local JSON for dev. Clean interface separation.

---

## Module Audit Scorecard

| Module | Complete? | Well-Typed? | Pure? | Active? | Issues |
|---|---|---|---|---|---|
| **core** | ✅ | ⚠️ (`any` in GameTransaction) | ✅ | ✅ | Revolution event, avatar typo |
| **phase** | ✅ | ✅ | ✅ | ❌ (legacy wrapper used) | Dead code in Turn 1 skip |
| **distribution** | ✅ | ✅ | ✅ | ✅ | None |
| **conflict** | ✅ | ⚠️ (local types) | ✅ | ✅ | DRY violation (duplicate RPS) |
| **actions** | ✅ | ⚠️ (`as any`) | ❌ (Math.random) | ✅ | Impure RNG, unexported types |
| **resources** | ✅ | ⚠️ (`as any`) | ✅ | ✅ | Missing export, no addResources |
| **market** | ✅ | ✅ | ❌ (Math.random) | ✅ | Naming inconsistency, no deck tracking |
| **player** | ✅ | ⚠️ (`any[]`) | ✅ | ✅ | Dead import, fragile filter |
| **bot** | ⚠️ Minimal | ✅ | ❌ (Math.random) | ❌ (legacy BotAI.ts used) | No strategy, orphaned |

### UI Component Completeness

| Area | Rating | Notes |
|---|---|---|
| **Game Components** | 95% | All gameplay mechanics have UI. 3 superseded components remain. |
| **Phase Flow** | 100% | All 5 phases have dedicated phase orchestrator components. |
| **Pages / Routes** | 80% | Core flow works. Several legacy/mockup pages remain. |
| **Context / State** | 90% | Functional. Tooltip provider placement is fragile. |
| **Design System** | 30% | Only 1 generic UI component (`CursorTooltip`). No shared primitives. |
| **Type Safety** | 70% | Interfaces exist but many `any` types remain. |

---

## Refactoring Priorities

### High Priority

1. **Split `useBoardSession`** into domain-specific hooks:
   - `useEventPhase`
   - `usePlacementPhase`
   - `useActionPhase`
   - `useConflictPhase`
   - `useMarketPhase`
   - `useServerSync`

2. **Migrate to pure modules** — Replace `PhaseEngine.ts` and `BotAI.ts` with pure module functions

3. **Type safety** — Remove all `any` types, add proper indexed types

### Medium Priority

4. **Dead code removal** — Delete `ConflictResolver.ts`, `getConflicts.ts`, superseded components
5. **Consolidate constants** — Migrate all imports from `gameConstants.ts` to `@/lib/modules/core`
6. **Add missing helpers** — `addResources()`, export missing types

### Low Priority

7. **Inject RNG** — Make random functions deterministic for replay
8. **Card categorization** — Add `category` enum instead of string matching
9. **DRY violations** — Consolidate duplicate RPS logic

---

## Performance Considerations

- **Polling overhead:** 3-second polling creates unnecessary network traffic
- **State updates:** 55 state variables in one hook causes excessive re-renders
- **No memoization:** Components re-render unnecessarily
- **No lazy loading:** All game components loaded upfront

**Recommendations:**
- Replace polling with WebSockets
- Split state into smaller contexts
- Add `React.memo` to expensive components
- Lazy load phase components