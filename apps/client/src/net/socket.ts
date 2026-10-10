// One WebSocket to the game server (architecture/Client.md §5): hello with the
// Supabase access token, auto-reconnect with resume{gameId,lastEventSeq},
// app-level heartbeat, request/response correlation via envelope seq. The MVP
// folds no events by hand: every event burst schedules a debounced game.resync,
// and game.sync always wins.

import type { SeatId } from '@metarchy/engine'
import type {
  AvatarId,
  ClientIntent,
  RankedMode,
  ReplayEntry,
  ServerMessage,
  ServerMessageOf,
  TeamStaging,
  WatchableGame,
  Wardrobe
} from '@metarchy/protocol'
// Persisted chat (global room + DMs) — kept in its own import so the two
// features touching this file at once do not fight over one list.
import type {
  ChatAuthorView,
  ChatConversation,
  ChatCounts,
  ChatMessageEntry,
  ChatReaction,
  ChatScope,
  ChatSort
} from '@metarchy/protocol'
// Player↔player market — same reasoning as the chat block above.
import type { MarketCategory, MarketComment, MarketListing } from '@metarchy/protocol'
import { CLOSE_SUPERSEDED, ServerMessageSchema } from '@metarchy/protocol'
import { config } from '../config.js'
import { useGameStore } from '../stores/game.js'
import { useSessionStore } from '../stores/session.js'
import { supabase } from '../supabase.js'

const HEARTBEAT_MS = 20_000
const RESYNC_DEBOUNCE_MS = 80
const REQUEST_TIMEOUT_MS = 10_000

type Timer = ReturnType<typeof setTimeout>

interface Pending {
  resolve: (msg: ServerMessage) => void
  reject: (error: Error) => void
  timer: Timer
}

export class GameSocket {
  private ws: WebSocket | null = null
  private reqSeq = 100
  private readonly pending = new Map<number, Pending>()
  private heartbeat: Timer | null = null
  private resyncTimer: Timer | null = null
  private reconnectTimer: Timer | null = null
  private reconnectAttempt = 0
  private wantOnline = false
  /** connect() is async before it assigns `ws`; without this two starts race two sockets. */
  private connecting = false
  /** Another tab owns the session — reconnecting would only fight it. Wait for takeOver(). */
  private superseded = false
  /** Server minus client wall-clock (ms), refreshed by pong — drives deadlines. */
  private clockOffset = 0
  /** Live subscribers to the persisted chat (the chat screen, while mounted). */
  private readonly chatListeners = new Set<(p: ChatPostedPayload) => void>()

  serverNow(): number {
    return Date.now() + this.clockOffset
  }

  /** Idempotent: connects when a Supabase session exists. */
  start(): void {
    if (this.superseded) return
    this.wantOnline = true
    if (this.ws || this.connecting) return
    void this.connect()
  }

  /** Reclaim the session from the tab that superseded this one. */
  takeOver(): void {
    this.superseded = false
    this.start()
  }

  stop(): void {
    this.wantOnline = false
    this.superseded = false
    this.clearTimers()
    this.ws?.close(1000, 'sign out')
    this.ws = null
    useSessionStore.getState().setSocketStatus('offline')
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.heartbeat = null
    this.resyncTimer = null
    this.reconnectTimer = null
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('socket closed'))
    }
    this.pending.clear()
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.ws) return
    this.connecting = true
    try {
      await this.openSocket()
    } finally {
      this.connecting = false
    }
  }

  private async openSocket(): Promise<void> {
    const session = useSessionStore.getState()
    session.setSocketStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting')

    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token || !this.wantOnline) {
      session.setSocketStatus('offline')
      return
    }

    const ws = new WebSocket(config.wsUrl)
    this.ws = ws

    ws.onopen = () => {
      const game = useGameStore.getState()
      const resume =
        game.activeGame && game.lastEventSeq > 0
          ? { gameId: game.activeGame.gameId, lastEventSeq: game.lastEventSeq }
          : undefined
      ws.send(
        JSON.stringify({ t: 'hello', p: { accessToken: token, ...(resume ? { resume } : {}) } })
      )
    }

    ws.onmessage = (event) => {
      const parsed = ServerMessageSchema.safeParse(JSON.parse(event.data as string))
      if (!parsed.success) return
      this.route(parsed.data)
    }

    ws.onclose = (event) => {
      if (this.ws !== ws) return
      this.ws = null
      this.clearTimers()
      if (event.code === CLOSE_SUPERSEDED) {
        // Reconnecting here would evict the tab that just took over, which would
        // reconnect and evict us — the two tabs would trade the session forever.
        this.superseded = true
        useSessionStore.getState().setSocketStatus('superseded')
        return
      }
      if (this.wantOnline) this.scheduleReconnect()
      else useSessionStore.getState().setSocketStatus('offline')
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1
    useSessionStore.getState().setSocketStatus('reconnecting')
    const delay = Math.min(500 * 2 ** this.reconnectAttempt, 8000) * (0.7 + 0.6 * Math.random())
    this.reconnectTimer = setTimeout(() => void this.connect(), delay)
  }

  private route(msg: ServerMessage): void {
    if (msg.seq !== undefined) {
      const pending = this.pending.get(msg.seq)
      if (pending) {
        this.pending.delete(msg.seq)
        clearTimeout(pending.timer)
        if (msg.t === 'error') pending.reject(new Error(msg.p.message))
        else pending.resolve(msg)
        if (msg.t !== 'error') this.consume(msg)
        return
      }
    }
    this.consume(msg)
  }

  private consume(msg: ServerMessage): void {
    const game = useGameStore.getState()
    const session = useSessionStore.getState()
    switch (msg.t) {
      case 'welcome': {
        this.reconnectAttempt = 0
        session.setSocketStatus('online')
        session.setProfile(msg.p.profile)
        const active = msg.p.activeGame
        if (active) {
          game.setActiveGame({
            gameId: active.gameId,
            mode: active.mode,
            seat: active.seat,
            status: active.status
          })
        } else if (game.activeGame && !game.gameOver) {
          // The server no longer knows our game (finished/aborted while away).
          game.resetGame()
        }
        this.armHeartbeat()
        this.sendRaw({ t: 'ping' }) // prime the clock offset right away
        return
      }
      case 'lobby.state':
        game.setLobby({
          gameId: msg.p.gameId,
          mode: msg.p.mode,
          players: msg.p.players,
          seatsTotal: msg.p.seatsTotal
        })
        return
      case 'game.started':
        game.setLobby(null)
        game.setActiveGame({
          gameId: msg.p.gameId,
          mode: msg.p.mode,
          seat: msg.p.seat,
          status: 'active'
        })
        game.setPlayers(msg.p.players)
        this.requestResyncSoon(msg.p.gameId)
        return
      case 'game.event': {
        game.bumpEventSeq(msg.p.seq)
        if (msg.p.event.type === 'game.finished') {
          const payload = msg.p.event.payload as {
            winnerSeats: SeatId[]
            ranking: { seats: SeatId[]; vp: number }[]
          }
          game.setGameOver(payload)
          return
        }
        this.requestResyncSoon(msg.p.gameId)
        return
      }
      case 'game.sync':
        game.setView(msg.p.playerView, msg.p.seq)
        if (msg.p.players) game.setPlayers(msg.p.players)
        return
      case 'deadline':
        game.setDeadline({ phaseRef: msg.p.phaseRef, endsAt: msg.p.endsAt })
        return
      case 'presence':
        game.setPresence({
          seat: msg.p.seat,
          connected: msg.p.connected,
          graceEndsAt: msg.p.graceEndsAt
        })
        return
      case 'profile.updated':
        session.setProfile(msg.p.profile)
        return
      case 'error':
        session.setError(msg.p.message)
        return
      case 'pong':
        if (msg.p) this.clockOffset = msg.p.time - Date.now()
        return
      case 'queue.status':
        game.setQueue(msg.p)
        return
      case 'match.found': {
        // Queueing was the consent: the game is already live, there is no lobby.
        game.resetGame()
        game.setQueue(null)
        game.setActiveGame({
          gameId: msg.p.gameId,
          mode: msg.p.mode,
          seat: msg.p.seat,
          status: 'active'
        })
        game.setPlayers(msg.p.seats)
        return
      }
      case 'chat.message':
        if (msg.p.gameId === game.activeGame?.gameId) game.appendChat(msg.p.fromSeat, msg.p.text)
        return
      case 'team.staging':
        if (msg.p.gameId === game.activeGame?.gameId)
          game.setAllyStaging({ fromSeat: msg.p.fromSeat, staging: msg.p.staging })
        return
      case 'spectate.joined':
        // A fresh board: drop any stale game state, then mark this tab a watcher.
        game.resetGame()
        game.setSpectating({ gameId: msg.p.gameId, mode: msg.p.mode })
        game.setPlayers(msg.p.players)
        return
      case 'spectator.presence': {
        const current = game.activeGame?.gameId ?? game.spectating?.gameId
        if (msg.p.gameId === current) game.setWatchers({ count: msg.p.count, names: msg.p.names })
        return
      }
      case 'gato.reward':
        // Unsolicited, and it lands a beat AFTER the game-over screen (the
        // server credits once finishGame/ratings are persisted) — so the
        // screen renders it reactively rather than waiting for it.
        game.setGatoReward({
          gameId: msg.p.gameId,
          amount: msg.p.amount,
          balance: msg.p.balance
        })
        return
      case 'loot.drop':
        // Same beat as the payout above: a cosmetic fell out of the game. The
        // entitlement is already granted server-side; this is the announcement.
        game.setLootDrop({ gameId: msg.p.gameId, itemId: msg.p.itemId })
        return
      case 'chat.posted': {
        // Unsolicited for everyone but the author (whose copy carries the
        // request seq and has already resolved the send promise above).
        //
        // A private message ALSO raises a shell-level flag. The chat screen
        // subscribes below, but the one case that matters most is the one it
        // cannot cover — the screen is not mounted — and a DM dropped there is a
        // message the recipient never learns exists. That is how the persisted
        // chat reached the end of the beta with zero messages in it.
        const session = useSessionStore.getState()
        const from = msg.p.message.author
        // A null author is a flagged-away tombstone, not somebody writing to you.
        if (msg.p.scope.kind === 'dm' && from && from.userId !== session.userId)
          session.setDmUnread(true)
        for (const listener of this.chatListeners) listener(msg.p)
        return
      }
      case 'chat.messages':
      case 'chat.replies':
      case 'chat.stats':
      case 'chat.conversations':
        return // consumed by the chat request promises
      case 'spectate.games':
        return // consumed by the spectateList() request promise
      case 'replay.games':
      case 'replay.data':
        return // consumed by the replay request promises
      case 'game.created':
        return
    }
  }

  private armHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = setInterval(() => {
      this.sendRaw({ t: 'ping' })
    }, HEARTBEAT_MS)
  }

  private requestResyncSoon(gameId: string): void {
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
    this.resyncTimer = setTimeout(() => {
      this.sendRaw({ t: 'game.resync', p: { gameId } })
    }, RESYNC_DEBOUNCE_MS)
  }

  private sendRaw(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private request<T extends ServerMessage['t']>(
    payload: Record<string, unknown>,
    expect: T
  ): Promise<ServerMessageOf<T>> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        reject(new Error('not connected'))
        return
      }
      const seq = this.reqSeq++
      const timer = setTimeout(() => {
        this.pending.delete(seq)
        reject(new Error('request timed out'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(seq, {
        resolve: (msg) => {
          if (msg.t === expect) resolve(msg as ServerMessageOf<T>)
          else reject(new Error(`expected ${expect}, got ${msg.t}`))
        },
        reject,
        timer
      })
      this.sendRaw({ ...payload, seq })
    })
  }

  // --- public API used by screens ---------------------------------------------------

  async createGame(p: {
    mode: '1v1' | 'ffa3' | '2v2' | 'vs_bots' | 'tutorial'
    private?: boolean
    seatCount?: 2 | 3
  }): Promise<ServerMessageOf<'game.created'>> {
    const created = await this.request({ t: 'game.create', p }, 'game.created')
    const game = useGameStore.getState()
    game.resetGame()
    game.setActiveGame({
      gameId: created.p.gameId,
      mode: created.p.mode,
      seat: created.p.seat,
      status: 'lobby'
    })
    game.setInviteCode(created.p.inviteCode)
    return created
  }

  async joinGame(inviteCode: string): Promise<ServerMessageOf<'game.created'>> {
    const joined = await this.request({ t: 'game.join', p: { inviteCode } }, 'game.created')
    const game = useGameStore.getState()
    game.resetGame()
    game.setActiveGame({
      gameId: joined.p.gameId,
      mode: joined.p.mode,
      seat: joined.p.seat,
      status: 'lobby'
    })
    game.setInviteCode(joined.p.inviteCode)
    return joined
  }

  /** Rejects with the server's reason (taken, reserved, malformed). */
  async updateProfile(patch: {
    nickname?: string
    avatar?: AvatarId | null
    wardrobe?: Wardrobe
  }): Promise<ServerMessageOf<'profile.updated'>> {
    return this.request({ t: 'profile.update', p: patch }, 'profile.updated')
  }

  /** Resolves once the server acknowledges the wait; the match arrives later. */
  async joinQueue(mode: RankedMode): Promise<ServerMessageOf<'queue.status'>> {
    return this.request({ t: 'queue.join', p: { mode } }, 'queue.status')
  }

  leaveQueue(): void {
    this.sendRaw({ t: 'queue.leave' })
    useGameStore.getState().setQueue(null)
  }

  ready(gameId: string): void {
    this.sendRaw({ t: 'lobby.ready', p: { gameId } })
  }

  /** 2v2 lobby: ask for a side; the refreshed lobby.state is the answer. */
  pickTeam(gameId: string, team: 0 | 1): void {
    this.sendRaw({ t: 'lobby.team', p: { gameId, team } })
  }

  /** Leave a lobby before it starts. Fire-and-forget: the client returns home. */
  leaveLobby(gameId: string): void {
    this.sendRaw({ t: 'lobby.leave', p: { gameId } })
  }

  /** Own match history, newest first, plus the per-category record (one round trip). */
  async fetchHistory(): Promise<ServerMessageOf<'history'>> {
    return this.request({ t: 'history.get' }, 'history')
  }

  /** A page of the Players directory; `query` is a nickname substring. */
  async fetchPlayers(
    opts: { query?: string; offset?: number } = {}
  ): Promise<ServerMessageOf<'players'>> {
    const p: { query?: string; offset?: number } = {}
    if (opts.query) p.query = opts.query
    if (opts.offset) p.offset = opts.offset
    return this.request(
      { t: 'players.list', ...(Object.keys(p).length > 0 ? { p } : {}) },
      'players'
    )
  }

  /** One player's public profile, by nickname — what a shared link resolves to. */
  async fetchPlayer(nickname: string): Promise<ServerMessageOf<'player'>> {
    return this.request({ t: 'player.get', p: { nickname } }, 'player')
  }

  /** Native app hands over its FCM token; safe to repeat (server upserts). */
  registerPush(token: string, platform: 'android' | 'ios'): void {
    this.sendRaw({ t: 'push.register', p: { token, platform } })
  }

  unregisterPush(): void {
    this.sendRaw({ t: 'push.unregister' })
  }

  sendIntent(gameId: string, intent: ClientIntent): void {
    const seq = this.reqSeq++
    this.sendRaw({ t: 'intent', seq, p: { gameId, intent } })
  }

  forfeit(gameId: string): void {
    this.sendRaw({ t: 'game.forfeit', p: { gameId } })
  }

  /** Live staging to the 2v2 ally (fire-and-forget; the server relays ally-only). */
  sendTeamStaging(gameId: string, staging: TeamStaging): void {
    this.sendRaw({ t: 'team.staging', p: { gameId, staging } })
  }

  /** The server relays chat.team to the ally only — the sender echoes locally. */
  sendChat(gameId: string, text: string): void {
    const trimmed = text.trim().slice(0, 280)
    if (!trimmed) return
    this.sendRaw({ t: 'chat.team', p: { gameId, text: trimmed } })
    const game = useGameStore.getState()
    if (game.activeGame?.gameId === gameId) game.appendChat(game.activeGame.seat, trimmed)
  }

  resyncNow(gameId: string): void {
    this.sendRaw({ t: 'game.resync', p: { gameId } })
  }

  // --- spectating -------------------------------------------------------------------

  /** The live ranked games open to watchers. */
  async spectateList(): Promise<WatchableGame[]> {
    const res = await this.request({ t: 'spectate.list' }, 'spectate.games')
    return res.p.games
  }

  /** Start watching; resolves once the server confirms (the spectator sync follows). */
  async spectateJoin(gameId: string): Promise<void> {
    await this.request({ t: 'spectate.join', p: { gameId } }, 'spectate.joined')
  }

  /** Stop watching and clear the local board. */
  spectateLeave(gameId: string): void {
    this.sendRaw({ t: 'spectate.leave', p: { gameId } })
    const game = useGameStore.getState()
    game.setSpectating(null)
    game.resetGame()
  }

  // --- replays ----------------------------------------------------------------------

  /**
   * One page of recorded ranked games, newest first, plus the archive size
   * under the same filter (the server fixes the page size).
   */
  async replayList(p?: {
    offset?: number
    starredOnly?: boolean
    /** Only games this player sat in — their public profile's match list. */
    playerId?: string
  }): Promise<{ games: ReplayEntry[]; total: number }> {
    const res = await this.request({ t: 'replay.list', ...(p ? { p } : {}) }, 'replay.games')
    return res.p
  }

  /** Pin/unpin a past game in this user's favorites; resolves once persisted. */
  async replayStar(gameId: string, starred: boolean): Promise<void> {
    await this.request({ t: 'replay.star', p: { gameId, starred } }, 'replay.starred')
  }

  // --- GATO wallet ------------------------------------------------------------------

  /** Balance + owned shop item ids (the wallet is created on first touch). */
  async walletGet(): Promise<{ balance: number; owned: string[] }> {
    const res = await this.request({ t: 'wallet.get' }, 'wallet')
    return res.p
  }

  /** Buy a catalog item; resolves to the updated wallet. */
  async shopBuy(itemId: string): Promise<{ balance: number; owned: string[] }> {
    const res = await this.request({ t: 'shop.buy', p: { itemId } }, 'wallet')
    return res.p
  }

  // --- Player↔player market ---------------------------------------------------------

  /** One page of the shelf (or of the caller's own lots when `mine`). */
  async marketBrowse(p?: {
    category?: MarketCategory | null
    mine?: boolean
    offset?: number
  }): Promise<ServerMessageOf<'market.listings'>['p']> {
    const res = await this.request({ t: 'market.browse', ...(p ? { p } : {}) }, 'market.listings')
    return res.p
  }

  /** Put an owned item up for sale; the item is locked until the lot closes. */
  async marketList(itemId: string, price: number): Promise<MarketListing | null> {
    const res = await this.request({ t: 'market.list', p: { itemId, price } }, 'market.listing')
    return res.p.listing
  }

  async marketCancel(listingId: string): Promise<void> {
    await this.request({ t: 'market.cancel', p: { listingId } }, 'market.listing')
  }

  /** Buy someone's lot; resolves to the post-sale wallet. */
  async marketBuy(listingId: string): Promise<ServerMessageOf<'market.bought'>['p']> {
    const res = await this.request({ t: 'market.buy', p: { listingId } }, 'market.bought')
    return res.p
  }

  async marketComment(listingId: string, body: string): Promise<MarketComment[]> {
    const res = await this.request(
      { t: 'market.comment', p: { listingId, body } },
      'market.comments'
    )
    return res.p.rows
  }

  async marketComments(listingId: string): Promise<MarketComment[]> {
    const res = await this.request({ t: 'market.comments', p: { listingId } }, 'market.comments')
    return res.p.rows
  }

  /** The seed + move log for a finished ranked game, to reconstruct locally. */
  async replayGet(gameId: string): Promise<ServerMessageOf<'replay.data'>['p']> {
    const res = await this.request({ t: 'replay.get', p: { gameId } }, 'replay.data')
    return res.p
  }

  // --- Persisted chat: global room + DMs --------------------------------------------

  /** One page of top-level messages under the chosen sort, plus my cooldown. */
  async chatList(p: {
    scope: ChatScope
    sort: ChatSort
    offset?: number
  }): Promise<ServerMessageOf<'chat.messages'>['p']> {
    const res = await this.request({ t: 'chat.list', p }, 'chat.messages')
    return res.p
  }

  /** The thread under a message — chronological, one level deep. */
  async chatThread(parentId: string): Promise<ChatMessageEntry[]> {
    const res = await this.request({ t: 'chat.thread', p: { parentId } }, 'chat.replies')
    return res.p.messages
  }

  /**
   * Post, or reply with `parentId`. Rejects with the server's reason — a global
   * message inside the one-per-minute window comes back as rate_limited.
   */
  async chatPost(p: {
    scope: ChatScope
    body: string
    parentId?: string
  }): Promise<ChatMessageEntry> {
    const res = await this.request({ t: 'chat.post', p }, 'chat.posted')
    return res.p.message
  }

  /** Like/dislike; sending the reaction already held clears it. */
  async chatReact(messageId: string, reaction: ChatReaction): Promise<ChatCounts> {
    const res = await this.request({ t: 'chat.react', p: { messageId, reaction } }, 'chat.stats')
    return res.p
  }

  /** Flag a message; at ten distinct flaggers the server removes it. */
  async chatFlag(messageId: string): Promise<ChatCounts> {
    const res = await this.request({ t: 'chat.flag', p: { messageId } }, 'chat.stats')
    return res.p
  }

  /** My conversations, plus the exact-nickname lookup that starts a new one. */
  async chatDms(
    nickname?: string
  ): Promise<{ items: ChatConversation[]; found: ChatAuthorView | null }> {
    const res = await this.request(
      { t: 'chat.dms', ...(nickname ? { p: { nickname } } : {}) },
      'chat.conversations'
    )
    return res.p
  }

  /** Close (blocked=true) or reopen a private conversation with this peer. */
  async chatBlock(peerId: string, blocked: boolean): Promise<boolean> {
    const res = await this.request({ t: 'chat.block', p: { peerId, blocked } }, 'chat.blocked')
    return res.p.blocked
  }

  /** Subscribe while the chat screen is mounted; the return value unsubscribes. */
  onChatPosted(listener: (p: ChatPostedPayload) => void): () => void {
    this.chatListeners.add(listener)
    return () => this.chatListeners.delete(listener)
  }
}

/** What a live chat push carries: the message plus which conversation it is in. */
export type ChatPostedPayload = ServerMessageOf<'chat.posted'>['p']

export const gameSocket = new GameSocket()
