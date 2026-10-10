import type { Strings } from '../types.js'

/** Sign-in / sign-up screen: headings, field labels, buttons, notices. */
export const auth: Strings = {
  'auth.signIn': { en: 'Sign in', ru: 'Вход' },
  'auth.chooseLogin': { en: 'Choose how to sign in', ru: 'Выберите способ входа' },
  'auth.emailChoice': { en: 'Email', ru: 'Почта' },
  'auth.walletChoice': { en: 'Solana wallet', ru: 'Solana-кошелёк' },
  'auth.walletHint': {
    en: 'Choose your wallet and approve the sign-in message. On Seeker, choose Seed Vault Wallet in the wallet selector.',
    ru: 'Выберите кошелёк и подтвердите сообщение для входа. На Seeker выберите Seed Vault Wallet в списке кошельков.'
  },
  'auth.walletLoading': { en: 'Looking for wallets…', ru: 'Поиск кошельков…' },
  'auth.walletMissing': {
    en: 'No compatible wallet found. Install or unlock Phantom, Solflare or another Solana wallet. Mobile wallet connection works in Android Chrome or the Metarchy Android app.',
    ru: 'Совместимый кошелёк не найден. Установите или разблокируйте Phantom, Solflare или другой Solana-кошелёк. Мобильное подключение работает в Chrome на Android или Android-приложении Metarchy.'
  },
  'auth.walletRefresh': { en: 'Find wallets again', ru: 'Найти кошельки снова' },
  'auth.walletWaiting': {
    en: 'Approve the sign-in message in your wallet. Connecting…',
    ru: 'Подтвердите сообщение для входа в кошельке. Подключение…'
  },
  'auth.walletCancel': { en: 'Cancel wallet request', ru: 'Отменить запрос к кошельку' },
  'auth.createAccount': { en: 'Create account', ru: 'Создать аккаунт' },

  'auth.email': { en: 'Email', ru: 'Эл. почта' },
  'auth.password': { en: 'Password', ru: 'Пароль' },

  'auth.enter': { en: 'Enter', ru: 'Войти' },
  'auth.signUp': { en: 'Sign up', ru: 'Регистрация' },

  'auth.or': { en: '— or —', ru: '— или —' },
  'auth.continueGoogle': { en: 'Continue with Google', ru: 'Продолжить через Google' },

  'auth.toSignUp': { en: 'New here? Create an account', ru: 'Впервые здесь? Создать аккаунт' },
  'auth.toSignIn': { en: 'Have an account? Sign in', ru: 'Уже есть аккаунт? Войти' },

  'auth.checkInbox': {
    en: 'Check your inbox — confirm the email, then sign in here.',
    ru: 'Проверьте почту — подтвердите адрес, затем войдите здесь.'
  },

  'auth.howToPlay': { en: 'How to Play', ru: 'Обучение' },
  'auth.rules': { en: 'Rules', ru: 'Правила' }
}
