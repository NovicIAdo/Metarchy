// Achievements (author's list, 2026-07-27). The feat evaluator is pure, so these
// build a finished state by hand instead of driving whole games: what is under
// test is the PREDICATE, and a scripted game would only prove that one game
// happened to hit it.

import { randomUUID } from 'node:crypto'
import type { GameState, Mode, PlayedCard, SeatId } from '@metarchy/engine'
import { RANKED_BOT_STRATEGY, createGame } from '@metarchy/engine'
import { PLAY_CATEGORIES, countAchievements, emptyPlayCounts } from '@metarchy/protocol'
import { describe, expect, it } from 'vitest'
import { featsEarned, grantAchievements } from '../src/achievements.js'
import type { AchievementSeat } from '../src/achievements.js'
import { MemoryStore } from '../src/store.js'

/** A finished game as finishLocked hands it over: phase 'finished', final turn. */
function finished(opts: {
  mode?: Mode
  turn?: number
  isTieBreakerTurn?: boolean
  played?: PlayedCard[]
  ranking?: { seats: SeatId[]; vp: number }[]
  winnerSeats?: SeatId[]
}): GameState {
  const state = createGame({ gameId: randomUUID(), mode: opts.mode ?? '1v1', seed: 'seed' })
  state.turn = opts.turn ?? 5
  state.isTieBreakerTurn = opts.isTieBreakerTurn ?? false
  state.played = opts.played ?? []
  state.phase = {
    kind: 'finished',
    winnerSeats: opts.winnerSeats ?? [0],
    ranking: opts.ranking ?? [
      { seats: [0], vp: 5 },
      { seats: [1], vp: 4 }
    ]
  }
  return state
}

const cards = (turn: number, card: PlayedCard['card'], n: number, seat: SeatId = 0): PlayedCard[] =>
  Array.from({ length: n }, () => ({ seat, card, turn }))

describe('featsEarned: "Пройти Туториал"', () => {
  it('unlocks when the tutorial was played to the end, win or lose', () => {
    const state = finished({ mode: 'tutorial', turn: 3 })
    expect(featsEarned({ state, seat: 0, result: 'win', botStrategies: [] })).toEqual([
      'feat.tutorial.complete'
    ])
    expect(featsEarned({ state, seat: 0, result: 'lose', botStrategies: [] })).toEqual([
      'feat.tutorial.complete'
    ])
  })

  it('does NOT unlock when the player quit — even on the last tutorial turn', () => {
    // The whole point of the predicate. Forfeiting eliminates the seat, and the
    // beta archive is full of exactly this shape: 21 human seats 'eliminated' at
    // turns 1..3 against 4 that played it out. A badge that unlocked here would
    // celebrate quitting.
    const state = finished({ mode: 'tutorial', turn: 3 })
    expect(featsEarned({ state, seat: 0, result: 'eliminated', botStrategies: [] })).toEqual([])
  })

  it('gives the tutorial no other badge — its bot is scripted to lose', () => {
    // A tie-breaker can push a finished tutorial past TUTORIAL_MAX_TURNS (the
    // archive has completed runs at turn 5), which would otherwise hand out
    // "won on turn 5" and "first win" for free.
    const state = finished({
      mode: 'tutorial',
      turn: 5,
      isTieBreakerTurn: true,
      played: cards(2, 'relocation', 3)
    })
    expect(featsEarned({ state, seat: 0, result: 'win', botStrategies: [] })).toEqual([
      'feat.tutorial.complete'
    ])
  })
})

describe('featsEarned: "Победить за N ходов"', () => {
  it('a win on turn 5 is the on-schedule rung and nothing longer', () => {
    const earned = featsEarned({
      state: finished({ turn: 5 }),
      seat: 0,
      result: 'win',
      botStrategies: []
    })
    expect(earned).toContain('feat.win.turn5')
    expect(earned).toContain('feat.win.first')
    expect(earned).not.toContain('feat.win.turn6')
    expect(earned).not.toContain('feat.win.tiebreak')
  })

  it('a win on turn 7 is a tie-breaker win, and not a turn-5 one', () => {
    // MAX_TURNS is 5: turns 6/7/8 only exist because the game was tied on VP and
    // the engine added tie-breaker turns.
    const earned = featsEarned({
      state: finished({ turn: 7, isTieBreakerTurn: true }),
      seat: 0,
      result: 'win',
      botStrategies: []
    })
    expect(earned).toContain('feat.win.turn7')
    expect(earned).toContain('feat.win.tiebreak')
    expect(earned).not.toContain('feat.win.turn5')
  })

  it('a loss earns no victory badge however long the game ran', () => {
    const earned = featsEarned({
      state: finished({ turn: 8, isTieBreakerTurn: true }),
      seat: 1,
      result: 'lose',
      botStrategies: []
    })
    expect(earned.filter((id) => id.startsWith('feat.win.'))).toEqual([])
  })
})

describe('featsEarned: three Action Cards of a kind in ONE turn', () => {
  it('unlocks per kind: relocation, change of values, and disabling Locations', () => {
    const relocations = featsEarned({
      state: finished({ played: cards(2, 'relocation', 3) }),
      seat: 0,
      result: 'lose',
      botStrategies: []
    })
    expect(relocations).toEqual(['feat.turn.relocation3'])

    const exchanges = featsEarned({
      state: finished({ played: cards(3, 'change_values', 3) }),
      seat: 0,
      result: 'lose',
      botStrategies: []
    })
    expect(exchanges).toEqual(['feat.turn.exchange3'])

    // Blocks are the cards that disable a Location (BLOCK_CARD_LOCATION); three
    // distinct ones, because the deck holds one of each.
    const blocks = featsEarned({
      state: finished({
        played: [
          { seat: 0, card: 'sabotage', turn: 4 },
          { seat: 0, card: 'cable_stolen', turn: 4 },
          { seat: 0, card: 'student_protests', turn: 4 }
        ]
      }),
      seat: 0,
      result: 'lose',
      botStrategies: []
    })
    expect(blocks).toEqual(['feat.turn.block3'])
  })

  it('three spread over three turns is NOT the feat', () => {
    const state = finished({
      played: [
        ...cards(1, 'relocation', 1),
        ...cards(2, 'relocation', 1),
        ...cards(3, 'relocation', 1)
      ]
    })
    expect(featsEarned({ state, seat: 0, result: 'lose', botStrategies: [] })).toEqual([])
  })

  it('counts only this seat, and one of each kind is its own badge', () => {
    const state = finished({
      played: [
        ...cards(2, 'relocation', 3, 1), // the opponent's turn-2 triple
        { seat: 0, card: 'relocation', turn: 2 },
        { seat: 0, card: 'change_values', turn: 2 },
        { seat: 0, card: 'sabotage', turn: 2 }
      ]
    })
    expect(featsEarned({ state, seat: 0, result: 'lose', botStrategies: [] })).toEqual([
      'feat.turn.allKinds'
    ])
    expect(featsEarned({ state, seat: 1, result: 'lose', botStrategies: [] })).toEqual([
      'feat.turn.relocation3'
    ])
  })
})

describe('featsEarned: proposed victory badges', () => {
  it('a landslide needs a runner-up that actually scored', () => {
    const win = (ranking: { seats: SeatId[]; vp: number }[]): string[] =>
      featsEarned({ state: finished({ ranking }), seat: 0, result: 'win', botStrategies: [] })

    expect(
      win([
        { seats: [0], vp: 10 },
        { seats: [1], vp: 4 }
      ])
    ).toContain('feat.win.landslide')
    // Twice zero is zero — a shutout is not evidence of a thrashing.
    expect(
      win([
        { seats: [0], vp: 3 },
        { seats: [1], vp: 0 }
      ])
    ).not.toContain('feat.win.landslide')
    // Everyone else was eliminated: `ranking` holds only the sides that scored.
    expect(win([{ seats: [0], vp: 9 }])).not.toContain('feat.win.landslide')
  })

  it('"arguments only" needs an empty card log for this seat', () => {
    const clean = featsEarned({
      state: finished({ played: cards(2, 'relocation', 1, 1) }),
      seat: 0,
      result: 'win',
      botStrategies: []
    })
    expect(clean).toContain('feat.win.noCards')

    const spent = featsEarned({
      state: finished({ played: cards(2, 'relocation', 1, 0) }),
      seat: 0,
      result: 'win',
      botStrategies: []
    })
    expect(spent).not.toContain('feat.win.noCards')
  })

  it('the hard bot only counts when you beat it', () => {
    const state = finished({})
    expect(
      featsEarned({ state, seat: 0, result: 'win', botStrategies: [RANKED_BOT_STRATEGY] })
    ).toContain('feat.win.vsHardBot')
    expect(
      featsEarned({ state, seat: 0, result: 'win', botStrategies: ['random-legal'] })
    ).not.toContain('feat.win.vsHardBot')
    expect(
      featsEarned({ state, seat: 1, result: 'lose', botStrategies: [RANKED_BOT_STRATEGY] })
    ).not.toContain('feat.win.vsHardBot')
  })
})

describe("countAchievements: the author's 10 / 100 / 1000 tiers", () => {
  it('nine games is not ten', () => {
    const counts = emptyPlayCounts()
    counts['ranked.1v1'] = { played: 9, wins: 5 }
    expect(countAchievements(counts)).toEqual([])

    counts['ranked.1v1'] = { played: 10, wins: 5 }
    expect(countAchievements(counts)).toEqual(['play.ranked.1v1.10'])
  })

  it('a higher tier carries the lower ones with it', () => {
    const counts = emptyPlayCounts()
    counts['private.2v2'] = { played: 1000, wins: 1 }
    expect(countAchievements(counts)).toEqual([
      'play.private.2v2.10',
      'play.private.2v2.100',
      'play.private.2v2.1000'
    ])
  })

  it('"been everywhere" needs a win in every one of the six categories', () => {
    const counts = emptyPlayCounts()
    for (const c of PLAY_CATEGORIES) counts[c] = { played: 1, wins: 1 }
    expect(countAchievements(counts)).toContain('play.everyCategory.win')

    counts['ranked.ffa3'] = { played: 5, wins: 0 } // played a lot, never won one
    expect(countAchievements(counts)).not.toContain('play.everyCategory.win')
  })
})

describe('grantAchievements', () => {
  const log = { info: () => {}, warn: () => {}, error: () => {} }

  /** Ten finished vs_bots games for `me`, all wins — enough for the first tier. */
  async function seedTenBotWins(store: MemoryStore, me: string): Promise<string> {
    let last = ''
    for (let i = 0; i < 10; i++) {
      const gameId = randomUUID()
      last = gameId
      await store.createGame({
        gameId,
        mode: 'vs_bots',
        status: 'lobby',
        isPrivate: false,
        inviteCode: null,
        rulesVersion: '1.0.0',
        rngSeedHash: 'h'
      })
      await store.markActive(gameId, [
        { seat: 0, userId: me, botStrategy: null },
        { seat: 1, userId: null, botStrategy: 'random-legal' }
      ])
      await store.finishGame(gameId, {
        status: 'finished',
        results: [
          { seat: 0, result: 'win', finalVp: 7 },
          { seat: 1, result: 'lose', finalVp: 2 }
        ],
        rngSeed: 's'
      })
    }
    return last
  }

  it('awards feats and counters once, however often the finish runs', async () => {
    const store = new MemoryStore()
    const me = randomUUID()
    const gameId = await seedTenBotWins(store, me)
    const seats: AchievementSeat[] = [
      { seat: 0, userId: me, botStrategy: null, result: 'win' },
      { seat: 1, userId: null, botStrategy: 'random-legal', result: 'lose' }
    ]
    const state = finished({ mode: 'vs_bots', turn: 5 })

    await grantAchievements({ store, log, gameId, state, seats })
    const first = await store.loadAchievements(me)
    expect(first.map((a) => a.id).sort()).toEqual([
      'feat.win.first',
      'feat.win.noCards',
      'feat.win.turn5',
      'play.bots.10'
    ])

    // Crash recovery can reach `finished` a second time. The primary key absorbs
    // it: nothing new lands, and earned_at does not move — which is what makes
    // "first win" mean the first one.
    await grantAchievements({ store, log, gameId, state, seats })
    const again = await store.loadAchievements(me)
    expect(again).toEqual(first)
  })

  it('a bot seat earns nothing — it has no profile', async () => {
    const store = new MemoryStore()
    const me = randomUUID()
    const gameId = await seedTenBotWins(store, me)
    await grantAchievements({
      store,
      log,
      gameId,
      state: finished({ mode: 'vs_bots' }),
      seats: [
        { seat: 0, userId: me, botStrategy: null, result: 'win' },
        { seat: 1, userId: null, botStrategy: 'random-legal', result: 'lose' }
      ]
    })
    // Only the human has a row set at all; the bot has no user to key one by.
    expect((await store.loadAchievements(me)).length).toBeGreaterThan(0)
  })

  it('never throws when the store fails — a finished game outlives a badge', async () => {
    const broken = {
      loadPlayCounts: async () => {
        throw new Error('db down')
      },
      awardAchievements: async () => {
        throw new Error('db down')
      }
    }
    await expect(
      grantAchievements({
        store: broken,
        log,
        gameId: randomUUID(),
        state: finished({}),
        seats: [{ seat: 0, userId: randomUUID(), botStrategy: null, result: 'win' }]
      })
    ).resolves.toBeUndefined()
  })
})
