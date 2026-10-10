// Plan 2.5 DoD: a full PvP game between two scripted clients over real sockets,
// plus the disconnect lifecycle — resume replay within the ring buffer, and
// grace-expiry elimination (2-player game → the remaining player wins).

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GameClient, mulberry32 } from '@metarchy/e2e'
import type { MemoryStore } from '../src/store.js'
import type { TestServer } from './helpers.js'
import { startTestServer } from './helpers.js'

async function connectClient(ts: TestServer, userId: string): Promise<GameClient> {
  const client = await GameClient.connect(ts.wsUrl)
  await client.hello(await ts.auth.mint(userId))
  return client
}

async function startPrivate1v1(ts: TestServer, userA: string, userB: string) {
  const a = await connectClient(ts, userA)
  const b = await connectClient(ts, userB)
  const created = await a.createGame({ mode: '1v1', private: true })
  const gameId = created.p.gameId
  await b.joinGame(created.p.inviteCode as string)
  a.ready(gameId)
  b.ready(gameId)
  await a.expect('game.started')
  await b.expect('game.started')
  return { a, b, gameId }
}

describe('PvP over WebSocket', () => {
  it('two scripted clients complete a full private 1v1', async () => {
    const ts = await startTestServer()
    try {
      const { a, b, gameId } = await startPrivate1v1(ts, randomUUID(), randomUUID())
      const [outcomeA, outcomeB] = await Promise.all([
        a.playUntilFinished(gameId, mulberry32(0xa11ce), { idleTimeoutMs: 30_000 }),
        b.playUntilFinished(gameId, mulberry32(0xb0b), { idleTimeoutMs: 30_000 })
      ])
      expect(outcomeA.winnerSeats).toEqual(outcomeB.winnerSeats)
      expect(outcomeA.ranking).toEqual(outcomeB.ranking)

      const stored = (ts.store as MemoryStore).inspect(gameId)
      expect(stored?.game.status).toBe('finished')
      expect(stored?.results).toHaveLength(2)
      expect(stored?.results.every((r) => r.result !== null)).toBe(true)
      expect(stored?.commitments.some((c) => c.seat === 0)).toBe(true)
      expect(stored?.commitments.some((c) => c.seat === 1)).toBe(true)
      a.close()
      b.close()
    } finally {
      await ts.server.close()
    }
  }, 120_000)

  it('resume replays exactly the missed events from the ring buffer', async () => {
    const ts = await startTestServer()
    try {
      const userB = randomUUID()
      const { a, b, gameId } = await startPrivate1v1(ts, randomUUID(), userB)

      // B drops; A sees the presence change with a grace deadline.
      const seenByB = b.lastEventSeqOf(gameId)
      b.close()
      const gone = await a.next((m) => m.t === 'presence')
      expect(gone.t === 'presence' && gone.p).toMatchObject({ seat: 1, connected: false })
      expect(gone.t === 'presence' && gone.p.graceEndsAt).not.toBeNull()

      // A commits while B is away — a public event B misses.
      a.send({
        t: 'intent',
        p: {
          gameId,
          intent: {
            type: 'distribution.commit',
            placements: [
              { actorType: 'politician', locationId: 'square', argument: 'rock' },
              { actorType: 'scientist', locationId: 'university', argument: 'paper' },
              { actorType: 'artist', locationId: 'theatre', argument: 'scissors' },
              { actorType: 'robot', locationId: 'factory', argument: 'dummy' }
            ]
          }
        }
      })
      await a.next((m) => m.t === 'game.event' && m.p.event.type === 'distribution.committed')

      // B reconnects with resume: replayed events, not a sync.
      const b2 = await GameClient.connect(ts.wsUrl)
      const welcome = await b2.hello(await ts.auth.mint(userB), {
        gameId,
        lastEventSeq: seenByB
      })
      expect(welcome.p.activeGame?.gameId).toBe(gameId)
      const replayed = await b2.expect('game.event')
      expect(replayed.p.seq).toBe(seenByB + 1)
      expect(replayed.p.event.type).toBe('distribution.committed')
      // No sync frame on the buffered-resume path.
      const sync = await b2.next((m) => m.t === 'game.sync', 300).catch(() => null)
      expect(sync).toBeNull()

      // A sees B back online.
      const back = await a.next((m) => m.t === 'presence' && m.p.connected === true)
      expect(back.t === 'presence' && back.p.seat).toBe(1)
      a.close()
      b2.close()
    } finally {
      await ts.server.close()
    }
  })

  it('grace expiry eliminates the silent seat and the remaining player wins', async () => {
    const ts = await startTestServer({ disconnectGraceMs: 150 })
    try {
      const { a, b, gameId } = await startPrivate1v1(ts, randomUUID(), randomUUID())
      b.close()
      const eliminated = await a.next(
        (m) => m.t === 'game.event' && m.p.event.type === 'player.eliminated',
        5000
      )
      expect(
        eliminated.t === 'game.event' && (eliminated.p.event.payload as { reason: string }).reason
      ).toBe('disconnect')
      const finished = await a.next(
        (m) => m.t === 'game.event' && m.p.event.type === 'game.finished'
      )
      expect(
        finished.t === 'game.event' &&
          (finished.p.event.payload as { winnerSeats: number[] }).winnerSeats
      ).toEqual([0])

      const stored = (ts.store as MemoryStore).inspect(gameId)
      expect(stored?.results.find((r) => r.seat === 1)?.result).toBe('eliminated')
      expect(stored?.results.find((r) => r.seat === 0)?.result).toBe('win')
      const res = await fetch(`${ts.httpUrl}/healthz`)
      expect(((await res.json()) as { rooms: number }).rooms).toBe(0)
      a.close()
    } finally {
      await ts.server.close()
    }
  })

  it('reconnect within grace cancels elimination', async () => {
    const ts = await startTestServer({ disconnectGraceMs: 2000 })
    try {
      const userB = randomUUID()
      const { a, b, gameId } = await startPrivate1v1(ts, randomUUID(), userB)
      b.close()
      await a.next((m) => m.t === 'presence' && m.p.connected === false)
      const b2 = await GameClient.connect(ts.wsUrl)
      await b2.hello(await ts.auth.mint(userB), { gameId, lastEventSeq: b.lastEventSeqOf(gameId) })
      await a.next((m) => m.t === 'presence' && m.p.connected === true)
      // Wait past the original grace window — nobody must be eliminated.
      await new Promise((r) => setTimeout(r, 2200))
      const stored = (ts.store as MemoryStore).inspect(gameId)
      expect(stored?.game.status).toBe('active')
      a.close()
      b2.close()
    } finally {
      await ts.server.close()
    }
  }, 15_000)
})
