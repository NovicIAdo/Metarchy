import type { Strings } from '../types.js'

/** The Players directory and a player's public profile (author backlog #2). */
export const players: Strings = {
  'player.write': { en: 'Message', ru: 'Написать' },
  'players.title': { en: 'Players', ru: 'Игроки' },
  'players.searchPlaceholder': { en: 'Search by username', ru: 'Поиск по юзернейму' },
  'players.empty': { en: 'Nobody by that name.', ru: 'Никого с таким именем.' },
  'players.you': { en: '(you)', ru: '(вы)' },
  'players.rate': { en: '{n}% ranked', ru: '{n}% в рейтинге' },
  'players.prev': { en: '← Previous', ru: '← Назад' },
  'players.next': { en: 'Next →', ru: 'Дальше →' },
  'players.pageOf': { en: '{from}–{to} of {total}', ru: '{from}–{to} из {total}' },

  'player.rankedRate': { en: 'Ranked win rate {n}%', ru: 'Винрейт в рейтинге {n}%' },
  'player.noRanked': { en: 'No ranked games yet', ru: 'Рейтинговых игр пока нет' },
  'player.rating': { en: 'rating {n}', ru: 'рейтинг {n}' },
  'player.games': { en: '{n} games', ru: 'игр: {n}' },
  'player.matches': { en: 'Their matches', ru: 'Его бои' },
  'player.noMatches': {
    en: 'No replayable matches yet.',
    ru: 'Боёв для просмотра пока нет.'
  },
  'player.share': { en: 'Link to this player', ru: 'Ссылка на игрока' },
  'player.copyLink': { en: 'Copy link', ru: 'Скопировать ссылку' },
  'player.linkCopied': { en: 'Copied', ru: 'Скопировано' }
}
