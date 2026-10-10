import type { Strings } from '../types.js'

/** Spectator lobby + spectator board chrome. */
export const watch: Strings = {
  'watch.title': { en: 'Watch a Game', ru: 'Смотреть игру' },
  'watch.subtitle': {
    en: 'Live ranked games — anyone can watch. Hidden moves stay hidden until they resolve.',
    ru: 'Живые рейтинговые игры — смотреть может каждый. Скрытые ходы видны только после развязки.'
  },
  'watch.refresh': { en: 'Refresh', ru: 'Обновить' },
  'watch.loading': { en: 'Loading games…', ru: 'Загрузка игр…' },
  'watch.none': {
    en: 'No ranked games are live right now.',
    ru: 'Сейчас нет живых рейтинговых игр.'
  },
  'watch.turn': { en: 'Turn {n}', ru: 'Ход {n}' },
  'watch.watching': { en: '{n} watching', ru: 'смотрят: {n}' },
  'watch.watch': { en: 'Watch', ru: 'Смотреть' },
  'watch.vs': { en: 'vs', ru: 'против' },

  'watch.spectating': { en: 'Spectating', ru: 'Наблюдение' },
  'watch.connecting': { en: 'Connecting to the game…', ru: 'Подключение к игре…' },
  'watch.watchers': { en: 'Watching now: {names}', ru: 'Смотрят: {names}' },
  'watch.gameOver': { en: 'The game has ended.', ru: 'Игра завершена.' },
  'watch.leave': { en: 'Leave', ru: 'Выйти' },
  'watch.backToList': { en: 'Back to games', ru: 'К списку игр' }
}
