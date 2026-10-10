// Spectating over real sockets: a live ranked (human-human) game is watchable,
// a watcher receives a public spectator view, the seated players are told who is
// watching, and non-ranked games (vs bots) never expose themselves.

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_MATCHMAKING } from '../src/matchmaking.js'
import type { TestServer } from './helpers.js'
import { connectAs, startTestServer, TestClient } from './helpers.js'

const servers: TestServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((ts) => ts.server.close()))
})

async function rankedServer(): Promise<TestServer> {
  // A generous bot-fallback so the two humans always pair with each other.
  const ts = await startTestServer({
    matchmaking: { ...DEFAULT_MATCHMAKING, tickMs: 20, botFallbackMs: 10_000 }
  })
  servers.push(ts)
  return ts
}

describe('spectating ranked games', () => {
  it('lists a live ranked game, streams a public view, and shows the watcher to the players', async () => {
    const ts = await rankedServer()
    const alice = await connectAs(ts, randomUUID())
    const bob = await connectAs(ts, randomUUID())
    alice.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    bob.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    const found = await alice.client.expect('match.found')
    await alice.client.expect('game.started')
    await bob.client.expect('game.started')
    const gameId = found.p.gameId

    // A third user watches.
    const spec = await TestClient.connect(ts.wsUrl)
    await spec.hello(await ts.auth.mint(randomUUID()))

    spec.send({ t: 'spectate.list', seq: 1 })
    const games = await spec.expect('spectate.games')
    const listed = games.p.games.find((g) => g.gameId === gameId)
    expect(listed).toBeDefined()
    expect(listed?.spectators).toBe(0)
    expect(listed?.players).toHaveLength(2)

    spec.send({ t: 'spectate.join', seq: 2, p: { gameId } })
    const joined = await spec.expect('spectate.joined')
    expect(joined.p.gameId).toBe(gameId)

    const sync = await spec.expect('game.sync')
    expect(sync.p.playerView.spectator).toBe(true)
    expect(sync.p.playerView.me.hand).toEqual([])
    // No sealed placement content leaks to a watcher.
    if (sync.p.playerView.phase.kind === 'p2_distribution') {
      expect(sync.p.playerView.phase.sealed).toEqual([])
    }

    // Both seated players learn a watcher joined, by name.
    const presence = await alice.client.next((m) => m.t === 'spectator.presence')
    if (presence.t !== 'spectator.presence') throw new Error('expected spectator.presence')
    expect(presence.p.count).toBe(1)
    expect(presence.p.names).toHaveLength(1)

    spec.close()
  })

  it('does not list or allow spectating a vs-bots game', async () => {
    const ts = await rankedServer()
    const host = await connectAs(ts, randomUUID())
    host.client.send({ t: 'game.create', seq: 1, p: { mode: 'vs_bots' } })
    const created = await host.client.expect('game.created')

    const spec = await connectAs(ts, randomUUID())
    spec.client.send({ t: 'spectate.list', seq: 2 })
    const games = await spec.client.expect('spectate.games')
    expect(games.p.games.map((g) => g.gameId)).not.toContain(created.p.gameId)

    spec.client.send({ t: 'spectate.join', seq: 3, p: { gameId: created.p.gameId } })
    const err = await spec.client.expect('error')
    expect(err.p.code).toBe('not_found')

    host.client.close()
  })
})
