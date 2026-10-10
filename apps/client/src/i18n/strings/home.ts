import type { Strings } from '../types.js'

/** The home hub: how-to-play, ranked queue, private/bot play, join, feedback. */
export const home: Strings = {
  'home.howToPlay': { en: 'How to Play', ru: 'Обучение' },
  'home.rules': { en: 'Rules', ru: 'Правила' },
  'home.watchGame': { en: 'Watch a Game', ru: 'Смотреть игру' },

  'home.inProgress': { en: 'Game in progress', ru: 'Идёт игра' },
  'home.returnToBoard': { en: 'Return to the board', ru: 'Вернуться к столу' },

  'home.findingMatch': { en: 'Finding a match', ru: 'Ищем соперника' },
  'home.queue.1v1': { en: 'Ranked 1v1', ru: 'Рейтинговая 1×1' },
  'home.queue.ffa3': { en: 'Ranked free-for-all', ru: 'Рейтинговая на троих' },
  'home.queue.position': { en: 'position {n}', ru: 'место {n}' },
  'home.queue.filled': { en: 'Players found: {n} of {max}', ru: 'Найдено игроков: {n} из {max}' },
  'home.queue.botIn': {
    en: 'A bot takes the empty seat in {n}s',
    ru: 'Через {n} с пустое место займёт бот'
  },
  'home.queue.botNow': { en: 'Seating a bot…', ru: 'Садим бота…' },
  'home.queue.widening': {
    en: 'Widening the rating range to find you someone…',
    ru: 'Расширяем диапазон рейтинга, ищем соперника…'
  },
  'home.queue.searching': {
    en: 'Looking for an opponent near your rating…',
    ru: 'Ищем соперника близкого рейтинга…'
  },

  'home.ranked': { en: 'Ranked', ru: 'Рейтинг' },
  'home.find1v1': { en: 'Find 1v1', ru: 'Игра 1×1' },
  'home.findFfa3': { en: '3-Players Game', ru: 'Игра на 3 игроков' },
  'home.rankedHint': {
    en: 'Ranked games move your rating. Wait long enough and bots will step in.',
    ru: 'Рейтинговые игры меняют рейтинг. Если ждать долго, подключатся боты.'
  },

  'home.play': { en: 'Play', ru: 'Игра' },
  'home.vsBot': { en: 'vs Bot', ru: 'против Бота' },
  'home.vs2Bots': { en: 'vs 2 Bots', ru: 'против 2 Ботов' },
  'home.private1v1': { en: 'Private 1v1', ru: 'Частная 1×1' },
  'home.private3p': { en: 'Private 3-player', ru: 'Частная на троих' },
  'home.private2v2': { en: 'Private 2v2', ru: 'Частная 2×2' },
  'home.privateHint': {
    en: 'Private games are unrated — share the invite code with friends.',
    ru: 'Частные игры без рейтинга — поделитесь кодом приглашения с друзьями.'
  },

  'home.joinByCode': { en: 'Join by code', ru: 'Войти по коду' },
  'home.join': { en: 'Join', ru: 'Войти' },

  'home.leaderboard': { en: 'Leaderboard', ru: 'Таблица лидеров' },
  'home.players': { en: 'Players', ru: 'Игроки' },
  'home.shop': { en: 'Shop', ru: 'Магазин' },
  'home.market': { en: 'Market', ru: 'Рынок' },
  'home.settings': { en: 'Settings', ru: 'Настройки' },

  'home.feedback': { en: 'Send feedback', ru: 'Отправить отзыв' },
  'home.feedbackPlaceholder': {
    en: "What broke, what felt off, what you'd change…",
    ru: 'Что сломалось, что не так, что бы вы изменили…'
  },
  'home.feedbackThanks': { en: 'Thanks — got it.', ru: 'Спасибо — получили.' },
  'home.feedbackFailed': {
    en: 'Could not send — try again.',
    ru: 'Не отправилось — попробуйте ещё раз.'
  },
  'home.sending': { en: 'Sending…', ru: 'Отправка…' },
  'home.send': { en: 'Send', ru: 'Отправить' }
}
