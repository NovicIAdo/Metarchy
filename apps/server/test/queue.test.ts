// The queue over real sockets: two players join, a rated game starts without a
// lobby, and finishing it moves both ratings.

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_MATCHMAKING } from '../src/matchmaking.js'
import type { MemoryStore } from '../src/store.js'
import type { TestServer } from './helpers.js'
import { connectAs, startTestServer } from './helpers.js'

const servers: TestServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((ts) => ts.server.close()))
})

async function serverWith(matchmaking: Partial<typeof DEFAULT_MATCHMAKING> = {}) {
  const ts = await startTestServer({
    matchmaking: { ...DEFAULT_MATCHMAKING, tickMs: 20, botFallbackMs: 0, ...matchmaking }
  })
  servers.push(ts)
  return ts
}

describe('matchmaking queue', () => {
  it('acknowledges a join with the queue position', async () => {
    const ts = await serverWith()
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'queue.join', seq: 3, p: { mode: '1v1' } })
    const status = await client.expect('queue.status')
    expect(status.seq).toBe(3)
    expect(status.p).toMatchObject({ mode: '1v1', position: 1, widenedRange: false })
  })

  it('pairs two waiting players and starts the game with no ready-up', async () => {
    const ts = await serverWith()
    const alice = await connectAs(ts, randomUUID())
    const bob = await connectAs(ts, randomUUID())

    alice.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    await alice.client.expect('queue.status')
    bob.client.send({ t: 'queue.join', p: { mode: '1v1' } })

    const foundA = await alice.client.expect('match.found')
    const foundB = await bob.client.expect('match.found')
    expect(foundA.p.gameId).toBe(foundB.p.gameId)
    expect(foundA.p.mode).toBe('1v1')
    expect(new Set([foundA.p.seat, foundB.p.seat])).toEqual(new Set([0, 1]))
    expect(foundA.p.seats).toHaveLength(2)
    expect(foundA.p.seats.every((s) => !s.bot)).toBe(true)

    // The game is live immediately: both get their first sync.
    await alice.client.expect('game.started')
    await bob.client.expect('game.started')
  })

  it('a matched game is rated — finishing it moves both players', async () => {
    const ts = await serverWith()
    const aliceId = randomUUID()
    const bobId = randomUUID()
    const alice = await connectAs(ts, aliceId)
    const bob = await connectAs(ts, bobId)

    alice.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    bob.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    const found = await alice.client.expect('match.found')
    await bob.client.expect('game.started')

    alice.client.send({ t: 'game.forfeit', p: { gameId: found.p.gameId } })
    const store = ts.store as MemoryStore
    await expect.poll(() => store.inspectRating('1v1', bobId)?.games, { timeout: 5000 }).toBe(1)

    expect(store.inspectRating('1v1', aliceId)?.rating).toBeLessThan(1500)
    expect(store.inspectRating('1v1', bobId)?.rating).toBeGreaterThan(1500)
  })

  it('stays silent while nothing the player can see has changed', async () => {
    // Ticks run every 20ms here; a lone waiter must still hear the status once.
    const ts = await serverWith()
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'queue.join', p: { mode: '1v1' } })
    await client.expect('queue.status')

    await new Promise((resolve) => setTimeout(resolve, 400)) // ~20 ticks
    await expect(client.expect('queue.status', 200)).rejects.toThrow(/timed out/)
  })

  it('tells the player when the queue moves under them', async () => {
    const ts = await serverWith({ baseWindow: 0, widenPerStep: 0, openWaitMs: 10_000_000 })
    const first = await connectAs(ts, randomUUID())
    const second = await connectAs(ts, randomUUID())
    const third = await connectAs(ts, randomUUID())

    // Unrated players are all 1500 and a zero window still admits an exact tie,
    // so use ffa3 (3 seats) and keep the pool at 2 to stop a match forming.
    first.client.send({ t: 'queue.join', p: { mode: 'ffa3' } })
    await first.client.expect('queue.status')
    second.client.send({ t: 'queue.join', p: { mode: 'ffa3' } })
    const secondStatus = await second.client.expect('queue.status')
    expect(secondStatus.p.position).toBe(2)

    third.client.send({ t: 'queue.leave' }) // not queued; a no-op
    first.client.send({ t: 'queue.leave' })

    const promoted = await second.client.expect('queue.status', 2000)
    expect(promoted.p.position).toBe(1)
  })

  it('leaving the queue means never being matched', async () => {
    const ts = await serverWith()
    const alice = await connectAs(ts, randomUUID())
    const bob = await connectAs(ts, randomUUID())

    alice.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    await alice.client.expect('queue.status')
    alice.client.send({ t: 'queue.leave' })

    bob.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    await bob.client.expect('queue.status')
    await expect(bob.client.expect('match.found', 300)).rejects.toThrow(/timed out/)
  })

  it('a dropped socket leaves the queue behind it', async () => {
    const ts = await serverWith()
    const alice = await connectAs(ts, randomUUID())
    alice.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    await alice.client.expect('queue.status')
    alice.client.close()

    const bob = await connectAs(ts, randomUUID())
    bob.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    await bob.client.expect('queue.status')
    await expect(bob.client.expect('match.found', 300)).rejects.toThrow(/timed out/)
  })

  it('refuses to queue a player who is already in a game', async () => {
    const ts = await serverWith()
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'game.create', p: { mode: 'vs_bots' } })
    await client.expect('game.created')

    client.send({ t: 'queue.join', p: { mode: '1v1' } })
    const error = await client.expect('error')
    expect(error.p.code).toBe('already_in_game')
  })

  it('refuses 2v2 — it has no team ratings yet', async () => {
    const ts = await serverWith()
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'queue.join', p: { mode: '2v2' } })
    const error = await client.expect('error')
    expect(error.p.code).toBe('unavailable')
  })

  it('seats a bot in the RANKED game once the wait is up, not a vs_bots game', async () => {
    const ts = await serverWith({ botFallbackMs: 1 })
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'queue.join', p: { mode: '1v1' } })

    const found = await client.expect('match.found', 3000)
    // The mode is what the player queued for. It has to be: the ranked GATO
    // schedule pays these games (rewards.ts) and the harder ranked bot only sits
    // in public rated rooms (room.ts botStrategy).
    expect(found.p.mode).toBe('1v1')
    expect(found.p.seats).toHaveLength(2)
    expect(found.p.seats.filter((s) => s.bot)).toHaveLength(1)
  })

  it('the ffa3 fallback keeps the humans together and fills the rest with bots', async () => {
    // Two humans waiting, nobody third: the author's "два игрока, а третий не
    // нашёлся и добавился бот" — ONE game, not two solo bot games.
    const ts = await serverWith({
      baseWindow: 0,
      widenPerStep: 0,
      openWaitMs: 60_000,
      botFallbackMs: 150
    })
    const alice = await connectAs(ts, randomUUID())
    const bob = await connectAs(ts, randomUUID())
    alice.client.send({ t: 'queue.join', p: { mode: 'ffa3' } })
    bob.client.send({ t: 'queue.join', p: { mode: 'ffa3' } })

    const foundA = await alice.client.expect('match.found', 3000)
    const foundB = await bob.client.expect('match.found', 3000)
    expect(foundA.p.gameId).toBe(foundB.p.gameId)
    expect(foundA.p.mode).toBe('ffa3')
    expect(foundA.p.seats).toHaveLength(3)
    expect(foundA.p.seats.filter((s) => s.bot)).toHaveLength(1)
  })

  it('a lone ffa3 waiter gets two bots, in ffa3', async () => {
    const ts = await serverWith({ botFallbackMs: 1 })
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'queue.join', p: { mode: 'ffa3' } })

    const found = await client.expect('match.found', 3000)
    expect(found.p.mode).toBe('ffa3')
    expect(found.p.seats.filter((s) => s.bot)).toHaveLength(2)
  })

  it('tells the waiting player who has been found and when a bot arrives', async () => {
    // A window that never widens keeps the pair apart, so the roster is visible
    // before the match forms; the fallback is far enough out not to fire.
    const ts = await serverWith({
      baseWindow: 0,
      widenPerStep: 0,
      openWaitMs: 10_000_000,
      botFallbackMs: 600_000
    })
    const alice = await connectAs(ts, randomUUID())
    const bob = await connectAs(ts, randomUUID())

    alice.client.send({ t: 'queue.join', p: { mode: 'ffa3' } })
    const alone = await alice.client.expect('queue.status')
    expect(alone.p).toMatchObject({ seats: 3, found: [] })
    // A fixed instant, not a countdown — that is what keeps ticks silent.
    expect(alone.p.botAt).toBeGreaterThan(Date.now())

    bob.client.send({ t: 'queue.join', p: { mode: 'ffa3' } })
    const withBob = await alice.client.expect('queue.status', 2000)
    expect(withBob.p.found).toHaveLength(1)
    expect(withBob.p.found[0]?.nickname).toEqual(expect.any(String))
  })

  it('reports no bot deadline when the fallback is switched off', async () => {
    const ts = await serverWith({ botFallbackMs: 0 })
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'queue.join', p: { mode: '1v1' } })
    const status = await client.expect('queue.status')
    expect(status.p.botAt).toBeNull()
  })

  it('matches three players into an ffa3 game', async () => {
    const ts = await serverWith()
    const clients = await Promise.all([
      connectAs(ts, randomUUID()),
      connectAs(ts, randomUUID()),
      connectAs(ts, randomUUID())
    ])
    for (const c of clients) c.client.send({ t: 'queue.join', p: { mode: 'ffa3' } })

    const found = await Promise.all(clients.map((c) => c.client.expect('match.found', 3000)))
    expect(new Set(found.map((f) => f.p.gameId)).size).toBe(1)
    expect(new Set(found.map((f) => f.p.seat))).toEqual(new Set([0, 1, 2]))
  })

  it('keeps mismatched ratings apart, then pairs the newcomer with his peer', async () => {
    // A window that never widens: only rating proximity can make a match here.
    const ts = await serverWith({ baseWindow: 50, widenPerStep: 0, openWaitMs: 10_000_000 })
    const store = ts.store as MemoryStore
    const [grandmasterId, noviceId, peerId] = [randomUUID(), randomUUID(), randomUUID()]

    const seedGame = randomUUID()
    await store.createGame({
      gameId: seedGame,
      mode: '1v1',
      status: 'lobby',
      isPrivate: false,
      inviteCode: null,
      rulesVersion: '1.0.0',
      rngSeedHash: 'h'
    })
    await store.saveRatings(seedGame, '1v1', [
      {
        seat: 0,
        userId: grandmasterId,
        ratingBefore: 1900,
        after: { rating: 1900, rd: 50, volatility: 0.06 }
      },
      {
        seat: 1,
        userId: noviceId,
        ratingBefore: 1200,
        after: { rating: 1200, rd: 50, volatility: 0.06 }
      }
    ])

    const grandmaster = await connectAs(ts, grandmasterId)
    const novice = await connectAs(ts, noviceId)
    grandmaster.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    novice.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    await grandmaster.client.expect('queue.status')
    await novice.client.expect('queue.status')

    // 700 points apart, and the window never opens: nobody plays.
    await expect(grandmaster.client.expect('match.found', 300)).rejects.toThrow(/timed out/)

    // An unrated player (1500) is still too far from both…
    const peer = await connectAs(ts, peerId)
    peer.client.send({ t: 'queue.join', p: { mode: '1v1' } })
    await expect(peer.client.expect('match.found', 300)).rejects.toThrow(/timed out/)

    // …until someone close to the novice arrives.
    const twinId = randomUUID()
    await store.saveRatings(seedGame, '1v1', [
      {
        seat: 0,
        userId: twinId,
        ratingBefore: 1220,
        after: { rating: 1220, rd: 50, volatility: 0.06 }
      }
    ])
    const twin = await connectAs(ts, twinId)
    twin.client.send({ t: 'queue.join', p: { mode: '1v1' } })

    const found = await twin.client.expect('match.found', 2000)
    const noviceFound = await novice.client.expect('match.found', 2000)
    expect(found.p.gameId).toBe(noviceFound.p.gameId)
    // The grandmaster is still waiting, alone.
    await expect(grandmaster.client.expect('match.found', 300)).rejects.toThrow(/timed out/)
  })
})
