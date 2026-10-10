// RoomManager: registry gameId→room, invite codes, one-active-game-per-user.
// Creates vs_bots games (start immediately) and private invite lobbies
// (architecture/Platform-Services.md §3); the matchmaking queue is Stage 4.

import { randomBytes, randomUUID } from 'node:crypto'
import type { Mode, SeatId } from '@metarchy/engine'
import { applyIntent, RULES_VERSION, SEATS_PER_MODE } from '@metarchy/engine'
import type { ErrorCode, WatchableGame } from '@metarchy/protocol'
import type { ProfileStore } from '../profiles.js'
import { seedCommitment } from '../proof.js'
import type { Session } from '../session.js'
import type { GameStore } from '../store.js'
import type { LoggerLike, RoomDeps, SeatBinding, SessionDirectory } from './room.js'
import { GameRoom } from './room.js'

export class RoomError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'RoomError'
  }
}

/** No lookalike characters (I/O/0/1). */
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export interface ManagerDeps {
  config: RoomDeps['config']
  store: GameStore
  sessions: SessionDirectory
  log: LoggerLike
  metrics?: RoomDeps['metrics']
  push?: RoomDeps['push']
}

export interface ActiveGameRef {
  gameId: string
  mode: Mode
  seat: SeatId
  status: 'lobby' | 'active'
}

export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>()
  private readonly byInvite = new Map<string, string>()
  private readonly byUser = new Map<string, string>()
  /** userId → gameId they are watching (at most one; not a seat). */
  private readonly spectating = new Map<string, string>()

  constructor(private readonly deps: ManagerDeps) {}

  roomOf(gameId: string): GameRoom | undefined {
    return this.rooms.get(gameId)
  }

  roomOfUser(userId: string): GameRoom | undefined {
    const gameId = this.byUser.get(userId)
    return gameId ? this.rooms.get(gameId) : undefined
  }

  activeGameFor(userId: string): ActiveGameRef | null {
    const room = this.roomOfUser(userId)
    if (!room || (room.status !== 'lobby' && room.status !== 'active')) return null
    const binding = room.bindingOf(userId)
    if (!binding) return null
    return { gameId: room.gameId, mode: room.mode, seat: binding.seat, status: room.status }
  }

  private roomDeps(): RoomDeps {
    return {
      config: this.deps.config,
      store: this.deps.store,
      sessions: this.deps.sessions,
      log: this.deps.log,
      ...(this.deps.metrics ? { metrics: this.deps.metrics } : {}),
      ...(this.deps.push ? { push: this.deps.push } : {}),
      onGameOver: (gameId) => this.unregister(gameId),
      // Elimination ends *their* game: drop the one-active-game hold so they can
      // queue or create again while the table plays on (they keep their seat
      // binding, so an open tab still spectates the rest of the game).
      onEliminated: (gameId, userId) => {
        if (this.byUser.get(userId) === gameId) this.byUser.delete(userId)
      }
    }
  }

  async create(
    session: Session,
    p: { mode: Mode; private?: boolean; seatCount?: 2 | 3 },
    seq?: number
  ): Promise<void> {
    if (this.byUser.has(session.userId))
      throw new RoomError('already_in_game', 'finish or forfeit your current game first')
    this.leaveSpectate(session.userId)

    const gameId = randomUUID()
    const seed = randomBytes(32).toString('hex')

    // Tutorial rides the vs_bots path: created directly, started immediately,
    // filled with bots. It differs only in the room (no deadlines — see
    // GameRoom.armDeadline) and is fixed at one human + one bot.
    if (p.mode === 'vs_bots' || p.mode === 'tutorial') {
      const seatsTotal = p.mode === 'tutorial' ? 2 : (p.seatCount ?? 2)
      const room = new GameRoom(this.roomDeps(), {
        gameId,
        mode: p.mode,
        isPrivate: false,
        inviteCode: null,
        seatsTotal,
        seed
      })
      await this.deps.store.createGame({
        gameId,
        mode: p.mode,
        status: 'lobby',
        isPrivate: false,
        inviteCode: null,
        rulesVersion: RULES_VERSION,
        rngSeedHash: seedCommitment(seed)
      })
      const seat = room.addSeat(
        session.userId,
        session.profile.nickname,
        session.profile.avatar,
        'human',
        session.profile.wardrobe ?? null
      )
      for (let i = 1; i < seatsTotal; i++) room.addSeat(null, `Bot ${i}`, null, 'bot')
      this.rooms.set(gameId, room)
      this.byUser.set(session.userId, gameId)
      this.reply(session, gameId, p.mode, seat, null, seq)
      room.start()
      return
    }

    if (!p.private)
      throw new RoomError(
        'unavailable',
        'public matchmaking ships in Stage 4 — create a private game'
      )

    const seatsTotal = SEATS_PER_MODE[p.mode][0] as number
    const inviteCode = this.newInviteCode()
    const room = new GameRoom(this.roomDeps(), {
      gameId,
      mode: p.mode,
      isPrivate: true,
      inviteCode,
      seatsTotal,
      seed
    })
    await this.deps.store.createGame({
      gameId,
      mode: p.mode,
      status: 'lobby',
      isPrivate: true,
      inviteCode,
      rulesVersion: RULES_VERSION,
      rngSeedHash: seedCommitment(seed)
    })
    const seat = room.addSeat(
      session.userId,
      session.profile.nickname,
      session.profile.avatar,
      'human',
      session.profile.wardrobe ?? null
    )
    this.rooms.set(gameId, room)
    this.byInvite.set(inviteCode, gameId)
    this.byUser.set(session.userId, gameId)
    this.reply(session, gameId, p.mode, seat, inviteCode, seq)
    room.broadcastLobby()
  }

  join(session: Session, inviteCodeRaw: string, seq?: number): void {
    const inviteCode = inviteCodeRaw.toUpperCase()
    const gameId = this.byInvite.get(inviteCode)
    const room = gameId ? this.rooms.get(gameId) : undefined
    if (!room || room.status !== 'lobby')
      throw new RoomError('not_found', 'no open lobby with this invite code')
    if (this.byUser.has(session.userId))
      throw new RoomError('already_in_game', 'finish or forfeit your current game first')
    if (room.isFull) throw new RoomError('lobby_full', 'this lobby is already full')
    this.leaveSpectate(session.userId)
    const seat = room.addSeat(
      session.userId,
      session.profile.nickname,
      session.profile.avatar,
      'human',
      session.profile.wardrobe ?? null
    )
    this.byUser.set(session.userId, room.gameId)
    this.reply(session, room.gameId, room.mode, seat, inviteCode, seq)
    room.broadcastLobby()
  }

  ready(session: Session, gameId: string, seq?: number): void {
    const room = this.rooms.get(gameId)
    if (!room) throw new RoomError('not_found', 'no such game')
    const binding = room.bindingOf(session.userId)
    if (!binding) throw new RoomError('not_in_game', 'you have no seat in this game')
    if (room.status !== 'lobby') return
    room.setReady(session.userId)
    room.broadcastLobby()
    void seq
    if (room.allHumansReady) room.start()
  }

  pickTeam(session: Session, gameId: string, team: 0 | 1, seq?: number): void {
    const room = this.rooms.get(gameId)
    if (!room) throw new RoomError('not_found', 'no such game')
    if (!room.bindingOf(session.userId))
      throw new RoomError('not_in_game', 'you have no seat in this game')
    void seq
    if (room.setTeamPref(session.userId, team) === 'unavailable')
      throw new RoomError('unavailable', 'that team is full, the game started, or you are ready')
    room.broadcastLobby()
  }

  onSessionAttach(session: Session, resume?: { gameId: string; lastEventSeq: number }): void {
    const room = this.roomOfUser(session.userId)
    room?.attachSession(session, resume)
  }

  onSessionDetach(userId: string): void {
    this.leaveSpectate(userId)
    const room = this.roomOfUser(userId)
    if (!room) return
    if (room.status === 'lobby') {
      this.dropFromLobby(room, userId)
      return
    }
    room.onDisconnect(userId)
  }

  /** Remove a user from a lobby and free them; abort the room if it emptied. */
  private dropFromLobby(room: GameRoom, userId: string): void {
    room.removeFromLobby(userId)
    this.byUser.delete(userId)
    if (room.humanBindings.length === 0) room.abort()
  }

  /** Explicit "Leave" from the lobby screen — same effect as dropping the socket. */
  leaveLobby(session: Session, gameId: string, seq?: number): void {
    const room = this.rooms.get(gameId)
    if (!room || !room.bindingOf(session.userId)) {
      session.sendError('not_in_game', 'you have no seat in this game', {
        ...(seq !== undefined ? { seq } : {})
      })
      return
    }
    if (room.status !== 'lobby') {
      session.sendError('unavailable', 'the game already started — forfeit instead', {
        ...(seq !== undefined ? { seq } : {})
      })
      return
    }
    this.dropFromLobby(room, session.userId)
  }

  // --- spectating (ranked games only) --------------------------------------------------

  /** The live ranked games a watcher may join. */
  listWatchable(): WatchableGame[] {
    const out: WatchableGame[] = []
    for (const room of this.rooms.values()) {
      if (!room.watchable) continue
      out.push({
        gameId: room.gameId,
        mode: room.mode,
        turn: room.currentTurn,
        players: room.playerSummaries(),
        spectators: room.spectatorCount
      })
    }
    return out
  }

  spectateJoin(session: Session, gameId: string, seq?: number): void {
    const room = this.rooms.get(gameId)
    if (!room || !room.watchable) throw new RoomError('not_found', 'no ranked game to watch here')
    if (this.byUser.has(session.userId))
      throw new RoomError('already_in_game', 'leave your own game before spectating')
    // Switch cleanly if already watching a different game on this connection.
    const prev = this.spectating.get(session.userId)
    if (prev && prev !== gameId) this.leaveSpectate(session.userId)
    this.spectating.set(session.userId, gameId)
    session.send({
      t: 'spectate.joined',
      ...(seq !== undefined ? { seq } : {}),
      p: { gameId, mode: room.mode, players: room.playerSummaries() }
    })
    room.addSpectator(session)
  }

  /** Tolerant: safe to call when the game is already gone (finished). */
  spectateLeave(userId: string, gameId?: string): void {
    const watching = this.spectating.get(userId)
    if (!watching || (gameId !== undefined && watching !== gameId)) return
    this.spectating.delete(userId)
    this.rooms.get(watching)?.removeSpectator(userId)
  }

  /** Drop the user from whatever they are watching (used on detach / entering a game). */
  private leaveSpectate(userId: string): void {
    this.spectateLeave(userId)
  }

  /**
   * A game the matchmaker assembled: public (so it is rated), no lobby and no
   * ready-up — queueing *was* the consent. `botSeats` fills the rest when the
   * queue gives up on finding humans.
   */
  async createMatched(
    sessions: Session[],
    mode: Mode,
    botSeats = 0
  ): Promise<{ room: GameRoom; seatOf: Map<string, SeatId> }> {
    const gameId = randomUUID()
    const seed = randomBytes(32).toString('hex')
    const room = new GameRoom(this.roomDeps(), {
      gameId,
      mode,
      isPrivate: false,
      inviteCode: null,
      seatsTotal: sessions.length + botSeats,
      seed,
      // A queue-made game: consent was queueing, so it opens on the fast beat
      // (room.openingWaitMs) instead of the long reading windows.
      matched: true
    })
    await this.deps.store.createGame({
      gameId,
      mode,
      status: 'lobby',
      isPrivate: false,
      inviteCode: null,
      rulesVersion: RULES_VERSION,
      rngSeedHash: seedCommitment(seed)
    })

    const seatOf = new Map<string, SeatId>()
    for (const session of sessions)
      seatOf.set(
        session.userId,
        room.addSeat(
          session.userId,
          session.profile.nickname,
          session.profile.avatar,
          'human',
          session.profile.wardrobe ?? null
        )
      )
    for (let i = 1; i <= botSeats; i++) room.addSeat(null, `Bot ${i}`, null, 'bot')

    this.rooms.set(gameId, room)
    for (const session of sessions) {
      this.leaveSpectate(session.userId)
      this.byUser.set(session.userId, gameId)
    }
    return { room, seatOf }
  }

  private reply(
    session: Session,
    gameId: string,
    mode: Mode,
    seat: SeatId,
    inviteCode: string | null,
    seq?: number
  ): void {
    session.send({
      t: 'game.created',
      ...(seq !== undefined ? { seq } : {}),
      p: { gameId, mode, seat, inviteCode }
    })
  }

  private newInviteCode(): string {
    for (let attempt = 0; attempt < 32; attempt++) {
      let code = ''
      const bytes = randomBytes(6)
      for (let i = 0; i < 6; i++)
        code += INVITE_ALPHABET[(bytes[i] as number) % INVITE_ALPHABET.length]
      if (!this.byInvite.has(code)) return code
    }
    throw new Error('could not generate a unique invite code')
  }

  /**
   * Boot recovery (architecture/Game-Server.md §8): stale lobbies are aborted;
   * every active game is rebuilt as latest snapshot + engine replay of the
   * logged intents, verified against the logged event seq before going live.
   */
  async recoverFromStore(profiles: ProfileStore): Promise<{ recovered: number; aborted: number }> {
    let recovered = 0
    let aborted = 0
    for (const gameId of await this.deps.store.listGamesByStatus('lobby')) {
      await this.deps.store.finishGame(gameId, { status: 'aborted', results: [], rngSeed: null })
      aborted += 1
    }
    for (const gameId of await this.deps.store.listGamesByStatus('active')) {
      try {
        recovered += await this.recoverGame(gameId, profiles)
      } catch (error) {
        this.deps.log.error({ err: error, gameId }, 'recovery failed — aborting game')
        await this.deps.store.finishGame(gameId, { status: 'aborted', results: [], rngSeed: null })
        aborted += 1
      }
    }
    return { recovered, aborted }
  }

  private async recoverGame(gameId: string, profiles: ProfileStore): Promise<number> {
    const loaded = await this.deps.store.loadGame(gameId)
    if (!loaded) throw new Error('game row disappeared')
    const snapshot = await this.deps.store.loadLatestSnapshot(gameId)
    if (!snapshot) throw new Error('active game has no snapshot')

    let state = snapshot.state
    for (const { seat, intent } of await this.deps.store.loadIntentsAfter(gameId, snapshot.seq)) {
      const result = applyIntent(state, seat, intent)
      if (!result.ok) throw new Error(`replay rejected: ${result.error.code}`)
      state = result.state
    }
    const tail = await this.deps.store.loadEventsAfter(gameId, snapshot.seq)
    const lastLogged = tail.length > 0 ? (tail[tail.length - 1]?.seq ?? snapshot.seq) : snapshot.seq
    if (state.seq !== lastLogged)
      throw new Error(`replay divergence: state seq ${state.seq}, log seq ${lastLogged}`)

    const bindings: SeatBinding[] = []
    for (const p of [...loaded.players].sort((x, y) => x.seat - y.seat)) {
      const profile = p.userId ? await profiles.getOrCreate(p.userId, null) : null
      bindings.push({
        seat: p.seat,
        userId: p.userId,
        nickname: profile?.nickname ?? `Bot ${p.seat}`,
        avatar: profile?.avatar ?? null,
        wardrobe: profile?.wardrobe ?? null,
        controller: p.botStrategy ? 'bot' : 'human',
        ready: true,
        connected: false
      })
    }
    const room = new GameRoom(this.roomDeps(), {
      gameId,
      mode: loaded.game.mode,
      isPrivate: loaded.game.isPrivate,
      inviteCode: loaded.game.inviteCode,
      seatsTotal: bindings.length,
      seed: state.meta.seed
    })
    this.rooms.set(gameId, room)
    // Eliminated players were already released pre-crash — do not re-capture them.
    for (const b of bindings)
      if (b.userId && !state.eliminated.includes(b.seat)) this.byUser.set(b.userId, gameId)
    room.restore(state, bindings)
    this.deps.log.info({ gameId, seq: state.seq }, 'game recovered')
    return 1
  }

  private unregister(gameId: string): void {
    const room = this.rooms.get(gameId)
    if (!room) return
    for (const b of room.humanBindings) {
      if (b.userId && this.byUser.get(b.userId) === gameId) this.byUser.delete(b.userId)
    }
    for (const [userId, gid] of this.spectating) if (gid === gameId) this.spectating.delete(userId)
    if (room.inviteCode) this.byInvite.delete(room.inviteCode)
    this.rooms.delete(gameId)
  }

  /** For /healthz and tests. */
  get roomCount(): number {
    return this.rooms.size
  }
}
