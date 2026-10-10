// Replays over real sockets: a finished ranked game is recorded (seed + move
// log, already persisted), listed in the gallery, and its replay reconstructs
// deterministically back to the finished state through the engine.

import { randomUUID } from 'node:crypto'
import { applyIntent, createGame } from '@metarchy/engine'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_MATCHMAKING } from '../src/matchmaking.js'
import type { TestServer } from './helpers.js'
import { connectAs, startTestServer } from './helpers.js'

const servers: TestServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((ts) => ts.server.close()))
})

async function rankedServer(): Promise<TestServer> {
  const ts = await startTestServer({
    matchmaking: { ...DEFAULT_MATCHMAKING, tickMs: 20, botFallbackMs: 10_000 }
  })
  servers.push(ts)
  return ts
}

describe('match replays', () => {
  it('lists a finished ranked game and replays it back to the finished state', async () => {
    const ts = await rankedServer()
    const alice = await connectAs(ts, randomUUID())
    const bob = await connectAs(ts, randomUUID())
    alice.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    bob.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    const found = await alice.client.expect('match.found')
    const gameId = found.p.gameId
    await bob.client.expect('game.started')

    // Alice forfeits → the game finishes and is recorded.
    alice.client.send({ t: 'game.forfeit', p: { gameId } })
    await bob.client.next((m) => m.t === 'game.event' && m.p.event.type === 'game.finished', 5000)

    bob.client.send({ t: 'replay.list', seq: 10 })
    const list = await bob.client.expect('replay.games')
    const entry = list.p.games.find((g) => g.gameId === gameId)
    expect(entry).toBeDefined()
    expect(entry?.players).toHaveLength(2)

    bob.client.send({ t: 'replay.get', seq: 11, p: { gameId } })
    const data = await bob.client.expect('replay.data')
    expect(data.p.seed).toBeTruthy()
    expect(data.p.seatCount).toBe(2)
    expect(data.p.controllers).toEqual(['human', 'human'])
    expect(data.p.intents.length).toBeGreaterThan(0)

    // The record reconstructs deterministically to the same finished game.
    let state = createGame({
      gameId: data.p.gameId,
      mode: data.p.mode,
      seed: data.p.seed,
      seatCount: data.p.seatCount,
      controllers: data.p.controllers
    })
    for (const { seat, intent } of data.p.intents) {
      const res = applyIntent(state, seat, intent)
      expect(res.ok).toBe(true)
      if (res.ok) state = res.state
    }
    expect(state.phase.kind).toBe('finished')
  })

  it('stars a past game, filters the gallery to favorites, per user', async () => {
    const ts = await rankedServer()
    const alice = await connectAs(ts, randomUUID())
    const bob = await connectAs(ts, randomUUID())
    alice.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    bob.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    const found = await alice.client.expect('match.found')
    const gameId = found.p.gameId
    await bob.client.expect('game.started')
    alice.client.send({ t: 'game.forfeit', p: { gameId } })
    await bob.client.next((m) => m.t === 'game.event' && m.p.event.type === 'game.finished', 5000)

    bob.client.send({ t: 'replay.star', seq: 20, p: { gameId, starred: true } })
    const starred = await bob.client.expect('replay.starred')
    expect(starred.p).toEqual({ gameId, starred: true })

    bob.client.send({ t: 'replay.list', seq: 21, p: { starredOnly: true } })
    const favorites = await bob.client.expect('replay.games')
    expect(favorites.p.games.map((g) => g.gameId)).toEqual([gameId])
    expect(favorites.p.games[0]?.starred).toBe(true)
    expect(favorites.p.total).toBe(1)

    // Stars are per-user: the same filter for Alice is empty.
    alice.client.send({ t: 'replay.list', seq: 22, p: { starredOnly: true } })
    const aliceView = await alice.client.expect('replay.games')
    expect(aliceView.p.total).toBe(0)
    expect(aliceView.p.games).toEqual([])

    // Unstar drops it from favorites but not from the archive.
    bob.client.send({ t: 'replay.star', seq: 23, p: { gameId, starred: false } })
    await bob.client.expect('replay.starred')
    bob.client.send({ t: 'replay.list', seq: 24, p: {} })
    const archive = await bob.client.expect('replay.games')
    expect(archive.p.games.some((g) => g.gameId === gameId && !g.starred)).toBe(true)

    // Starring a game with no replay is refused.
    bob.client.send({ t: 'replay.star', seq: 25, p: { gameId: randomUUID(), starred: true } })
    const err = await bob.client.expect('error')
    expect(err.p.code).toBe('not_found')
  })

  it('refuses a replay of a vs-bots game', async () => {
    const ts = await rankedServer()
    const host = await connectAs(ts, randomUUID())
    host.client.send({ t: 'game.create', seq: 1, p: { mode: 'vs_bots' } })
    const created = await host.client.expect('game.created')
    host.client.send({ t: 'game.forfeit', p: { gameId: created.p.gameId } })

    host.client.send({ t: 'replay.get', seq: 2, p: { gameId: created.p.gameId } })
    const err = await host.client.expect('error')
    expect(err.p.code).toBe('not_found')
  })
})
