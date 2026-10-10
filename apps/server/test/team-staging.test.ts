// team.staging (2v2 live drafts): relayed to the ally ONLY, replanted on
// reconnect, retracted when the drafting tab disconnects, rejected outside 2v2.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GameClient } from '@metarchy/e2e'
import type { TestServer } from './helpers.js'
import { startTestServer } from './helpers.js'

async function connectClient(ts: TestServer, userId: string): Promise<GameClient> {
  const client = await GameClient.connect(ts.wsUrl)
  await client.hello(await ts.auth.mint(userId))
  return client
}

/** Private 2v2 by join order: a=0, b=1, c=2, d=3 → allies (a,c) and (b,d). */
async function startPrivate2v2(ts: TestServer, users: string[]) {
  const [a, b, c, d] = await Promise.all(users.map((u) => connectClient(ts, u)))
  const created = await (a as GameClient).createGame({ mode: '2v2', private: true })
  const gameId = created.p.gameId
  const code = created.p.inviteCode as string
  for (const client of [b, c, d]) await (client as GameClient).joinGame(code)
  for (const client of [a, b, c, d]) (client as GameClient).ready(gameId)
  for (const client of [a, b, c, d]) await (client as GameClient).expect('game.started')
  return { a: a as GameClient, b: b as GameClient, c: c as GameClient, d: d as GameClient, gameId }
}

const P2_STAGING = {
  kind: 'p2',
  turn: 1,
  placements: [{ actorType: 'politician', locationId: 'square', argument: 'rock', bet: 'win' }]
}

describe('team.staging relay', () => {
  it('reaches the ally only and is replanted for a reconnecting ally', async () => {
    const ts = await startTestServer()
    const userC = randomUUID()
    try {
      const { a, b, c, d, gameId } = await startPrivate2v2(ts, [
        randomUUID(),
        randomUUID(),
        userC,
        randomUUID()
      ])
      a.send({ t: 'team.staging', p: { gameId, staging: P2_STAGING } })
      const relayed = await c.expect('team.staging')
      expect(relayed.p.fromSeat).toBe(0)
      expect(relayed.p.staging).toEqual(P2_STAGING)
      // The opponents never see the draft.
      await expect(b.next((m) => m.t === 'team.staging', 250)).rejects.toThrow()
      await expect(d.next((m) => m.t === 'team.staging', 250)).rejects.toThrow()

      // The ally reloads: after the sync the draft ghosts are replanted.
      c.close()
      const c2 = await connectClient(ts, userC)
      const replant = await c2.next((m) => m.t === 'team.staging')
      expect(replant.t === 'team.staging' && replant.p.fromSeat).toBe(0)
      expect(replant.t === 'team.staging' && replant.p.staging).toEqual(P2_STAGING)
      for (const client of [a, b, c2, d]) client.close()
    } finally {
      await ts.server.close()
    }
  })

  it('a disconnecting drafter retracts its ghosts from the ally', async () => {
    const ts = await startTestServer()
    try {
      const { a, b, c, d, gameId } = await startPrivate2v2(
        ts,
        Array.from({ length: 4 }, () => randomUUID())
      )
      a.send({ t: 'team.staging', p: { gameId, staging: P2_STAGING } })
      await c.expect('team.staging')
      a.close()
      const cleared = await c.next((m) => m.t === 'team.staging' && m.p.staging.kind === 'clear')
      expect(cleared.t === 'team.staging' && cleared.p.fromSeat).toBe(0)
      for (const client of [b, c, d]) client.close()
    } finally {
      await ts.server.close()
    }
  })

  it('is rejected outside 2v2', async () => {
    const ts = await startTestServer()
    try {
      const a = await connectClient(ts, randomUUID())
      const b = await connectClient(ts, randomUUID())
      const created = await a.createGame({ mode: '1v1', private: true })
      const gameId = created.p.gameId
      await b.joinGame(created.p.inviteCode as string)
      a.ready(gameId)
      b.ready(gameId)
      await a.expect('game.started')
      a.send({ t: 'team.staging', p: { gameId, staging: { kind: 'clear', turn: 1 } } })
      const err = await a.expect('error')
      expect(err.p.code).toBe('unavailable')
      a.close()
      b.close()
    } finally {
      await ts.server.close()
    }
  })
})
