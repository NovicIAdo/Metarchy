// Game state store: the server's PlayerView plus connection-side metadata.
// The client folds nothing by hand in the MVP — every event burst triggers a
// debounced resync, and game.sync always wins (architecture/Client.md §1).

import type { PlayerView, SeatId, Values } from '@metarchy/engine'
import type { LobbyPlayer, PlayerSummary, RankedMode, TeamStaging } from '@metarchy/protocol'
import { create } from 'zustand'

export interface ActiveGameRef {
  gameId: string
  mode: string
  seat: SeatId
  status: 'lobby' | 'active'
}

export interface LobbyState {
  gameId: string
  mode: string
  players: LobbyPlayer[]
  seatsTotal: number
}

export interface DeadlineState {
  phaseRef: string
  endsAt: number | null
}

export interface PresenceState {
  seat: SeatId
  connected: boolean
  graceEndsAt: number | null
}

export interface GameOverState {
  winnerSeats: SeatId[]
  /** values absent on games finished before the engine started attaching them. */
  ranking: { seats: SeatId[]; vp: number; values?: Values }[]
}

/** Set while waiting in the matchmaking queue; cleared on match.found or leave. */
export interface QueueState {
  mode: RankedMode
  position: number
  widenedRange: boolean
  /** Seats this mode needs, so the panel can read "2 of 3". */
  seats: number
  /** The other humans already waiting for this mode (author: "кто уже найден"). */
  found: { nickname: string; avatar: string | null }[]
  /** Server-clock epoch ms when a bot fills the empty seats; null = never. */
  botAt: number | null
}

/** Set while watching someone else's ranked game (a spectator has no seat). */
export interface SpectatingState {
  gameId: string
  mode: string
}

/** Who is watching the current game — shown to players and to spectators. */
export interface WatchersState {
  count: number
  names: string[]
}

/** One team-chat line. History is tab-local — the server relays and forgets. */
export interface ChatEntry {
  id: number
  fromSeat: SeatId
  text: string
}

/** A finished ranked game's GATO payout (server rewards.ts), post-credit. */
export interface GatoRewardState {
  gameId: string
  amount: number
  balance: number
}

/**
 * A cosmetic that fell out of a finished ranked game (server drops.ts). Shown on
 * the game-over screen beside the payout — a drop the player never sees announced
 * is indistinguishable from no drop at all.
 */
export interface LootDropState {
  gameId: string
  itemId: string
}

/** The 2v2 ally's live pre-commit staging, as last relayed by the server. */
export interface AllyStagingState {
  fromSeat: SeatId
  staging: TeamStaging
}

const CHAT_HISTORY_MAX = 200
let nextChatId = 1

interface GameStore {
  activeGame: ActiveGameRef | null
  lobby: LobbyState | null
  view: PlayerView | null
  lastEventSeq: number
  players: PlayerSummary[]
  deadline: DeadlineState | null
  presence: Partial<Record<SeatId, PresenceState>>
  gameOver: GameOverState | null
  inviteCode: string | null
  chat: ChatEntry[]
  chatOpen: boolean
  /** Messages that arrived while the panel was closed. */
  chatUnread: number
  /** Queue state is not game-scoped: resetGame() must not clear it. */
  queue: QueueState | null
  /** Non-null while this tab is watching a ranked game as a spectator. */
  spectating: SpectatingState | null
  /** Watcher roster of the current game (player or spectator context). */
  watchers: WatchersState | null
  /** What the 2v2 ally is staging right now (null = nothing / retracted). */
  allyStaging: AllyStagingState | null
  /** Ranked payout of the game just finished — shown on the game-over screen. */
  gatoReward: GatoRewardState | null
  /** Cosmetic drop of the game just finished — shown on the game-over screen. */
  lootDrop: LootDropState | null

  appendChat(fromSeat: SeatId, text: string): void
  setAllyStaging(payload: AllyStagingState | null): void
  setChatOpen(open: boolean): void
  setQueue(queue: QueueState | null): void
  setActiveGame(ref: ActiveGameRef | null): void
  setLobby(lobby: LobbyState | null): void
  setView(view: PlayerView, seq: number): void
  bumpEventSeq(seq: number): void
  setPlayers(players: PlayerSummary[]): void
  setDeadline(deadline: DeadlineState | null): void
  setPresence(presence: PresenceState): void
  setGameOver(outcome: GameOverState): void
  setInviteCode(code: string | null): void
  setSpectating(spectating: SpectatingState | null): void
  setWatchers(watchers: WatchersState | null): void
  setGatoReward(reward: GatoRewardState | null): void
  setLootDrop(drop: LootDropState | null): void
  resetGame(): void
}

export const useGameStore = create<GameStore>((set) => ({
  activeGame: null,
  lobby: null,
  view: null,
  lastEventSeq: 0,
  players: [],
  deadline: null,
  presence: {},
  gameOver: null,
  inviteCode: null,
  chat: [],
  chatOpen: false,
  chatUnread: 0,
  queue: null,
  gatoReward: null,
  lootDrop: null,
  spectating: null,
  watchers: null,
  allyStaging: null,

  // A 'clear' collapses to null — consumers never need to branch on it.
  setAllyStaging: (payload) =>
    set({ allyStaging: payload && payload.staging.kind !== 'clear' ? payload : null }),
  appendChat: (fromSeat, text) =>
    set((s) => ({
      chat: [...s.chat, { id: nextChatId++, fromSeat, text }].slice(-CHAT_HISTORY_MAX),
      chatUnread: s.chatOpen ? 0 : s.chatUnread + 1
    })),
  setChatOpen: (chatOpen) => set((s) => ({ chatOpen, chatUnread: chatOpen ? 0 : s.chatUnread })),
  setQueue: (queue) => set({ queue }),
  setActiveGame: (activeGame) => set({ activeGame }),
  setLobby: (lobby) => set({ lobby }),
  setView: (view, seq) => set((s) => ({ view, lastEventSeq: Math.max(s.lastEventSeq, seq) })),
  bumpEventSeq: (seq) => set((s) => ({ lastEventSeq: Math.max(s.lastEventSeq, seq) })),
  setPlayers: (players) => set({ players }),
  setDeadline: (deadline) => set({ deadline }),
  setPresence: (presence) =>
    set((s) => ({ presence: { ...s.presence, [presence.seat]: presence } })),
  setGameOver: (gameOver) => set({ gameOver }),
  setInviteCode: (inviteCode) => set({ inviteCode }),
  setSpectating: (spectating) => set({ spectating }),
  setWatchers: (watchers) => set({ watchers }),
  setGatoReward: (gatoReward) => set({ gatoReward }),
  setLootDrop: (lootDrop) => set({ lootDrop }),
  resetGame: () =>
    set({
      activeGame: null,
      lobby: null,
      view: null,
      lastEventSeq: 0,
      players: [],
      deadline: null,
      presence: {},
      gameOver: null,
      inviteCode: null,
      chat: [],
      chatOpen: false,
      chatUnread: 0,
      spectating: null,
      watchers: null,
      allyStaging: null,
      gatoReward: null,
      lootDrop: null
    })
}))
