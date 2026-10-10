import { describe, expect, it } from 'vitest'
import type { LeaderboardRow } from '../src/screens/leaderboard.js'
import { isProvisional, rankRows } from '../src/screens/leaderboard.js'

const row = (over: Partial<LeaderboardRow> & Pick<LeaderboardRow, 'nickname' | 'rating'>) =>
  ({ user_id: over.nickname, avatar: null, rd: 60, games: 20, ...over }) as LeaderboardRow

describe('isProvisional', () => {
  it('marks a rating nobody should trust yet', () => {
    expect(isProvisional({ rd: 111 })).toBe(true)
    expect(isProvisional({ rd: 110 })).toBe(false)
  })
})

describe('rankRows', () => {
  it('sorts by rating, highest first', () => {
    const ranked = rankRows([
      row({ nickname: 'mid', rating: 1500 }),
      row({ nickname: 'top', rating: 1900 }),
      row({ nickname: 'low', rating: 1100 })
    ])
    expect(ranked.map((r) => r.nickname)).toEqual(['top', 'mid', 'low'])
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  it('shares a rank on a tie and skips the next one', () => {
    const ranked = rankRows([
      row({ nickname: 'a', rating: 1600 }),
      row({ nickname: 'b', rating: 1500 }),
      row({ nickname: 'c', rating: 1500 }),
      row({ nickname: 'd', rating: 1400 })
    ])
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4])
  })

  it('ties on the rating that is shown, not on hidden decimals', () => {
    const ranked = rankRows([
      row({ nickname: 'a', rating: 1500.4 }),
      row({ nickname: 'b', rating: 1499.6 })
    ])
    expect(ranked.map((r) => r.displayRating)).toEqual([1500, 1500])
    expect(ranked.map((r) => r.rank)).toEqual([1, 1])
  })

  it('carries the provisional flag through', () => {
    const ranked = rankRows([row({ nickname: 'rookie', rating: 1500, rd: 300, games: 1 })])
    expect(ranked[0]?.provisional).toBe(true)
  })

  it('leaves the caller’s array alone', () => {
    const rows = [row({ nickname: 'a', rating: 1000 }), row({ nickname: 'b', rating: 2000 })]
    rankRows(rows)
    expect(rows.map((r) => r.nickname)).toEqual(['a', 'b'])
  })
})
