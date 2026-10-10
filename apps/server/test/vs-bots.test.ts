// Plan 2.3 DoD: a vs_bots game completes end-to-end over a real WebSocket with a
// scripted client, exercising exactly the pipeline humans use.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GameClient, mulberry32 } from '@metarchy/e2e'
import type { MemoryStore } from '../src/store.js'
import { startTestServer } from './helpers.js'

describe('vs_bots end-to-end', () => {
  it('scripted client finishes a 2-seat vs_bots game; log and results are consistent', async () => {
    const ts = await startTestServer()
    try {
      const client = await GameClient.connect(ts.wsUrl)
      await client.hello(await ts.auth.mint(randomUUID()))
      const created = await client.createGame({ mode: 'vs_bots' })
      expect(created.p.seat).toBe(0)
      expect(created.p.inviteCode).toBeNull()
      const gameId = created.p.gameId
      const started = await client.expect('game.started')
      expect(started.p.players).toHaveLength(2)
      expect(started.p.players.find((p) => p.seat === 1)?.bot).toBe(true)

      const outcome = await client.playUntilFinished(gameId, mulberry32(0xc0ffee))
      expect(outcome.winnerSeats.length).toBeGreaterThanOrEqual(0)
      expect(outcome.ranking.length).toBeGreaterThan(0)

      const stored = (ts.store as MemoryStore).inspect(gameId)
      expect(stored?.game.status).toBe('finished')
      expect(stored?.players).toHaveLength(2)
      expect(stored?.players.find((p) => p.seat === 1)?.botStrategy).toBe('random-legal')
      expect(stored?.rngSeed).not.toBeNull()
      expect(stored?.events.some((e) => e.type === 'game.finished')).toBe(true)
      // Gapless event log ending at the final snapshot.
      const lastEvent = stored?.events[stored.events.length - 1]
      const lastSnapshot = stored?.snapshots[stored.snapshots.length - 1]
      expect(lastSnapshot?.seq).toBe(lastEvent?.seq)
      // Every player move (human and bot alike — same pipeline) leaves a commitment.
      expect(stored!.commitments.some((c) => c.seat === 0)).toBe(true)
      expect(stored!.commitments.some((c) => c.seat === 1)).toBe(true)

      // The room unloaded and the user is free to start another game.
      const res = await fetch(`${ts.httpUrl}/healthz`)
      expect(((await res.json()) as { rooms: number }).rooms).toBe(0)
      const again = await client.createGame({ mode: 'vs_bots' })
      expect(again.p.gameId).not.toBe(gameId)
      client.close()
    } finally {
      await ts.server.close()
    }
  }, 90_000)

  it('scripted client finishes a 3-seat vs_bots game (1 human + 2 bots)', async () => {
    const ts = await startTestServer()
    try {
      const client = await GameClient.connect(ts.wsUrl)
      await client.hello(await ts.auth.mint(randomUUID()))
      const created = await client.createGame({ mode: 'vs_bots', seatCount: 3 })
      const started = await client.expect('game.started')
      expect(started.p.players).toHaveLength(3)
      const outcome = await client.playUntilFinished(created.p.gameId, mulberry32(0xbeef))
      expect(outcome.ranking.length).toBeGreaterThan(0)
      const stored = (ts.store as MemoryStore).inspect(created.p.gameId)
      expect(stored?.game.status).toBe('finished')
      expect(stored?.players.filter((p) => p.botStrategy !== null)).toHaveLength(2)
      client.close()
    } finally {
      await ts.server.close()
    }
  }, 90_000)
})
