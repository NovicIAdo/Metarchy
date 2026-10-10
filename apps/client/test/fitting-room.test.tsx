// Author report (beta): "the Customize result is never applied — the Actor still
// looks like the selected skin." The save itself was fine; the fitting room LIED
// about it. A saved loadout relabelled the canonical tile to "Custom" while still
// drawing the canonical art, so nothing on screen changed and no tile stayed lit
// — and the same tile's click only cleared the skin, leaving the loadout to win
// over the canon it claimed to restore.
//
// These pin the two halves: the built look gets its own tile drawn from the real
// layer stack, and "Default" means default.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActorLoadout, Wardrobe } from '@metarchy/protocol'
import { skinItemId } from '@metarchy/protocol'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' },
  solanaChain: 'solana:devnet',
  solanaAuthUrl: 'https://game.test/',
  serverHttpBase: () => 'https://game.test'
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const updateProfile = vi.fn(async (_patch: unknown) => ({}))
vi.mock('../src/net/socket.js', () => ({
  gameSocket: { updateProfile: (p: unknown) => updateProfile(p) }
}))

const { ActorSkinsSection } = await import('../src/screens/ProfileScreen.js')
const { useSessionStore } = await import('../src/stores/session.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const LOOK: ActorLoadout = { body: 2, costume: [1, 3], hair: [4, 1] }

let host: HTMLDivElement
let root: Root

function mount(wardrobe: Wardrobe | null, owned: string[] = []): void {
  useSessionStore.setState({
    socketStatus: 'online',
    profile: { userId: 'u1', nickname: 'Ann', avatar: null, wardrobe }
  })
  act(() => {
    root.render(
      <MemoryRouter>
        <ActorSkinsSection ownedItems={new Set(owned)} />
      </MemoryRouter>
    )
  })
}

/** The politician block is the first one — ACTOR_TYPES order. */
const politicianTiles = (): HTMLButtonElement[] =>
  [
    ...(host.querySelector('.skin-block')?.querySelectorAll('button.skin-thumb') ?? [])
  ] as HTMLButtonElement[]

const tileNamed = (label: RegExp): HTMLButtonElement => {
  const found = politicianTiles().find((b) => label.test(b.textContent ?? ''))
  if (!found)
    throw new Error(`no tile matching ${label} in [${politicianTiles().map((b) => b.textContent)}]`)
  return found
}

/** Equipping is a round-trip: await inside act() so the busy-flag reset settles. */
const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(() => {
  updateProfile.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('fitting room gallery', () => {
  it('offers no Custom tile until a look has been built', () => {
    mount(null)
    expect(politicianTiles().some((b) => /custom/i.test(b.textContent ?? ''))).toBe(false)
    expect(tileNamed(/default/i).classList.contains('chosen')).toBe(true)
  })

  it('draws the saved look from its own layers and marks it worn', () => {
    mount({ politician: LOOK })
    const custom = tileNamed(/custom/i)
    expect(custom.classList.contains('chosen')).toBe(true)
    expect(tileNamed(/default/i).classList.contains('chosen')).toBe(false)
    // The actual composite, not the canonical figure standing in for it.
    const layers = [...custom.querySelectorAll('.layered-actor img')].map((i) =>
      i.getAttribute('src')
    )
    expect(layers).toEqual([
      expect.stringContaining('body_2'),
      expect.stringContaining('costume_1_3'),
      expect.stringContaining('hair_4_1')
    ])
  })

  it('a skin covers the built look without discarding it', async () => {
    mount({ politician: LOOK, skins: { politician: 'revolutionary' } }, [
      skinItemId('politician', 'revolutionary')
    ])
    expect(tileNamed(/custom/i).classList.contains('chosen')).toBe(false)
    // Still offered: taking the skin off must return the player to their look.
    await click(tileNamed(/custom/i))
    expect(updateProfile).toHaveBeenCalledWith({ wardrobe: { skins: {} } })
  })

  it('Default clears the layered look too, not just the skin', async () => {
    mount({ politician: LOOK })
    await click(tileNamed(/default/i))
    expect(updateProfile).toHaveBeenCalledWith({ wardrobe: { skins: {}, politician: null } })
  })

  it('leaves another actor’s skin alone when the politician changes', async () => {
    mount({ politician: LOOK, skins: { robot: 'industrial' } }, [skinItemId('robot', 'industrial')])
    await click(tileNamed(/default/i))
    expect(updateProfile).toHaveBeenCalledWith({
      wardrobe: { skins: { robot: 'industrial' }, politician: null }
    })
  })
})
