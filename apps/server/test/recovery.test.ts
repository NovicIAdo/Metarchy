// Plan 2.4 DoD: crash recovery by replay. A game is played halfway on server
// generation 1; generation 2 gets the same database, rebuilds the room as
// snapshot + engine replay of logged intents, and the game completes with a
// gapless event log. (The true kill -9 e2e lives in /e2e, gated on a real
// Postgres; the write-ahead ordering makes the two equivalent.)

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { chooseFromView, GameClient, mulberry32 } from '@metarchy/e2e'
import { makePgliteSql, migrate } from '../src/db.js'
import { SqlProfileStore, SqlStore } from '../src/store-sql.js'
import { startTestServer } from './helpers.js'

describe('crash recovery by replay', () => {
  it('generation 2 recovers an active vs_bots game and completes it', async () => {
    const sql = await makePgliteSql('memory://')
    await migrate(sql)
    const userId = randomUUID()

    // --- Generation 1: create a game and play into turn 2 ------------------
    const gen1 = await startTestServer(
      {},
      { store: new SqlStore(sql), profiles: new SqlProfileStore(sql) }
    )
    const c1 = await GameClient.connect(gen1.wsUrl)
    await c1.hello(await gen1.auth.mint(userId))
    const created = await c1.createGame({ mode: 'vs_bots' })
    const gameId = created.p.gameId
    await c1.expect('game.started')

    const rng1 = mulberry32(0x51)
    let reachedTurn = 1
    for (let i = 0; i < 300 && reachedTurn < 2; i++) {
      const view = await c1.resync(gameId)
      reachedTurn = view.turn
      if (view.phase.kind === 'finished') throw new Error('game finished too early for the test')
      if (view.waitingOn.includes(view.seat)) {
        const intent = chooseFromView(view, rng1)
        if (intent) {
          const seq = 1000 + i
          c1.send({ t: 'intent', seq, p: { gameId, intent } })
          await c1.next((m) => m.t === 'game.event' || (m.t === 'error' && m.seq === seq), 5000)
          continue
        }
      }
      await c1.next((m) => m.t === 'game.event', 5000)
    }
    expect(reachedTurn).toBeGreaterThanOrEqual(2)

    const persisted = await sql.query<{ n: unknown }>(
      `select count(*) as n from game_events where game_id = $1`,
      [gameId]
    )
    expect(Number(persisted.rows[0]?.n)).toBeGreaterThan(10)

    // --- Crash: sockets die, rooms are gone, nothing is flushed gracefully --
    await gen1.server.close()

    // --- Generation 2: same database, fresh process state -------------------
    const gen2 = await startTestServer(
      {},
      { store: new SqlStore(sql), profiles: new SqlProfileStore(sql) }
    )
    const c2 = await GameClient.connect(gen2.wsUrl)
    const welcome = await c2.hello(await gen2.auth.mint(userId))
    expect(welcome.p.activeGame?.gameId).toBe(gameId)
    expect(welcome.p.activeGame?.status).toBe('active')

    const outcome = await c2.playUntilFinished(gameId, mulberry32(0x52))
    expect(outcome.ranking.length).toBeGreaterThan(0)

    // --- Log integrity across the crash boundary ----------------------------
    const seqRows = await sql.query<{ seq: unknown }>(
      `select seq from game_events where game_id = $1 order by seq`,
      [gameId]
    )
    const seqs = seqRows.rows.map((r) => Number(r.seq))
    seqs.forEach((s, i) => expect(s).toBe(i + 1))

    const game = await sql.query<{ status: string; rng_seed: string | null }>(
      `select status, rng_seed from games where id = $1`,
      [gameId]
    )
    expect(game.rows[0]?.status).toBe('finished')
    expect(game.rows[0]?.rng_seed).not.toBeNull()

    const lastSnapshot = await sql.query<{ seq: unknown }>(
      `select max(seq) as seq from game_snapshots where game_id = $1`,
      [gameId]
    )
    expect(Number(lastSnapshot.rows[0]?.seq)).toBe(seqs[seqs.length - 1])

    const players = await sql.query<{ seat: number; result: string | null }>(
      `select seat, result from game_players where game_id = $1 order by seat`,
      [gameId]
    )
    expect(players.rows).toHaveLength(2)
    expect(players.rows.every((p) => p.result !== null)).toBe(true)

    c2.close()
    await gen2.server.close()
    await sql.close()
  }, 120_000)

  it('stale lobbies are aborted on boot', async () => {
    const sql = await makePgliteSql('memory://')
    await migrate(sql)
    const store = new SqlStore(sql)
    const gameId = randomUUID()
    await store.createGame({
      gameId,
      mode: '1v1',
      status: 'lobby',
      isPrivate: true,
      inviteCode: 'AAAAAA',
      rulesVersion: '1.0.0',
      rngSeedHash: 'h'
    })
    const ts = await startTestServer({}, { store, profiles: new SqlProfileStore(sql) })
    const statuses = await sql.query<{ status: string }>(`select status from games where id = $1`, [
      gameId
    ])
    expect(statuses.rows[0]?.status).toBe('aborted')
    await ts.server.close()
    await sql.close()
  })
})
