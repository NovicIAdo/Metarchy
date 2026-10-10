// The persisted chat screen (author backlog #3). What the layout has to get
// right, checked against the real component: own messages on the LEFT and
// others' on the RIGHT with a byline in front, the 255-character counter, the
// server's one-per-minute cooldown holding the Send button, a thread opening one
// level deep, and a live push landing without a refetch.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessageEntry } from '@metarchy/protocol'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

/** Every chat call the screen can make, recorded. */
const socket = {
  serverNow: () => Date.now(),
  chatList: vi.fn(),
  chatThread: vi.fn(),
  chatPost: vi.fn(),
  chatReact: vi.fn(),
  chatFlag: vi.fn(),
  chatDms: vi.fn(),
  onChatPosted: vi.fn()
}
vi.mock('../src/net/socket.js', () => ({ gameSocket: socket }))

const { ChatScreen } = await import('../src/screens/ChatScreen.js')
const { useSessionStore } = await import('../src/stores/session.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ME = '11111111-1111-4111-8111-111111111111'
const THEM = '22222222-2222-4222-8222-222222222222'

function message(over: Partial<ChatMessageEntry> = {}): ChatMessageEntry {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    parentId: null,
    author: { userId: THEM, nickname: 'Okeesha', avatar: null },
    body: 'the Politician deadlock is a trap',
    createdAt: new Date('2026-07-26T10:00:00Z').toISOString(),
    likes: 2,
    dislikes: 0,
    myReaction: null,
    flags: 0,
    flaggedByMe: false,
    replyCount: 0,
    mine: false,
    removed: false,
    ...over
  }
}

/** The page reply the screen expects from chat.list. */
const page = (messages: ChatMessageEntry[], cooldownMs = 0) => ({
  scope: { kind: 'global' as const },
  sort: 'new' as const,
  offset: 0,
  messages,
  total: messages.length,
  cooldownMs
})

let host: HTMLDivElement
let root: Root
/** The listener the screen registered with onChatPosted. */
let push: ((p: unknown) => void) | null = null

beforeEach(() => {
  vi.clearAllMocks()
  push = null
  socket.onChatPosted.mockImplementation((fn: (p: unknown) => void) => {
    push = fn
    return () => {
      push = null
    }
  })
  socket.chatDms.mockResolvedValue({ items: [], found: null })
  useSessionStore.setState({ userId: ME, socketStatus: 'online' } as never)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** Mount and let the first chat.list resolve. */
async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ChatScreen />
      </MemoryRouter>
    )
  })
}

const bubbles = (): HTMLElement[] => [...document.querySelectorAll('.chat-msg')] as HTMLElement[]
const sendButton = (): HTMLButtonElement =>
  document.querySelector('.chat-composer-foot .btn') as HTMLButtonElement

/**
 * Type into the composer. React tracks the value on the DOM node, so assigning
 * `.value` directly is invisible to it — the native setter is what makes onChange
 * fire, exactly as a keystroke would.
 */
async function typeDraft(text: string): Promise<void> {
  const input = document.querySelector('.chat-input') as HTMLTextAreaElement
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set as (
    v: string
  ) => void
  await act(async () => {
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('the chat screen', () => {
  it('puts my messages on the left and everyone else on the right, each with a byline', async () => {
    socket.chatList.mockResolvedValue(
      page([
        message(),
        message({
          id: '44444444-4444-4444-8444-444444444444',
          author: { userId: ME, nickname: 'Asa', avatar: 'politician' },
          body: 'only if both stand still',
          mine: true
        })
      ])
    )
    await mount()

    const [theirs, mine] = bubbles()
    // `mine` is the author's left/right rule, and it comes from the server.
    expect(theirs?.classList.contains('mine')).toBe(false)
    expect(mine?.classList.contains('mine')).toBe(true)
    // Avatar + username in front of the message.
    expect(theirs?.querySelector('.nickname')?.textContent).toBe('Okeesha')
    expect(mine?.querySelector('.nickname')?.textContent).toBe('Asa')
    // No avatar set = no <img> at all, never a stand-in face.
    expect(theirs?.querySelector('img')).toBeNull()
    expect(mine?.querySelector('img')).not.toBeNull()
    // The counters are shown as the server counted them.
    expect(theirs?.textContent).toContain('👍 2')
  })

  it('counts characters up to 255 and sends the trimmed body', async () => {
    socket.chatList.mockResolvedValue(page([]))
    socket.chatPost.mockResolvedValue(message({ mine: true }))
    await mount()

    const input = document.querySelector('.chat-input') as HTMLTextAreaElement
    expect(input.maxLength).toBe(255)
    // Empty draft: nothing to send.
    expect(sendButton().disabled).toBe(true)

    await typeDraft('  hello world  ')
    expect(document.querySelector('.chat-count')?.textContent).toBe('15/255')
    expect(sendButton().disabled).toBe(false)

    await act(async () => sendButton().click())
    expect(socket.chatPost).toHaveBeenCalledWith({
      scope: { kind: 'global' },
      body: 'hello world'
    })
  })

  it("holds Send while the server's minute is still running", async () => {
    // The cooldown arrives with the page, so it survives a reload — a fresh tab
    // is told how long is left rather than trusted to remember.
    socket.chatList.mockResolvedValue(page([message()], 42_000))
    await mount()

    await typeDraft('let me flood the room')
    expect(sendButton().disabled).toBe(true)
    expect(sendButton().textContent).toContain('42')
  })

  it('opens a thread under a message and keeps it one level deep', async () => {
    const parent = message({ replyCount: 1 })
    socket.chatList.mockResolvedValue(page([parent]))
    socket.chatThread.mockResolvedValue([
      message({
        id: '55555555-5555-4555-8555-555555555555',
        parentId: parent.id,
        author: { userId: ME, nickname: 'Asa', avatar: null },
        body: 'that is the trap',
        mine: true
      })
    ])
    await mount()

    const openThread = [...document.querySelectorAll('.chat-chip.thread')][0] as HTMLButtonElement
    await act(async () => openThread.click())

    expect(socket.chatThread).toHaveBeenCalledWith(parent.id)
    const thread = document.querySelector('.chat-thread') as HTMLElement
    expect(thread.textContent).toContain('that is the trap')
    // A reply has no thread control of its own — there is no second level.
    expect(thread.querySelector('.chat-chip.thread')).toBeNull()
  })

  it('lands a live message at the bottom, and a live reply on its parent', async () => {
    const parent = message({ replyCount: 0 })
    socket.chatList.mockResolvedValue(page([parent]))
    await mount()
    expect(push).not.toBeNull()

    await act(async () => {
      push?.({
        scope: { kind: 'global' },
        message: message({
          id: '66666666-6666-4666-8666-666666666666',
          body: 'just arrived',
          author: { userId: THEM, nickname: 'Ann', avatar: null }
        })
      })
    })
    // The stream reads top-to-bottom: the brand-new message is the LAST bubble.
    expect(bubbles().at(-1)?.textContent).toContain('just arrived')

    // A reply does not join the room list; it bumps the parent's counter, so the
    // "N replies" control appears without a refetch.
    await act(async () => {
      push?.({
        scope: { kind: 'global' },
        message: message({
          id: '77777777-7777-4777-8777-777777777777',
          parentId: parent.id,
          body: 'a reply'
        })
      })
    })
    expect(bubbles()).toHaveLength(2)
    expect(document.querySelector('.chat-chip.thread')?.textContent).toContain('1')
  })
})
