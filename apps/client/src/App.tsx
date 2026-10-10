import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { checkAccountMfa } from './auth/mfa.js'
import { solanaAuth } from './auth/solana.js'
import { AccountMfaVerification } from './components/AccountMfaVerification.js'
import { useT } from './i18n/index.js'
import { gameSocket } from './net/socket.js'
import { AuthScreen } from './screens/AuthScreen.js'
import { ChatScreen } from './screens/ChatScreen.js'
import { GameScreen } from './screens/GameScreen.js'
import { HomeScreen } from './screens/HomeScreen.js'
import { LeaderboardScreen } from './screens/LeaderboardScreen.js'
import { PlayerScreen } from './screens/PlayerScreen.js'
import { PlayersScreen } from './screens/PlayersScreen.js'
import { MfaChallengeScreen } from './screens/MfaChallenge.js'
import { ProfileScreen } from './screens/ProfileScreen.js'
import { RulesScreen } from './screens/RulesScreen.js'
import { SettingsScreen } from './screens/SettingsScreen.js'
import { MarketScreen } from './screens/MarketScreen.js'
import { ShopScreen } from './screens/ShopScreen.js'
import { TutorialScreen } from './screens/TutorialScreen.js'
import { ReplaysScreen } from './screens/ReplaysScreen.js'
import { WatchGameScreen } from './screens/WatchGameScreen.js'
import { WatchScreen } from './screens/WatchScreen.js'
import { useSessionStore } from './stores/session.js'
import { supabase } from './supabase.js'

// The replay viewer bundles the engine (local reconstruction) — keep it out of
// the main chunk.
const ReplayScreen = lazy(() =>
  import('./screens/ReplayScreen.js').then((m) => ({ default: m.ReplayScreen }))
)

/** One session per user: the server keeps the newest socket, this tab stands down. */
function SupersededOverlay() {
  const t = useT()
  return (
    <div className="reconnect-overlay">
      <div className="reconnect-box">
        <h2>{t('app.otherTab.title')}</h2>
        <p className="hint-text">{t('app.otherTab.body')}</p>
        <button className="btn" onClick={() => gameSocket.takeOver()}>
          {t('app.otherTab.playHere')}
        </button>
      </div>
    </div>
  )
}

/**
 * MFA gate: an account with a verified authenticator signs in at aal1 — hold
 * the app until the TOTP code upgrades the session. Fails open on API errors
 * (the gate is a client-side courtesy; locking users out would be worse).
 */
function useAalGate(userId: string | null): 'checking' | 'verify' | 'setup' | 'error' | 'ok' {
  const [state, setState] = useState<'checking' | 'verify' | 'setup' | 'error' | 'ok'>('checking')
  useEffect(() => {
    if (!userId) {
      setState('checking')
      return
    }
    let cancelled = false
    setState('checking')
    void checkAccountMfa(supabase, () => solanaAuth.wallets())
      .then((next) => {
        if (!cancelled) setState(next)
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [userId])
  return state
}

export function App() {
  const authReady = useSessionStore((s) => s.authReady)
  const userId = useSessionStore((s) => s.userId)
  const authUserId = useSessionStore((s) => s.authUserId)
  const t = useT()
  const superseded = useSessionStore((s) => s.socketStatus === 'superseded')
  const [aalBump, setAalBump] = useState(0)
  const aal = useAalGate(authUserId ? `${authUserId}:${aalBump}` : null)
  const verified = useCallback(() => {
    gameSocket.stop()
    gameSocket.start()
    setAalBump((n) => n + 1)
  }, [])

  if (!authReady) {
    return <div className="app-backdrop" />
  }

  if (userId && aal === 'checking') {
    return <div className="app-backdrop" />
  }

  if (userId && aal === 'verify') {
    return (
      <div className="app-backdrop">
        <MfaChallengeScreen onVerified={verified} />
      </div>
    )
  }

  if (userId && (aal === 'setup' || aal === 'error')) {
    return (
      <div className="app-backdrop">
        <div className="screen">
          <div className="panel">
            <h2>{t('profile.twoFactor')}</h2>
            {aal === 'setup' ? (
              <AccountMfaVerification client={supabase} onVerified={verified} />
            ) : (
              <>
                <p className="error-text" role="alert">
                  {t('profile.mfaCheckFailed')}
                </p>
                <button className="btn" type="button" onClick={() => setAalBump((n) => n + 1)}>
                  {t('profile.retry')}
                </button>
              </>
            )}
            <button
              className="btn secondary"
              type="button"
              onClick={() => void supabase.auth.signOut()}
            >
              {t('mfa.signOut')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-backdrop">
      {userId && superseded && <SupersededOverlay />}
      {userId ? (
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          {/* One screen, four tabs — the tab is in the URL so a link to the
              inventory opens the inventory (see ProfileScreen PROFILE_TABS). */}
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="/profile/:tab" element={<ProfileScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/shop" element={<ShopScreen />} />
          <Route path="/market" element={<MarketScreen />} />
          <Route path="/leaderboard" element={<LeaderboardScreen />} />
          <Route path="/chat" element={<ChatScreen />} />
          <Route path="/players" element={<PlayersScreen />} />
          {/* A shared link lands here — keyed by nickname, not by user id. */}
          <Route path="/player/:nickname" element={<PlayerScreen />} />
          <Route path="/rules" element={<RulesScreen />} />
          <Route path="/tutorial" element={<TutorialScreen />} />
          <Route path="/game/:gameId" element={<GameScreen />} />
          <Route path="/watch" element={<WatchScreen />} />
          <Route path="/watch/:gameId" element={<WatchGameScreen />} />
          <Route path="/replays" element={<ReplaysScreen />} />
          <Route
            path="/replay/:gameId"
            element={
              <Suspense fallback={<div className="app-backdrop" />}>
                <ReplayScreen />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          {/* Rules and the tutorial are readable before signing up. */}
          <Route path="/rules" element={<RulesScreen />} />
          <Route path="/tutorial" element={<TutorialScreen />} />
          <Route path="*" element={<AuthScreen />} />
        </Routes>
      )}
    </div>
  )
}
