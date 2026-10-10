import type { Strings } from '../types.js'

/** Cross-screen words: buttons, connection status, generic actions. */
export const common: Strings = {
  'common.back': { en: '← Back', ru: '← Назад' },
  'common.cancel': { en: 'Cancel', ru: 'Отмена' },
  'common.save': { en: 'Save', ru: 'Сохранить' },
  'common.close': { en: 'Close', ru: 'Закрыть' },
  'common.loading': { en: 'Loading…', ru: 'Загрузка…' },
  'common.logout': { en: 'Log Out', ru: 'Выйти' },
  'common.retry': { en: 'Try again', ru: 'Ещё раз' },

  'status.offline': { en: 'offline', ru: 'нет сети' },
  'status.connecting': { en: 'connecting', ru: 'подключение' },
  'status.online': { en: 'online', ru: 'в сети' },
  'status.reconnecting': { en: 'reconnecting', ru: 'переподключение' },
  'status.superseded': { en: 'another tab', ru: 'другая вкладка' }
}
