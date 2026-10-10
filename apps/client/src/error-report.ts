// Browser crash reporting (Stage 6 observability): window errors, unhandled
// rejections and React render crashes POST to the game server's /client-errors,
// which drops them into Fly's log stream. Deliberately tiny — no SDK, no PII;
// capped and deduped per page load, and never allowed to throw itself.

import { config, serverHttpBase } from './config.js'
import { useGameStore } from './stores/game.js'

const MAX_REPORTS_PER_LOAD = 10
let sent = 0
const seen = new Set<string>()

export interface ClientErrorReport {
  message: string
  stack?: string | undefined
  source: 'window' | 'promise' | 'react'
}

/**
 * Player-initiated beta feedback — rides the same /client-errors sink (Fly
 * logs), tagged source=feedback so it stands apart from crashes. Unlike crash
 * reports it is neither deduped nor capped, and it awaits the POST so the UI
 * can confirm. Returns false on a network/blank failure.
 */
export async function sendFeedback(text: string): Promise<boolean> {
  const message = text.trim()
  if (!message) return false
  try {
    const gameId = useGameStore.getState().activeGame?.gameId
    const res = await fetch(`${serverHttpBase()}/client-errors`, {
      method: 'POST',
      body: JSON.stringify({
        message: message.slice(0, 500),
        source: 'feedback',
        url: window.location.pathname,
        build: config.buildSha,
        ...(gameId ? { gameId } : {})
      })
    })
    return res.ok
  } catch {
    return false
  }
}

export function reportClientError(report: ClientErrorReport): void {
  try {
    if (sent >= MAX_REPORTS_PER_LOAD) return
    const key = `${report.source}:${report.message}`
    if (seen.has(key)) return
    seen.add(key)
    sent += 1

    const gameId = useGameStore.getState().activeGame?.gameId
    const body = JSON.stringify({
      message: report.message.slice(0, 500),
      ...(report.stack ? { stack: report.stack.slice(0, 4000) } : {}),
      source: report.source,
      url: window.location.pathname,
      build: config.buildSha,
      ...(gameId ? { gameId } : {})
    })
    const url = `${serverHttpBase()}/client-errors`
    // sendBeacon survives page unload and posts text/plain — no CORS preflight
    // when the dev client (5173) talks to the dev server (8080).
    if (!navigator.sendBeacon?.(url, body))
      void fetch(url, { method: 'POST', body, keepalive: true }).catch(() => undefined)
  } catch {
    // Reporting must never take the app down with it.
  }
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message
  return String(value ?? 'unknown error')
}

function stackOf(value: unknown): string | undefined {
  return value instanceof Error ? value.stack : undefined
}

export function installErrorReporting(): void {
  window.addEventListener('error', (event) => {
    reportClientError({
      message: String(event.message || 'unknown error'),
      stack: stackOf(event.error),
      source: 'window'
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError({
      message: messageOf(event.reason),
      stack: stackOf(event.reason),
      source: 'promise'
    })
  })
}
