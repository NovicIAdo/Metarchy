import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useT } from '../i18n/index.js'

/** Works with either the player's current session or the isolated wallet-link session. */
export function AccountMfaVerification({
  client,
  onVerified
}: {
  client: SupabaseClient
  onVerified(): void | Promise<void>
}) {
  const t = useT()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [enrollment, setEnrollment] = useState<{ qr: string; secret: string } | null>(null)
  const [ready, setReady] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void client.auth.mfa
      .listFactors()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        else {
          setFactorId(data.totp.find((f) => f.status === 'verified')?.id ?? null)
          setReady(true)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [client])
  async function enroll() {
    setBusy(true)
    setError(null)
    try {
      const factors = await client.auth.mfa.listFactors()
      if (factors.error) throw factors.error
      for (const factor of factors.data.totp.filter((f) => f.status !== 'verified')) {
        const removed = await client.auth.mfa.unenroll({ factorId: factor.id })
        if (removed.error) throw removed.error
      }
      const { data, error } = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Metarchy'
      })
      if (error) throw error
      setFactorId(data.id)
      setEnrollment({ qr: data.totp.qr_code, secret: data.totp.secret })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  async function verify() {
    if (!factorId) return
    setBusy(true)
    setError(null)
    try {
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code })
      if (error) throw error
      await onVerified()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="wallet-mfa">
      <p className="hint-text">{t('profile.walletMfa')}</p>
      {ready && !factorId && (
        <button
          className="btn secondary"
          type="button"
          disabled={busy}
          onClick={() => void enroll()}
        >
          {t('profile.enable2fa')}
        </button>
      )}
      {enrollment && (
        <>
          <p className="hint-text">{t('profile.scanQr')}</p>
          <img src={enrollment.qr} alt={t('profile.qrAlt')} width={180} height={180} />
          <code className="wallet-address">{enrollment.secret}</code>
        </>
      )}
      {factorId && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void verify()
          }}
        >
          <div className="field">
            <label htmlFor="wallet-mfa-code">{t('profile.mfaCode')}</label>
            <input
              id="wallet-mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              required
            />
          </div>
          <button className="btn" type="submit" disabled={busy || code.length !== 6}>
            {t('profile.verify')}
          </button>
        </form>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
