// The persisted chat shipped complete — global room, private messages, threads,
// reactions — and finished the whole beta with zero messages in the table. The
// reason was here: `chat.posted` reached only the subscribers of the chat SCREEN,
// so a private message that arrived while the recipient was anywhere else was
// dropped on the floor. Nobody was ever told they had mail, so nobody wrote
// twice.
//
// These pin the shell-level flag that fixes it, and the three cases that must
// NOT raise it — a badge that lights up for your own message teaches players to
// ignore badges.

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

const ME = '11111111-1111-4111-8111-111111111111'
const THEM = '22222222-2222-4222-8222-222222222222'

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

const posted = (opts: { dm: boolean; authorId: string | null }) => ({
  t: 'chat.posted',
  p: {
    scope: opts.dm ? { kind: 'dm', peerId: THEM } : { kind: 'global' },
    message: {
      id: '33333333-3333-4333-8333-333333333333',
      parentId: null,
      flags: 0,
      author: opts.authorId ? { userId: opts.authorId, nickname: 'oke', avatar: null } : null,
      body: 'about that lot…',
      createdAt: '2026-08-02T00:00:00.000Z',
      likes: 0,
      dislikes: 0,
      myReaction: null,
      flaggedByMe: false,
      removed: opts.authorId === null,
      replyCount: 0,
      mine: opts.authorId === ME
    }
  }
})

async function deliver(msg: unknown): Promise<void> {
  const socket = new GameSocket()
  socket.start()
  await vi.advanceTimersByTimeAsync(0)
  FakeWebSocket.instances.at(-1)?.onmessage?.({ data: JSON.stringify(msg) })
}

const unread = (): boolean => useSessionStore.getState().dmUnread

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  useSessionStore.setState({ userId: ME, dmUnread: false, socketStatus: 'offline' })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('private-message badge', () => {
  it('raises when somebody writes to you, wherever you are in the app', async () => {
    await deliver(posted({ dm: true, authorId: THEM }))
    expect(unread()).toBe(true)
  })

  it('stays down for your own message echoed back', async () => {
    await deliver(posted({ dm: true, authorId: ME }))
    expect(unread()).toBe(false)
  })

  it('stays down for the global room — that is a feed, not mail', async () => {
    await deliver(posted({ dm: false, authorId: THEM }))
    expect(unread()).toBe(false)
  })

  it('stays down for a flagged-away tombstone, which nobody wrote', async () => {
    await deliver(posted({ dm: true, authorId: null }))
    expect(unread()).toBe(false)
  })
})
