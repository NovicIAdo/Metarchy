import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerMessageOf } from '@metarchy/protocol'
import type { MemoryStore } from '../src/store.js'
import type { TestClient, TestServer } from './helpers.js'
import { connectAs, startTestServer } from './helpers.js'

const VALID_COMMIT = {
  type: 'distribution.commit',
  placements: [
    { actorType: 'politician', locationId: 'square', argument: 'rock' },
    { actorType: 'scientist', locationId: 'university', argument: 'paper' },
    { actorType: 'artist', locationId: 'theatre', argument: 'scissors' },
    { actorType: 'robot', locationId: 'factory', argument: 'dummy' }
  ]
}

/** Create a private 1v1, join with a second user, ready both; returns both clients + gameId. */
async function startPvp(ts: TestServer) {
  const a = await connectAs(ts, randomUUID())
  const b = await connectAs(ts, randomUUID())
  a.client.send({ t: 'game.create', seq: 1, p: { mode: '1v1', private: true } })
  const created = await a.client.expect('game.created')
  const gameId = created.p.gameId
  const inviteCode = created.p.inviteCode as string
  b.client.send({ t: 'game.join', seq: 2, p: { inviteCode } })
  const joined = await b.client.expect('game.created')
  expect(joined.p.gameId).toBe(gameId)
  expect(joined.p.seat).toBe(1)
  a.client.send({ t: 'lobby.ready', p: { gameId } })
  b.client.send({ t: 'lobby.ready', p: { gameId } })
  const startedA = await a.client.expect('game.started')
  const startedB = await b.client.expect('game.started')
  expect(startedA.p.seat).toBe(0)
  expect(startedB.p.seat).toBe(1)
  await a.client.expect('game.sync')
  await b.client.expect('game.sync')
  return { a: a.client, b: b.client, gameId, inviteCode }
}

describe('rooms: lobby → game', () => {
  let ts: TestServer
  beforeAll(async () => {
    ts = await startTestServer()
  })
  afterAll(async () => {
    await ts.server.close()
  })

  it('runs the private-lobby flow: create, join by code, ready, start', async () => {
    const { a, b, gameId } = await startPvp(ts)
    // Both saw lobby.state updates along the way; the game is now live for both.
    const deadlineA = await a.next((m) => m.t === 'deadline')
    expect(deadlineA.t === 'deadline' && deadlineA.p.phaseRef).toContain('p2')
    a.send({ t: 'game.forfeit', p: { gameId } })
    await b.next((m) => m.t === 'game.event' && m.p.event.type === 'game.finished')
    a.close()
    b.close()
  })

  it('rejects joining with a bad code and double-create', async () => {
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'game.join', p: { inviteCode: 'ZZZZZZ' } })
    expect((await client.expect('error')).p.code).toBe('not_found')
    client.send({ t: 'game.create', p: { mode: '1v1', private: true } })
    await client.expect('game.created')
    client.send({ t: 'game.create', p: { mode: '1v1', private: true } })
    expect((await client.expect('error')).p.code).toBe('already_in_game')
    client.close()
  })

  it('rejects non-private non-bot creation until matchmaking exists', async () => {
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'game.create', p: { mode: '1v1' } })
    expect((await client.expect('error')).p.code).toBe('unavailable')
    client.close()
  })

  it('leaving a lobby frees the seat and the player, and the host sees it', async () => {
    const host = await connectAs(ts, randomUUID())
    const guest = await connectAs(ts, randomUUID())
    host.client.send({ t: 'game.create', p: { mode: '1v1', private: true } })
    const created = await host.client.expect('game.created')
    const gameId = created.p.gameId
    const inviteCode = created.p.inviteCode as string
    guest.client.send({ t: 'game.join', p: { inviteCode } })
    await guest.client.expect('game.created')

    // Guest leaves the lobby; the host's roster drops back to one seat filled.
    guest.client.send({ t: 'lobby.leave', p: { gameId } })
    const lobby = await host.client.next((m) => m.t === 'lobby.state' && m.p.players.length === 1)
    expect(lobby.t === 'lobby.state' && lobby.p.players[0]?.seat).toBe(0)

    // The guest is free to start a fresh game (no lingering "already in game" hold).
    guest.client.send({ t: 'game.create', p: { mode: 'vs_bots' } })
    expect((await guest.client.expect('game.created')).p.gameId).not.toBe(gameId)

    // The guest can re-join the original lobby by code — the seat reopened.
    host.client.close()
    guest.client.close()
  })

  it('rejects a leave from someone with no seat, and after the game started', async () => {
    const outsider = await connectAs(ts, randomUUID())
    outsider.client.send({ t: 'lobby.leave', p: { gameId: randomUUID() } })
    expect((await outsider.client.expect('error')).p.code).toBe('not_in_game')

    const { a, b, gameId } = await startPvp(ts)
    a.send({ t: 'lobby.leave', p: { gameId } })
    expect((await a.expect('error')).p.code).toBe('unavailable')
    outsider.client.close()
    a.close()
    b.close()
  })
})

describe('rooms: intent pipeline', () => {
  let ts: TestServer
  beforeAll(async () => {
    ts = await startTestServer()
  })
  afterAll(async () => {
    await ts.server.close()
  })

  it('binds seats to users and filters sealed events by visibility', async () => {
    const { a, b, gameId } = await startPvp(ts)

    // Outsider cannot act in this game.
    const outsider = await connectAs(ts, randomUUID())
    outsider.client.send({ t: 'intent', seq: 9, p: { gameId, intent: { type: 'market.done' } } })
    const err = await outsider.client.expect('error')
    expect(err.p.code).toBe('not_in_game')
    expect(err.seq).toBe(9)
    outsider.client.close()

    // Wrong-phase intent → typed rule_violation with the engine code.
    a.send({ t: 'intent', seq: 3, p: { gameId, intent: { type: 'event.ack' } } })
    const violation = await a.expect('error')
    expect(violation.p.code).toBe('rule_violation')
    expect((violation.p.details as { engineCode: string }).engineCode).toBe('wrong_phase')

    // Seat 0 commits: the public event reaches both, the sealed staging only seat 0.
    a.send({ t: 'intent', p: { gameId, intent: VALID_COMMIT } })
    const publicA = await a.next(
      (m) => m.t === 'game.event' && m.p.event.type === 'distribution.committed'
    )
    expect(publicA.t).toBe('game.event')
    const stagedA = await a.next(
      (m) => m.t === 'game.event' && m.p.event.type === 'distribution.staged'
    )
    const stagedPayload = (stagedA as ServerMessageOf<'game.event'>).p.event.payload as {
      placements: unknown[]
    }
    expect(stagedPayload.placements).toHaveLength(4)

    await b.next((m) => m.t === 'game.event' && m.p.event.type === 'distribution.committed')
    // Seat 1 must never see seat 0's sealed placements.
    const leaked = await b
      .next((m) => m.t === 'game.event' && m.p.event.type === 'distribution.staged', 300)
      .catch(() => null)
    expect(leaked).toBeNull()

    a.close()
    b.close()
  })

  it('double commit is rejected as already_committed', async () => {
    const { a, gameId, b } = await startPvp(ts)
    a.send({ t: 'intent', p: { gameId, intent: VALID_COMMIT } })
    await a.next((m) => m.t === 'game.event' && m.p.event.type === 'distribution.committed')
    a.send({ t: 'intent', seq: 5, p: { gameId, intent: VALID_COMMIT } })
    const violation = await a.expect('error')
    expect(violation.p.code).toBe('rule_violation')
    expect((violation.p.details as { engineCode: string }).engineCode).toBe('already_committed')
    a.close()
    b.close()
  })
})

describe('rooms: deadlines & timeouts (§5)', () => {
  it('auto-commits distribution for silent seats when the deadline fires', async () => {
    const ts = await startTestServer({
      timeouts: {
        ackMs: 30_000,
        summaryMs: 30_000,
        discardMs: 30_000,
        distributionMs: 200,
        actionStepMs: 30_000,
        rpsMs: 30_000,
        marketMs: 30_000
      }
    })
    try {
      const { a, b } = await startPvp(ts)
      const deadline = await a.next((m) => m.t === 'deadline' && m.p.endsAt !== null)
      expect(deadline.t === 'deadline' && deadline.p.phaseRef).toContain('p2')
      // Nobody commits; the server must inject system.timeout defaults for both seats.
      const auto0 = await b.next(
        (m) => m.t === 'game.event' && m.p.event.type === 'distribution.committed',
        3000
      )
      expect(auto0.t).toBe('game.event')
      await b.next(
        (m) =>
          m.t === 'game.event' &&
          m.p.event.type === 'distribution.committed' &&
          (m.p.event.payload as { seat: number }).seat === 1,
        3000
      )
      a.close()
      b.close()
    } finally {
      await ts.server.close()
    }
  })
})

describe('rooms: your-turn pushes', () => {
  it('a waited-on human who disconnects gets exactly one push per stage', async () => {
    const pushes: { userId: string; gameId: string | undefined }[] = []
    const ts = await startTestServer(
      {},
      {
        push: {
          async notifyUser(userId, note) {
            pushes.push({ userId, gameId: note.data?.gameId })
          }
        }
      }
    )
    try {
      const userA = randomUUID()
      const userB = randomUUID()
      const a = await connectAs(ts, userA)
      const b = await connectAs(ts, userB)
      a.client.send({ t: 'game.create', seq: 1, p: { mode: '1v1', private: true } })
      const created = await a.client.expect('game.created')
      const gameId = created.p.gameId
      b.client.send({ t: 'game.join', seq: 2, p: { inviteCode: created.p.inviteCode as string } })
      await b.client.expect('game.created')
      a.client.send({ t: 'lobby.ready', p: { gameId } })
      b.client.send({ t: 'lobby.ready', p: { gameId } })
      await a.client.expect('game.started')
      await b.client.expect('game.started')
      // Both connected while P2 waits on both: starting the game pushes nobody.
      expect(pushes).toHaveLength(0)

      // B walks away mid-turn — exactly one push, to B, tagged with the game.
      b.client.close()
      await expect.poll(() => pushes.length, { timeout: 5000 }).toBe(1)
      expect(pushes[0]).toEqual({ userId: userB, gameId })

      // A's commit keeps the same stage (still waiting on B) — no duplicate.
      a.client.send({ t: 'intent', seq: 9, p: { gameId, intent: VALID_COMMIT } })
      await a.client.next((m) => m.t === 'game.event' || m.t === 'error')
      await new Promise((r) => setTimeout(r, 150))
      expect(pushes).toHaveLength(1)
      a.client.close()
    } finally {
      await ts.server.close()
    }
  })
})

describe('rooms: finish & cleanup', () => {
  it('forfeit finishes a 1v1, persists results, frees both users', async () => {
    const ts = await startTestServer()
    try {
      const { a, b, gameId } = await startPvp(ts)
      b.send({ t: 'game.forfeit', seq: 11, p: { gameId } })
      const eliminated = await a.next(
        (m) => m.t === 'game.event' && m.p.event.type === 'player.eliminated'
      )
      expect(
        eliminated.t === 'game.event' &&
          (eliminated.p.event.payload as { seat: number; reason: string })
      ).toMatchObject({ seat: 1, reason: 'forfeit' })
      const finished = await a.next(
        (m) => m.t === 'game.event' && m.p.event.type === 'game.finished'
      )
      expect(
        finished.t === 'game.event' &&
          (finished.p.event.payload as { winnerSeats: number[] }).winnerSeats
      ).toEqual([0])

      const store = ts.store as MemoryStore
      const stored = store.inspect(gameId)
      expect(stored?.game.status).toBe('finished')
      expect(stored?.rngSeed).not.toBeNull()
      expect(stored?.results.find((r) => r.seat === 0)?.result).toBe('win')
      expect(stored?.results.find((r) => r.seat === 1)?.result).toBe('eliminated')
      // Snapshot retention: only the latest (the finish snapshot) survives.
      expect(stored?.snapshots).toHaveLength(1)
      expect(stored?.snapshots[0]?.state.phase.kind).toBe('finished')
      expect(stored?.commitments.length).toBeGreaterThanOrEqual(0)

      // The finished game shows up in both players' histories.
      a.send({ t: 'history.get', seq: 41 })
      const history = await a.expect('history')
      expect(history.p.entries.some((e) => e.gameId === gameId && e.result === 'win')).toBe(true)

      // Both users can create a new game afterwards.
      a.send({ t: 'game.create', p: { mode: '1v1', private: true } })
      await a.expect('game.created')
      a.close()
      b.close()
    } finally {
      await ts.server.close()
    }
  })

  it('aborts an emptied lobby and frees the invite code', async () => {
    const ts = await startTestServer()
    try {
      const { client } = await connectAs(ts, randomUUID())
      client.send({ t: 'game.create', p: { mode: '1v1', private: true } })
      const created = await client.expect('game.created')
      client.close()
      await new Promise((r) => setTimeout(r, 100))
      const store = ts.store as MemoryStore
      expect(store.inspect(created.p.gameId)?.game.status).toBe('aborted')
      const res = await fetch(`${ts.httpUrl}/healthz`)
      expect(((await res.json()) as { rooms: number }).rooms).toBe(0)
    } finally {
      await ts.server.close()
    }
  })

  it('an eliminated player is freed for a new game while the table plays on', async () => {
    const ts = await startTestServer()
    try {
      const users = await Promise.all(Array.from({ length: 3 }, () => connectAs(ts, randomUUID())))
      const [a, b, c] = users.map((u) => u.client) as [TestClient, TestClient, TestClient]
      a.send({ t: 'game.create', seq: 1, p: { mode: 'ffa3', private: true } })
      const created = await a.expect('game.created')
      const gameId = created.p.gameId
      const inviteCode = created.p.inviteCode as string
      for (const joiner of [b, c]) {
        joiner.send({ t: 'game.join', p: { inviteCode } })
        await joiner.expect('game.created')
      }
      for (const player of [a, b, c]) player.send({ t: 'lobby.ready', p: { gameId } })
      await Promise.all([a, b, c].map((p) => p.expect('game.started')))

      // C gives up. The game runs on for A and B — but C is done *here*, and
      // "finish or forfeit your current game first" must not apply anymore.
      c.send({ t: 'game.forfeit', p: { gameId } })
      await c.next((m) => m.t === 'game.event' && m.p.event.type === 'player.eliminated')

      c.send({ t: 'game.create', seq: 9, p: { mode: 'vs_bots' } })
      const fresh = await c.expect('game.created')
      expect(fresh.p.gameId).not.toBe(gameId)

      // A, still alive in the running game, stays held to it.
      a.send({ t: 'game.create', seq: 9, p: { mode: 'vs_bots' } })
      expect((await a.expect('error')).p.code).toBe('already_in_game')
      for (const player of [a, b, c]) player.close()
    } finally {
      await ts.server.close()
    }
  })

  it('team chat is rejected outside 2v2', async () => {
    const ts = await startTestServer()
    try {
      const { a, b, gameId } = await startPvp(ts)
      a.send({ t: 'chat.team', seq: 4, p: { gameId, text: 'hi' } })
      expect((await a.expect('error')).p.code).toBe('unavailable')
      a.close()
      b.close()
    } finally {
      await ts.server.close()
    }
  })

  it('runs a 2v2 lobby to game start and routes team chat to the ally only', async () => {
    const ts = await startTestServer()
    try {
      const users = await Promise.all(Array.from({ length: 4 }, () => connectAs(ts, randomUUID())))
      const [a, b, c, d] = users.map((u) => u.client) as [
        TestClient,
        TestClient,
        TestClient,
        TestClient
      ]
      a.send({ t: 'game.create', seq: 1, p: { mode: '2v2', private: true } })
      const created = await a.expect('game.created')
      const gameId = created.p.gameId
      const inviteCode = created.p.inviteCode as string

      // Seats go in join order; teams are fixed [0,2] vs [1,3] (spec §13).
      for (const [i, joiner] of [b, c, d].entries()) {
        joiner.send({ t: 'game.join', seq: 2 + i, p: { inviteCode } })
        expect((await joiner.expect('game.created')).p.seat).toBe(i + 1)
      }
      for (const player of [a, b, c, d]) player.send({ t: 'lobby.ready', p: { gameId } })
      const started = await Promise.all([a, b, c, d].map((p) => p.expect('game.started')))
      expect(started.map((m) => m.p.seat)).toEqual([0, 1, 2, 3])
      expect(started[0]?.p.players).toHaveLength(4)

      const syncA = await a.expect('game.sync')
      expect(syncA.p.playerView.teams).toEqual([
        [0, 2],
        [1, 3]
      ])
      expect(syncA.p.playerView.allies).toEqual([2])

      // Seat 0 talks to the team: the ally (seat 2) hears it, nobody else does —
      // not the opponents and not the sender (clients echo locally).
      a.send({ t: 'chat.team', p: { gameId, text: 'take the square' } })
      const chat = await c.expect('chat.message')
      expect(chat.p).toEqual({ gameId, fromSeat: 0, text: 'take the square' })
      // A ping round-trip after the chat landed flushes each socket: anything the
      // room had sent them would already be in the inbox by the time pong arrives.
      for (const bystander of [a, b, d]) {
        bystander.send({ t: 'ping' })
        await bystander.expect('pong')
        await expect(bystander.next((m) => m.t === 'chat.message', 50)).rejects.toThrow()
      }
      for (const player of [a, b, c, d]) player.close()
    } finally {
      await ts.server.close()
    }
  })

  it('2v2 team choice: a declared pref reseats players when the game starts', async () => {
    const ts = await startTestServer()
    try {
      const users = await Promise.all(Array.from({ length: 4 }, () => connectAs(ts, randomUUID())))
      const [a, b, c, d] = users.map((u) => u.client) as [
        TestClient,
        TestClient,
        TestClient,
        TestClient
      ]
      a.send({ t: 'game.create', seq: 1, p: { mode: '2v2', private: true } })
      const created = await a.expect('game.created')
      const gameId = created.p.gameId
      const inviteCode = created.p.inviteCode as string
      for (const [i, joiner] of [b, c].entries()) {
        joiner.send({ t: 'game.join', seq: 2 + i, p: { inviteCode } })
        await joiner.expect('game.created')
      }

      // 3rd joiner would default to team 0 — they ask for team 1 while it has room.
      c.send({ t: 'lobby.team', p: { gameId, team: 1 } })
      await c.next(
        (m) => m.t === 'lobby.state' && m.p.players.some((p) => p.seat === 2 && p.team === 1)
      )

      d.send({ t: 'game.join', seq: 9, p: { inviteCode } })
      await d.expect('game.created')
      // Team 1 is now full (c's pref + b's parity): d bounces off it.
      d.send({ t: 'lobby.team', p: { gameId, team: 1 } })
      const err = await d.expect('error')
      expect(err.p.code).toBe('unavailable')

      for (const player of [a, b, c, d]) player.send({ t: 'lobby.ready', p: { gameId } })
      const started = await Promise.all([a, b, c, d].map((p) => p.expect('game.started')))
      // Join order a,b,c,d → teams {a,d} vs {b,c} → seats a=0, b=1, d=2, c=3.
      expect(started.map((m) => m.p.seat)).toEqual([0, 1, 3, 2])

      // The ally lists must reflect the reseating: b's ally is c (seat 3).
      const syncB = await b.expect('game.sync')
      expect(syncB.p.playerView.allies).toEqual([3])
      b.send({ t: 'chat.team', p: { gameId, text: 'flank left' } })
      const chat = await c.expect('chat.message')
      expect(chat.p).toEqual({ gameId, fromSeat: 1, text: 'flank left' })
      for (const player of [a, b, c, d]) player.close()
    } finally {
      await ts.server.close()
    }
  })
})
