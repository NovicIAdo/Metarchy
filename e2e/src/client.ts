// Protocol-level scripted game client: connects, authenticates, and can play a
// full game to the end through the real WS pipeline using the view-driven
// autoplayer. Knows nothing about server internals — protocol messages only.

import type { Mode, PlayerView } from '@metarchy/engine'
import type { ServerMessage, ServerMessageOf } from '@metarchy/protocol'
import { ServerMessageSchema } from '@metarchy/protocol'
import { WebSocket } from 'ws'
import type { Random } from './autoplayer.js'
import { chooseFromView } from './autoplayer.js'

interface Waiter {
  predicate: (msg: ServerMessage) => boolean
  resolve: (msg: ServerMessage) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export interface GameOutcome {
  winnerSeats: number[]
  ranking: { seats: number[]; vp: number }[]
}

export class GameClient {
  private readonly inbox: ServerMessage[] = []
  private readonly waiters = new Set<Waiter>()
  private closed: { code: number; reason: string } | null = null
  private seqCounter = 100

  private constructor(private readonly ws: WebSocket) {}

  static async connect(url: string): Promise<GameClient> {
    const ws = new WebSocket(url)
    const client = new GameClient(ws)
    ws.on('message', (data) => {
      const parsed = ServerMessageSchema.safeParse(JSON.parse(data.toString('utf8')))
      if (!parsed.success) throw new Error(`invalid server message: ${data.toString()}`)
      client.deliver(parsed.data)
    })
    ws.on('close', (code, reason) => {
      client.closed = { code, reason: reason.toString() }
      for (const w of client.waiters) {
        clearTimeout(w.timer)
        w.reject(new Error(`socket closed (${code}) while waiting`))
      }
      client.waiters.clear()
    })
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    return client
  }

  private readonly lastSeqByGame = new Map<string, number>()

  /** Highest game.event seq seen for this game — feeds hello.resume. */
  lastEventSeqOf(gameId: string): number {
    return this.lastSeqByGame.get(gameId) ?? 0
  }

  private deliver(msg: ServerMessage): void {
    if (msg.t === 'game.event') {
      const current = this.lastSeqByGame.get(msg.p.gameId) ?? 0
      if (msg.p.seq > current) this.lastSeqByGame.set(msg.p.gameId, msg.p.seq)
    }
    for (const w of this.waiters) {
      if (w.predicate(msg)) {
        this.waiters.delete(w)
        clearTimeout(w.timer)
        w.resolve(msg)
        return
      }
    }
    this.inbox.push(msg)
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }

  async next(
    predicate: (msg: ServerMessage) => boolean = () => true,
    timeoutMs = 5000
  ): Promise<ServerMessage> {
    const idx = this.inbox.findIndex(predicate)
    if (idx >= 0) return this.inbox.splice(idx, 1)[0] as ServerMessage
    if (this.closed) throw new Error(`socket already closed (${this.closed.code})`)
    return new Promise<ServerMessage>((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          reject(new Error(`timed out; inbox: ${this.inbox.map((m) => m.t).join(',') || 'empty'}`))
        }, timeoutMs)
      }
      this.waiters.add(waiter)
    })
  }

  async expect<T extends ServerMessage['t']>(
    t: T,
    timeoutMs?: number
  ): Promise<ServerMessageOf<T>> {
    return (await this.next((m) => m.t === t, timeoutMs)) as ServerMessageOf<T>
  }

  async hello(
    accessToken: string,
    resume?: { gameId: string; lastEventSeq: number }
  ): Promise<ServerMessageOf<'welcome'>> {
    this.send({ t: 'hello', p: { accessToken, ...(resume ? { resume } : {}) } })
    const reply = await this.next((m) => m.t === 'welcome' || m.t === 'error')
    if (reply.t !== 'welcome') throw new Error(`hello failed: ${JSON.stringify(reply)}`)
    return reply as ServerMessageOf<'welcome'>
  }

  async createGame(p: {
    mode: Mode
    private?: boolean
    seatCount?: 2 | 3
  }): Promise<ServerMessageOf<'game.created'>> {
    const seq = this.seqCounter++
    this.send({ t: 'game.create', seq, p })
    const reply = await this.next(
      (m) => (m.t === 'game.created' || m.t === 'error') && m.seq === seq
    )
    if (reply.t !== 'game.created') throw new Error(`game.create failed: ${JSON.stringify(reply)}`)
    return reply as ServerMessageOf<'game.created'>
  }

  async joinGame(inviteCode: string): Promise<ServerMessageOf<'game.created'>> {
    const seq = this.seqCounter++
    this.send({ t: 'game.join', seq, p: { inviteCode } })
    const reply = await this.next(
      (m) => (m.t === 'game.created' || m.t === 'error') && m.seq === seq
    )
    if (reply.t !== 'game.created') throw new Error(`game.join failed: ${JSON.stringify(reply)}`)
    return reply as ServerMessageOf<'game.created'>
  }

  ready(gameId: string): void {
    this.send({ t: 'lobby.ready', p: { gameId } })
  }

  /** Drop everything buffered (stale events between decision points). */
  drainInbox(): void {
    this.inbox.length = 0
  }

  async resync(gameId: string, timeoutMs = 5000): Promise<PlayerView> {
    const seq = this.seqCounter++
    this.send({ t: 'game.resync', seq, p: { gameId } })
    const reply = await this.next(
      (m) => (m.t === 'game.sync' || m.t === 'error') && m.seq === seq,
      timeoutMs
    )
    if (reply.t !== 'game.sync') throw new Error(`resync failed: ${JSON.stringify(reply)}`)
    return (reply as ServerMessageOf<'game.sync'>).p.playerView
  }

  /** Consume a buffered game.finished event for this game, if any. */
  private takeFinished(gameId: string): GameOutcome | null {
    const idx = this.inbox.findIndex(
      (m) => m.t === 'game.event' && m.p.gameId === gameId && m.p.event.type === 'game.finished'
    )
    if (idx < 0) return null
    const msg = this.inbox.splice(idx, 1)[0] as ServerMessageOf<'game.event'>
    return msg.p.event.payload as GameOutcome
  }

  /** Play until the game reaches `targetTurn` (for mid-game crash scenarios). */
  async playUntilTurn(
    gameId: string,
    random: Random,
    targetTurn: number,
    opts: { maxSteps?: number } = {}
  ): Promise<void> {
    const maxSteps = opts.maxSteps ?? 500
    for (let step = 0; step < maxSteps; step++) {
      const view = await this.resync(gameId)
      if (view.turn >= targetTurn) return
      if (view.phase.kind === 'finished') throw new Error('finished before the target turn')
      const intent = view.waitingOn.includes(view.seat) ? chooseFromView(view, random) : null
      if (intent) {
        const seq = this.seqCounter++
        this.send({ t: 'intent', seq, p: { gameId, intent } })
        await this.next((m) => (m.t === 'error' && m.seq === seq) || m.t === 'game.event', 10_000)
        continue
      }
      await this.next((m) => m.t === 'game.event', 20_000)
    }
    throw new Error(`turn ${targetTurn} not reached within ${maxSteps} steps`)
  }

  /**
   * Play the game to the end with the view-driven autoplayer: resync → act if
   * waited on → otherwise wait for movement → repeat. The game.finished event is
   * the termination signal (the room unloads right after it, so a late resync
   * can legitimately answer not_found).
   */
  async playUntilFinished(
    gameId: string,
    random: Random,
    opts: { maxSteps?: number; idleTimeoutMs?: number; throttleMs?: number } = {}
  ): Promise<GameOutcome> {
    const maxSteps = opts.maxSteps ?? 5000
    const idleTimeoutMs = opts.idleTimeoutMs ?? 20_000
    for (let step = 0; step < maxSteps; step++) {
      // Stay under production per-connection rate limits when asked to.
      if (opts.throttleMs) await new Promise((r) => setTimeout(r, opts.throttleMs))
      const finished = this.takeFinished(gameId)
      if (finished) return finished

      let view: PlayerView
      try {
        view = await this.resync(gameId)
      } catch (error) {
        const lateFinished = this.takeFinished(gameId)
        if (lateFinished) return lateFinished
        throw new Error(
          `resync failed with no game.finished in sight: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      if (view.phase.kind === 'finished')
        return { winnerSeats: view.phase.winnerSeats, ranking: view.phase.ranking }

      const intent = view.waitingOn.includes(view.seat) ? chooseFromView(view, random) : null
      if (intent) {
        const seq = this.seqCounter++
        this.send({ t: 'intent', seq, p: { gameId, intent } })
        // Wait for the move to land: either our typed error or any game event.
        await this.next((m) => (m.t === 'error' && m.seq === seq) || m.t === 'game.event', 10_000)
        continue
      }
      // Not our turn: wait until something happens, then re-evaluate.
      await this.next((m) => m.t === 'game.event', idleTimeoutMs)
    }
    throw new Error(`game did not finish within ${maxSteps} steps`)
  }

  get isClosed(): boolean {
    return this.closed !== null
  }

  close(): void {
    this.ws.close()
  }
}
