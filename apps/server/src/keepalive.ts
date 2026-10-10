// Supabase free-tier inactivity guard. Free projects that see no activity for
// 7+ days get auto-paused (the author's 2026-08-09 warning email); a paused
// project takes auth AND the database down mid-beta. The server holds a pool
// but says nothing on it while no game runs, so an idle week reads as
// "inactive". This keep-alive says a quiet hello instead: one `select 1` on
// the pool plus one request to the REST gateway (the anon key is public by
// design — the same value ships in the client bundle). Twice a day is far
// under any fair-use bar and exactly what Supabase suggests short of Pro.

import type { Sql } from './db.js'

export const KEEPALIVE_INTERVAL_MS = 12 * 60 * 60 * 1000

export interface KeepAliveDeps {
  sql: Sql
  /** Project base URL; absent = pg-only ping (local dev has no gateway). */
  supabaseUrl?: string
  anonKey?: string
  intervalMs?: number
  fetchFn?: typeof fetch
  log?: (msg: string) => void
}

/** Start the guard; returns a stop function (called from stores.close()). */
export function startKeepAlive(deps: KeepAliveDeps): () => void {
  const intervalMs = deps.intervalMs ?? KEEPALIVE_INTERVAL_MS
  const log = deps.log ?? (() => {})
  let stopped = false

  const tick = async (): Promise<void> => {
    try {
      await deps.sql.query('select 1')
      log('keepalive: pg ping ok')
    } catch (err) {
      // A failed ping is a symptom, not a new problem — the pool's real users
      // surface DB errors already; never crash the server over a heartbeat.
      log(`keepalive: pg ping failed: ${(err as Error).message}`)
    }
    if (deps.supabaseUrl) {
      try {
        const fetchFn = deps.fetchFn ?? fetch
        const headers: Record<string, string> = {}
        if (deps.anonKey) headers.apikey = deps.anonKey
        await fetchFn(`${deps.supabaseUrl}/rest/v1/`, { headers })
        log('keepalive: gateway ping ok')
      } catch (err) {
        log(`keepalive: gateway ping failed: ${(err as Error).message}`)
      }
    }
  }

  // First tick one interval in: boot itself already touched the DB (schema
  // assert), so there is nothing to prove at minute zero.
  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref?.()
  return () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
  }
}
