import { useEffect, useRef, useState } from 'react'
import { solanaAuth } from '../auth/solana.js'
import type { WalletAccountStatus, WalletLinkAttempt } from '../auth/solana-service.js'
import { useT } from '../i18n/index.js'
import { isNativePlatform, NATIVE_REDIRECT } from '../native/oauth.js'
import { useSessionStore } from '../stores/session.js'
import { supabase } from '../supabase.js'
import { AccountMfaVerification } from './AccountMfaVerification.js'
import { SolanaWalletPicker } from './SolanaWalletPicker.js'

export function SolanaAccountPanel() {
  const t = useT()
  const authUserId = useSessionStore((s) => s.authUserId)
  const [status, setStatus] = useState<WalletAccountStatus | null>(null)
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<WalletLinkAttempt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const mounted = useRef(false)
  const generation = useRef(0)
  const attemptRef = useRef<WalletLinkAttempt | null>(null)
  useEffect(() => {
    mounted.current = true
    generation.current++
    let active = true
    setStatus(null)
    setPending(null)
    setPicker(false)
    setBusy(false)
    setError(null)
    setNotice(null)
    void solanaAuth
      .wallets()
      .then((data) => {
        if (active) setStatus(data)
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      mounted.current = false
      generation.current++
      active = false
      void attemptRef.current?.cancel().catch(() => {})
      attemptRef.current = null
    }
  }, [authUserId])
  async function finish(attempt: WalletLinkAttempt) {
    if (attemptRef.current !== attempt) return
    const startedFor = useSessionStore.getState().authUserId
    const startedGeneration = generation.current
    const current = () =>
      mounted.current &&
      generation.current === startedGeneration &&
      startedFor === useSessionStore.getState().authUserId
    setBusy(true)
    try {
      await attempt.complete()
      if (!current() || attemptRef.current !== attempt) return
      attemptRef.current = null
      setPending(null)
      setPicker(false)
      setNotice(t('profile.walletLinked'))
      const data = await solanaAuth.wallets()
      if (current()) setStatus(data)
    } finally {
      if (current()) setBusy(false)
    }
  }
  async function link(walletId: string) {
    const startedFor = useSessionStore.getState().authUserId
    const startedGeneration = generation.current
    const current = () =>
      mounted.current &&
      generation.current === startedGeneration &&
      startedFor === useSessionStore.getState().authUserId
    setBusy(true)
    setError(null)
    setNotice(null)
    let attempt: WalletLinkAttempt | undefined
    try {
      attempt = await solanaAuth.beginLink(walletId)
      if (!current()) {
        await attempt.cancel()
        return
      }
      attemptRef.current = attempt
      if (attempt.requiresMfa) {
        setPending(attempt)
        setPicker(false)
      } else await finish(attempt)
    } catch (e) {
      await attempt?.cancel()
      if (attemptRef.current === attempt) attemptRef.current = null
      if (current()) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (current()) setBusy(false)
    }
  }
  async function cancel() {
    const attempt = attemptRef.current
    attemptRef.current = null
    setPending(null)
    setPicker(false)
    await attempt?.cancel()
  }
  return (
    <div className="solana-account">
      <h3>{t('profile.solanaLogin')}</h3>
      <p className="hint-text">{t('profile.solanaBlurb')}</p>
      {status?.wallets.map((wallet) => (
        <div key={wallet.address}>
          <code className="wallet-address">{wallet.address}</code>
          <p className="hint-text">
            {wallet.loginEnabled ? t('profile.walletLoginEnabled') : t('profile.walletMfaNeeded')}
          </p>
        </div>
      ))}
      {status?.wallets.length === 0 && <p className="hint-text">{t('profile.noWallet')}</p>}
      {pending ? (
        <>
          <code className="wallet-address">{pending.address}</code>
          <AccountMfaVerification client={pending.client} onVerified={() => finish(pending)} />
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {t('profile.cancelLink')}
          </button>
        </>
      ) : (
        <>
          <button
            className="btn secondary"
            type="button"
            disabled={busy || !status}
            onClick={() => {
              setPicker(!picker)
              setError(null)
              setNotice(null)
            }}
          >
            {t('profile.linkSolana')}
          </button>
          {picker && <SolanaWalletPicker disabled={busy} onSelect={(id) => void link(id)} />}
        </>
      )}
      {busy && (
        <p className="hint-text" role="status">
          {t('profile.walletWaiting')}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="hint-text" role="status">
          {notice}
        </p>
      )}
    </div>
  )
}

export function AddEmailLogin() {
  const t = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  async function submit() {
    setError(null)
    setNotice(null)
    if (password !== repeat) {
      setError(t('profile.passwordsDiffer'))
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser(
        { email, password },
        { emailRedirectTo: isNativePlatform() ? NATIVE_REDIRECT : window.location.origin }
      )
      if (error) throw error
      setNotice(t('profile.emailConfirmation'))
      setPassword('')
      setRepeat('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section>
      <h3>{t('profile.addEmail')}</h3>
      <p className="hint-text">{t('profile.addEmailBlurb')}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="field">
          <label htmlFor="wallet-email">{t('auth.email')}</label>
          <input
            id="wallet-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="wallet-password">{t('profile.newPassword')}</label>
          <input
            id="wallet-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="wallet-password-repeat">{t('profile.repeatPassword')}</label>
          <input
            id="wallet-password-repeat"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            required
          />
        </div>
        <button
          className="btn secondary"
          type="submit"
          disabled={busy || !email || password.length < 8 || repeat.length < 8}
        >
          {t('profile.addEmail')}
        </button>
      </form>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="hint-text" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}
