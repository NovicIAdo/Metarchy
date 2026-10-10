// The reference case is Glickman's own worked example ("Example of the Glicko-2
// system", §Example calculation). If these numbers drift, the implementation is
// wrong — not the test.
//
// The paper prints 1464.06 / 151.52 / 0.05999, having rounded every intermediate
// to 4 decimals on the way. Carried at full precision the same formulas give
// 1464.0507 / 151.5165 / 0.0599960, which is what we assert; the paper's figures
// are checked too, at the precision they were published to.

import { describe, expect, it } from 'vitest'
import type { FinishedSeat, Rating } from '../src/ratings.js'
import { DEFAULT_RD, rateGame, scoreAgainst, UNRATED, updateRating } from '../src/ratings.js'

const rating = (r: number, rd: number, volatility = 0.06): Rating => ({ rating: r, rd, volatility })

describe('updateRating (Glicko-2)', () => {
  it('reproduces Glickman’s published example', () => {
    const player = rating(1500, 200)
    const after = updateRating(player, [
      { rating: rating(1400, 30), score: 1 },
      { rating: rating(1550, 100), score: 0 },
      { rating: rating(1700, 300), score: 0 }
    ])
    expect(after.rating).toBeCloseTo(1464.0507, 4)
    expect(after.rd).toBeCloseTo(151.5165, 4)
    expect(after.volatility).toBeCloseTo(0.059996, 7)

    // …and it still lands on the paper's rounded figures.
    expect(after.rating).toBeCloseTo(1464.06, 1)
    expect(after.rd).toBeCloseTo(151.52, 1)
  })

  it('an unplayed period leaves the rating alone and widens RD', () => {
    const after = updateRating(rating(1500, 200), [])
    expect(after.rating).toBe(1500)
    expect(after.rd).toBeGreaterThan(200)
    expect(after.volatility).toBe(0.06)
  })

  it('never lets RD exceed the default — an unrated player is the ceiling of doubt', () => {
    const after = updateRating(rating(1500, DEFAULT_RD), [])
    expect(after.rd).toBe(DEFAULT_RD)
  })

  it('beating a stronger player raises the rating; losing to a weaker one lowers it', () => {
    const upset = updateRating(UNRATED, [{ rating: rating(1800, 50), score: 1 }])
    expect(upset.rating).toBeGreaterThan(1500)
    const choke = updateRating(UNRATED, [{ rating: rating(1200, 50), score: 0 }])
    expect(choke.rating).toBeLessThan(1500)
  })

  it('a win over a fog-of-war opponent (huge RD) moves the rating less than one over a known peer', () => {
    const vsUnknown = updateRating(UNRATED, [{ rating: rating(1500, 350), score: 1 }])
    const vsKnown = updateRating(UNRATED, [{ rating: rating(1500, 30), score: 1 }])
    expect(vsKnown.rating - 1500).toBeGreaterThan(vsUnknown.rating - 1500)
  })
})

describe('scoreAgainst', () => {
  const seat = (over: Partial<FinishedSeat> & Pick<FinishedSeat, 'seat'>): FinishedSeat => ({
    userId: `u${over.seat}`,
    finalVp: 0,
    won: false,
    ...over
  })

  it('a winner beats every non-winner regardless of VP', () => {
    const winner = seat({ seat: 0, won: true, finalVp: 3 })
    const loser = seat({ seat: 1, finalVp: 99 })
    expect(scoreAgainst(winner, loser)).toBe(1)
    expect(scoreAgainst(loser, winner)).toBe(0)
  })

  it('among non-winners, victory points order the field, ties split', () => {
    const a = seat({ seat: 0, finalVp: 5 })
    const b = seat({ seat: 1, finalVp: 2 })
    const c = seat({ seat: 2, finalVp: 5 })
    expect(scoreAgainst(a, b)).toBe(1)
    expect(scoreAgainst(b, a)).toBe(0)
    expect(scoreAgainst(a, c)).toBe(0.5)
  })

  it('a seat that never scored counts as zero VP', () => {
    const quitter = seat({ seat: 0, finalVp: null })
    const player = seat({ seat: 1, finalVp: 1 })
    expect(scoreAgainst(quitter, player)).toBe(0)
  })
})

describe('rateGame', () => {
  const before = new Map<string, Rating>()

  it('1v1: the winner gains exactly what the symmetric loser loses, from equal footing', () => {
    const changes = rateGame(
      [
        { seat: 0, userId: 'a', finalVp: 7, won: true },
        { seat: 1, userId: 'b', finalVp: 4, won: false }
      ],
      before
    )
    const [winner, loser] = changes
    expect(winner?.after.rating).toBeGreaterThan(1500)
    expect(loser?.after.rating).toBeLessThan(1500)
    expect((winner?.after.rating ?? 0) - 1500).toBeCloseTo(1500 - (loser?.after.rating ?? 0), 6)
  })

  it('ffa3: everyone is rated against the others’ pre-game ratings, so order cannot matter', () => {
    const seats: FinishedSeat[] = [
      { seat: 0, userId: 'a', finalVp: 9, won: true },
      { seat: 1, userId: 'b', finalVp: 5, won: false },
      { seat: 2, userId: 'c', finalVp: 1, won: false }
    ]
    const forwards = rateGame(seats, before)
    const backwards = rateGame([...seats].reverse(), before)

    for (const change of forwards) {
      const mirror = backwards.find((c) => c.userId === change.userId)
      expect(mirror?.after.rating).toBeCloseTo(change.after.rating, 9)
    }
    // and the podium order survives into the ratings
    const by = (id: string) => forwards.find((c) => c.userId === id)?.after.rating ?? 0
    expect(by('a')).toBeGreaterThan(by('b'))
    expect(by('b')).toBeGreaterThan(by('c'))
  })

  it('the middle finisher in a 3-way barely moves — one win, one loss', () => {
    const changes = rateGame(
      [
        { seat: 0, userId: 'a', finalVp: 9, won: true },
        { seat: 1, userId: 'b', finalVp: 5, won: false },
        { seat: 2, userId: 'c', finalVp: 1, won: false }
      ],
      before
    )
    const middle = changes.find((c) => c.userId === 'b')
    expect(Math.abs((middle?.after.rating ?? 0) - 1500)).toBeLessThan(20)
  })
})
