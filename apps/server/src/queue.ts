// The live matchmaking queue: a ticker over the pure pairing rules in
// matchmaking.ts. Queueing is consent, so a match starts its game immediately —
// there is no lobby and no ready-up to sit through.

import type { RankedMode } from '@metarchy/protocol'
import type { MatchmakingConfig, Waiting } from './matchmaking.js'
import {
  botFallbackCandidates,
  findMatch,
  isQueueMode,
  QUEUE_MODES,
  seatsForMode,
  windowFor
} from './matchmaking.js'
import type { Metrics } from './metrics.js'
import type { RatedMode } from './ratings.js'
import { UNRATED } from './ratings.js'
import type { LoggerLike } from './rooms/room.js'
import type { RoomManager } from './rooms/manager.js'
import type { Session } from './session.js'
import type { GameStore } from './store.js'

interface Entry extends Waiting {
  session: Session
  mode: RatedMode
  /** Arrival order. Wall-clock ties on a busy tick; a counter never does. */
  arrival: number
  /** Last status this player was told, so ticks stay silent until it changes. */
  lastSent: { position: number; widenedRange: boolean; found: string; botAt: number | null } | null
}

export interface QueueDeps {
  config: MatchmakingConfig
  manager: RoomManager
  store: GameStore
  log: LoggerLike
  metrics?: Metrics
  /** Injectable for tests. */
  now?: () => number
}

export class MatchmakingQueue {
  private readonly entries = new Map<string, Entry>()
  private timer: NodeJS.Timeout | null = null
  private nextArrival = 0
  private readonly now: () => number

  constructor(private readonly deps: QueueDeps) {
    this.now = deps.now ?? (() => Date.now())
  }

  /** Idempotent; the ticker never keeps the process alive on its own. */
  private ensureTicking(): void {
    if (this.timer || this.entries.size === 0) return
    this.timer = setInterval(() => void this.tick(), this.deps.config.tickMs)
    this.timer.unref?.()
  }

  private stopTickingIfIdle(): void {
    if (this.entries.size > 0 || !this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async join(session: Session, mode: RankedMode, seq?: number): Promise<void> {
    if (!isQueueMode(mode)) {
      session.sendError('unavailable', `${mode} is not matchmade yet`, {
        ...(seq !== undefined ? { seq } : {})
      })
      return
    }
    if (this.deps.manager.activeGameFor(session.userId)) {
      session.sendError('already_in_game', 'finish or forfeit your current game first', {
        ...(seq !== undefined ? { seq } : {})
      })
      return
    }

    const existing = this.entries.get(session.userId)
    if (existing) {
      // Re-joining the same mode is a no-op; switching modes restarts the wait.
      if (existing.mode === mode) {
        this.sendStatus(existing, seq)
        return
      }
      this.entries.delete(session.userId)
    }

    const ratings = await this.deps.store.loadRatings(mode, [session.userId])
    const entry: Entry = {
      session,
      mode,
      userId: session.userId,
      rating: ratings.get(session.userId)?.rating ?? UNRATED.rating,
      joinedAtMs: this.now(),
      arrival: this.nextArrival++,
      lastSent: null
    }
    this.entries.set(session.userId, entry)
    this.sendStatus(entry, seq, { force: true })
    this.ensureTicking()
    // A match may already be waiting for this player.
    await this.tick()
  }

  leave(userId: string): void {
    if (!this.entries.delete(userId)) return
    this.stopTickingIfIdle()
    this.broadcastStatus()
  }

  /** Called when a session drops; a disconnected player must not be matched. */
  onSessionGone(userId: string): void {
    this.leave(userId)
  }

  get size(): number {
    return this.entries.size
  }

  /** For the /metrics gauge. */
  waitingByMode(): { mode: string; waiting: number }[] {
    const counts = new Map<string, number>()
    for (const e of this.entries.values()) counts.set(e.mode, (counts.get(e.mode) ?? 0) + 1)
    return [...counts].map(([mode, waiting]) => ({ mode, waiting }))
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.entries.clear()
  }

  private of(mode: RatedMode): Entry[] {
    return [...this.entries.values()].filter((e) => e.mode === mode)
  }

  /** Position is by arrival: the queue is a line, even though pairing is not. */
  private positionOf(entry: Entry): number {
    const ahead = this.of(entry.mode).filter((e) => e.arrival < entry.arrival).length
    return ahead + 1
  }

  /**
   * Silent unless something the player can see actually moved. A tick every
   * second must not become a message every second — and `botAt` is a fixed
   * instant, not a countdown, precisely so it does not change every tick.
   */
  private sendStatus(entry: Entry, seq?: number, opts: { force?: boolean } = {}): void {
    const waited = this.now() - entry.joinedAtMs
    const seats = seatsForMode(entry.mode)
    // Everyone else queued for this mode, longest wait first: at the deadline
    // they are seated together, so this roster is a promise the queue keeps.
    const others = this.of(entry.mode)
      .filter((e) => e.userId !== entry.userId)
      .sort((a, b) => a.arrival - b.arrival)
      .slice(0, seats - 1)
    const next = {
      position: this.positionOf(entry),
      widenedRange: windowFor(waited, this.deps.config) > this.deps.config.baseWindow,
      seats,
      found: others.map((e) => ({
        nickname: e.session.profile.nickname,
        avatar: e.session.profile.avatar
      })),
      botAt:
        this.deps.config.botFallbackMs > 0
          ? entry.joinedAtMs + this.deps.config.botFallbackMs
          : null
    }
    const fingerprint = next.found.map((f) => f.nickname).join('\u0000')
    const unchanged =
      entry.lastSent?.position === next.position &&
      entry.lastSent.widenedRange === next.widenedRange &&
      entry.lastSent.botAt === next.botAt &&
      entry.lastSent.found === fingerprint
    if (unchanged && !opts.force) return

    entry.lastSent = { ...next, found: fingerprint }
    entry.session.send({
      t: 'queue.status',
      ...(seq !== undefined ? { seq } : {}),
      p: { mode: entry.mode, ...next }
    })
  }

  private broadcastStatus(): void {
    for (const entry of this.entries.values()) this.sendStatus(entry)
  }

  private async tick(): Promise<void> {
    try {
      for (const mode of QUEUE_MODES) await this.drainMode(mode)
      this.broadcastStatus()
      this.stopTickingIfIdle()
    } catch (error) {
      this.deps.log.error({ err: error }, 'matchmaking tick failed')
    }
  }

  private async drainMode(mode: RatedMode): Promise<void> {
    const seats = seatsForMode(mode)

    // Keep matching until the remaining players cannot form another game.
    for (;;) {
      const pool = this.of(mode)
      const match = findMatch(pool, seats, this.now(), this.deps.config)
      if (!match) break
      for (const entry of match) this.entries.delete(entry.userId)
      this.deps.metrics?.matches.inc({ mode, fill: 'humans' })
      await this.startMatch(
        match.map((e) => e.session),
        mode,
        0
      )
    }

    // The minute is up for at least one of them: the game starts in the RANKED
    // mode with bots in the seats nobody claimed — not as a vs_bots game, which
    // is what this used to do. That mattered in three places at once: the author
    // asks for "два игрока, а третий не нашёлся и добавился бот" (impossible
    // when each straggler got their own solo game), the ranked GATO schedule has
    // rows for a bot in a rated game (rewards.ts), and the harder ranked bot only
    // sits in public rated rooms (room.ts botStrategy). Ratings still do not move
    // — applyRatings wants every seat human — so nobody farms rating off a bot.
    const stale = botFallbackCandidates(this.of(mode), this.now(), this.deps.config)
    if (stale.length === 0) return
    const seated = stale
      .map((e) => this.entries.get(e.userId))
      .filter((e): e is Entry => e !== undefined)
      .sort((a, b) => a.arrival - b.arrival)
      .slice(0, seats)
    if (seated.length === 0) return
    for (const entry of seated) this.entries.delete(entry.userId)
    this.deps.metrics?.matches.inc({ mode, fill: 'bots' })
    await this.startMatch(
      seated.map((e) => e.session),
      mode,
      seats - seated.length
    )
  }

  private async startMatch(sessions: Session[], mode: RatedMode, botSeats: number): Promise<void> {
    try {
      const { room, seatOf } = await this.deps.manager.createMatched(sessions, mode, botSeats)
      const seats = room.playerSummaries()
      for (const session of sessions) {
        const seat = seatOf.get(session.userId)
        if (seat === undefined) continue
        session.send({
          t: 'match.found',
          p: { gameId: room.gameId, mode: room.mode, seat, seats }
        })
      }
      this.deps.log.info(
        { gameId: room.gameId, mode, humans: sessions.length, botSeats },
        'match found'
      )
      room.start()
    } catch (error) {
      this.deps.log.error({ err: error, mode }, 'could not start a matched game')
      for (const session of sessions)
        session.sendError('internal', 'could not start the match — try again')
    }
  }
}
