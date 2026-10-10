// GATO for ranked play (author's schedule, 2026-07-26). Gated exactly like the
// rating update — a public game in a rated mode — with one difference: a bot
// filling a ranked seat cancels the rating update entirely, but only *lowers*
// the payout. The bot itself always earns nothing, and it never reaches a
// wallet: a bot seat has no userId.
//
// The author gave the schedule as a table rather than a formula, so it stays a
// table. Read by finishing place, best first:
//
//   1v1  humans   30 / 10        ffa3 humans   30 / 20 / 10
//   1v1  with bot 10 /  0        ffa3 with bot 20 / 10 /  0
//
// 2v2 is absent on purpose: it is not a rated mode (ratings.ts — team ratings
// are a separate design), so it pays nothing, same as private games and the
// casual vs_bots button.

import type { Mode, SeatId } from '@metarchy/engine'
import { isRatedMode, type RatedMode } from './ratings.js'

const LADDER: Record<RatedMode, { humansOnly: number[]; withBot: number[] }> = {
  '1v1': { humansOnly: [30, 10], withBot: [10, 0] },
  ffa3: { humansOnly: [30, 20, 10], withBot: [20, 10, 0] }
}

/**
 * Casual games against bots pay a token amount (author, 2026-08-01: «давай дадим
 * символические 5 ГАТО, просто для тестов»). The reason is a measurement, not
 * generosity: 102 of the 123 finished games in the beta were vs_bots, so the only
 * faucet in the economy was attached to the mode almost nobody played
 * (plan/Market-Plan.md §1). Placement does not matter here — showing up does.
 *
 * `tutorial` rides the same code path as vs_bots everywhere else in the server
 * and is deliberately NOT in this table: a lesson is not a wage.
 */
const CASUAL_REWARD = 5

export interface RewardSeat {
  seat: SeatId
  /** null = a bot took this ranked seat: it earns nothing and lowers the ladder. */
  userId: string | null
}

export interface RewardInput {
  mode: Mode
  isPrivate: boolean
  seats: RewardSeat[]
  /**
   * Finishing order, best first — one group per place, seats tied for a place
   * share the group. Seats the engine left out (eliminated: a forfeit or a
   * disconnect) are treated as finishing behind everyone who is listed.
   */
  ranking: SeatId[][]
}

export interface RewardCredit {
  seat: SeatId
  userId: string
  amount: number
}

/**
 * What each human seat earned. Zero-amount credits are returned too — the
 * caller records the payout of every ranked seat, so "played and earned 0"
 * stays distinguishable from "never paid out" when a game is recovered.
 */
export function rankedRewards(input: RewardInput): RewardCredit[] {
  if (input.isPrivate) return []

  if (input.mode === 'vs_bots')
    return input.seats
      .filter((s): s is { seat: SeatId; userId: string } => s.userId !== null)
      .map((s) => ({ seat: s.seat, userId: s.userId, amount: CASUAL_REWARD }))

  if (!isRatedMode(input.mode)) return []

  const hasBot = input.seats.some((s) => s.userId === null)
  const ladder = hasBot ? LADDER[input.mode].withBot : LADDER[input.mode].humansOnly

  // Standard competition ranking (1, 1, 3): a place costs as many slots as the
  // group holds, so a shared 1st still leaves the next seat in 3rd.
  const placeOf = new Map<SeatId, number>()
  let taken = 0
  for (const group of input.ranking) {
    for (const seat of group) placeOf.set(seat, taken + 1)
    taken += group.length
  }

  return input.seats
    .filter((s): s is { seat: SeatId; userId: string } => s.userId !== null)
    .map((s) => {
      // Unranked = eliminated before scoring: last place, whatever that pays.
      const index = (placeOf.get(s.seat) ?? ladder.length) - 1
      return {
        seat: s.seat,
        userId: s.userId,
        amount: ladder[Math.min(Math.max(index, 0), ladder.length - 1)] as number
      }
    })
}
