// Table transparency (author backlog): the own hand rides the HUD at all
// times, and the top strip counts both decks instead of hiding them in the
// Global Stats modal.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView } from '@metarchy/engine'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { HandStrip, TopBar } = await import('../src/screens/game/HudPanels.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function stubView(hand: Array<{ instanceId: string; card: string }>): PlayerView {
  return {
    gameId: '55555555-5555-4555-8555-555555555555',
    mode: '1v1',
    rulesVersion: '1.0.0',
    seat: 0,
    turn: 3,
    isTieBreakerTurn: false,
    activeSeats: [0, 1],
    eliminated: [],
    decks: { event: 4, action: 11 },
    values: [
      { power: 1, art: 0, knowledge: 0, fame: 0 },
      { power: 0, art: 1, knowledge: 0, fame: 0 }
    ],
    me: { resources: { product: 2, electricity: 1, recycling: 0 }, hand },
    allies: [],
    others: [{ seat: 1, handCount: 2, resources: { product: 3, electricity: 0, recycling: 1 } }],
    board: { placements: [], disabledLocations: [] },
    phase: { kind: 'p3_action', stage: { t: 'select', committedSeats: [] } },
    played: [],
    eventsPlayed: [],
    waitingOn: [0, 1],
    seq: 9
  } as unknown as PlayerView
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('HandStrip', () => {
  it('renders every card in hand as art, in order', () => {
    const view = stubView([
      { instanceId: 'i1', card: 'sabotage' },
      { instanceId: 'i2', card: 'relocation' }
    ])
    act(() => root.render(<HandStrip view={view} onOpen={() => {}} />))
    const cards = [...host.querySelectorAll<HTMLImageElement>('.hud-hand-card')]
    expect(cards.map((c) => c.src)).toHaveLength(2)
    expect(cards[0]?.src).toContain('cards/actions/sabotage')
    expect(cards[1]?.src).toContain('cards/actions/relocation')
  })

  it('tap opens Global Stats; empty hand renders nothing', () => {
    const onOpen = vi.fn()
    const view = stubView([{ instanceId: 'i1', card: 'sabotage' }])
    act(() => root.render(<HandStrip view={view} onOpen={onOpen} />))
    act(() => host.querySelector<HTMLButtonElement>('.hud-hand')!.click())
    expect(onOpen).toHaveBeenCalledOnce()

    act(() => root.render(<HandStrip view={stubView([])} onOpen={onOpen} />))
    expect(host.querySelector('.hud-hand')).toBeNull()
  })
})

describe('TopBar deck counters', () => {
  it('shows both deck counts in the stats strip', () => {
    const view = stubView([])
    act(() => root.render(<TopBar view={view} onStats={() => {}} />))
    // TopBar portals to document.body.
    const stats = [...document.body.querySelectorAll('.hud-strip-stat')]
    const byTitle = (t: string) => stats.find((s) => s.getAttribute('title')?.includes(t))
    expect(byTitle('Events left')?.textContent).toContain('4')
    expect(byTitle('Action Cards left')?.textContent).toContain('11')
  })
})
