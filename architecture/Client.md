# Client

> `apps/client` — one TypeScript SPA serving all three platforms: browser (first-class),
> iOS and Android via Capacitor shells. Vite + React 18, PixiJS 8 for the board scene,
> Framer Motion for UI, zustand for state.

---

## 1. Architecture in One Paragraph

The client is a **renderer of `PlayerView` plus an intent sender**. It holds no
authoritative game logic: the server streams visibility-filtered engine events, the
client folds them into a local `PlayerView` copy and an animation queue, and renders.
`@metarchy/engine` is imported client-side only for *affordances* — `legalIntents`
drives what is clickable, and staging validation (e.g. "this argument is already used")
gives instant feedback before the server round-trip. If client and server ever disagree,
the server's `game.sync` wins unconditionally.

## 2. Rendering Layers

| Layer | Technology | Contents |
|---|---|---|
| Board scene | PixiJS 8 canvas | map, 6 locations, actor sprites, drag-and-drop placement, conflict arena animations, disabled-location states |
| UI chrome | React DOM + Framer Motion | lobby, panels (resources, players, cards), modals (event, market, exchange, conflict results), radial RPS/bet menus, timers |
| Bridge | thin React↔Pixi adapter | Pixi scene subscribes to zustand stores; input events dispatch the same actions as DOM |

The cyberpunk design language, screen inventory, and PNG asset manifest from the
prototype remain valid references (`architecture/legacy/UI-System.md`); art assets are
reused, code is not.

## 3. State Stores (zustand)

- `session` — auth state, profile, socket status
- `lobbyStore` — queue status, private-game lobby
- `gameStore` — current `PlayerView`, event cursor (`seq`), deadlines
- `animQueue` — ordered presentation effects derived from engine events; gameplay state
  updates immediately, presentation catches up (reveals, conflict rounds, reward flights)
- `uiStore` — selections, staged placements, open modals

Staged (not yet committed) placements/choices exist **only** in `uiStore` until the
player hits the commit button — mirroring the sealed-bid UX from the design docs.

## 4. Screen Flow

```
Auth (email / Google / Apple)
  → Home (Play: ranked queue | private game | vs bots · Profile · Leaderboard)
    → Queue / Lobby (invite code, ready checks)
      → Board  [P1 Event → P2 Distribution → P3 Action steps → P4 Conflicts → P5 Market]
        → Game Over (results, rating change, rematch)
```

Board phase UIs follow the interaction scripts already written in
`docs/metarchy-rules.md` (Phase Flow section) — confirm buttons, "WAITING FOR OTHERS…",
sequential conflict resolution, tie-breaker modals.

## 5. Networking

- One WebSocket (protocol in `@metarchy/protocol`), auto-reconnect with
  `resume { gameId, lastEventSeq }`; heartbeat ping keeps mobile webview sockets alive.
- Server deadlines rendered from `deadline` messages against server clock offset.
- REST/PostgREST used only for public reads (leaderboard, profile) — everything
  game-related is WS.

## 6. Capacitor Shells

| Concern | Approach |
|---|---|
| Packaging | `apps/client` builds once; `ios/` and `android/` Capacitor projects wrap the same bundle |
| Sign-in | Supabase OAuth with deep-link redirect; native Sign in with Apple / Google plugins where required (Apple review requires Sign in with Apple when third-party logins are offered — satisfied) |
| Push notifications | APNs / FCM via `@capacitor/push-notifications`: "match found", "your turn", "opponent moved" (server sends through a push service worker) |
| Platform polish | safe-area insets, haptics on conflict reveal, keep-awake during active game, landscape-first board layout |
| Updates | web deploys instantly; mobile binaries through the stores (game logic lives server-side, so most changes don't require store releases) |

## 7. Performance Notes

Turn-based 2D board: no real constraints. Pixi renders the scene at 60fps on low-end
Android webviews; the SPA bundle target is a few MB (asset lazy-loading for location
closeups and card art). Initial load in browser must stay "click link → playing in
seconds" — that requirement drove the engine-less web stack choice.

## 8. Testing

- Component tests (vitest + testing-library) for UI logic
- Playwright e2e: 2–3 browser contexts play a full PvP game against the real server
  (the same suite CI runs); screenshot assertions on key screens
- Manual device passes on iOS/Android before store submissions
