// The Market shelf. The server is the authority on every refusal, but a lot card
// that offers a BUY button it knows will bounce is how a player learns to
// distrust the screen — so the reasons are computed here too, and pinned here.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketListing } from '@metarchy/protocol'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const marketBrowse = vi.fn(async (_p?: unknown) => ({ rows: LOTS, total: LOTS.length, offset: 0 }))
const marketBuy = vi.fn(async (_id: string) => ({
  listingId: 'x',
  itemId: 'skin.robot.industrial',
  price: 10,
  balance: 0,
  owned: []
}))
const marketComments = vi.fn(async (_id: string) => [
  {
    id: 'c1',
    author: { userId: 'u9', nickname: 'oke', avatar: null },
    body: 'drop it',
    createdAt: ''
  }
])
vi.mock('../src/net/socket.js', () => ({
  gameSocket: {
    marketBrowse: (p?: unknown) => marketBrowse(p),
    marketBuy: (id: string) => marketBuy(id),
    marketComments: (id: string) => marketComments(id),
    marketComment: async () => [],
    marketCancel: async () => {},
    walletGet: async () => ({ balance: 50, owned: [] })
  }
}))

const { MarketScreen } = await import('../src/screens/MarketScreen.js')
const { useSessionStore } = await import('../src/stores/session.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const lot = (over: Partial<MarketListing>): MarketListing => ({
  id: '00000000-0000-4000-8000-000000000001',
  itemId: 'skin.robot.industrial',
  category: 'actorSkin',
  price: 10,
  seller: { userId: 'u2', nickname: 'oke', avatar: null },
  createdAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2026-08-08T00:00:00.000Z',
  comments: 1,
  mine: false,
  owned: false,
  ...over
})

const LOTS: MarketListing[] = [
  lot({}),
  lot({ id: '00000000-0000-4000-8000-000000000002', price: 9000, itemId: 'argSkin.silver' }),
  lot({
    id: '00000000-0000-4000-8000-000000000003',
    itemId: 'skin.artist.revolutionary',
    owned: true
  }),
  lot({ id: '00000000-0000-4000-8000-000000000004', itemId: 'avatar.politician', mine: true })
]

let host: HTMLDivElement
let root: Root

async function mount(): Promise<void> {
  useSessionStore.setState({
    socketStatus: 'online',
    profile: { userId: 'u1', nickname: 'ann', avatar: null, wardrobe: null }
  })
  await act(async () => {
    root.render(
      <MemoryRouter>
        <MarketScreen />
      </MemoryRouter>
    )
  })
}

const cards = (): HTMLElement[] => [...host.querySelectorAll('.lot-card')] as HTMLElement[]
const buyButton = (card: HTMLElement): HTMLButtonElement | undefined =>
  [...card.querySelectorAll('.lot-actions button')].find((b) =>
    /buy/i.test(b.textContent ?? '')
  ) as HTMLButtonElement | undefined

beforeEach(() => {
  marketBrowse.mockClear()
  marketBuy.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('market shelf', () => {
  it('offers Buy only on a lot the player can actually take', async () => {
    await mount()
    const [affordable, tooDear, alreadyOwned, own] = cards()

    expect(buyButton(affordable as HTMLElement)?.disabled).toBe(false)
    // 9000 GATO against a balance of 50.
    expect(buyButton(tooDear as HTMLElement)?.disabled).toBe(true)
    // A second copy of a cosmetic does nothing, so the button says so.
    expect(buyButton(alreadyOwned as HTMLElement)?.disabled).toBe(true)
    expect(alreadyOwned?.textContent).toMatch(/already own/i)
    // Your own lot is withdrawn, never bought — a round trip through the fee.
    expect(buyButton(own as HTMLElement)).toBeUndefined()
    expect(own?.textContent).toMatch(/withdraw/i)
  })

  it('names what is for sale, not just its wire id', async () => {
    await mount()
    // "<look> · <actor>" — the same look exists for all four Actors, so a shelf
    // of four identical words would be unreadable.
    expect(cards()[0]?.querySelector('.lot-name')?.textContent).toMatch(/·/)
    expect(cards()[0]?.querySelector('.lot-art img')?.getAttribute('src')).toContain(
      'skins/robot/industrial'
    )
    // A coin set is four coins, not one representative coin.
    expect(cards()[1]?.querySelectorAll('.lot-art .coin-set img')).toHaveLength(4)
  })

  it('loads a haggle only when the thread is opened', async () => {
    await mount()
    expect(marketComments).not.toHaveBeenCalled()
    const toggle = cards()[0]?.querySelector('.lot-comments') as HTMLButtonElement
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(marketComments).toHaveBeenCalledWith(LOTS[0]?.id)
    expect(host.querySelector('.lot-comment')?.textContent).toContain('drop it')
  })

  it('refetches when the category filter changes', async () => {
    await mount()
    marketBrowse.mockClear()
    const chip = [...host.querySelectorAll('.market-filters button')].find((b) =>
      /argument/i.test(b.textContent ?? '')
    ) as HTMLButtonElement
    await act(async () => {
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(marketBrowse).toHaveBeenCalledWith({ category: 'argumentSkin', mine: false, offset: 0 })
  })
})
