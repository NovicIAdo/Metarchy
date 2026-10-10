// The author's ranked GATO schedule, read straight off the table:
//
//   1v1  humans   30 / 10        ffa3 humans   30 / 20 / 10
//   1v1  with bot 10 /  0        ffa3 with bot 20 / 10 /  0
//
// plus the two rules that surround it: a bot always earns nothing, and anything
// that is not public ranked play pays nothing at all.

import { describe, expect, it } from 'vitest'
import type { SeatId } from '@metarchy/engine'
import { rankedRewards } from '../src/rewards.js'

const human = (seat: SeatId, userId: string): { seat: SeatId; userId: string } => ({ seat, userId })
const bot = (seat: SeatId): { seat: SeatId; userId: null } => ({ seat, userId: null })

/** userId → amount, which is all the caller of rankedRewards actually pays on. */
function paid(credits: { userId: string; amount: number }[]): Record<string, number> {
  return Object.fromEntries(credits.map((c) => [c.userId, c.amount]))
}

describe('ranked GATO rewards', () => {
  it('pays 30/10 in an all-human 1v1', () => {
    const credits = rankedRewards({
      mode: '1v1',
      isPrivate: false,
      seats: [human(0, 'alice'), human(1, 'bob')],
      ranking: [[0], [1]]
    })
    expect(paid(credits)).toEqual({ alice: 30, bob: 10 })
  })

  it('pays 30/20/10 by place in an all-human 3-player game', () => {
    const credits = rankedRewards({
      mode: 'ffa3',
      isPrivate: false,
      seats: [human(0, 'alice'), human(1, 'bob'), human(2, 'carol')],
      ranking: [[2], [0], [1]]
    })
    expect(paid(credits)).toEqual({ carol: 30, alice: 20, bob: 10 })
  })

  it('drops a 1v1 against a bot to 10 for the win and 0 for the loss', () => {
    const win = rankedRewards({
      mode: '1v1',
      isPrivate: false,
      seats: [human(0, 'alice'), bot(1)],
      ranking: [[0], [1]]
    })
    expect(paid(win)).toEqual({ alice: 10 })

    const loss = rankedRewards({
      mode: '1v1',
      isPrivate: false,
      seats: [human(0, 'alice'), bot(1)],
      ranking: [[1], [0]]
    })
    expect(paid(loss)).toEqual({ alice: 0 })
  })

  it('pays 20/10/0 when a bot filled the third ranked seat', () => {
    const credits = rankedRewards({
      mode: 'ffa3',
      isPrivate: false,
      seats: [human(0, 'alice'), human(1, 'bob'), bot(2)],
      ranking: [[0], [2], [1]] // the bot came second; the humans took 1st and last
    })
    // The bot is never in the payout at all — it has no wallet to credit.
    expect(credits.map((c) => c.seat).sort()).toEqual([0, 1])
    expect(paid(credits)).toEqual({ alice: 20, bob: 0 })
  })

  it('gives a shared place to everyone in it, and the next seat the place after', () => {
    // Standard competition ranking: a two-way tie for 1st leaves 3rd, not 2nd.
    const credits = rankedRewards({
      mode: 'ffa3',
      isPrivate: false,
      seats: [human(0, 'alice'), human(1, 'bob'), human(2, 'carol')],
      ranking: [[0, 1], [2]]
    })
    expect(paid(credits)).toEqual({ alice: 30, bob: 30, carol: 10 })
  })

  it('treats a seat the engine never ranked (forfeit, disconnect) as last', () => {
    const credits = rankedRewards({
      mode: 'ffa3',
      isPrivate: false,
      seats: [human(0, 'alice'), human(1, 'bob'), human(2, 'carol')],
      ranking: [[0], [2]] // seat 1 forfeited and is absent from the ranking
    })
    expect(paid(credits)).toEqual({ alice: 30, carol: 20, bob: 10 })
  })

  it('pays nothing outside public ranked play', () => {
    const seats = [human(0, 'alice'), human(1, 'bob')]
    // A private invite game: unrated, so unpaid — otherwise two friends farm it.
    expect(rankedRewards({ mode: '1v1', isPrivate: true, seats, ranking: [[0], [1]] })).toEqual([])
    // The tutorial rides the vs_bots code path everywhere else in the server and
    // is excluded here on purpose: a lesson is not a wage.
    expect(
      rankedRewards({ mode: 'tutorial', isPrivate: false, seats, ranking: [[0], [1]] })
    ).toEqual([])
    // 2v2 has no ratings (team ratings are a separate design), so no payout.
    expect(rankedRewards({ mode: '2v2', isPrivate: false, seats, ranking: [[0], [1]] })).toEqual([])
  })

  /**
   * Author, 2026-08-01: «давай дадим символические 5 ГАТО, просто для тестов».
   * The reason is a measurement — 102 of the beta's 123 finished games were
   * vs_bots, so the only faucet hung off the mode almost nobody played.
   */
  it('pays the casual bot button a flat token, regardless of who won', () => {
    const seats = [human(0, 'alice'), human(1, 'bob')]
    expect(
      paid(rankedRewards({ mode: 'vs_bots', isPrivate: false, seats, ranking: [[0], [1]] }))
    ).toEqual({ alice: 5, bob: 5 })
    // Losing still pays: showing up is the behaviour being rewarded.
    expect(
      paid(rankedRewards({ mode: 'vs_bots', isPrivate: false, seats, ranking: [[1], [0]] }))
    ).toEqual({ alice: 5, bob: 5 })
    // The bot in the other seat is not a user and earns nothing.
    expect(
      rankedRewards({
        mode: 'vs_bots',
        isPrivate: false,
        seats: [human(0, 'alice'), { seat: 1, userId: null }],
        ranking: [[0], [1]]
      })
    ).toEqual([{ seat: 0, userId: 'alice', amount: 5 }])
  })
})
