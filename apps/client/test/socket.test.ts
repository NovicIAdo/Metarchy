// GameSocket connection policy: exactly one socket per tab, and a superseded
// tab parks instead of reconnecting (two tabs would otherwise trade the session
// back and forth forever).

import { CLOSE_SUPERSEDED } from '@metarchy/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) }
  }
}))

const { GameSocket } = await import('../src/net/socket.js')
const { useSessionStore } = await import('../src/stores/session.js')

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(): void {}
  close(): void {}
}

/** Resolves the getSession() await and any timer the socket armed. */
async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

function statusNow(): string {
  return useSessionStore.getState().socketStatus
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  useSessionStore.getState().setSocketStatus('offline')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('GameSocket connection policy', () => {
  it('opens one socket even when start() fires twice before the token resolves', async () => {
    const socket = new GameSocket()
    socket.start()
    socket.start() // e.g. supabase firing INITIAL_SESSION then SIGNED_IN
    await settle()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('parks on a superseded close — no reconnect, however long we wait', async () => {
    const socket = new GameSocket()
    socket.start()
    await settle()
    FakeWebSocket.instances[0]?.onclose?.({ code: CLOSE_SUPERSEDED })

    expect(statusNow()).toBe('superseded')
    await settle(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('ignores start() while superseded, but takeOver() reclaims the session', async () => {
    const socket = new GameSocket()
    socket.start()
    await settle()
    FakeWebSocket.instances[0]?.onclose?.({ code: CLOSE_SUPERSEDED })

    socket.start()
    await settle()
    expect(FakeWebSocket.instances).toHaveLength(1)

    socket.takeOver()
    await settle()
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('still reconnects after an ordinary close', async () => {
    const socket = new GameSocket()
    socket.start()
    await settle()
    FakeWebSocket.instances[0]?.onclose?.({ code: 1006 })

    expect(statusNow()).toBe('reconnecting')
    await settle(10_000)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })
})
