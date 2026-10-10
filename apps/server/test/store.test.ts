// GameStore contract, run against both backends: MemoryStore and the SQL store
// over embedded Postgres (PGlite) with the real supabase/migrations schema.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Mode } from '@metarchy/engine'
import { createGame } from '@metarchy/engine'
import { GATO_START_BALANCE, emptyModeRecord, emptyPlayCounts, winRate } from '@metarchy/protocol'
import { makePgliteSql, migrate } from '../src/db.js'
import { SqlProfileStore, SqlStore } from '../src/store-sql.js'
import type { GameStore } from '../src/store.js'
import { MemoryStore } from '../src/store.js'

interface Backend {
  store: GameStore
  close(): Promise<void>
  /** Raw row counters (SQL backend only) — commitments have no read API by design. */
  countRows?(table: 'move_commitments' | 'game_snapshots', gameId: string): Promise<number>
  /** SQL backend only: game_players.user_id has an FK to profiles. */
  seedProfile?(userId: string): Promise<void>
}

const backends: [string, () => Promise<Backend>][] = [
  ['MemoryStore', async () => ({ store: new MemoryStore(), close: async () => {} })],
  [
    'SqlStore over PGlite',
    async () => {
      const sql = await makePgliteSql('memory://')
      await migrate(sql)
      // Run the contract under the production role, not the superuser — this is
      // what catches missing grants (writeSnapshot's retention DELETE, 42501).
      await sql.exec('set role metarchy_server')
      const profiles = new SqlProfileStore(sql)
      return {
        store: new SqlStore(sql),
        close: () => sql.close(),
        async countRows(table, gameId) {
          const r = await sql.query<{ n: unknown }>(
            `select count(*) as n from ${table} where game_id = $1`,
            [gameId]
          )
          return Number(r.rows[0]?.n ?? 0)
        },
        async seedProfile(userId) {
          await profiles.getOrCreate(userId, null)
        }
      }
    }
  ]
]

describe.each(backends)('GameStore contract: %s', (_name, make) => {
  it('persists the whole game lifecycle and reads it back', async () => {
    const { store, close, countRows, seedProfile } = await make()
    try {
      const gameId = randomUUID()
      const userId = randomUUID()
      if (seedProfile) await seedProfile(userId)
      await store.createGame({
        gameId,
        mode: 'vs_bots',
        status: 'lobby',
        isPrivate: false,
        inviteCode: null,
        rulesVersion: '1.0.0',
        rngSeedHash: 'feed'
      })
      expect(await store.listGamesByStatus('lobby')).toContain(gameId)

      await store.markActive(gameId, [
        { seat: 0, userId, botStrategy: null },
        { seat: 1, userId: null, botStrategy: 'random-legal' }
      ])
      expect(await store.listGamesByStatus('active')).toContain(gameId)

      const state = createGame({ gameId, mode: 'vs_bots', seed: 'seed-1' })
      await store.writeSnapshot(gameId, 0, state)

      // Commitment rides the same append as its events (one atomic write).
      await store.appendEvents(
        gameId,
        [
          { seq: 1, type: 'a', payload: { x: 1 }, visibility: 'public' },
          { seq: 2, type: 'b', payload: null, visibility: [0] }
        ],
        { seat: 0, intent: { type: 'market.done' } },
        { seq: 1, seat: 0, turn: 1, phase: 2, hash: 'deadbeef', salt: 'cafe' }
      )
      await store.appendEvents(gameId, [{ seq: 3, type: 'c', payload: {}, visibility: 'public' }], {
        seat: 1,
        intent: { type: 'event.ack' }
      })
      if (countRows) expect(await countRows('move_commitments', gameId)).toBe(1)

      const snap = await store.loadLatestSnapshot(gameId)
      expect(snap?.seq).toBe(0)
      expect(snap?.state.meta.gameId).toBe(gameId)

      // A later snapshot supersedes the old one — only the latest is retained.
      await store.writeSnapshot(gameId, 3, state)
      expect((await store.loadLatestSnapshot(gameId))?.seq).toBe(3)
      if (countRows) expect(await countRows('game_snapshots', gameId)).toBe(1)

      const events = await store.loadEventsAfter(gameId, 0)
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
      expect(events[1]?.visibility).toEqual([0])

      const intents = await store.loadIntentsAfter(gameId, 0)
      expect(intents).toEqual([
        { firstEventSeq: 1, seat: 0, intent: { type: 'market.done' } },
        { firstEventSeq: 3, seat: 1, intent: { type: 'event.ack' } }
      ])
      expect(await store.loadIntentsAfter(gameId, 1)).toHaveLength(1)

      const loaded = await store.loadGame(gameId)
      expect(loaded?.game.mode).toBe('vs_bots')
      expect(loaded?.players).toHaveLength(2)
      expect(loaded?.players[1]?.botStrategy).toBe('random-legal')

      await store.finishGame(gameId, {
        status: 'finished',
        results: [
          { seat: 0, result: 'win', finalVp: 7 },
          { seat: 1, result: 'lose', finalVp: 3 }
        ],
        rngSeed: 'seed-1'
      })
      expect(await store.listGamesByStatus('finished')).toContain(gameId)
      expect(await store.listGamesByStatus('active')).not.toContain(gameId)

      const history = await store.loadMatchHistory(userId, 5)
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({
        gameId,
        mode: 'vs_bots',
        status: 'finished',
        seat: 0,
        result: 'win',
        finalVp: 7
      })
      expect(await store.loadMatchHistory(randomUUID(), 5)).toHaveLength(0)
    } finally {
      await close()
    }
  })

  it('push tokens: save, per-token delete, and the notifications-off sweep', async () => {
    const { store, close, seedProfile } = await make()
    try {
      const userId = randomUUID()
      const rival = randomUUID()
      if (seedProfile) {
        await seedProfile(userId)
        await seedProfile(rival)
      }
      await store.savePushToken(userId, 'tok-a', 'android')
      await store.savePushToken(userId, 'tok-b', 'android')
      await store.savePushToken(rival, 'tok-r', 'android')
      expect((await store.loadPushTokens(userId)).sort()).toEqual(['tok-a', 'tok-b'])

      await store.deletePushToken('tok-a')
      expect(await store.loadPushTokens(userId)).toEqual(['tok-b'])

      // push.unregister: every device of this user stops, rivals untouched.
      await store.deleteUserPushTokens(userId)
      expect(await store.loadPushTokens(userId)).toEqual([])
      expect(await store.loadPushTokens(rival)).toEqual(['tok-r'])
    } finally {
      await close()
    }
  })

  it('replay gallery: pages the archive with a stable total, stars, and filters', async () => {
    const { store, close, seedProfile } = await make()
    try {
      const viewer = randomUUID()
      const rival = randomUUID()
      if (seedProfile) {
        await seedProfile(viewer)
        await seedProfile(rival)
      }
      const finishedHuman = async (): Promise<string> => {
        const gameId = randomUUID()
        await store.createGame({
          gameId,
          mode: '1v1',
          status: 'lobby',
          isPrivate: false,
          inviteCode: null,
          rulesVersion: '1.0.0',
          rngSeedHash: 'h'
        })
        await store.markActive(gameId, [
          { seat: 0, userId: viewer, botStrategy: null },
          { seat: 1, userId: rival, botStrategy: null }
        ])
        await store.writeSnapshot(gameId, 0, createGame({ gameId, mode: '1v1', seed: 's' }))
        await store.finishGame(gameId, {
          status: 'finished',
          results: [
            { seat: 0, result: 'win', finalVp: 5 },
            { seat: 1, result: 'lose', finalVp: 2 }
          ],
          rngSeed: 's'
        })
        return gameId
      }
      const ids = [await finishedHuman(), await finishedHuman(), await finishedHuman()]

      // A bots game never enters the gallery and cannot be starred.
      const botsId = randomUUID()
      await store.createGame({
        gameId: botsId,
        mode: 'vs_bots',
        status: 'lobby',
        isPrivate: false,
        inviteCode: null,
        rulesVersion: '1.0.0',
        rngSeedHash: 'h'
      })
      await store.markActive(botsId, [
        { seat: 0, userId: viewer, botStrategy: null },
        { seat: 1, userId: null, botStrategy: 'random-legal' }
      ])
      await store.finishGame(botsId, {
        status: 'finished',
        results: [
          { seat: 0, result: 'win', finalVp: 5 },
          { seat: 1, result: 'lose', finalVp: 2 }
        ],
        rngSeed: 's'
      })
      expect(await store.setReplayStar(viewer, botsId, true)).toBe(false)

      // Two pages cover the whole archive exactly once; total is page-independent.
      const page1 = await store.listReplays({
        userId: viewer,
        limit: 2,
        offset: 0,
        starredOnly: false
      })
      const page2 = await store.listReplays({
        userId: viewer,
        limit: 2,
        offset: 2,
        starredOnly: false
      })
      expect(page1.total).toBe(3)
      expect(page2.total).toBe(3)
      expect(page1.rows).toHaveLength(2)
      expect(page2.rows).toHaveLength(1)
      const seen = [...page1.rows, ...page2.rows].map((r) => r.gameId).sort()
      expect(seen).toEqual([...ids].sort())
      expect(page1.rows.every((r) => !r.starred)).toBe(true)

      // Stars are per-user and drive both the row flag and the filter.
      expect(await store.setReplayStar(viewer, ids[0] as string, true)).toBe(true)
      const starredPage = await store.listReplays({
        userId: viewer,
        limit: 10,
        offset: 0,
        starredOnly: true
      })
      expect(starredPage.total).toBe(1)
      expect(starredPage.rows.map((r) => r.gameId)).toEqual([ids[0]])
      expect(starredPage.rows[0]?.starred).toBe(true)
      const rivalView = await store.listReplays({
        userId: rival,
        limit: 10,
        offset: 0,
        starredOnly: true
      })
      expect(rivalView.total).toBe(0)

      expect(await store.setReplayStar(viewer, ids[0] as string, false)).toBe(true)
      const cleared = await store.listReplays({
        userId: viewer,
        limit: 10,
        offset: 0,
        starredOnly: true
      })
      expect(cleared.total).toBe(0)
    } finally {
      await close()
    }
  })

  it('GATO wallet: start grant, atomic purchase, owned/insufficient outcomes', async () => {
    const { store, close, seedProfile } = await make()
    try {
      const userId = randomUUID()
      if (seedProfile) await seedProfile(userId)

      const fresh = await store.getWallet(userId)
      expect(fresh).toEqual({ balance: GATO_START_BALANCE, owned: [] })

      expect(await store.purchase(userId, 'avatar.politician', 150)).toBe('ok')
      const after = await store.getWallet(userId)
      expect(after.balance).toBe(GATO_START_BALANCE - 150)
      expect(after.owned).toEqual(['avatar.politician'])

      // Buying again must not debit twice.
      expect(await store.purchase(userId, 'avatar.politician', 150)).toBe('owned')
      expect((await store.getWallet(userId)).balance).toBe(GATO_START_BALANCE - 150)

      // More than the balance: refused, nothing changes.
      expect(await store.purchase(userId, 'skin.robot.industrial', 999_999)).toBe('insufficient')
      const untouched = await store.getWallet(userId)
      expect(untouched.balance).toBe(GATO_START_BALANCE - 150)
      expect(untouched.owned).toEqual(['avatar.politician'])
    } finally {
      await close()
    }
  })

  it('GATO rewards credit once per game, however often the finish runs', async () => {
    const { store, close, seedProfile } = await make()
    try {
      const gameId = randomUUID()
      const alice = randomUUID()
      const bob = randomUUID()
      if (seedProfile) {
        await seedProfile(alice)
        await seedProfile(bob)
      }
      await store.createGame({
        gameId,
        mode: 'ffa3',
        status: 'lobby',
        isPrivate: false,
        inviteCode: null,
        rulesVersion: '1.0.0',
        rngSeedHash: 'feed'
      })
      await store.markActive(gameId, [
        { seat: 0, userId: alice, botStrategy: null },
        { seat: 1, userId: bob, botStrategy: null },
        { seat: 2, userId: null, botStrategy: 'random-legal' }
      ])

      // A bot filled the third seat: 20 for the winner, 0 for last (rewards.ts).
      const credits = [
        { seat: 0 as const, userId: alice, amount: 20 },
        { seat: 1 as const, userId: bob, amount: 0 }
      ]
      const paid = await store.creditRewards(gameId, credits)
      expect(paid.map((p) => [p.seat, p.amount, p.balance])).toEqual([
        [0, 20, GATO_START_BALANCE + 20],
        [1, 0, GATO_START_BALANCE]
      ])
      expect((await store.getWallet(alice)).balance).toBe(GATO_START_BALANCE + 20)

      // Recovery can reach `finished` a second time; the ledger row absorbs it.
      expect(await store.creditRewards(gameId, credits)).toEqual([])
      expect((await store.getWallet(alice)).balance).toBe(GATO_START_BALANCE + 20)
      expect((await store.getWallet(bob)).balance).toBe(GATO_START_BALANCE)
    } finally {
      await close()
    }
  })

  it('per-category record: ranked/private/bots split, eliminated is a loss, tutorial counts nowhere', async () => {
    const { store, close, seedProfile } = await make()
    try {
      const me = randomUUID()
      const rival = randomUUID()
      if (seedProfile) {
        await seedProfile(me)
        await seedProfile(rival)
      }
      // A player with no games at all: every row zero, and no 0/0 anywhere.
      expect(await store.loadModeRecord(randomUUID())).toEqual(emptyModeRecord())

      /** One finished (or dead) game with `me` on seat 0. `mine` = my verdict. */
      const play = async (
        mode: Mode,
        isPrivate: boolean,
        mine: 'win' | 'lose' | 'eliminated' | 'aborted' | null,
        status: 'finished' | 'aborted' = 'finished'
      ): Promise<void> => {
        const gameId = randomUUID()
        await store.createGame({
          gameId,
          mode,
          status: 'lobby',
          isPrivate,
          inviteCode: null,
          rulesVersion: '1.0.0',
          rngSeedHash: 'h'
        })
        const machine = mode === 'vs_bots' || mode === 'tutorial'
        await store.markActive(gameId, [
          { seat: 0, userId: me, botStrategy: null },
          machine
            ? { seat: 1, userId: null, botStrategy: 'random-legal' }
            : { seat: 1, userId: rival, botStrategy: null }
        ])
        await store.finishGame(gameId, {
          status,
          results:
            mine === null
              ? [] // how an abandoned lobby really lands: no result rows at all
              : [
                  { seat: 0, result: mine, finalVp: 1 },
                  {
                    seat: 1,
                    result: mine === 'aborted' ? 'aborted' : mine === 'win' ? 'lose' : 'win',
                    finalVp: 2
                  }
                ],
          rngSeed: 's'
        })
      }

      await play('1v1', false, 'win') // ranked
      await play('ffa3', false, 'eliminated') // ranked, and a forfeit is a loss
      await play('1v1', true, 'win') // invite game → private, never ranked
      await play('2v2', true, 'lose') // private too: the flag decides, not the mode
      await play('vs_bots', false, 'win')
      await play('vs_bots', false, 'lose')
      await play('tutorial', false, 'eliminated') // a lesson: counts nowhere
      await play('1v1', false, null, 'aborted') // dead lobby: not a game played
      await play('1v1', false, 'aborted', 'aborted') // same, verdict spelled out

      const record = await store.loadModeRecord(me)
      expect(record.ranked).toEqual({ played: 2, wins: 1, losses: 1 })
      expect(record.private).toEqual({ played: 2, wins: 1, losses: 1 })
      expect(record.bots).toEqual({ played: 2, wins: 1, losses: 1 })
      // No public 2v2 exists (that mode is invite-only today), so the row is empty
      // rather than folded into ranked.
      expect(record.team).toEqual({ played: 0, wins: 0, losses: 0 })
      // The books balance in every row: 9 games sat in, 6 counted.
      for (const row of Object.values(record)) expect(row.played).toBe(row.wins + row.losses)
      expect(winRate(record.ranked)).toBe(50)
      expect(winRate(record.team)).toBeNull()

      // The batch loader must agree with the single-user one, row for row —
      // the Players directory reads a whole page through it.
      const batch = await store.loadModeRecords([me, rival, randomUUID()])
      expect(batch.get(me)).toEqual(record)
      // A user with no games is present with an empty record, never absent.
      expect([...batch.values()]).toHaveLength(3)
      for (const [, r] of batch) expect(Object.keys(r).sort()).toEqual(Object.keys(record).sort())

      // The record is per user, not per game: the rival's own row set differs.
      const theirs = await store.loadModeRecord(rival)
      expect(theirs.ranked).toEqual({ played: 2, wins: 1, losses: 1 })
      expect(theirs.bots).toEqual({ played: 0, wins: 0, losses: 0 })
    } finally {
      await close()
    }
  })

  it('achievement counters split mode × privacy, and a badge is granted once', async () => {
    const { store, close, seedProfile } = await make()
    try {
      const me = randomUUID()
      const rival = randomUUID()
      if (seedProfile) {
        await seedProfile(me)
        await seedProfile(rival)
      }
      expect(await store.loadPlayCounts(randomUUID())).toEqual(emptyPlayCounts())
      expect(await store.loadAchievements(randomUUID())).toEqual([])

      /** One finished game with `me` on seat 0 and `mine` as my verdict. */
      const play = async (
        mode: Mode,
        isPrivate: boolean,
        mine: 'win' | 'lose' | 'eliminated' | null,
        status: 'finished' | 'aborted' = 'finished'
      ): Promise<string> => {
        const gameId = randomUUID()
        await store.createGame({
          gameId,
          mode,
          status: 'lobby',
          isPrivate,
          inviteCode: null,
          rulesVersion: '1.0.0',
          rngSeedHash: 'h'
        })
        const machine = mode === 'vs_bots' || mode === 'tutorial'
        await store.markActive(gameId, [
          { seat: 0, userId: me, botStrategy: null },
          machine
            ? { seat: 1, userId: null, botStrategy: 'random-legal' }
            : { seat: 1, userId: rival, botStrategy: null }
        ])
        await store.finishGame(gameId, {
          status,
          results:
            mine === null
              ? []
              : [
                  { seat: 0, result: mine, finalVp: 1 },
                  { seat: 1, result: mine === 'win' ? 'lose' : 'win', finalVp: 2 }
                ],
          rngSeed: 's'
        })
        return gameId
      }

      // The whole point of this aggregate: private 1v1, private 3-player and
      // private 2v2 are three DIFFERENT badge families, where loadModeRecord
      // would fold all three into one `private` row.
      await play('1v1', true, 'win')
      await play('1v1', true, 'lose')
      await play('ffa3', true, 'eliminated') // a forfeit is played, and not a win
      await play('2v2', true, 'win')
      await play('1v1', false, 'win') // ranked
      await play('ffa3', false, 'lose') // ranked
      const botGame = await play('vs_bots', false, 'win')
      await play('tutorial', false, 'win') // a lesson: counts in no category
      await play('1v1', false, null, 'aborted') // dead lobby: never played

      const counts = await store.loadPlayCounts(me)
      expect(counts).toEqual({
        bots: { played: 1, wins: 1 },
        'private.1v1': { played: 2, wins: 1 },
        'private.ffa3': { played: 1, wins: 0 },
        'private.2v2': { played: 1, wins: 1 },
        'ranked.1v1': { played: 1, wins: 1 },
        'ranked.ffa3': { played: 1, wins: 0 }
      })
      // The record table's coarser split still agrees on the totals.
      expect((await store.loadModeRecord(me)).private.played).toBe(4)

      // A badge from a game carries the game; counters are archive-wide and carry null.
      expect(
        await store.awardAchievements(me, ['feat.win.first', 'feat.win.turn5'], botGame)
      ).toEqual(['feat.win.first', 'feat.win.turn5'])
      expect(await store.awardAchievements(me, ['play.bots.10'], null)).toEqual(['play.bots.10'])
      // Granted again on the next qualifying game: the primary key absorbs it and
      // only the genuinely new id comes back.
      expect(
        await store.awardAchievements(me, ['feat.win.first', 'feat.win.landslide'], botGame)
      ).toEqual(['feat.win.landslide'])
      expect(await store.awardAchievements(me, [], botGame)).toEqual([])

      const earned = await store.loadAchievements(me)
      expect(earned.map((a) => a.id).sort()).toEqual([
        'feat.win.first',
        'feat.win.landslide',
        'feat.win.turn5',
        'play.bots.10'
      ])
      for (const a of earned) expect(Number.isNaN(Date.parse(a.earnedAt))).toBe(false)
      // Per user, not global.
      expect(await store.loadAchievements(rival)).toEqual([])
    } finally {
      await close()
    }
  })

  it('rejects event seq gaps', async () => {
    const { store, close } = await make()
    try {
      const gameId = randomUUID()
      await store.createGame({
        gameId,
        mode: '1v1',
        status: 'lobby',
        isPrivate: true,
        inviteCode: null,
        rulesVersion: '1.0.0',
        rngSeedHash: 'h'
      })
      await store.appendEvents(gameId, [{ seq: 1, type: 'a', payload: {}, visibility: 'public' }])
      await expect(
        store.appendEvents(gameId, [{ seq: 3, type: 'b', payload: {}, visibility: 'public' }])
      ).rejects.toThrow(/gap/)
    } finally {
      await close()
    }
  })
})

describe('SqlStore ratings', () => {
  it('upserts ratings, counts games, and stamps rating_before/after on the seats', async () => {
    const sql = await makePgliteSql('memory://')
    try {
      await migrate(sql)
      const store = new SqlStore(sql)
      const profiles = new SqlProfileStore(sql)
      const alice = randomUUID()
      const bob = randomUUID()
      await profiles.getOrCreate(alice, null)
      await profiles.getOrCreate(bob, null)

      const gameId = randomUUID()
      await store.createGame({
        gameId,
        mode: '1v1',
        status: 'lobby',
        isPrivate: false,
        inviteCode: null,
        rulesVersion: '1.0.0',
        rngSeedHash: 'hash'
      })
      await store.markActive(gameId, [
        { seat: 0, userId: alice, botStrategy: null },
        { seat: 1, userId: bob, botStrategy: null }
      ])

      expect(await store.loadRatings('1v1', [alice, bob])).toEqual(new Map())

      await store.saveRatings(gameId, '1v1', [
        {
          seat: 0,
          userId: alice,
          ratingBefore: 1500,
          after: { rating: 1520, rd: 300, volatility: 0.06 }
        },
        {
          seat: 1,
          userId: bob,
          ratingBefore: 1500,
          after: { rating: 1480, rd: 300, volatility: 0.06 }
        }
      ])

      const loaded = await store.loadRatings('1v1', [alice, bob])
      expect(loaded.get(alice)).toMatchObject({ rating: 1520, games: 1 })
      expect(loaded.get(bob)).toMatchObject({ rating: 1480, games: 1 })

      // A second game increments `games` rather than inserting a duplicate row.
      await store.saveRatings(gameId, '1v1', [
        {
          seat: 0,
          userId: alice,
          ratingBefore: 1520,
          after: { rating: 1535, rd: 280, volatility: 0.06 }
        }
      ])
      expect((await store.loadRatings('1v1', [alice])).get(alice)).toMatchObject({
        rating: 1535,
        games: 2
      })

      const seats = await sql.query<{ seat: number; rating_before: number; rating_after: number }>(
        `select seat, rating_before, rating_after from game_players where game_id = $1 order by seat`,
        [gameId]
      )
      expect(seats.rows[0]).toMatchObject({ rating_before: 1520, rating_after: 1535 })
      expect(seats.rows[1]).toMatchObject({ rating_before: 1500, rating_after: 1480 })

      // Ratings are per mode: ffa3 knows nothing of these 1v1 games.
      expect(await store.loadRatings('ffa3', [alice, bob])).toEqual(new Map())
    } finally {
      await sql.close()
    }
  })
})

describe('SqlProfileStore', () => {
  it('creates once, is idempotent, and survives nickname collisions', async () => {
    const sql = await makePgliteSql('memory://')
    try {
      await migrate(sql)
      const profiles = new SqlProfileStore(sql)
      const userId = randomUUID()
      const first = await profiles.getOrCreate(userId, null)
      const second = await profiles.getOrCreate(userId, null)
      expect(second).toEqual(first)
      expect(first.nickname.length).toBeGreaterThanOrEqual(3)

      // Force a nickname collision: another user whose default nickname is taken.
      const other = randomUUID()
      await sql.query(`update profiles set nickname = $2 where user_id = $1`, [
        userId,
        `p_${other.replace(/-/g, '').slice(0, 10)}`
      ])
      const otherProfile = await profiles.getOrCreate(other, null)
      expect(otherProfile.userId).toBe(other)
    } finally {
      await sql.close()
    }
  })

  it('renames, and refuses a name another profile holds in any casing', async () => {
    const sql = await makePgliteSql('memory://')
    try {
      await migrate(sql)
      const profiles = new SqlProfileStore(sql)
      const alice = randomUUID()
      const bob = randomUUID()
      await profiles.getOrCreate(alice, null)
      await profiles.getOrCreate(bob, null)

      expect(await profiles.rename(alice, 'Highlander')).toMatchObject({
        userId: alice,
        nickname: 'Highlander'
      })
      expect(await profiles.rename(bob, 'highlander')).toBe('taken')
      // Re-claiming your own nickname is not a conflict with yourself.
      expect(await profiles.rename(alice, 'Highlander')).toMatchObject({ nickname: 'Highlander' })
      expect((await profiles.getOrCreate(bob, null)).nickname).not.toBe('highlander')
    } finally {
      await sql.close()
    }
  })

  it('the lower(nickname) index rejects a case-variant written behind the store', async () => {
    const sql = await makePgliteSql('memory://')
    try {
      await migrate(sql)
      const profiles = new SqlProfileStore(sql)
      const alice = randomUUID()
      const bob = randomUUID()
      await profiles.getOrCreate(alice, null)
      await profiles.getOrCreate(bob, null)
      await profiles.rename(alice, 'Unique_One')

      await expect(
        sql.query(`update profiles set nickname = $2 where user_id = $1`, [bob, 'unique_one'])
      ).rejects.toThrow()
    } finally {
      await sql.close()
    }
  })

  it('lists and searches the roster, and a LIKE wildcard stays a literal', async () => {
    const sql = await makePgliteSql('memory://')
    try {
      await migrate(sql)
      await sql.exec('set role metarchy_server')
      const profiles = new SqlProfileStore(sql)
      const ids = [randomUUID(), randomUUID(), randomUUID()]
      for (const id of ids) await profiles.getOrCreate(id, null)
      await profiles.rename(ids[0] as string, 'Highlander_X')
      await profiles.rename(ids[1] as string, 'web34ever')
      await profiles.rename(ids[2] as string, 'Okeesha')

      const all = await profiles.listProfiles({ query: null, limit: 10, offset: 0 })
      expect(all.total).toBe(3)
      expect(all.rows.map((r) => r.nickname).sort()).toEqual([
        'Highlander_X',
        'Okeesha',
        'web34ever'
      ])

      // Case-insensitive substring.
      const hit = await profiles.listProfiles({ query: 'EESH', limit: 10, offset: 0 })
      expect(hit.rows.map((r) => r.nickname)).toEqual(['Okeesha'])
      expect(hit.total).toBe(1)

      // Paging is stable (ordered by created_at, user_id) and `total` ignores it.
      const page = await profiles.listProfiles({ query: null, limit: 2, offset: 2 })
      expect(page.rows).toHaveLength(1)
      expect(page.total).toBe(3)

      // The wildcards ILIKE would honour must be escaped, or a search for '%'
      // would hand the whole roster to anyone who typed it. '_' is legal INSIDE
      // a nickname, so escaped it matches the one name that really contains it
      // — unescaped it would match every name at least one character long.
      for (const needle of ['%', '%e%', '_e_']) {
        const res = await profiles.listProfiles({ query: needle, limit: 10, offset: 0 })
        expect(res.rows, needle).toEqual([])
        expect(res.total, needle).toBe(0)
      }
      const underscore = await profiles.listProfiles({ query: '_', limit: 10, offset: 0 })
      expect(underscore.rows.map((r) => r.nickname)).toEqual(['Highlander_X'])

      expect((await profiles.findByNickname('HIGHLANDER_X'))?.userId).toBe(ids[0])
      expect(await profiles.findByNickname('nobody')).toBeNull()
    } finally {
      await sql.close()
    }
  })

  it('wardrobe: sets a loadout, reads it back on getOrCreate, and clears to null', async () => {
    const sql = await makePgliteSql('memory://')
    try {
      await migrate(sql)
      await sql.exec('set role metarchy_server') // update grant must cover the new column
      const profiles = new SqlProfileStore(sql)
      const alice = randomUUID()
      await profiles.getOrCreate(alice, null)

      const wardrobe = {
        politician: { body: 3, costume: [2, 4] as [number, number], accessories: [] }
      }
      expect((await profiles.setWardrobe(alice, wardrobe)).wardrobe).toEqual(wardrobe)
      expect((await profiles.getOrCreate(alice, null)).wardrobe).toEqual(wardrobe)
      expect((await profiles.setWardrobe(alice, null)).wardrobe).toBeNull()
    } finally {
      await sql.close()
    }
  })
})
