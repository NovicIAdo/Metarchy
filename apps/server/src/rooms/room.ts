// GameRoom (architecture/Game-Server.md §2): one in-memory object owning one
// game's GameState. Every input — player intents, timer fires, disconnect
// notices, bot moves — goes through a single FIFO queue processed one at a
// time. Events are appended to the store BEFORE any broadcast (write-ahead).

import type { EngineEvent, GameState, Intent, Mode, SeatId } from '@metarchy/engine'
import {
  RANKED_BOT_STRATEGY,
  applyIntent,
  chooseBotIntent,
  chooseRankedBotIntent,
  chooseTutorialBotIntent,
  createGame,
  fnv1a32,
  projectSpectatorView,
  projectView,
  randU32,
  waitingOn
} from '@metarchy/engine'
import type {
  ClientIntent,
  PlayerSummary,
  ServerMessage,
  TeamStaging,
  Wardrobe
} from '@metarchy/protocol'
import type { ServerConfig } from '../config.js'
import type { Metrics } from '../metrics.js'
import type { PushService } from '../push.js'
import { moveCommitment, newSalt, PHASE_NUMBER } from '../proof.js'
import type { FinishedSeat, Rating } from '../ratings.js'
import { isRatedMode, rateGame } from '../ratings.js'
import { grantAchievements } from '../achievements.js'
import { dropCandidates, rollDrop } from '../drops.js'
import { rankedRewards } from '../rewards.js'
import type { Session } from '../session.js'
import type { GameResultRow, GameStore } from '../store.js'
import { stageKey, stageWaitMs } from './deadlines.js'

export interface LoggerLike {
  info(obj: unknown, msg?: string): void
  warn(obj: unknown, msg?: string): void
  error(obj: unknown, msg?: string): void
}

export interface SessionDirectory {
  sessionOf(userId: string): Session | undefined
}

export interface RoomDeps {
  config: ServerConfig
  store: GameStore
  sessions: SessionDirectory
  log: LoggerLike
  /** Called once after finish/abort has been persisted; the manager unregisters the room. */
  onGameOver(gameId: string): void
  /** A human seat was eliminated mid-game; the manager frees the user for new games. */
  onEliminated(gameId: string, userId: string): void
  metrics?: Metrics
  /** "Your turn" pushes to disconnected humans; absent = pushless server. */
  push?: PushService
}

export interface RoomInit {
  gameId: string
  mode: Mode
  isPrivate: boolean
  inviteCode: string | null
  seatsTotal: number
  /** Server RNG seed — secret until game end (commit-reveal). */
  seed: string
  /** True for a matchmade (public queue) game: the opening reads run fast. */
  matched?: boolean
}

export interface SeatBinding {
  seat: SeatId
  userId: string | null
  nickname: string
  avatar: string | null
  /** Cosmetic loadouts frozen at seat time, like nickname/avatar. */
  wardrobe?: Wardrobe | null
  controller: 'human' | 'bot'
  ready: boolean
  connected: boolean
  /** 2v2 lobby team wish; effective teams resolve prefs in join order. */
  teamPref?: 0 | 1
}

export type RoomStatus = 'lobby' | 'active' | 'finished' | 'aborted'

/** Per-seat replay window for resume; beyond it the client gets game.sync. */
const EVENT_BUFFER_SIZE = 512

export class GameRoom {
  readonly gameId: string
  readonly mode: Mode
  readonly isPrivate: boolean
  readonly inviteCode: string | null
  readonly seatsTotal: number
  private readonly seed: string
  /** Matched (public queue) rooms open on a fast beat — see openingWaitMs(). */
  readonly matched: boolean

  status: RoomStatus = 'lobby'
  private state: GameState | null = null
  private readonly bindings: SeatBinding[] = []
  private readonly buffers = new Map<SeatId, EngineEvent[]>()
  /** Non-seated watchers of a ranked game: userId → their live session. */
  private readonly spectators = new Map<string, Session>()
  // endsAt/timer are null for a tutorial room: it keeps a stage key (so re-arm
  // dedup and resync broadcasts still work) but never runs a countdown.
  private deadline: { key: string; endsAt: number | null; timer: NodeJS.Timeout | null } | null =
    null
  private readonly graceTimers = new Map<SeatId, { endsAt: number; timer: NodeJS.Timeout }>()
  /** Live pre-commit staging per seat, relayed to the 2v2 ally (display-only). */
  private readonly stagingBySeat = new Map<SeatId, TeamStaging>()
  private readonly botPending = new Set<SeatId>()
  private readonly botSeedHash: number
  private botCursor = 0

  private queue: Array<() => Promise<void>> = []
  private draining = false

  constructor(
    private readonly deps: RoomDeps,
    init: RoomInit
  ) {
    this.gameId = init.gameId
    this.mode = init.mode
    this.isPrivate = init.isPrivate
    this.inviteCode = init.inviteCode
    this.seatsTotal = init.seatsTotal
    this.seed = init.seed
    this.matched = init.matched ?? false
    this.botSeedHash = fnv1a32(`${init.seed}:bots`)
  }

  // --- single-writer queue ---------------------------------------------------------

  private enqueue(job: () => Promise<void>): void {
    this.queue.push(job)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift() as () => Promise<void>
        try {
          await job()
        } catch (error) {
          this.deps.log.error({ err: error, gameId: this.gameId }, 'room job failed')
        }
      }
    } finally {
      this.draining = false
    }
  }

  // --- lobby -------------------------------------------------------------------------

  bindingOf(userId: string): SeatBinding | undefined {
    return this.bindings.find((b) => b.userId === userId)
  }

  get isFull(): boolean {
    return this.bindings.length >= this.seatsTotal
  }

  get humanBindings(): SeatBinding[] {
    return this.bindings.filter((b) => b.controller === 'human')
  }

  addSeat(
    userId: string | null,
    nickname: string,
    avatar: string | null,
    controller: 'human' | 'bot',
    wardrobe?: Wardrobe | null
  ): SeatId {
    if (this.status !== 'lobby') throw new Error('room is not in lobby')
    if (this.isFull) throw new Error('room is full')
    const seat = this.bindings.length as SeatId
    this.bindings.push({
      seat,
      userId,
      nickname,
      avatar,
      wardrobe: wardrobe ?? null,
      controller,
      ready: controller === 'bot',
      connected: controller === 'human'
    })
    return seat
  }

  removeFromLobby(userId: string): void {
    const idx = this.bindings.findIndex((b) => b.userId === userId)
    if (idx < 0 || this.status !== 'lobby') return
    this.bindings.splice(idx, 1)
    this.bindings.forEach((b, i) => {
      b.seat = i as SeatId
    })
    this.broadcastLobby()
  }

  setReady(userId: string): void {
    const binding = this.bindingOf(userId)
    if (binding) binding.ready = true
  }

  /**
   * Effective 2v2 lobby teams: walk bindings in join order, honor the pref
   * (default = seat parity, the classic [0,2] vs [1,3]) while the team has
   * room, overflow to the other side. Deterministic — the lobby shows exactly
   * what start() will build.
   */
  private effectiveTeams(): Map<SeatBinding, 0 | 1> {
    const out = new Map<SeatBinding, 0 | 1>()
    const count: [number, number] = [0, 0]
    for (const b of this.bindings) {
      const wish = b.teamPref ?? ((b.seat % 2) as 0 | 1)
      const team = count[wish] < this.seatsTotal / 2 ? wish : ((1 - wish) as 0 | 1)
      count[team] += 1
      out.set(b, team)
    }
    return out
  }

  /** 2v2 lobby only: sit on `team` next game. Rejected once ready or team full. */
  setTeamPref(userId: string, team: 0 | 1): 'ok' | 'unavailable' {
    if (this.mode !== '2v2' || this.status !== 'lobby') return 'unavailable'
    const binding = this.bindingOf(userId)
    if (!binding || binding.ready) return 'unavailable'
    const teams = this.effectiveTeams()
    if (teams.get(binding) === team) return 'ok'
    let members = 0
    for (const [b, t] of teams) if (t === team && b !== binding) members += 1
    if (members >= this.seatsTotal / 2) return 'unavailable'
    binding.teamPref = team
    return 'ok'
  }

  /**
   * Seats follow teams at start: team 0 → seats {0,2}, team 1 → {1,3} (spec
   * §13 pairs by parity). Reordering the bindings array keeps the seat = index
   * invariant that start() and removeFromLobby rely on.
   */
  private applyTeamSeating(): void {
    if (this.mode !== '2v2') return
    const teams = this.effectiveTeams()
    const order: SeatBinding[] = []
    const of = (team: 0 | 1): SeatBinding[] => this.bindings.filter((b) => teams.get(b) === team)
    const [a, z] = [of(0), of(1)]
    for (let i = 0; i < this.seatsTotal / 2; i++) {
      if (a[i]) order.push(a[i] as SeatBinding)
      if (z[i]) order.push(z[i] as SeatBinding)
    }
    this.bindings.splice(0, this.bindings.length, ...order)
    this.bindings.forEach((b, i) => {
      b.seat = i as SeatId
    })
  }

  get allHumansReady(): boolean {
    return this.isFull && this.bindings.every((b) => b.ready)
  }

  playerSummaries(): PlayerSummary[] {
    return this.bindings.map((b) => ({
      seat: b.seat,
      nickname: b.nickname,
      bot: b.controller === 'bot',
      avatar: b.avatar,
      wardrobe: b.wardrobe ?? null
    }))
  }

  lobbyStateMessage(): ServerMessage {
    const teams = this.mode === '2v2' ? this.effectiveTeams() : null
    return {
      t: 'lobby.state',
      p: {
        gameId: this.gameId,
        mode: this.mode,
        players: this.bindings.map((b) => ({
          seat: b.seat,
          nickname: b.nickname,
          bot: b.controller === 'bot',
          avatar: b.avatar,
          wardrobe: b.wardrobe ?? null,
          ready: b.ready,
          team: teams?.get(b) ?? null
        })),
        seatsTotal: this.seatsTotal
      }
    }
  }

  broadcastLobby(): void {
    const msg = this.lobbyStateMessage()
    this.sendToHumans(() => msg)
  }

  private sendToHumans(msgFor: (binding: SeatBinding) => ServerMessage | null): void {
    for (const b of this.bindings) {
      if (!b.userId) continue
      const session = this.deps.sessions.sessionOf(b.userId)
      if (!session) continue
      const msg = msgFor(b)
      if (msg) session.send(msg)
    }
  }

  // --- start & recovery ---------------------------------------------------------------

  /** Leave the lobby: create engine state, persist, notify seats. */
  start(): void {
    this.enqueue(async () => {
      if (this.status !== 'lobby') return
      this.applyTeamSeating()
      const controllers = this.bindings.map((b) => b.controller)
      this.state = createGame({
        gameId: this.gameId,
        mode: this.mode,
        seed: this.seed,
        seatCount: this.seatsTotal,
        controllers
      })
      this.status = 'active'
      await this.deps.store.markActive(
        this.gameId,
        this.bindings.map((b) => ({
          seat: b.seat,
          userId: b.userId,
          botStrategy: b.controller === 'bot' ? this.botStrategy : null
        }))
      )
      await this.deps.store.writeSnapshot(this.gameId, this.state.seq, this.state)
      const players = this.playerSummaries()
      this.sendToHumans((b) => ({
        t: 'game.started',
        p: { gameId: this.gameId, mode: this.mode, seat: b.seat, players }
      }))
      this.sendToHumans((b) => this.syncMessage(b.seat))
      this.armDeadline()
      this.scheduleBots()
      this.deps.metrics?.gamesStarted.inc({ mode: this.mode })
      this.deps.log.info({ gameId: this.gameId, mode: this.mode }, 'game started')
    })
  }

  /** Rebuild an active room from persistence (snapshot + replayed events already merged). */
  restore(state: GameState, bindings: SeatBinding[]): void {
    this.enqueue(async () => {
      this.state = state
      this.status = state.phase.kind === 'finished' ? 'finished' : 'active'
      this.bindings.splice(0, this.bindings.length, ...bindings)
      if (this.status === 'active') {
        this.armDeadline()
        this.scheduleBots()
      } else {
        await this.finishLocked()
      }
    })
  }

  // --- socket attach/detach --------------------------------------------------------------

  attachSession(session: Session, resume?: { gameId: string; lastEventSeq: number }): void {
    this.enqueue(async () => {
      const binding = this.bindingOf(session.userId)
      if (!binding) return
      binding.connected = true
      this.cancelGrace(binding.seat)
      this.broadcastPresence(binding.seat, true, null)
      if (this.status === 'lobby') {
        session.send(this.lobbyStateMessage())
        return
      }
      if (this.status !== 'active' || !this.state) return

      const buffer = this.buffers.get(binding.seat) ?? []
      const canReplay =
        resume &&
        resume.gameId === this.gameId &&
        resume.lastEventSeq <= this.state.seq &&
        (buffer.length === 0
          ? resume.lastEventSeq === this.state.seq
          : (buffer[0] as EngineEvent).seq <= resume.lastEventSeq + 1)
      if (canReplay) {
        for (const event of buffer) {
          if (event.seq > resume.lastEventSeq)
            session.send({
              t: 'game.event',
              p: { gameId: this.gameId, seq: event.seq, event }
            })
        }
      } else {
        const sync = this.syncMessage(binding.seat)
        if (sync) session.send(sync)
      }
      if (this.deadline)
        session.send({
          t: 'deadline',
          p: { gameId: this.gameId, phaseRef: this.deadline.key, endsAt: this.deadline.endsAt }
        })
      // Rejoining mid-phase (2v2): replant the ally's live staging ghosts.
      if (this.mode === '2v2') {
        const ally = this.allyBindingOf(binding.seat)
        const staged = ally ? this.stagingBySeat.get(ally.seat) : undefined
        if (ally && staged)
          session.send({
            t: 'team.staging',
            p: { gameId: this.gameId, fromSeat: ally.seat, staging: staged }
          })
      }
    })
  }

  onDisconnect(userId: string): void {
    this.enqueue(async () => {
      const binding = this.bindingOf(userId)
      if (!binding || this.status !== 'active' || !this.state) return
      binding.connected = false
      // The tab that held the draft is gone — retract its ghosts from the ally.
      if (this.mode === '2v2' && this.stagingBySeat.delete(binding.seat)) {
        const ally = this.allyBindingOf(binding.seat)
        if (ally?.userId)
          this.deps.sessions.sessionOf(ally.userId)?.send({
            t: 'team.staging',
            p: {
              gameId: this.gameId,
              fromSeat: binding.seat,
              staging: { kind: 'clear', turn: this.state.turn }
            }
          })
      }
      if (this.state.eliminated.includes(binding.seat)) return
      const graceMs = this.deps.config.disconnectGraceMs
      const endsAt = Date.now() + graceMs
      this.cancelGrace(binding.seat)
      const timer = setTimeout(() => {
        this.enqueue(async () => {
          this.graceTimers.delete(binding.seat)
          if (this.status !== 'active' || !this.state) return
          if (binding.connected) return
          if (!this.state.activeSeats.includes(binding.seat)) return
          await this.applyLocked(
            binding.seat,
            { type: 'system.eliminate', seat: binding.seat, reason: 'disconnect' },
            {}
          )
        })
      }, graceMs)
      timer.unref()
      this.graceTimers.set(binding.seat, { endsAt, timer })
      this.broadcastPresence(binding.seat, false, endsAt)
      this.maybePushTurn()
    })
  }

  private cancelGrace(seat: SeatId): void {
    const grace = this.graceTimers.get(seat)
    if (grace) {
      clearTimeout(grace.timer)
      this.graceTimers.delete(seat)
    }
  }

  private broadcastPresence(seat: SeatId, connected: boolean, graceEndsAt: number | null): void {
    if (this.status === 'lobby') return
    this.sendToHumans(() => ({
      t: 'presence',
      p: { gameId: this.gameId, seat, connected, graceEndsAt }
    }))
  }

  // --- intents ---------------------------------------------------------------------------

  submitIntent(session: Session, intent: ClientIntent, seq?: number): void {
    this.enqueue(async () => {
      const binding = this.bindingOf(session.userId)
      if (!binding) {
        session.sendError('not_in_game', 'you have no seat in this game', {
          ...(seq !== undefined ? { seq } : {})
        })
        return
      }
      await this.applyLocked(binding.seat, intent, {
        session,
        ...(seq !== undefined ? { seq } : {})
      })
    })
  }

  forfeit(session: Session, seq?: number): void {
    this.enqueue(async () => {
      const binding = this.bindingOf(session.userId)
      if (!binding) {
        session.sendError('not_in_game', 'you have no seat in this game', {
          ...(seq !== undefined ? { seq } : {})
        })
        return
      }
      await this.applyLocked(
        binding.seat,
        { type: 'system.eliminate', seat: binding.seat, reason: 'forfeit' },
        { session, ...(seq !== undefined ? { seq } : {}) }
      )
    })
  }

  requestSync(session: Session, seq?: number): void {
    this.enqueue(async () => {
      const binding = this.bindingOf(session.userId)
      if (!binding) {
        // A spectator resyncs to the strictly-public spectator view.
        if (this.spectators.has(session.userId)) {
          const sync = this.spectatorSyncMessage()
          if (sync) session.send(seq !== undefined ? { ...sync, seq } : sync)
          if (this.deadline)
            session.send({
              t: 'deadline',
              p: { gameId: this.gameId, phaseRef: this.deadline.key, endsAt: this.deadline.endsAt }
            })
          return
        }
        session.sendError('not_in_game', 'you have no seat in this game', {
          ...(seq !== undefined ? { seq } : {})
        })
        return
      }
      if (this.status === 'lobby') {
        session.send(this.lobbyStateMessage())
        return
      }
      const sync = this.syncMessage(binding.seat)
      if (sync) session.send(seq !== undefined ? { ...sync, seq } : sync)
      if (this.deadline)
        session.send({
          t: 'deadline',
          p: { gameId: this.gameId, phaseRef: this.deadline.key, endsAt: this.deadline.endsAt }
        })
    })
  }

  chatTeam(session: Session, text: string, seq?: number): void {
    this.enqueue(async () => {
      const binding = this.bindingOf(session.userId)
      if (!binding) {
        session.sendError('not_in_game', 'you have no seat in this game', {
          ...(seq !== undefined ? { seq } : {})
        })
        return
      }
      if (this.mode !== '2v2') {
        session.sendError('unavailable', 'team chat exists in 2v2 games only', {
          ...(seq !== undefined ? { seq } : {})
        })
        return
      }
      const ally = this.allyBindingOf(binding.seat)
      if (!ally?.userId) return
      this.deps.sessions.sessionOf(ally.userId)?.send({
        t: 'chat.message',
        p: { gameId: this.gameId, fromSeat: binding.seat, text }
      })
    })
  }

  /** Teams are fixed [0,2] vs [1,3] (spec §13); the ally is seat+2 mod 4. */
  private allyBindingOf(seat: SeatId): SeatBinding | undefined {
    const allySeat = ((seat + 2) % 4) as SeatId
    return this.bindings.find((b) => b.seat === allySeat)
  }

  /**
   * Live staging relay (2v2): what a player is ABOUT to do this phase, shown
   * to the ally only — structured table talk, like chat.team. Kept per seat so
   * a reconnecting ally gets the ghosts replanted; wiped at phase boundaries
   * (applyLocked) and when the staging seat disconnects (its local draft died
   * with the tab, so the ghosts must not outlive it).
   */
  teamStaging(session: Session, staging: TeamStaging, seq?: number): void {
    this.enqueue(async () => {
      const binding = this.bindingOf(session.userId)
      if (!binding) {
        session.sendError('not_in_game', 'you have no seat in this game', {
          ...(seq !== undefined ? { seq } : {})
        })
        return
      }
      if (this.mode !== '2v2') {
        session.sendError('unavailable', 'team staging exists in 2v2 games only', {
          ...(seq !== undefined ? { seq } : {})
        })
        return
      }
      if (this.status !== 'active') return
      if (staging.kind === 'clear') this.stagingBySeat.delete(binding.seat)
      else this.stagingBySeat.set(binding.seat, staging)
      const ally = this.allyBindingOf(binding.seat)
      if (!ally?.userId) return
      this.deps.sessions.sessionOf(ally.userId)?.send({
        t: 'team.staging',
        p: { gameId: this.gameId, fromSeat: binding.seat, staging }
      })
    })
  }

  /**
   * The one mutation path. Applies an intent, persists its events (write-ahead),
   * then broadcasts, snapshots phase boundaries, re-arms deadlines and bots.
   */
  private async applyLocked(
    seat: SeatId,
    intent: Intent,
    opts: { session?: Session; seq?: number }
  ): Promise<boolean> {
    if (this.status !== 'active' || !this.state) {
      opts.session?.sendError('not_found', 'game is not active', {
        ...(opts.seq !== undefined ? { seq: opts.seq } : {})
      })
      return false
    }
    const before = this.state
    const result = applyIntent(before, seat, intent)
    if (!result.ok) {
      this.deps.metrics?.intents.inc({ result: 'rejected' })
      opts.session?.sendError('rule_violation', result.error.message, {
        ...(opts.seq !== undefined ? { seq: opts.seq } : {}),
        details: { engineCode: result.error.code }
      })
      return false
    }
    this.deps.metrics?.intents.inc({ result: 'applied' })

    this.state = result.state
    // Proof trail: hash of the accepted player move (Data-Model.md
    // move_commitments); system intents are not player moves.
    const isSystem = intent.type === 'system.timeout' || intent.type === 'system.eliminate'
    let commitment
    if (!isSystem && result.events.length > 0) {
      const salt = newSalt()
      commitment = {
        seq: (result.events[0] as EngineEvent).seq,
        seat,
        turn: before.turn,
        phase: PHASE_NUMBER[before.phase.kind],
        hash: moveCommitment(
          {
            gameId: this.gameId,
            turn: before.turn,
            phase: PHASE_NUMBER[before.phase.kind],
            seat,
            intent
          },
          salt
        ),
        salt
      }
    }
    // The origin intent rides with the batch — it's what recovery re-applies;
    // the commitment lands in the same round trip, atomic with its events.
    await this.deps.store.appendEvents(this.gameId, result.events, { seat, intent }, commitment)

    this.broadcastEvents(result.events)

    const boundary = this.state.phase.kind !== before.phase.kind || this.state.turn !== before.turn
    if (boundary) {
      await this.deps.store.writeSnapshot(this.gameId, this.state.seq, this.state)
      // A phase flip voids every live draft — clients drop stale ghosts by
      // turn/phase themselves; this only stops replanting them on reconnect.
      this.stagingBySeat.clear()
    }

    // Whoever just got eliminated is done *here* — free them to start another
    // game right away. The seat binding stays for spectating and recovery.
    for (const s of this.state.eliminated) {
      if (before.eliminated.includes(s)) continue
      const binding = this.bindings.find((x) => x.seat === s)
      if (binding?.userId && binding.controller === 'human')
        this.deps.onEliminated(this.gameId, binding.userId)
    }

    this.armDeadline()
    this.scheduleBots()
    if (this.state.phase.kind === 'finished') await this.finishLocked()
    return true
  }

  private broadcastEvents(events: EngineEvent[]): void {
    for (const event of events) {
      for (const b of this.bindings) {
        const visible = event.visibility === 'public' || event.visibility.includes(b.seat)
        if (!visible) continue
        const buffer = this.buffers.get(b.seat) ?? []
        buffer.push(event)
        if (buffer.length > EVENT_BUFFER_SIZE) buffer.shift()
        this.buffers.set(b.seat, buffer)
        if (b.userId)
          this.deps.sessions.sessionOf(b.userId)?.send({
            t: 'game.event',
            p: { gameId: this.gameId, seq: event.seq, event }
          })
      }
      // Spectators only ever receive public events — hidden-info events (sealed
      // placements, unrevealed arguments) are seat-scoped and never reach them.
      if (event.visibility === 'public' && this.spectators.size > 0) {
        for (const s of this.spectators.values())
          s.send({ t: 'game.event', p: { gameId: this.gameId, seq: event.seq, event } })
      }
    }
    // A watcher re-derives its whole board from the sync, not from the event
    // stream, so after any public change it needs a fresh projection — otherwise
    // it sits on a stale view until something else nudges it (the "watchers just
    // wait through the conflict" report). projectSpectatorView keeps hidden info
    // sealed until the moment the table sees it, so this leaks nothing early.
    if (this.spectators.size > 0 && events.some((e) => e.visibility === 'public')) {
      const sync = this.spectatorSyncMessage()
      if (sync) for (const s of this.spectators.values()) s.send(sync)
    }
  }

  private syncMessage(seat: SeatId): ServerMessage | null {
    if (!this.state) return null
    return {
      t: 'game.sync',
      p: {
        gameId: this.gameId,
        seq: this.state.seq,
        playerView: projectView(this.state, seat),
        players: this.playerSummaries()
      }
    }
  }

  // --- spectators ---------------------------------------------------------------------
  // Only a live ranked game is watchable: public, a rated mode, every seat human.
  // Private and vs-bot games are never exposed (matches the ratings predicate).

  get watchable(): boolean {
    return (
      this.status === 'active' &&
      !this.isPrivate &&
      isRatedMode(this.mode) &&
      this.bindings.every((b) => b.controller === 'human')
    )
  }

  get spectatorCount(): number {
    return this.spectators.size
  }

  /** Current turn number, for the spectator lobby listing (0 before start). */
  get currentTurn(): number {
    return this.state?.turn ?? 0
  }

  addSpectator(session: Session): void {
    this.enqueue(async () => {
      if (this.status !== 'active' || !this.state) {
        session.sendError('unavailable', 'this game is not open to spectators')
        return
      }
      this.spectators.set(session.userId, session)
      const sync = this.spectatorSyncMessage()
      if (sync) session.send(sync)
      if (this.deadline)
        session.send({
          t: 'deadline',
          p: { gameId: this.gameId, phaseRef: this.deadline.key, endsAt: this.deadline.endsAt }
        })
      this.broadcastSpectatorPresence()
    })
  }

  removeSpectator(userId: string): void {
    this.enqueue(async () => {
      if (this.spectators.delete(userId)) this.broadcastSpectatorPresence()
    })
  }

  private spectatorSyncMessage(): ServerMessage | null {
    if (!this.state) return null
    return {
      t: 'game.sync',
      p: {
        gameId: this.gameId,
        seq: this.state.seq,
        playerView: projectSpectatorView(this.state),
        players: this.playerSummaries()
      }
    }
  }

  private broadcastSpectatorPresence(): void {
    const names: string[] = []
    for (const s of this.spectators.values()) names.push(s.profile.nickname)
    const msg: ServerMessage = {
      t: 'spectator.presence',
      p: { gameId: this.gameId, count: names.length, names }
    }
    this.sendToHumans(() => msg)
    for (const s of this.spectators.values()) s.send(msg)
  }

  private sendDeadlineToSpectators(phaseRef: string, endsAt: number | null): void {
    if (this.spectators.size === 0) return
    const msg: ServerMessage = { t: 'deadline', p: { gameId: this.gameId, phaseRef, endsAt } }
    for (const s of this.spectators.values()) s.send(msg)
  }

  // --- deadlines (§5) ------------------------------------------------------------------------

  private armDeadline(): void {
    const key = this.status === 'active' && this.state ? stageKey(this.state) : null
    if (key === (this.deadline?.key ?? null)) return
    if (this.deadline) {
      if (this.deadline.timer) clearTimeout(this.deadline.timer)
      this.deadline = null
    }
    if (key === null || !this.state) {
      this.sendToHumans(() => ({
        t: 'deadline',
        p: { gameId: this.gameId, phaseRef: 'none', endsAt: null }
      }))
      this.sendDeadlineToSpectators('none', null)
      return
    }
    // Coached tutorial: no clock at all. Store a timer-less deadline so the
    // dedup above and the resync/reconnect re-sends keep broadcasting "no
    // deadline" (endsAt null); handleDeadline is never scheduled, so the
    // player is never timed out (bots still move on their own delay).
    if (this.mode === 'tutorial') {
      this.deadline = { key, endsAt: null, timer: null }
      this.sendToHumans(() => ({
        t: 'deadline',
        p: { gameId: this.gameId, phaseRef: key, endsAt: null }
      }))
      this.sendDeadlineToSpectators(key, null)
      this.maybePushTurn()
      return
    }
    const ms = this.openingWaitMs(this.state, stageWaitMs(this.state, this.deps.config.timeouts))
    const endsAt = Date.now() + ms
    const timer = setTimeout(() => {
      this.enqueue(() => this.handleDeadline(key))
    }, ms)
    timer.unref()
    this.deadline = { key, endsAt, timer }
    this.sendToHumans(() => ({
      t: 'deadline',
      p: { gameId: this.gameId, phaseRef: key, endsAt }
    }))
    this.sendDeadlineToSpectators(key, endsAt)
    this.maybePushTurn()
  }

  /**
   * A fresh matchmade game must not sit on the long reading windows: the first
   * turns of a 1v1/ffa3 queue game used to idle ~40s on stacked ack/summary
   * windows (distribution reveal 15s, event ack 10s) before the board felt live.
   * Author rule: the game starts ~2s after the lobby fills. So on turn 1 of a
   * matched game every pure "look at it" window collapses to a short beat; real
   * decisions (placement, cards, RPS, market) keep their full clock. Anything
   * not matched, and every later turn, behaves exactly as before.
   */
  private openingWaitMs(state: GameState, ms: number): number {
    if (!this.matched || state.turn !== 1) return ms
    const t = this.deps.config.timeouts
    // Reading windows only; never a decision window.
    if (ms === t.ackMs || ms === t.summaryMs) return 2000
    return ms
  }

  private async handleDeadline(key: string): Promise<void> {
    if (this.status !== 'active' || !this.state) return
    if (stageKey(this.state) !== key) return
    let guard = 0
    while (this.status === 'active' && this.state && stageKey(this.state) === key && guard < 16) {
      guard += 1
      const waiting = waitingOn(this.state)
      if (waiting.length === 0) break
      const seat = waiting[0] as SeatId
      const ok = await this.applyLocked(seat, { type: 'system.timeout', seat }, {})
      if (!ok) {
        this.deps.log.warn({ gameId: this.gameId, seat, key }, 'timeout default failed')
        break
      }
    }
  }

  // --- bots (§7) --------------------------------------------------------------------------------

  // --- "your turn" pushes -------------------------------------------------------------------

  /** One push per (stage, seat): re-arms and reconnect races must not spam. */
  private readonly pushedStages = new Set<string>()

  /**
   * A waited-on human who is not connected gets a push. Fires from armDeadline
   * (stage advanced while they were away) and onDisconnect (they left mid-turn).
   */
  private maybePushTurn(): void {
    if (!this.deps.push || this.status !== 'active' || !this.state) return
    const key = stageKey(this.state)
    if (key === null) return
    for (const seat of waitingOn(this.state)) {
      const binding = this.bindings.find((b) => b.seat === seat)
      if (!binding?.userId || binding.controller !== 'human' || binding.connected) continue
      const dedupe = `${key}:${seat}`
      if (this.pushedStages.has(dedupe)) continue
      this.pushedStages.add(dedupe)
      void this.deps.push.notifyUser(binding.userId, {
        title: 'Metarchy',
        body: 'Your move — the timer is running.',
        data: { gameId: this.gameId }
      })
    }
  }

  /**
   * Which bot sits in this room's empty seats — recorded on the seat as
   * game_players.bot_strategy, so a past game says which opponent it was:
   *  - tutorial → the scripted mirror bot, which plays to teach;
   *  - a public rated mode → the ranked bot, which plays to win (author: "когда
   *    рейтинговый бой происходит с ботом, надо увеличивать сложность бота");
   *  - anything else (the casual vs Bot button, a private invite game) → the
   *    random-legal bot, which is the friendly sparring partner it always was.
   */
  private get botStrategy(): string {
    if (this.mode === 'tutorial') return 'tutorial-mirror'
    if (!this.isPrivate && isRatedMode(this.mode)) return RANKED_BOT_STRATEGY
    return 'random-legal'
  }

  private chooseIntentForBot(state: GameState, seat: SeatId): Intent | null {
    switch (this.botStrategy) {
      // The mirror bot returns null on simultaneous stages until the player has
      // moved; the player's apply re-runs scheduleBots, so it wakes on its cue.
      case 'tutorial-mirror':
        return chooseTutorialBotIntent(state, seat, this.botRandom)
      case RANKED_BOT_STRATEGY:
        return chooseRankedBotIntent(state, seat, this.botRandom)
      default:
        return chooseBotIntent(state, seat, this.botRandom)
    }
  }

  private botRandom = (): number => {
    const value = randU32(this.botSeedHash, this.botCursor)
    this.botCursor += 1
    return value / 0x1_0000_0000
  }

  private scheduleBots(): void {
    if (this.status !== 'active' || !this.state) return
    const waiting = waitingOn(this.state)
    for (const b of this.bindings) {
      if (b.controller !== 'bot' || this.botPending.has(b.seat)) continue
      if (!waiting.includes(b.seat)) continue
      this.botPending.add(b.seat)
      const { minDelayMs, maxDelayMs } = this.deps.config.bot
      const delay = minDelayMs + Math.floor(this.botRandom() * Math.max(1, maxDelayMs - minDelayMs))
      const timer = setTimeout(() => {
        this.enqueue(async () => {
          this.botPending.delete(b.seat)
          if (this.status !== 'active' || !this.state) return
          if (!waitingOn(this.state).includes(b.seat)) return
          // Which bot sits here is a property of the room, not of the moment —
          // see `botStrategy` / `chooseIntentForBot`.
          const intent = this.chooseIntentForBot(this.state, b.seat)
          if (intent) await this.applyLocked(b.seat, intent, {})
        })
      }, delay)
      timer.unref()
    }
  }

  // --- finish -----------------------------------------------------------------------------------

  private finished = false

  private async finishLocked(): Promise<void> {
    if (this.finished) return
    const state = this.state
    if (!state || state.phase.kind !== 'finished') return
    this.finished = true
    this.status = 'finished'
    if (this.deadline) {
      if (this.deadline.timer) clearTimeout(this.deadline.timer)
      this.deadline = null
    }
    for (const seat of [...this.graceTimers.keys()]) this.cancelGrace(seat)
    this.sendToHumans(() => ({
      t: 'deadline',
      p: { gameId: this.gameId, phaseRef: 'none', endsAt: null }
    }))
    this.sendDeadlineToSpectators('none', null)

    const phase = state.phase
    const vpBySeat = new Map<SeatId, number>()
    for (const entry of phase.ranking) for (const s of entry.seats) vpBySeat.set(s, entry.vp)
    for (const e of state.eliminationLog) if (!vpBySeat.has(e.seat)) vpBySeat.set(e.seat, e.vp)
    const results: GameResultRow[] = this.bindings.map((b) => ({
      seat: b.seat,
      result: phase.winnerSeats.includes(b.seat)
        ? 'win'
        : state.eliminated.includes(b.seat)
          ? 'eliminated'
          : 'lose',
      finalVp: vpBySeat.get(b.seat) ?? null
    }))
    await this.deps.store.writeSnapshot(this.gameId, state.seq, state)
    await this.deps.store.finishGame(this.gameId, {
      status: 'finished',
      results,
      rngSeed: this.seed
    })
    await this.applyRatings(results)
    await this.applyRewards(phase.ranking.map((entry) => entry.seats))
    await this.applyDrops(phase.ranking.map((entry) => entry.seats))
    // Achievements (author's list, 2026-07-27) — same contract as applyRewards:
    // idempotent by primary key, and it can never lose a finished game. Runs
    // AFTER finishGame on purpose: the "played N games" counters read this very
    // game back out of the archive.
    await grantAchievements({
      store: this.deps.store,
      log: this.deps.log,
      gameId: this.gameId,
      state,
      seats: this.bindings.map((b) => ({
        seat: b.seat,
        userId: b.controller === 'human' ? b.userId : null,
        botStrategy: b.controller === 'bot' ? this.botStrategy : null,
        result: results.find((r) => r.seat === b.seat)?.result ?? 'aborted'
      }))
    })
    this.deps.metrics?.gamesFinished.inc({ mode: this.mode, outcome: 'finished' })
    this.deps.log.info(
      { gameId: this.gameId, winners: phase.winnerSeats, turns: state.turn },
      'game finished'
    )
    this.deps.onGameOver(this.gameId)
  }

  /**
   * Ranked games only: a public game, a rated mode, and every seat a human.
   * Private invite games stay unrated — otherwise two friends could farm each
   * other's rating. A rating failure must never lose a finished game, so this
   * logs and moves on.
   */
  private async applyRatings(results: GameResultRow[]): Promise<void> {
    if (this.isPrivate || !isRatedMode(this.mode)) return
    if (this.bindings.some((b) => b.controller !== 'human' || !b.userId)) return

    const resultOf = new Map(results.map((r) => [r.seat, r]))
    const seats: FinishedSeat[] = this.bindings.map((b) => ({
      seat: b.seat,
      userId: b.userId as string,
      finalVp: resultOf.get(b.seat)?.finalVp ?? null,
      won: resultOf.get(b.seat)?.result === 'win'
    }))

    try {
      const rows = await this.deps.store.loadRatings(
        this.mode,
        seats.map((s) => s.userId)
      )
      const before = new Map<string, Rating>(
        [...rows].map(([userId, row]) => [
          userId,
          { rating: row.rating, rd: row.rd, volatility: row.volatility }
        ])
      )
      const changes = rateGame(seats, before)
      await this.deps.store.saveRatings(
        this.gameId,
        this.mode,
        changes.map((c) => ({
          seat: c.seat,
          userId: c.userId,
          ratingBefore: c.before.rating,
          after: c.after
        }))
      )
      this.deps.log.info(
        {
          gameId: this.gameId,
          mode: this.mode,
          changes: changes.map((c) => ({
            userId: c.userId,
            from: Math.round(c.before.rating),
            to: Math.round(c.after.rating)
          }))
        },
        'ratings updated'
      )
    } catch (error) {
      this.deps.log.error({ err: error, gameId: this.gameId }, 'rating update failed')
    }
  }

  /**
   * GATO for ranked play (author's schedule; the ladder lives in rewards.ts).
   * Same gate as the rating update minus the all-human rule — a bot filling a
   * ranked seat still pays the humans, just one step less — so the two are
   * deliberately separate passes. The ledger keeps it idempotent, and a payout
   * failure must never lose a finished game: log and move on.
   */
  private async applyRewards(ranking: SeatId[][]): Promise<void> {
    const credits = rankedRewards({
      mode: this.mode,
      isPrivate: this.isPrivate,
      seats: this.bindings.map((b) => ({
        seat: b.seat,
        userId: b.controller === 'human' ? b.userId : null
      })),
      ranking
    })
    if (credits.length === 0) return
    try {
      const paid = await this.deps.store.creditRewards(this.gameId, credits)
      if (paid.length === 0) return // already paid — a recovered finish
      const balanceOf = new Map(paid.map((p) => [p.seat, p]))
      this.sendToHumans((b) => {
        const p = balanceOf.get(b.seat)
        return p
          ? {
              t: 'gato.reward',
              p: { gameId: this.gameId, amount: p.amount, balance: p.balance }
            }
          : null
      })
      this.deps.log.info(
        { gameId: this.gameId, mode: this.mode, paid: paid.map((p) => [p.seat, p.amount]) },
        'gato rewards credited'
      )
    } catch (error) {
      this.deps.log.error({ err: error, gameId: this.gameId }, 'gato reward credit failed')
    }
  }

  /**
   * Cosmetic drops from a finished ranked game (drops.ts). Same contract as
   * applyRewards: idempotent through the ledger, and a failure here must never
   * lose a finished game — log and move on.
   */
  private async applyDrops(ranking: SeatId[][]): Promise<void> {
    const winners = dropCandidates({
      mode: this.mode,
      isPrivate: this.isPrivate,
      seats: this.bindings.map((b) => ({
        seat: b.seat,
        userId: b.controller === 'human' ? b.userId : null
      })),
      ranking
    })
    if (winners.length === 0) return
    try {
      const landed = new Map<SeatId, string>()
      for (const w of winners) {
        const wallet = await this.deps.store.getWallet(w.userId)
        const itemId = rollDrop(wallet.owned, Math.random())
        // Recorded even when null — "rolled, owned everything" must stay
        // distinguishable from "never rolled" for a recovered finish.
        const first = await this.deps.store.recordDrop(this.gameId, w.seat, w.userId, itemId)
        if (first && itemId) landed.set(w.seat, itemId)
      }
      if (landed.size === 0) return
      this.sendToHumans((b) => {
        const itemId = landed.get(b.seat)
        return itemId ? { t: 'loot.drop', p: { gameId: this.gameId, itemId } } : null
      })
      this.deps.log.info(
        { gameId: this.gameId, mode: this.mode, drops: [...landed] },
        'cosmetic drops granted'
      )
    } catch (error) {
      this.deps.log.error({ err: error, gameId: this.gameId }, 'cosmetic drop failed')
    }
  }

  /** Lobby died (everyone left) — persist the abort and unload. */
  abort(): void {
    this.enqueue(async () => {
      if (this.status !== 'lobby') return
      this.status = 'aborted'
      await this.deps.store.finishGame(this.gameId, {
        status: 'aborted',
        results: [],
        rngSeed: null
      })
      this.deps.metrics?.gamesFinished.inc({ mode: this.mode, outcome: 'aborted' })
      this.deps.onGameOver(this.gameId)
    })
  }
}
