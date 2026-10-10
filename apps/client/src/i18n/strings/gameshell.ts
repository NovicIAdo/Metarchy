import type { Strings } from '../types.js'

/** The game route shell: lobby (invite, ready, teams), the not-in-game fallback,
 *  and the game-over ranking. The live board (screens/game/) owns its own strings. */
export const gameshell: Strings = {
  // Game-over ranking
  'gameshell.victory': { en: 'Victory', ru: 'Победа' },
  'gameshell.defeat': { en: 'Defeat', ru: 'Поражение' },
  'gameshell.seat': { en: 'Seat {n}', ru: 'Место {n}' },
  'gameshell.you': { en: '(you)', ru: '(вы)' },
  'gameshell.vp': { en: 'VP', ru: 'ПО' },
  'gameshell.backHome': { en: 'Back to home', ru: 'На главную' },
  'gameshell.reward': { en: '+{n} GATO earned', ru: 'Заработано +{n} GATO' },
  'gameshell.rewardNone': { en: 'No GATO this time', ru: 'GATO за этот бой нет' },
  'gameshell.drop': { en: 'Dropped: {name}', ru: 'Выпало: {name}' },

  // Not-in-this-game fallback
  'gameshell.notInGame': { en: 'Not in this game', ru: 'Вас нет в этой игре' },

  // Lobby
  'gameshell.lobby': { en: 'Lobby — {mode}', ru: 'Лобби — {mode}' },
  'gameshell.shareCodeFriends': {
    en: 'Share this code with your friends',
    ru: 'Поделитесь этим кодом с друзьями'
  },
  'gameshell.shareCodeOpponent': {
    en: 'Share this code with your opponent',
    ru: 'Поделитесь этим кодом с соперником'
  },
  'gameshell.emptySeat': { en: 'empty seat…', ru: 'пустое место…' },
  'gameshell.ready': { en: 'ready', ru: 'готов' },
  'gameshell.waiting': { en: 'waiting', ru: 'ждёт' },
  'gameshell.team': { en: 'Team {n}', ru: 'Команда {n}' },
  'gameshell.yourTeam': { en: 'your team', ru: 'ваша команда' },
  'gameshell.switchTeam': { en: 'Switch to team {n}', ru: 'Перейти в команду {n}' },
  'gameshell.pickSideHint': {
    en: 'Pick a side until everyone is ready — seats are dealt when the game starts.',
    ru: 'Выбирайте сторону, пока не все готовы — места раздаются при старте игры.'
  },
  'gameshell.waitingForOthers': { en: 'Waiting for others…', ru: 'Ждём остальных…' },
  'gameshell.readyButton': { en: 'Ready', ru: 'Готов' },
  'gameshell.leave': { en: 'Leave', ru: 'Выйти' },

  // Board lazy-load fallback
  'gameshell.loadingBoard': { en: 'Loading the board…', ru: 'Загружаем стол…' }
}
