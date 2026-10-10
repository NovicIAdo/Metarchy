// Stage 2 DoD: `kill -9` mid-game → recovery resumes exactly. A REAL server
// process is SIGKILLed halfway through a game; a second process on the same
// Postgres recovers the room by snapshot + intent replay and the game completes
// with a gapless event log.
//
// Needs a disposable Postgres: set E2E_DATABASE_URL (CI provides a service
// container; locally e.g. `docker run --rm -e POSTGRES_PASSWORD=postgres -p
// 5432:5432 postgres:16-alpine`). Skipped when unset.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { makeTestAuth } from '../src/auth.js'
import { mulberry32 } from '../src/autoplayer.js'
import { GameClient } from '../src/client.js'
import { spawnServer } from '../src/server-process.js'

const DB_URL = process.env.E2E_DATABASE_URL

describe.skipIf(!DB_URL)('kill -9 crash recovery (real processes, real Postgres)', () => {
  it('SIGKILL mid-game → new process recovers → game completes, log gapless', async () => {
    const auth = await makeTestAuth()
    const env = {
      DATABASE_URL: DB_URL as string,
      MIGRATE_ON_BOOT: '1',
      SUPABASE_JWKS_JSON: auth.jwksJson,
      SUPABASE_JWT_ISSUER: auth.issuer
    }
    const userId = randomUUID()

    // Generation 1: play into turn 2, then die without any goodbye.
    const gen1 = await spawnServer(env)
    let gameId: string
    try {
      const c1 = await GameClient.connect(gen1.url)
      await c1.hello(await auth.mint(userId))
      const created = await c1.createGame({ mode: 'vs_bots' })
      gameId = created.p.gameId
      await c1.expect('game.started')
      await c1.playUntilTurn(gameId, mulberry32(0x91), 2)
    } finally {
      gen1.kill9()
    }

    // Generation 2: same database, fresh process.
    const gen2 = await spawnServer(env)
    try {
      const c2 = await GameClient.connect(gen2.url)
      const welcome = await c2.hello(await auth.mint(userId))
      expect(welcome.p.activeGame?.gameId).toBe(gameId)
      expect(welcome.p.activeGame?.status).toBe('active')

      const outcome = await c2.playUntilFinished(gameId, mulberry32(0x92))
      expect(outcome.ranking.length).toBeGreaterThan(0)
      c2.close()

      const { default: pg } = await import('pg')
      const pool = new pg.Pool({ connectionString: DB_URL, max: 1 })
      try {
        const seqs = (
          await pool.query(`select seq from game_events where game_id = $1 order by seq`, [gameId])
        ).rows.map((r: { seq: string | number }) => Number(r.seq))
        expect(seqs.length).toBeGreaterThan(20)
        seqs.forEach((s, i) => expect(s).toBe(i + 1))

        const game = await pool.query(
          `select status, rng_seed, rng_seed_hash from games where id = $1`,
          [gameId]
        )
        expect(game.rows[0].status).toBe('finished')
        expect(game.rows[0].rng_seed).not.toBeNull()

        const snapshot = await pool.query(
          `select max(seq) as seq from game_snapshots where game_id = $1`,
          [gameId]
        )
        expect(Number(snapshot.rows[0].seq)).toBe(seqs[seqs.length - 1])
      } finally {
        await pool.end()
      }
    } finally {
      await gen2.stop()
    }
  }, 240_000)
})
