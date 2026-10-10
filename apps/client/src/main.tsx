import * as Sentry from '@sentry/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App.js'
import { disconnectSolanaWallet } from './auth/solana.js'
import { config, sentryDsn } from './config.js'
import { installErrorReporting } from './error-report.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import { wireNativeAuth } from './native/oauth.js'
import { wireNativePush } from './native/push.js'
import { gameSocket } from './net/socket.js'
import { useGameStore } from './stores/game.js'
import { useSessionStore } from './stores/session.js'
import { useSettingsStore } from './stores/settings.js'
import { supabase } from './supabase.js'
import { setTheme, themeById } from './theme.js'
import './styles/global.css'

// Art style before first render: every themeAsset() call below the root sees
// the persisted choice (localStorage hydration is synchronous).
setTheme(themeById(useSettingsStore.getState().artTheme))

// Errors only — no tracing/replay (bundle size, beta budget). Sentry's default
// integrations own window.onerror/unhandledrejection; the homegrown
// /client-errors → Fly-logs pipeline stays alongside as the operational view.
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    release: config.buildSha,
    environment: import.meta.env.MODE,
    sendDefaultPii: false
  })
}

installErrorReporting()
wireNativeAuth()
wireNativePush()

// Forensics for browser smokes: a compact live-state snapshot on demand.
// Everything here is the player's own view — nothing hidden is exposed.
declare global {
  interface Window {
    __metarchy?: () => unknown
  }
}
window.__metarchy = () => {
  const g = useGameStore.getState()
  const phase = g.view?.phase as { kind?: string; stage?: { t?: string } } | undefined
  return {
    socket: useSessionStore.getState().socketStatus,
    viewSeq: g.view?.seq ?? null,
    lastEventSeq: g.lastEventSeq,
    phase: phase?.kind ?? null,
    stage: phase?.stage?.t ?? null,
    waitingOn: g.view?.waitingOn ?? null,
    gameId: g.activeGame?.gameId ?? null
  }
}

// Supabase owns auth; the socket follows the session.
supabase.auth.onAuthStateChange((event, session) => {
  useSessionStore.getState().setAuth(session?.user.id ?? null, session?.user.email ?? null)
  if (session) gameSocket.start()
  else gameSocket.stop()
  if (event === 'SIGNED_OUT') void disconnectSolanaWallet().catch(() => {})
})

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)
