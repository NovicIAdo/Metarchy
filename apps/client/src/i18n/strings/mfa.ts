import type { Strings } from '../types.js'

/** Two-factor (TOTP) challenge after password sign-in. */
export const mfa: Strings = {
  'mfa.title': { en: 'Two-factor check', ru: 'Двухфакторная проверка' },
  'mfa.prompt': {
    en: 'Enter the 6-digit code from your authenticator app.',
    ru: 'Введите 6-значный код из приложения-аутентификатора.'
  },
  'mfa.code': { en: 'Code', ru: 'Код' },
  'mfa.verify': { en: 'Verify', ru: 'Подтвердить' },
  'mfa.signOut': { en: 'Sign out', ru: 'Выйти' },
  'mfa.noAuthenticator': {
    en: 'No authenticator enrolled on this account.',
    ru: 'На этом аккаунте нет приложения-аутентификатора.'
  }
}
