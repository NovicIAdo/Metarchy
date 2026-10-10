// Crash reporting: one POST per distinct error, capped per page load, carrying
// the build stamp and the active game id. jsdom has no sendBeacon, so the
// fetch(keepalive) fallback is what these tests observe.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/config.js', () => ({
  config: {
    supabaseUrl: 'http://sb.test',
    supabaseAnonKey: 'anon',
    wsUrl: 'ws://game.test/ws',
    buildSha: 'abc1234'
  },
  serverHttpBase: () => 'http://game.test'
}))

const { reportClientError } = await import('../src/error-report.js')
const { useGameStore } = await import('../src/stores/game.js')

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
  Promise.resolve(new Response(null, { status: 204 }))
)

function sentBodies(): Record<string, string>[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(init?.body as string))
}

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  useGameStore.getState().resetGame()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reportClientError', () => {
  it('posts to /client-errors with the build stamp, deduping repeats', () => {
    reportClientError({ message: 'null is not a function', stack: 'at foo', source: 'window' })
    reportClientError({ message: 'null is not a function', stack: 'at foo', source: 'window' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://game.test/client-errors')
    expect(sentBodies()[0]).toMatchObject({
      message: 'null is not a function',
      stack: 'at foo',
      source: 'window',
      build: 'abc1234'
    })
  })

  it('attaches the active game id when one exists', () => {
    useGameStore.getState().setActiveGame({
      gameId: '33333333-3333-4333-8333-333333333333',
      mode: '1v1',
      seat: 0,
      status: 'active'
    })
    reportClientError({ message: 'mid-game crash', source: 'react' })
    expect(sentBodies()[0]).toMatchObject({
      gameId: '33333333-3333-4333-8333-333333333333',
      source: 'react'
    })
  })

  it('stops after the per-load cap however many distinct errors fire', () => {
    for (let i = 0; i < 30; i++) reportClientError({ message: `error ${i}`, source: 'promise' })
    // Two reports were already sent by the tests above; the module-wide cap is 10.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(10)
  })
})
