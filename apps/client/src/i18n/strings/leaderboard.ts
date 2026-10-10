import type { Strings } from '../types.js'

/** The leaderboard screen: title, empty state, per-row tags and games count. */
export const leaderboard: Strings = {
  'leaderboard.title': { en: 'Leaderboard', ru: 'Таблица лидеров' },
  'leaderboard.empty': {
    en: 'No ranked games yet. Be the first to play one.',
    ru: 'Рейтинговых игр пока нет. Сыграйте первым.'
  },
  'leaderboard.provisional': { en: 'provisional', ru: 'предв.' },

  // Games-played count. English needs singular/plural; Russian needs three forms
  // (1 игра / 2 игры / 5 игр) — the render site picks the form via gamesPluralForm.
  'leaderboard.games.one': { en: '{n} game', ru: '{n} игра' },
  'leaderboard.games.few': { en: '{n} games', ru: '{n} игры' },
  'leaderboard.games.many': { en: '{n} games', ru: '{n} игр' }
}
