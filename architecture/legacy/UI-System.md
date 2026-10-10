# Metarchy — UI System

This document describes the visual design system, component hierarchy, screen flows, and asset pipeline of the Metarchy frontend.

---

## Design Language

| Aspect | Specification |
|---|---|
| **Aesthetic** | Cyberpunk dystopia — dark backgrounds, golden/amber accents |
| **Typography** | System fonts via Tailwind; uppercase headers for game UI |
| **Color palette** | Black (#000), dark grays, gold/amber accents, red for alerts, green for success |
| **Animations** | Framer Motion — scale transitions, fade-ins, pulse effects |
| **Icons** | Lucide React (UI), custom PNG sprites (game assets) |
| **Layout** | Full-viewport game board; sidebar panels; modal overlays |
| **Styling** | Tailwind CSS with `cn()` utility (`clsx` + `tailwind-merge`) |

---

## Screen Flow

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Landing    │─────▶│  Onboarding  │─────▶│    Lobby     │
│  (page.tsx)  │      │   Modal      │      │  (page.tsx)  │
└──────────────┘      └──────────────┘      └──────┬───────┘
                                                    │
                           ┌────────────────────────┼────────────────────┐
                           ▼                        ▼                    ▼
                    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
                    │ Create Game  │      │  Join Game   │      │  Dashboard   │
                    │(game/create) │      │ (game/join)  │      │ (dashboard)  │
                    └──────┬───────┘      └──────┬───────┘      └──────────────┘
                           │                     │
                           ▼                     ▼
                    ┌──────────────┐      ┌──────────────┐
                    │   Waiting    │◀────▶│    Lobby     │
                    │(game/waiting)│      │ (game/lobby) │
                    └──────┬───────┘      └──────────────┘
                           │
                           ▼
                    ┌──────────────────────────────────────┐
                    │         GAME BOARD                    │
                    │     (game/board/[id])                 │
                    │                                      │
                    │  Phase 1: Event                      │
                    │  Phase 2: Distribution (place actors)│
                    │  Phase 3: Action Cards (4 steps)     │
                    │  Phase 4: Conflict Resolution        │
                    │  Phase 5: Market                     │
                    │                                      │
                    │  → Loop until game over              │
                    └──────────────┬───────────────────────┘
                                   │
                                   ▼
                            ┌──────────────┐
                            │  Game Over   │
                            │  (VP screen) │
                            └──────────────┘
```

### Admin Flow (separate)
```
/admin          → Admin dashboard (tabs: Games, Citizens)
/admin/games    → Game session management (view, delete, restore)
/admin/citizens → Citizen records (view, edit, delete)
```

---

## Core Components

### Layout & Navigation

| Component | File | Purpose |
|---|---|---|
| `TopBar` | `components/TopBar.tsx` | Global navigation bar |
| `ProfileWidget` | `components/ProfileWidget.tsx` | Player identity display (name, avatar, citizenId) |
| `OnboardingModal` | `components/OnboardingModal.tsx` | First-time player setup (face detection, name) |
| `WindowFrame` | `components/WindowFrame.tsx` | Reusable styled container frame |
| `CompactFrame` | `components/CompactFrame.tsx` | Compact version of WindowFrame |
| `MetarchyButton` | `components/MetarchyButton.tsx` | Styled game button |
| `CitizenIdCard` | `components/CitizenIdCard.tsx` | ID card display for citizens |
| `ConnectWalletFrame` | `components/ConnectWalletFrame.tsx` | Web3 wallet connection UI |
| `WelcomeCitizenFrame` | `components/WelcomeCitizenFrame.tsx` | Post-registration welcome screen |

### Game Board Components

| Component | File | Purpose |
|---|---|---|
| `MapContainer` | `game/MapContainer.tsx` | Hex map with drag-to-move, zoom (1.6x on action), location rendering |
| `PlacedActorMarker` | `game/PlacedActorMarker.tsx` | Actor sprite positioned on map (drag source for placement) |
| `OtherPlayerActorMarker` | `game/OtherPlayerActorMarker.tsx` | Opponent actor sprites (revealed in Phase 3+) |
| `ActorOrb` | `game/ActorOrb.tsx` | Circular actor icon with state indicators |
| `GameHeader` | `game/GameHeader.tsx` | SVG top bar: Turn number, Phase number, Phase name |
| `GameHUD` | `components/GameHUD.tsx` | Heads-up display overlay |
| `TurnControls` | `game/TurnControls.tsx` | Turn/Phase status + "Next Phase" navigation |
| `GameLog` | `game/GameLog.tsx` | Scrolling action log stream |
| `GameResources` | `game/GameResources.tsx` | Resource/Value display bar |

### Phase-Specific Components

| Component | File | Phase | Purpose |
|---|---|---|---|
| `ActorsPanel` | `game/ActorsPanel.tsx` | 2 | Actor selection sidebar for placement |
| `NewPlayersPanel` | `game/NewPlayersPanel.tsx` | 2 | Shows other players joining |
| `ResourcesPanel` | `game/ResourcesPanel.tsx` | 2 | Resource inventory for bet assignment |
| `ActionCardsPanel` | `game/ActionCardsPanel.tsx` | 3 | Carousel of owned Action Cards (filtered by step) |
| `BuyActionCardModal` | `game/BuyActionCardModal.tsx` | 5 | Market purchase confirmation |
| `ConflictResolutionView` | `game/ConflictResolutionView.tsx` | 4 | Full-screen RPS battle arena |
| `ConflictsSidebar` | `game/ConflictsSidebar.tsx` | 4 | List of pending/resolved conflicts |
| `RSPRadialMenu` | `game/RSPRadialMenu.tsx` | 4 | Radial Rock/Paper/Scissors selector |
| `PlayersPanel` | `game/PlayersPanel.tsx` | All | Player list with status indicators |
| `ExchangeModal` | `game/ExchangeModal.tsx` | 3.4 | Value exchange interface |
| `MarketOfferModal` | `game/MarketOfferModal.tsx` | 5 | Market trading interface |
| `MarketRevealModal` | `game/MarketRevealModal.tsx` | 5 | Reveals purchased card |

### Utility Components

| Component | File | Purpose |
|---|---|---|
| `CursorTooltip` | `ui/CursorTooltip.tsx` | Mouse-following tooltip (via TooltipContext) |

---

## Asset System

All game assets are static PNGs in `public/`. Paths are centralized in `data/assetManifest.ts`.

### Asset Manifests

**Location closeups** (`LOCATION_IMAGES`):
```
square    → /Locations closeups/Square.png
theatre   → /Locations closeups/Teatre.png
university→ /Locations closeups/University.png
factory   → /Locations closeups/Factory.png
energy    → /Locations closeups/Energy station.png
dump      → /Locations closeups/Dump.png
```

**RPS tokens** (`RSP_ICONS`):
```
rock     → /tokens/rsp_rock.png
paper    → /tokens/rsp_paper.png
scissors → /tokens/rsp_scissors.png
```

**Resource icons** (`RESOURCE_ICONS`):
```
glory    → /intangibles/resource_Glory.png
power    → /intangibles/resource_power.png
art      → /intangibles/resource_Art.png
knowledge→ /intangibles/resource_wisdom.png
product  → /resources/resource_product.png
energy   → /resources/resource_energy.png
recycle  → /resources/resource_Recycle.png
```

**Bid icons** (`BID_ICONS`):
```
product → /resources/resource_box.png     (Win Bid)
energy  → /resources/resource_energy.png  (Lose Bid)
recycle → /resources/resource_bio.png     (Draw Bid)
```

**Actor sprites** (`ACTOR_IMAGES` + `ACTOR_TYPES` in constants):
```
politician → /actors/Polotican.png       (head: Politican_head.png)
robot      → /actors/Robot.png           (head: Robot_head.png)
scientist  → /actors/Scientist.png       (head: Scientist_head.png)
artist     → /actors/Artist.png          (head: Artist_head.png)
```

### Asset Directories

| Directory | Contents |
|---|---|
| `public/actions/` | Action Card artwork (520px, borderless) |
| `public/actors/` | Actor full sprites + head portraits |
| `public/avatars/` | Player avatar images |
| `public/backgrounds/` | Screen background images |
| `public/events/` | Event Card artwork |
| `public/intangibles/` | Value icons (Power, Art, Knowledge, Glory) |
| `public/locations/` | Location sprites + hint overlays + active overlays |
| `public/Locations closeups/` | Location closeup images (for conflict backdrops) |
| `public/map/` | Base hex map image |
| `public/models/` | Face detection model (tiny_face_detector) |
| `public/resources/` | Material resource icons |
| `public/tokens/` | RPS token icons |

---

## Map System

The game board is a **hex-based map** rendered in `MapContainer.tsx`:

- **Base image:** `/map/map.png` (1880×776 px canvas)
- **Navigation:** Drag-to-move (mouse/touch), constrained within bounds
- **Zoom:** Automatic 1.6x zoom during action phases (actor placement)
- **Location markers:** Each location has (x, y) coordinates and (width, height) for hit areas
- **Actor placement:** `PlacedActorMarker` components positioned absolutely over locations
- **Hint system:** Locations show hint overlays when hovered, active overlays when selected
- **Disabled state:** Grayscale desaturation for blocked locations (via Action Cards)

### Location Coordinates (from `LOCATIONS` constant)

| Location | x | y | Size |
|---|---|---|---|
| City | 581 | 178 | 718×598 |
| Square | 156 | 215 | 718×598 |
| Theatre | 355 | 491 | 718×598 |
| University | 384 | -17 | 718×598 |
| Factory | 823 | 464 | 718×598 |
| Energy Station | 780 | 6 | 718×598 |
| Dump | 1015 | 229 | 718×598 |

---

## Conflict Resolution UI

The `ConflictResolutionView` is a full-screen battle arena:

1. **Setup:** Shows two actors face-to-face with location-specific dynamic backdrop
2. **Choice:** Player selects Rock/Paper/Scissors via `RSPRadialMenu`
3. **Reveal:** Animated "VS" sequence, both choices shown simultaneously
4. **Result:** Win/Lose/Draw with visual effects:
   - Winner: gold glow + resource reward animation
   - Loser: red tint + fade out
   - Draw: depends on actor type (re-fight for Politicians, shared win for Scientists, etc.)
5. **Bet resolution:** Shows if bet was successful/failed, resource consumed

### Re-fight Flow (Politician Draw or Electricity Bet)
```
Draw detected → "Re-fight!" prompt → new RPS selection → reveal → repeat until Win/Lose
```

---

## Action Cards UI

`ActionCardsPanel` displays cards in a horizontal carousel:

- **Idle state:** Compact view showing owned card count
- **Active state:** Expanded carousel with swipe navigation
- **Card design:** 520px borderless artwork, golden flavor text plate, centered typography
- **Filtering:** Cards auto-filter by current Phase 3 step (block → relocate → exchange)
- **Opponent view:** Shows card counts for other players (not card details)

---

## Context & State

### GameStateContext (Global)
```typescript
{
    resources: { gato, product, energy, recycle, power, art, knowledge, glory },
    player: { name, address, citizenId, avatar },
    lobby: { id, roomName, maxPlayers, players, status },
    games: Game[],           // Polled every 3s from /api/games
    // + setters and actions (createRoom, joinRoom, leaveRoom)
}
```

### TooltipContext
```typescript
{
    tooltip: { text: string; x: number; y: number } | null,
    showTooltip(text, x, y): void,
    hideTooltip(): void,
}
```

### Board Page Local State
The main game board (`game/board/[id]/page.tsx`, ~1500 lines) manages all game state locally via `useState`:
- Turn/Phase/Step tracking
- Placed actors array
- Conflicts array
- Disabled locations
- Player action card hand
- Opponent data (resources, cards)
- Game log entries
- Various UI flags (modals, selections, animations)

> **Note:** This is identified as a refactoring target. The plan is to extract state into a dedicated game context or state machine.

---

## Responsive & Interaction Patterns

| Pattern | Implementation |
|---|---|
| **Drag to place actors** | Actors dragged from sidebar onto map locations |
| **Drag to navigate map** | Click-and-drag moves the map viewport |
| **Click to select** | Click locations to select for placement; click actors for actions |
| **Modal overlays** | Market, Exchange, Buy Card — centered modal with backdrop blur |
| **Tooltip on hover** | Cursor-following tooltip via `TooltipContext` + `CursorTooltip` |
| **Phase dots** | Visual indicator showing current phase (5 dots in GameHeader) |
| **Auto-advance gating** | Phase 4 requires manual "Next" to give time for conflict review |
| **Log stream** | Chronological action log, auto-scrolling, UTC-timestamped |

---

## Providers Hierarchy

```tsx
// app/layout.tsx
<html>
  <body>
    <Providers>          {/* app/providers.tsx */}
      <GameStateProvider> {/* context/GameStateContext.tsx */}
        {children}        {/* All pages */}
      </GameStateProvider>
    </Providers>
  </body>
</html>
```

Web3 providers (RainbowKit/wagmi) are defined but wallet connection is optional — the app supports Guest mode with generated addresses.
