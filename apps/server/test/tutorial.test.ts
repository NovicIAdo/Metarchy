// The coached Tutorial rides the vs_bots pipeline but with the clock switched
// off: every deadline the server sends carries endsAt null, so the client shows
// no countdown and handleDeadline never fires (the player is never timed out).
// The game must still run to completion — bots move on their own delay.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { PlayerView } from '@metarchy/engine'
import { GameClient, mulberry32 } from '@metarchy/e2e'
import type { MemoryStore } from '../src/store.js'
import { startTestServer } from './helpers.js'

describe('tutorial mode', () => {
  it('creates a no-timer 1-human-vs-1-bot game and finishes it', async () => {
    const ts = await startTestServer()
    try {
      const client = await GameClient.connect(ts.wsUrl)
      await client.hello(await ts.auth.mint(randomUUID()))

      const created = await client.createGame({ mode: 'tutorial' })
      expect(created.p.mode).toBe('tutorial')
      expect(created.p.seat).toBe(0)
      expect(created.p.inviteCode).toBeNull()

      const started = await client.expect('game.started')
      expect(started.p.mode).toBe('tutorial')
      expect(started.p.players).toHaveLength(2)
      expect(started.p.players.find((p) => p.seat === 1)?.bot).toBe(true)

      // The very first deadline (armed at start) is timer-less — the core of the
      // feature. There is never a positive endsAt in a tutorial.
      const deadline = await client.expect('deadline', 8000)
      expect(deadline.p.endsAt).toBeNull()

      // And it plays through end-to-end without the human ever being auto-skipped.
      const outcome = await client.playUntilFinished(created.p.gameId, mulberry32(0x7007))
      expect(outcome.ranking.length).toBeGreaterThan(0)

      // Persisted as a bot game: recorded (crash recovery) but the seat-1 bot
      // keeps it out of ratings and replays elsewhere.
      const stored = (ts.store as MemoryStore).inspect(created.p.gameId)
      expect(stored?.game.mode).toBe('tutorial')
      expect(stored?.game.status).toBe('finished')
      expect(stored?.players.find((p) => p.seat === 1)?.botStrategy).toBe('tutorial-mirror')

      client.close()
    } finally {
      await ts.server.close()
    }
  }, 90_000)

  it('the mirror bot copies the placement and repeats the first re-fight throw', async () => {
    const ts = await startTestServer()
    try {
      const client = await GameClient.connect(ts.wsUrl)
      await client.hello(await ts.auth.mint(randomUUID()))
      const created = await client.createGame({ mode: 'tutorial' })
      const gameId = created.p.gameId
      await client.expect('game.started')

      const intent = (payload: unknown): void =>
        client.send({ t: 'intent', p: { gameId, intent: payload } })
      const viewNow = async (): Promise<PlayerView> => {
        client.send({ t: 'game.resync', p: { gameId } })
        const sync = await client.expect('game.sync')
        return sync.p.playerView
      }
      const waitFor = async (pred: (v: PlayerView) => boolean): Promise<PlayerView> => {
        for (let i = 0; i < 80; i++) {
          const v = await viewNow()
          if (pred(v)) return v
          await new Promise((r) => setTimeout(r, 50))
        }
        throw new Error('view never reached the expected shape')
      }

      // One politician on the square — the bot must wait for it, then mirror.
      intent({
        type: 'distribution.commit',
        placements: [{ actorType: 'politician', locationId: 'square', argument: 'rock' }]
      })
      // The mirrored commit reveals the board and the phase HOLDS there so the
      // player can see where the bot went (author request) — the tutorial has no
      // clock, so it waits for the player's ack, not a deadline.
      const revealed = await waitFor(
        (v) => v.phase.kind === 'p2_distribution' && v.phase.revealed !== undefined
      )
      if (revealed.phase.kind !== 'p2_distribution') throw new Error('expected p2')
      const mirrored = revealed.board.placements.filter((p) => p.actorType === 'politician')
      expect(mirrored.map((p) => p.locationId)).toEqual(['square', 'square'])

      // Turn 1 has no P3 (rulebook §Turn Structure): past the reveal it is P4.
      intent({ type: 'distribution.reveal.ack' })
      const p4 = await waitFor(
        (v) => v.phase.kind === 'p4_conflict' && v.phase.stage.t === 'reveal_ack'
      )
      const politicians = p4.board.placements.filter((p) => p.actorType === 'politician')
      expect(politicians.map((p) => p.locationId)).toEqual(['square', 'square'])

      // rock vs rock → draw → the politician re-fight gate.
      intent({ type: 'conflict.reveal.ack' })
      await waitFor((v) => v.phase.kind === 'p4_conflict' && v.phase.stage.t === 'refight_ack')
      intent({ type: 'conflict.refight.ack' })
      await waitFor((v) => v.phase.kind === 'p4_conflict' && v.phase.stage.t === 'rps')

      // The bot repeats the player's first live throw → another draw, gate again.
      intent({ type: 'conflict.rps', choice: 'paper' })
      const again = await waitFor(
        (v) => v.phase.kind === 'p4_conflict' && v.phase.stage.t === 'refight_ack'
      )
      if (again.phase.kind !== 'p4_conflict') throw new Error('expected p4')
      expect(again.phase.resolution?.revealedRps).toEqual({ 0: 'paper', 1: 'paper' })

      client.close()
    } finally {
      await ts.server.close()
    }
  }, 30_000)
})
