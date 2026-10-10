import type { Strings } from '../types.js'

/** The ErrorBoundary crash fallback (a React class component reads these via the
 *  non-reactive t()). Kept minimal — a crash screen offers only a reload. */
export const errors: Strings = {
  'errors.title': { en: 'Something broke', ru: 'Что-то сломалось' },
  'errors.body': {
    en: 'The error has been reported. Your game lives on the server — reload to keep playing.',
    ru: 'Ошибка отправлена. Ваша игра на сервере — перезагрузите страницу, чтобы продолжить.'
  },
  'errors.reload': { en: 'Reload', ru: 'Перезагрузить' }
}
