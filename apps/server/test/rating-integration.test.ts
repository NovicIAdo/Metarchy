// Which games move a rating, and does the finish path actually persist one.
// Rooms are built directly: the manager still refuses to create a public game
// until the matchmaking queue lands, but the room is where the rule lives.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { Mode } from '@metarchy/engine'
import { GATO_START_BALANCE } from '@metarchy/protocol'
import { DEFAULT_RATING } from '../src/ratings.js'
import type { RoomDeps, RoomInit } from '../src/rooms/room.js'
import { GameRoom } from '../src/rooms/room.js'
import type { Session } from '../src/session.js'
import { MemoryStore } from '../src/store.js'
import { testConfig, makeTestAuth } from './helpers.js'

const silentLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

function fakeSession(userId: string): Session {
  return {
    connId: 1,
    userId,
    email: null,
    profile: { userId, nickname: `n_${userId.slice(0, 6)}`, avatar: null },
    send: vi.fn(),
    sendError: vi.fn(),
    close: vi.fn()
  }
}

async function playToFinish(opts: {
  mode: Mode
  isPrivate: boolean
  seats: { userId: string | null; controller: 'human' | 'bot' }[]
}): Promise<{ store: MemoryStore; sessions: Map<string, Session>; gameId: string }> {
  const auth = await makeTestAuth()
  const store = new MemoryStore()
  const sessions = new Map<string, Session>()
  const gameId = randomUUID()

  const deps: RoomDeps = {
    config: testConfig(auth),
    store,
    sessions: { sessionOf: (userId) => sessions.get(userId) },
    log: silentLog,
    onGameOver: () => {},
    onEliminated: () => {}
  }
  const init: RoomInit = {
    gameId,
    mode: opts.mode,
    isPrivate: opts.isPrivate,
    inviteCode: opts.isPrivate ? 'ABC123' : null,
    seatsTotal: opts.seats.length,
    seed: 'seed-for-ratings'
  }
  await store.createGame({
    gameId,
    mode: opts.mode,
    status: 'lobby',
    isPrivate: opts.isPrivate,
    inviteCode: init.inviteCode,
    rulesVersion: '1.0.0',
    rngSeedHash: 'hash'
  })

  const room = new GameRoom(deps, init)
  for (const seat of opts.seats) {
    if (seat.userId) sessions.set(seat.userId, fakeSession(seat.userId))
    room.addSeat(seat.userId, seat.userId ?? 'Bot', null, seat.controller)
  }
  room.start()
  await vi.waitFor(() => expect(room.status).toBe('active'), { timeout: 5000 })

  // A game ends when one player is left standing, so seatsTotal - 1 of them quit,
  // taken from the humans in seat order (a bot cannot forfeit). The room's
  // single-writer queue serializes these, so they can be fired back to back.
  const humans = opts.seats.filter((s) => s.userId)
  for (const seat of humans.slice(0, opts.seats.length - 1))
    room.forfeit(sessions.get(seat.userId as string) as Session)

  await vi.waitFor(() => expect(room.status).toBe('finished'), { timeout: 5000 })
  return { store, sessions, gameId }
}

const human = (userId: string) => ({ userId, controller: 'human' as const })

describe('ratings on game finish', () => {
  it('a public 1v1 between humans rates both players', async () => {
    const alice = randomUUID()
    const bob = randomUUID()
    const { store } = await playToFinish({
      mode: '1v1',
      isPrivate: false,
      seats: [human(alice), human(bob)]
    })

    const aliceRating = store.inspectRating('1v1', alice)
    const bobRating = store.inspectRating('1v1', bob)
    expect(aliceRating?.games).toBe(1)
    expect(bobRating?.games).toBe(1)
    // Alice forfeited.
    expect(aliceRating?.rating).toBeLessThan(DEFAULT_RATING)
    expect(bobRating?.rating).toBeGreaterThan(DEFAULT_RATING)
    // Playing a game makes both of them better known.
    expect(aliceRating?.rd).toBeLessThan(350)
  })

  it('a private invite game is unrated — friends cannot farm each other', async () => {
    const alice = randomUUID()
    const bob = randomUUID()
    const { store } = await playToFinish({
      mode: '1v1',
      isPrivate: true,
      seats: [human(alice), human(bob)]
    })
    expect(store.inspectRating('1v1', alice)).toBeUndefined()
    expect(store.inspectRating('1v1', bob)).toBeUndefined()
  })

  it('a game with a bot in it is unrated', async () => {
    const alice = randomUUID()
    const { store } = await playToFinish({
      mode: 'vs_bots',
      isPrivate: false,
      seats: [human(alice), { userId: null, controller: 'bot' }]
    })
    expect(store.inspectRating('vs_bots', alice)).toBeUndefined()
    expect(store.inspectRating('1v1', alice)).toBeUndefined()
  })

  it('ffa3 rates all three, and the last player standing ends above both quitters', async () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()]
    const { store } = await playToFinish({
      mode: 'ffa3',
      isPrivate: false,
      seats: [human(a), human(b), human(c)]
    })
    const [ra, rb, rc] = [a, b, c].map((id) => store.inspectRating('ffa3', id))
    for (const r of [ra, rb, rc]) expect(r?.games).toBe(1)

    // a and b forfeited; c won.
    expect(rc?.rating).toBeGreaterThan(DEFAULT_RATING)
    expect(ra?.rating).toBeLessThan(DEFAULT_RATING)
    expect(rb?.rating).toBeLessThan(DEFAULT_RATING)
  })
})

describe('GATO rewards on game finish', () => {
  /** The gato.reward payouts a seat's session received, in order. */
  const rewardsSentTo = (session: Session, gameId: string): { amount: number; balance: number }[] =>
    (session.send as unknown as { mock: { calls: [{ t: string; p: unknown }][] } }).mock.calls
      .map(([msg]) => msg)
      .filter((msg) => msg.t === 'gato.reward')
      .map((msg) => msg.p as { gameId: string; amount: number; balance: number })
      .map(({ gameId: id, ...rest }) => {
        expect(id).toBe(gameId) // the push must name the game it paid for
        return rest
      })

  it('credits 30/10 in a public 1v1 and tells both wallets about it', async () => {
    const alice = randomUUID()
    const bob = randomUUID()
    const { store, sessions, gameId } = await playToFinish({
      mode: '1v1',
      isPrivate: false,
      seats: [human(alice), human(bob)]
    })

    // Alice forfeited, so Bob is the winner.
    expect((await store.getWallet(bob)).balance).toBe(GATO_START_BALANCE + 30)
    expect((await store.getWallet(alice)).balance).toBe(GATO_START_BALANCE + 10)
    expect(rewardsSentTo(sessions.get(bob) as Session, gameId)).toEqual([
      { amount: 30, balance: GATO_START_BALANCE + 30 }
    ])
    expect(rewardsSentTo(sessions.get(alice) as Session, gameId)).toEqual([
      { amount: 10, balance: GATO_START_BALANCE + 10 }
    ])
  })

  it('losing a ranked 1v1 to a bot earns nothing at all', async () => {
    const alice = randomUUID()
    const { store, sessions, gameId } = await playToFinish({
      mode: '1v1',
      isPrivate: false,
      // A bot cannot forfeit, so the only human quits: alice loses to a bot.
      // The winning-against-a-bot half of that row (10) is in rewards.test.ts,
      // which does not need a whole game played out to reach it.
      seats: [human(alice), { userId: null, controller: 'bot' }]
    })
    expect((await store.getWallet(alice)).balance).toBe(GATO_START_BALANCE)
    // Still pushed: a silent 0 reads as a lost credit.
    expect(rewardsSentTo(sessions.get(alice) as Session, gameId)).toEqual([
      { amount: 0, balance: GATO_START_BALANCE }
    ])
  })

  it('pays nothing for a private invite game', async () => {
    const alice = randomUUID()
    const bob = randomUUID()
    const { store, sessions, gameId } = await playToFinish({
      mode: '1v1',
      isPrivate: true,
      seats: [human(alice), human(bob)]
    })
    expect((await store.getWallet(alice)).balance).toBe(GATO_START_BALANCE)
    expect((await store.getWallet(bob)).balance).toBe(GATO_START_BALANCE)
    expect(rewardsSentTo(sessions.get(bob) as Session, gameId)).toEqual([])
  })
})
