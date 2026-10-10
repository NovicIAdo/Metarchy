# Metarchy — Architecture

## High-Level Overview

```
┌──────────────────────────────────────────────────────────┐
│                       FRONTEND                           │
│   Next.js 14 (App Router) + React 18 + Tailwind CSS     │
│   ┌───────────┐ ┌────────────┐ ┌──────────────────────┐ │
│   │   Pages    │ │ Components │ │    Game Logic         │ │
│   │ (app/)     │ │ (components│ │ (lib/modules/)        │ │
│   │           │ │  /game/)   │ │   Pure functions      │ │
│   └───────────┘ └────────────┘ └──────────────────────┘ │
│   ┌───────────┐ ┌────────────┐ ┌──────────────────────┐ │
│   │ Context   │ │  API Routes│ │  Services (JSON I/O) │ │
│   │ (context/)│ │ (app/api/) │ │ (lib/*Service.ts)    │ │
│   └───────────┘ └────────────┘ └──────────────────────┘ │
└──────────────────────────────────────────────────────────┘
                          │
                     JSON files
                  (data/games.json,
                   data/citizens.json)
                          │
┌──────────────────────────────────────────────────────────┐
│                    SMART CONTRACTS                        │
│              Solidity ^0.8.20 (Foundry)                  │
│   ┌──────────────────┐  ┌──────────────────────────────┐ │
│   │ MetarchyTokens   │  │      MetarchyGame            │ │
│   │ (ERC-1155)       │  │ (Session + Commit-Reveal)    │ │
│   └──────────────────┘  └──────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | Next.js 14 (App Router) | SSR, routing, API routes |
| **UI** | React 18, Tailwind CSS, Framer Motion | Components, styling, animations |
| **Icons** | Lucide React | UI iconography |
| **Web3** | RainbowKit 2.0, wagmi 2.5, viem 2.7 | Wallet connection, chain interaction |
| **State** | React Context (`GameStateContext`) | Global player/lobby/resource state |
| **Persistence** | JSON files (server-side fs) | Game sessions, citizen records |
| **Contracts** | Solidity ^0.8.20, OpenZeppelin | ERC-1155 tokens, game logic |
| **Build** | Docker & Docker Compose | Containerized deployment |
| **Type System** | TypeScript 5 | End-to-end type safety |

## Directory Structure

```
Meta_scratch/
├── contracts/
│   └── src/
│       ├── MetarchyGame.sol         # Game session + commit-reveal
│       └── MetarchyTokens.sol       # ERC-1155 token contract
├── docs/                            # Game design documentation
├── frontend/
│   ├── app/                         # Next.js App Router pages
│   │   ├── page.tsx                 # Landing / Lobby
│   │   ├── providers.tsx            # React context providers
│   │   ├── admin/                   # Admin dashboard (games, citizens)
│   │   ├── api/                     # REST API routes (JSON CRUD)
│   │   │   ├── games/               # GET/POST/PUT/DELETE games
│   │   │   ├── admin/               # Admin-specific endpoints
│   │   │   └── citizen/             # Citizen management
│   │   ├── dashboard/               # Player dashboard
│   │   └── game/                    # Game screens
│   │       ├── create/              # Create game session
│   │       ├── lobby/               # Pre-game lobby
│   │       ├── board/[id]/          # Main game board (dynamic route)
│   │       ├── actors/              # Actor selection
│   │       ├── event/               # Event phase UI
│   │       ├── join/                # Join game via invite
│   │       ├── loading/             # Loading screen
│   │       └── waiting/             # Waiting room
│   ├── components/
│   │   ├── game/                    # Game-specific components
│   │   │   ├── MapContainer.tsx     # Hex map with drag/zoom
│   │   │   ├── ConflictResolutionView.tsx  # RPS battle arena
│   │   │   ├── ActionCardsPanel.tsx # Action cards carousel
│   │   │   ├── ActorsPanel.tsx      # Actor selection sidebar
│   │   │   ├── ResourcesPanel.tsx   # Resource display
│   │   │   ├── PlayersPanel.tsx     # Player list
│   │   │   ├── GameHeader.tsx       # Turn/Phase indicator
│   │   │   ├── TurnControls.tsx     # Phase navigation
│   │   │   ├── ConflictsSidebar.tsx # Conflict tracking
│   │   │   ├── GameLog.tsx          # Action log stream
│   │   │   ├── ExchangeModal.tsx    # Value exchange UI
│   │   │   ├── MarketOfferModal.tsx # Market trading
│   │   │   └── ...
│   │   └── ui/                      # Generic UI components
│   ├── context/
│   │   ├── GameStateContext.tsx      # Global state (resources, player, lobby)
│   │   └── TooltipContext.tsx        # Cursor tooltip state
│   ├── data/
│   │   ├── gameConstants.ts         # Re-exports from modules/core
│   │   ├── assetManifest.ts         # Image path mappings
│   │   ├── getConflicts.ts          # Legacy conflict helper
│   │   ├── games.json               # Persisted game sessions
│   │   └── citizens.json            # Persisted citizen records
│   ├── lib/
│   │   ├── types.ts                 # Legacy API types (Game, Player)
│   │   ├── gameService.ts           # Server-side game CRUD (fs-based)
│   │   ├── citizenService.ts        # Server-side citizen CRUD (fs-based)
│   │   ├── logUtils.ts              # Log formatting utilities
│   │   ├── utils.ts                 # cn() - Tailwind class merger
│   │   ├── game/                    # Legacy wrappers (being migrated)
│   │   │   ├── PhaseEngine.ts       # Phase advancement (React setState)
│   │   │   ├── ConflictResolver.ts  # Conflict resolution wrapper
│   │   │   └── BotAI.ts             # Bot AI (stateful, setTimeout)
│   │   └── modules/                 # ⭐ Modular pure-function engine
│   │       ├── core/                # Types + constants (source of truth)
│   │       ├── actions/             # Action cards + events logic
│   │       ├── bot/                 # Bot AI decision functions
│   │       ├── conflict/            # Conflict detection + resolution
│   │       ├── distribution/        # Actor placement validation
│   │       ├── market/              # Market buying logic
│   │       ├── phase/               # Phase state machine
│   │       ├── player/              # Player identity + sync
│   │       └── resources/           # VP calculation + rewards
│   └── public/                      # Static assets
│       ├── actions/                 # Action card artwork
│       ├── actors/                  # Actor sprites
│       ├── avatars/                 # Player avatars
│       ├── backgrounds/             # Screen backgrounds
│       ├── events/                  # Event card artwork
│       ├── locations/               # Location sprites
│       ├── map/                     # Hex map base
│       ├── resources/               # Resource icons
│       └── tokens/                  # RPS token icons
```

## Module Architecture (`lib/modules/`)

The game engine is built as a set of pure-function modules with no React dependencies. Each module follows the pattern:

```
modules/{domain}/
├── {logic}.ts     # Pure functions (no side effects)
└── index.ts       # Public API barrel export
```

| Module | Responsibility | Key Exports |
|---|---|---|
| **core** | Types, constants, RPS matrix | `LOCATIONS`, `ACTORS`, `ALLOWED_MOVES`, `rpsOutcome()` |
| **phase** | Phase state machine | `advancePhase()`, `getMaxTurns()` |
| **distribution** | Actor placement validation | `isValidPlacement()`, `createPlacedActor()`, `getAvailableArguments()` |
| **conflict** | Conflict detection + resolution | `detectConflicts()`, `resolveConflictLogic()` |
| **actions** | Action cards + event cards | `getFilteredCards()`, `relocateActor()`, `resolveCompareEvent()` |
| **resources** | VP calculation, rewards | `calculateVictoryPoints()`, `getActorRewardType()`, `calculatePhase4Rewards()` |
| **market** | Action card purchasing | `canBuyActionCard()`, `deductBuyCost()`, `pickRandomActionCard()` |
| **player** | Player identity, bot setup | `getLocalPlayerId()`, `buildPlayerList()`, `initOpponentData()` |
| **bot** | Bot decision-making | `generateBotPlacements()`, `pickBotConflictChoice()` |

## Data Flow

### Game Session Lifecycle

```
1. Landing Page (page.tsx)
   └─ Guest login or wallet connect
       └─ Player identity stored in GameStateContext

2. Create/Join Game
   └─ POST /api/games → creates game in games.json
   └─ PUT /api/games/{id} → joins existing game
       └─ Lobby state synced via polling (3s interval)

3. Game Board (game/board/[id]/page.tsx)
   └─ Fetches game from API
   └─ Initializes local game state (massive useState block)
   └─ Phase loop: Distribution → Action → Conflict → Market → next Turn
       └─ Bot players act via setTimeout-based async simulation

4. Game Over
   └─ VP calculated via calculateVictoryPoints()
   └─ Winner displayed, return to lobby
```

### State Management

**Global** (React Context — `GameStateContext`):
- Player identity (name, address, citizenId, avatar)
- Resources (gato, product, energy, recycle, power, art, knowledge, glory)
- Lobby state (room, players, status)
- Games list (polled from API every 3s)

**Local** (Board page `useState`):
- Turn/Phase/Step tracking (`TurnState`)
- Placed actors array (`PlacedActor[]`)
- Conflicts array (`Conflict[]`)
- Disabled locations
- Action card hand
- Opponent data (resources, cards)
- Game log

## API Routes

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/games` | List all games |
| POST | `/api/games` | Create new game |
| GET | `/api/games/{id}` | Get game by ID |
| PUT | `/api/games/{id}` | Join game / update state |
| DELETE | `/api/games/{id}` | Soft-delete game |
| GET | `/api/admin/games` | Admin: list all games |
| DELETE | `/api/admin/games` | Admin: bulk delete |
| GET | `/api/admin/citizens` | Admin: list citizens |
| POST | `/api/citizen` | Register/update citizen |

## Blockchain Agnostic Design

The game is designed to be **blockchain-agnostic**, meaning the core loop and mechanics are independent of the specific underlying chain.

### Blockchain as "Source of Proof"
The blockchain is NOT used for real-time state storage. Instead, it serves as a **verification layer**:
1. **State Assertions**: At key checkpoints (e.g., end of Distribution phase), the "Game Server" (or authoritative layer) commits hashes of the state to the blockchain.
2. **Cheat Prevention**: By using the Commit-Reveal pattern on-chain, hidden information (like RPS arguments) can be proven genuine without being exposed prematurely.
3. **Decoupled Logic**: If the blockchain integration is removed or changed, the game remains fully functional in "Local Mode" or "Centralized Mode".

### Implementation Priority
1. **Functional Game Loop**: Complete all phases, action cards, and multiplayer sync using API routes and JSON persistence.
2. **Blockchain Layer**: Once the game is stable, implement `wagmi/viem` connectors to the pre-existing smart contracts to "anchor" game sessions to the chain.

## Smart Contracts

### MetarchyTokens (ERC-1155)
- Token IDs: Actors (0–3), Arguments (10–13), Resources (20–22), Values (30–33), Action Cards (40+)
- Minting/burning gated by `gameContract` address
- Standard ERC-1155 with OpenZeppelin base

### MetarchyGame
- Creates/joins game sessions
- Manages 6-phase state machine: EVENT → DISTRIBUTION → DISTRIBUTION_REVEAL → ACTION → CONFLICT → MARKET
- Implements commit-reveal scheme:
  1. Players submit `keccak256(gameId, turn, phase, moveData, salt)` hash
  2. After all commits, phase transitions to REVEAL
  3. Players reveal move data + salt; contract verifies hash
  4. After all reveals, phase auto-advances
- Mints initial 4 Actor tokens to each joining player

## Migration Status

The codebase is in active migration from monolithic patterns to modular architecture:

| Area | Status | Notes |
|---|---|---|
| `lib/modules/*` | ✅ Complete | Pure functions, well-typed |
| `lib/game/*` | ⚠️ Legacy wrappers | Thin wrappers delegating to modules |
| `game/board/[id]/page.tsx` | ⚠️ 1500+ lines | Still has inline logic, duplicated constants |
| `data/gameConstants.ts` | ⚠️ Deprecated | Re-exports from `modules/core` |
| Smart contracts ↔ Frontend | 🔲 Not connected | Contracts exist but frontend uses API routes + JSON |
