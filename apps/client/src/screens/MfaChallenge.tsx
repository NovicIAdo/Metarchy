// TOTP gate after password sign-in: Supabase returns an aal1 session even when
// the account has a verified authenticator — the app refuses to proceed until
// the code upgrades it to aal2. This is the standard client-side Supabase MFA
// gate; token-level AAL enforcement on the game server arrives with self-host.

import { useState } from 'react'
import { useT } from '../i18n/index.js'
import { supabase } from '../supabase.js'
import { themeAsset } from '../theme.js'

export function MfaChallengeScreen({ onVerified }: { onVerified(): void }) {
  const t = useT()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function verify() {
    setBusy(true)
    setError(null)
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError) throw listError
      const totp = factors.totp.find((f) => f.status === 'verified') ?? factors.totp[0]
      if (!totp) throw new Error(t('mfa.noAuthenticator'))
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: totp.id
      })
      if (challengeError) throw challengeError
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.id,
        code: code.trim()
      })
      if (verifyError) throw verifyError
      onVerified()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <img className="logo" src={themeAsset('logo')} alt="Metarchy" />
      <div className="panel">
        <h2>{t('mfa.title')}</h2>
        <p className="hint-text">{t('mfa.prompt')}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void verify()
          }}
        >
          <div className="field">
            <label htmlFor="totp">{t('mfa.code')}</label>
            <input
              id="totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
          </div>
          <button className="btn" type="submit" disabled={busy || code.trim().length < 6}>
            {t('mfa.verify')}
          </button>
        </form>
        <p className="error-text">{error}</p>
        <button className="btn secondary" onClick={() => void supabase.auth.signOut()}>
          {t('mfa.signOut')}
        </button>
      </div>
    </div>
  )
}
