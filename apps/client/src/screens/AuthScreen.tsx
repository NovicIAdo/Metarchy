import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { disconnectSolanaWallet, solanaAuth } from '../auth/solana.js'
import { SolanaWalletPicker } from '../components/SolanaWalletPicker.js'
import { useT } from '../i18n/index.js'
import { AUTH_ERROR_EVENT, isNativePlatform, nativeSignInWith } from '../native/oauth.js'
import { supabase, takeAuthRedirectError } from '../supabase.js'
import { themeAsset } from '../theme.js'

type Mode = 'sign_in' | 'sign_up'

export function AuthScreen() {
  const navigate = useNavigate()
  const t = useT()
  const [mode, setMode] = useState<Mode>('sign_in')
  const [method, setMethod] = useState<'email' | 'wallet'>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [walletCancellable, setWalletCancellable] = useState(false)
  const walletPending = useRef(false)
  useEffect(
    () => () => {
      if (walletPending.current) void disconnectSolanaWallet().catch(() => {})
    },
    []
  )

  useEffect(() => {
    const redirectError = takeAuthRedirectError()
    if (redirectError) setError(redirectError)
  }, [])

  // Native deep-link callbacks land while this screen is already mounted.
  useEffect(() => {
    const onAuthError = (e: Event): void => {
      setError(String((e as CustomEvent).detail ?? 'sign-in failed'))
      setBusy(false)
    }
    window.addEventListener(AUTH_ERROR_EVENT, onAuthError)
    return () => window.removeEventListener(AUTH_ERROR_EVENT, onAuthError)
  }, [])

  async function submit() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'sign_in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setError(error.message)
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin }
        })
        if (error) setError(error.message)
        else if (!data.session) setNotice(t('auth.checkInbox'))
      }
    } finally {
      setBusy(false)
    }
  }

  async function walletSignIn(walletId: string) {
    walletPending.current = true
    setWalletCancellable(true)
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await solanaAuth.signIn(walletId, () => {
        walletPending.current = false
        setWalletCancellable(false)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      walletPending.current = false
      setWalletCancellable(false)
      setBusy(false)
    }
  }

  async function signInWith(provider: 'google' | 'apple') {
    setBusy(true)
    setError(null)
    setNotice(null)
    // Google refuses OAuth inside WebViews — the APK signs in through the
    // system browser and returns via the deep link (native/oauth.ts).
    if (isNativePlatform()) {
      try {
        await nativeSignInWith(provider)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
      return
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin }
    })
    // On success the browser navigates away — only failures return here.
    if (error) {
      setError(error.message)
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <img className="logo" src={themeAsset('logo')} alt="Metarchy" />
      <div className="panel">
        <h2>{mode === 'sign_in' ? t('auth.signIn') : t('auth.createAccount')}</h2>
        <div className="row login-methods" aria-label={t('auth.chooseLogin')}>
          <button
            className={`btn ${method === 'email' ? '' : 'secondary'}`}
            type="button"
            aria-pressed={method === 'email'}
            disabled={busy}
            onClick={() => {
              setMethod('email')
              setError(null)
              setNotice(null)
            }}
          >
            {t('auth.emailChoice')}
          </button>
          <button
            className={`btn ${method === 'wallet' ? '' : 'secondary'}`}
            type="button"
            aria-pressed={method === 'wallet'}
            disabled={busy}
            onClick={() => {
              setMethod('wallet')
              setError(null)
              setNotice(null)
            }}
          >
            {t('auth.walletChoice')}
          </button>
        </div>
        {method === 'wallet' && (
          <SolanaWalletPicker disabled={busy} onSelect={(id) => void walletSignIn(id)} />
        )}
        {method === 'wallet' && busy && (
          <>
            <p className="hint-text" role="status">
              {t('auth.walletWaiting')}
            </p>
            {walletCancellable && (
              <button
                className="btn secondary"
                type="button"
                onClick={() =>
                  void disconnectSolanaWallet().catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : String(e))
                  )
                }
              >
                {t('auth.walletCancel')}
              </button>
            )}
          </>
        )}
        {method === 'email' && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <div className="field">
                <label htmlFor="email">{t('auth.email')}</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="password">{t('auth.password')}</label>
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <button className="btn" type="submit" disabled={busy || !email || !password}>
                {mode === 'sign_in' ? t('auth.enter') : t('auth.signUp')}
              </button>
            </form>
          </>
        )}
        <p className="error-text">{error}</p>
        {notice && <p className="hint-text">{notice}</p>}
        {method === 'email' && (
          <>
            <p className="hint-text" style={{ textAlign: 'center' }}>
              {t('auth.or')}
            </p>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() => void signInWith('google')}
            >
              {t('auth.continueGoogle')}
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in')
                setError(null)
                setNotice(null)
              }}
            >
              {mode === 'sign_in' ? t('auth.toSignUp') : t('auth.toSignIn')}
            </button>
          </>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn secondary" type="button" onClick={() => navigate('/tutorial')}>
            {t('auth.howToPlay')}
          </button>
          <button className="btn secondary" type="button" onClick={() => navigate('/rules')}>
            {t('auth.rules')}
          </button>
        </div>
      </div>
    </div>
  )
}
