// One load player = one WS connection playing one vs_bots game like the real
// browser client does: it folds no events by hand — every event burst schedules
// a debounced game.resync (80ms, matching apps/client), decisions come from the
// view-driven autoplayer after a human-ish think delay. Lean JSON parsing on
// purpose (no zod): a generator process fans out to hundreds of sockets.

import type { PlayerView } from '@metarchy/engine'
import { WebSocket } from 'ws'
import type { Random } from '../autoplayer.js'
import { chooseFromView } from '../autoplayer.js'
import type { StatsSnapshot } from './stats.js'
import { recordLatency } from './stats.js'

export interface PlayerOpts {
  url: string
  token: string
  userId: string
  seatCount: 2 | 3
  rng: Random
  stats: StatsSnapshot
  thinkMinMs: number
  thinkMaxMs: number
  resyncDebounceMs: number
  /** Called exactly once; the worker respawns the slot in steady-state mode. */
  onDone(outcome: 'finished' | 'failed', detail?: string): void
  debug?: (line: string) => void
}

const IDLE_RESYNC_MS = 60_000
const STUCK_MS = 150_000
const CREATE_RETRY_MS = 2_000
const CREATE_RETRIES = 5
const POST_INTENT_RESYNC_MS = 2_500

export class LoadPlayer {
  private ws: WebSocket | null = null
  private view: PlayerView | null = null
  private gameId: string | null = null
  private seat = -1
  private seq = 100
  private readonly rttBySeq = new Map<number, number>()
  private resyncTimer: NodeJS.Timeout | null = null
  private actTimer: NodeJS.Timeout | null = null
  private postIntentTimer: NodeJS.Timeout | null = null
  private watchdog: NodeJS.Timeout | null = null
  private lastInboundAt = Date.now()
  private lastSyncAt = 0
  private awaitingSyncSince = 0
  private nextActEarliest = 0
  private createAttempts = 0
  private sawFinished = false
  private done = false
  private readonly startedAt = Date.now()

  constructor(private readonly o: PlayerOpts) {}

  start(): void {
    const ws = new WebSocket(this.o.url, { perMessageDeflate: false })
    this.ws = ws
    ws.on('open', () => {
      this.send({ t: 'hello', p: { accessToken: this.o.token } })
    })
    ws.on('message', (data) => this.onMessage(data as Buffer))
    ws.on('error', (err) => {
      if (!this.done) this.fail(`socket error: ${err.message}`)
    })
    ws.on('close', () => {
      if (!this.done) {
        this.o.stats.counters.socketDrops++
        this.fail('socket closed unexpectedly')
      }
    })
    this.watchdog = setInterval(() => this.checkLiveness(), 15_000)
  }

  private onMessage(data: Buffer): void {
    if (this.done) return
    this.lastInboundAt = Date.now()
    this.o.stats.counters.msgsIn++
    this.o.stats.counters.bytesIn += data.length
    let msg: { t: string; seq?: number; p?: Record<string, unknown> }
    try {
      msg = JSON.parse(data.toString('utf8'))
    } catch {
      this.fail('unparseable server frame')
      return
    }
    switch (msg.t) {
      case 'welcome': {
        const active = (msg.p as { activeGame?: { gameId: string; status: string } }).activeGame
        if (active && active.status === 'active') {
          // A previous life of this user still owns a running game — adopt it.
          this.gameId = active.gameId
          this.resyncNow()
        } else {
          this.createGame()
        }
        return
      }
      case 'game.created': {
        const p = msg.p as { gameId: string; seat: number }
        this.gameId = p.gameId
        this.seat = p.seat
        this.o.stats.counters.gamesStarted++
        // start() pushes game.started + an unsolicited game.sync — just wait.
        return
      }
      case 'game.sync': {
        const p = msg.p as unknown as { gameId: string; playerView: PlayerView }
        if (p.gameId !== this.gameId) return
        const sentAt = msg.seq !== undefined ? this.rttBySeq.get(msg.seq) : undefined
        if (sentAt !== undefined) {
          this.rttBySeq.delete(msg.seq as number)
          recordLatency(this.o.stats.resyncRtt, Date.now() - sentAt)
        }
        this.lastSyncAt = Date.now()
        this.awaitingSyncSince = 0
        this.view = p.playerView
        this.seat = p.playerView.seat
        if (p.playerView.phase.kind === 'finished') {
          this.finish()
          return
        }
        this.maybeAct()
        return
      }
      case 'game.event': {
        const p = msg.p as { gameId: string; event: { type: string } }
        if (p.gameId !== this.gameId) return
        if (p.event.type === 'game.finished') {
          this.sawFinished = true
          this.finish()
          return
        }
        this.scheduleResync()
        return
      }
      case 'error':
        this.onError(
          (msg.p as { code: string; message: string }).code,
          (msg.p as { code: string; message: string }).message,
          msg.seq
        )
        return
      default:
        // lobby.state / deadline / presence / pong / chat — irrelevant to load.
        return
    }
  }

  private onError(code: string, message: string, seq?: number): void {
    void seq
    if (code === 'rule_violation') {
      // Acted on a stale view (bot moved first) — refresh and retry.
      this.o.stats.counters.ruleViolations++
      this.awaitingSyncSince = 0
      this.resyncNow()
      return
    }
    if (code === 'rate_limited') {
      this.o.stats.counters.rateLimited++
      this.nextActEarliest = Date.now() + 2_000
      return
    }
    if (code === 'already_in_game') {
      if (this.createAttempts <= CREATE_RETRIES) {
        setTimeout(() => this.createGame(), CREATE_RETRY_MS).unref()
      } else {
        this.fail('already_in_game persisted across retries')
      }
      return
    }
    if (code === 'not_found') {
      // A resync can cross game.finished on the wire; give the event a moment.
      setTimeout(() => {
        if (!this.done && !this.sawFinished) this.fail('room vanished without game.finished')
      }, 800).unref()
      return
    }
    this.o.stats.counters.otherErrors[code] = (this.o.stats.counters.otherErrors[code] ?? 0) + 1
    this.fail(`server error ${code}: ${message}`)
  }

  private createGame(): void {
    this.createAttempts++
    this.send({
      t: 'game.create',
      seq: this.seq++,
      p: { mode: 'vs_bots', seatCount: this.o.seatCount }
    })
  }

  private scheduleResync(): void {
    if (this.resyncTimer || this.done) return
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null
      this.resyncNow()
    }, this.o.resyncDebounceMs)
  }

  private resyncNow(): void {
    if (this.done || !this.gameId) return
    const seq = this.seq++
    this.rttBySeq.set(seq, Date.now())
    if (this.rttBySeq.size > 32) {
      const oldest = this.rttBySeq.keys().next().value as number
      this.rttBySeq.delete(oldest)
    }
    this.o.stats.counters.resyncsSent++
    this.send({ t: 'game.resync', seq, p: { gameId: this.gameId } })
  }

  private maybeAct(): void {
    if (this.done || this.actTimer || !this.view || !this.gameId) return
    if (this.awaitingSyncSince > 0) return
    if (!this.view.waitingOn.includes(this.view.seat)) return
    const think = this.o.thinkMinMs + this.o.rng() * (this.o.thinkMaxMs - this.o.thinkMinMs)
    const delay = Math.max(think, this.nextActEarliest - Date.now())
    this.actTimer = setTimeout(() => {
      this.actTimer = null
      this.act()
    }, delay)
  }

  private act(): void {
    if (this.done || !this.view || !this.gameId) return
    if (!this.view.waitingOn.includes(this.view.seat)) return
    const intent = chooseFromView(this.view, this.o.rng)
    if (!intent) return
    const sentAt = Date.now()
    this.awaitingSyncSince = sentAt
    this.o.stats.counters.intentsSent++
    this.send({ t: 'intent', seq: this.seq++, p: { gameId: this.gameId, intent } })
    // An accepted intent normally produces events → debounced resync. If nothing
    // visible comes back (sealed commits), nudge like an impatient client would.
    if (this.postIntentTimer) clearTimeout(this.postIntentTimer)
    this.postIntentTimer = setTimeout(() => {
      this.postIntentTimer = null
      if (!this.done && this.lastSyncAt < sentAt) this.resyncNow()
    }, POST_INTENT_RESYNC_MS)
  }

  private checkLiveness(): void {
    if (this.done) return
    const idle = Date.now() - this.lastInboundAt
    if (idle > STUCK_MS) {
      this.o.stats.counters.gamesStuck++
      this.fail(`stuck: no server traffic for ${Math.round(idle / 1000)}s`)
      return
    }
    if (idle > IDLE_RESYNC_MS && this.gameId) this.resyncNow()
    // A lost sync reply must not gate acting forever.
    if (this.awaitingSyncSince > 0 && Date.now() - this.awaitingSyncSince > 10_000) {
      this.awaitingSyncSince = 0
      this.resyncNow()
    }
  }

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.o.stats.counters.msgsOut++
      this.ws.send(JSON.stringify(msg))
    }
  }

  private finish(): void {
    if (this.done) return
    this.o.stats.counters.gamesFinished++
    recordLatency(this.o.stats.gameDurationS, (Date.now() - this.startedAt) / 1000)
    this.teardown()
    this.o.onDone('finished')
  }

  private fail(detail: string): void {
    if (this.done) return
    this.o.stats.counters.gamesFailed++
    this.o.debug?.(`[${this.o.userId.slice(0, 8)}] ${detail}`)
    this.teardown()
    this.o.onDone('failed', detail)
  }

  private teardown(): void {
    this.done = true
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
    if (this.actTimer) clearTimeout(this.actTimer)
    if (this.postIntentTimer) clearTimeout(this.postIntentTimer)
    if (this.watchdog) clearInterval(this.watchdog)
    try {
      this.ws?.close()
    } catch {
      // closing a dying socket is best-effort
    }
    // Let close/error events find `done` set; drop the reference for GC.
    this.ws?.removeAllListeners('close')
    this.ws?.removeAllListeners('error')
    this.ws = null
    this.view = null
  }

  /** External stop (end of run): tear down without counting an outcome. */
  stop(): void {
    if (this.done) return
    this.done = true
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
    if (this.actTimer) clearTimeout(this.actTimer)
    if (this.postIntentTimer) clearTimeout(this.postIntentTimer)
    if (this.watchdog) clearInterval(this.watchdog)
    this.ws?.removeAllListeners('close')
    this.ws?.removeAllListeners('error')
    try {
      this.ws?.close()
    } catch {
      // best-effort
    }
    this.ws = null
  }
}
