// The Supabase inactivity guard: a periodic `select 1` plus a REST gateway ping,
// failures swallowed (a heartbeat must never down the server), stop() final.

import { describe, expect, it } from 'vitest'
import { startKeepAlive } from '../src/keepalive.js'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function fakeSql(fail = false) {
  const calls: string[] = []
  return {
    calls,
    sql: {
      query: async (text: string) => {
        calls.push(text)
        if (fail) throw new Error('db down')
        return { rows: [] }
      },
      exec: async () => {},
      close: async () => {}
    }
  }
}

describe('startKeepAlive', () => {
  it('pings the pool and the REST gateway on every interval', async () => {
    const { sql, calls } = fakeSql()
    const fetches: { url: string; apikey?: string }[] = []
    const stop = startKeepAlive({
      sql,
      supabaseUrl: 'https://proj.supabase.co',
      anonKey: 'anon-public',
      intervalMs: 5,
      fetchFn: async (url, init) => {
        fetches.push({
          url: String(url),
          apikey: (init?.headers as Record<string, string>).apikey
        })
        return new Response()
      }
    })
    await wait(28)
    stop()
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls[0]).toBe('select 1')
    expect(fetches.length).toBeGreaterThanOrEqual(2)
    expect(fetches[0]).toEqual({
      url: 'https://proj.supabase.co/rest/v1/',
      apikey: 'anon-public'
    })
  })

  it('skips the gateway without a project url and swallows failures', async () => {
    const { sql, calls } = fakeSql(true)
    const stop = startKeepAlive({ sql, intervalMs: 5 })
    await wait(18)
    stop()
    expect(calls.length).toBeGreaterThanOrEqual(1) // threw, but the loop lived on
  })

  it('stops cleanly', async () => {
    const { sql, calls } = fakeSql()
    const stop = startKeepAlive({ sql, intervalMs: 5 })
    await wait(14)
    stop()
    const seen = calls.length
    await wait(20)
    expect(calls.length).toBe(seen)
  })
})
