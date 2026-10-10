// Team chat plumbing: inbound chat.message lands in the store (unread counting),
// sendChat trims + echoes locally (the server only relays to the ally), and
// messages for a game we are no longer in are dropped.

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
const { useGameStore } = await import('../src/stores/game.js')

const GAME_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_GAME_ID = '22222222-2222-4222-8222-222222222222'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  sent: string[] = []
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {}
}

async function openSocket(): Promise<{
  socket: InstanceType<typeof GameSocket>
  ws: FakeWebSocket
}> {
  const socket = new GameSocket()
  socket.start()
  await vi.advanceTimersByTimeAsync(0)
  const ws = FakeWebSocket.instances[0] as FakeWebSocket
  return { socket, ws }
}

function receive(ws: FakeWebSocket, msg: unknown): void {
  ws.onmessage?.({ data: JSON.stringify(msg) })
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  useGameStore.getState().resetGame()
  useGameStore.getState().setActiveGame({ gameId: GAME_ID, mode: '2v2', seat: 0, status: 'active' })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('team chat', () => {
  it('appends inbound chat and counts unread while the panel is closed', async () => {
    const { ws } = await openSocket()
    receive(ws, { t: 'chat.message', p: { gameId: GAME_ID, fromSeat: 2, text: 'take the square' } })
    receive(ws, { t: 'chat.message', p: { gameId: GAME_ID, fromSeat: 2, text: 'and the dump' } })

    const s = useGameStore.getState()
    expect(s.chat.map((m) => m.text)).toEqual(['take the square', 'and the dump'])
    expect(s.chat[0]?.fromSeat).toBe(2)
    expect(s.chatUnread).toBe(2)
  })

  it('an open panel reads messages as they arrive; closing resumes counting', async () => {
    const { ws } = await openSocket()
    useGameStore.getState().setChatOpen(true)
    receive(ws, { t: 'chat.message', p: { gameId: GAME_ID, fromSeat: 2, text: 'hi' } })
    expect(useGameStore.getState().chatUnread).toBe(0)

    useGameStore.getState().setChatOpen(false)
    receive(ws, { t: 'chat.message', p: { gameId: GAME_ID, fromSeat: 2, text: 'still here?' } })
    expect(useGameStore.getState().chatUnread).toBe(1)

    useGameStore.getState().setChatOpen(true)
    expect(useGameStore.getState().chatUnread).toBe(0)
  })

  it('drops chat for a game that is no longer active', async () => {
    const { ws } = await openSocket()
    receive(ws, { t: 'chat.message', p: { gameId: OTHER_GAME_ID, fromSeat: 1, text: 'stale' } })
    expect(useGameStore.getState().chat).toEqual([])
  })

  it('sendChat trims, sends chat.team and echoes locally with my seat', async () => {
    const { socket, ws } = await openSocket()
    socket.sendChat(GAME_ID, '  flank left  ')

    const sent = ws.sent.map((raw) => JSON.parse(raw)).find((m) => m.t === 'chat.team')
    expect(sent?.p).toEqual({ gameId: GAME_ID, text: 'flank left' })
    const s = useGameStore.getState()
    expect(s.chat).toHaveLength(1)
    expect(s.chat[0]).toMatchObject({ fromSeat: 0, text: 'flank left' })
  })

  it('sendChat ignores blank drafts', async () => {
    const { socket, ws } = await openSocket()
    socket.sendChat(GAME_ID, '   ')
    expect(ws.sent.map((raw) => JSON.parse(raw)).some((m) => m.t === 'chat.team')).toBe(false)
    expect(useGameStore.getState().chat).toEqual([])
  })

  it('resetGame clears the log and the unread badge', async () => {
    const { ws } = await openSocket()
    receive(ws, { t: 'chat.message', p: { gameId: GAME_ID, fromSeat: 2, text: 'gg' } })
    useGameStore.getState().resetGame()
    const s = useGameStore.getState()
    expect(s.chat).toEqual([])
    expect(s.chatUnread).toBe(0)
    expect(s.chatOpen).toBe(false)
  })
})
