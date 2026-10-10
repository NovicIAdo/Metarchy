import type { Strings } from '../types.js'

/** Settings screen: language, art style, audio volumes, notifications. */
export const settings: Strings = {
  'settings.title': { en: 'Settings', ru: 'Настройки' },

  'settings.language': { en: 'Language', ru: 'Язык' },
  'settings.langHint': {
    en: 'Changes the language across the whole app.',
    ru: 'Меняет язык во всём приложении.'
  },

  'settings.artStyle': { en: 'Art style', ru: 'Стиль оформления' },
  'settings.moreArtStyles': {
    en: 'More art styles arrive with the shop.',
    ru: 'Другие стили появятся вместе с магазином.'
  },

  'settings.music': { en: 'Music · {n}%', ru: 'Музыка · {n}%' },
  'settings.sfx': { en: 'Sound effects · {n}%', ru: 'Звуковые эффекты · {n}%' },
  'settings.volumeHint': {
    en: 'Volumes apply once the soundtrack ships.',
    ru: 'Громкость заработает, когда появится звук.'
  },

  'settings.turnNotifications': {
    en: '«Your turn» notifications on this account',
    ru: 'Уведомления «Ваш ход» на этом аккаунте'
  },
  'settings.on': { en: '✓ On', ru: '✓ Вкл' },
  'settings.off': { en: 'Off', ru: 'Выкл' },
  'settings.pushOffHint': {
    en: 'Push tokens removed — no device of yours gets pinged.',
    ru: 'Токены пушей удалены — ни одно ваше устройство не получит уведомлений.'
  }
}
