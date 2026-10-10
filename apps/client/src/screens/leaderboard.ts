// Leaderboard presentation rules. The rows come straight from the `leaderboard`
// view over PostgREST (architecture/Client.md §5: public reads bypass the game
// socket); everything here is pure so it can be tested without a network.

import type { RankedMode } from '@metarchy/protocol'
import type { Language } from '../stores/settings.js'

export interface LeaderboardRow {
  user_id: string
  nickname: string
  avatar: string | null
  rating: number
  rd: number
  games: number
}

/** Platform-Services.md §4: a rating this uncertain is not yet a claim. */
export const PROVISIONAL_RD = 110

export function isProvisional(row: Pick<LeaderboardRow, 'rd'>): boolean {
  return row.rd > PROVISIONAL_RD
}

export interface RankedRow extends LeaderboardRow {
  rank: number
  provisional: boolean
  /** Displayed rating: the fractional part is noise at this scale. */
  displayRating: number
}

/**
 * Competition ranking: equal ratings share a rank and the next one skips
 * (1, 2, 2, 4). Ties are decided on the displayed number, not the hidden
 * decimals — two players shown "1500" must not be told they are ranked apart.
 */
export function rankRows(rows: LeaderboardRow[]): RankedRow[] {
  const sorted = [...rows].sort((a, b) => b.rating - a.rating)
  const out: RankedRow[] = []
  let previous: number | null = null
  let rank = 0

  sorted.forEach((row, index) => {
    const displayRating = Math.round(row.rating)
    if (previous === null || displayRating !== previous) rank = index + 1
    previous = displayRating
    out.push({ ...row, rank, provisional: isProvisional(row), displayRating })
  })
  return out
}

/** Ranked ladders shown as leaderboard tabs, in display order. Names are
 * localized at the render site via t('mode.'+id), never hardcoded here. */
export const LEADERBOARD_MODES: RankedMode[] = ['1v1', 'ffa3']

/**
 * Plural category for the games-played count. English needs only singular vs
 * plural; Russian needs three forms (1 игра / 2 игры / 5 игр), so the phrase is
 * chosen per language. The render site maps this to `leaderboard.games.<form>`.
 */
export type GamesPlural = 'one' | 'few' | 'many'
export function gamesPluralForm(n: number, lang: Language): GamesPlural {
  if (lang === 'ru') {
    const mod10 = n % 10
    const mod100 = n % 100
    if (mod10 === 1 && mod100 !== 11) return 'one'
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few'
    return 'many'
  }
  return n === 1 ? 'one' : 'many'
}
