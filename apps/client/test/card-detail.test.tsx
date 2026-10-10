// Tapping a card in Global Stats shows its rulebook effect (mobile has no hover,
// so the old title tooltip was invisible there). Pins: click a hand card → the
// description popup appears with the card's rule text; Close dismisses it.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView } from '@metarchy/engine'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { GlobalStats } = await import('../src/screens/game/GlobalStats.js')
const { useGameStore } = await import('../src/stores/game.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function stubView(): PlayerView {
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
    me: {
      resources: { product: 2, electricity: 1, recycling: 0 },
      hand: [{ instanceId: 'c1', card: 'sabotage' }]
    },
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
  useGameStore.setState({
    players: [
      { seat: 0, nickname: 'me', bot: false, avatar: null },
      { seat: 1, nickname: 'rival', bot: false, avatar: null }
    ],
    presence: {}
  } as never)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('GlobalStats card detail', () => {
  it('opens a description popup when a hand card is tapped, and closes it', () => {
    act(() => root.render(<GlobalStats view={stubView()} onClose={() => {}} />))
    expect(document.querySelector('.card-detail')).toBeNull()

    const card = [...document.querySelectorAll('.cards-hand .cards-card')][0] as HTMLButtonElement
    expect(card).toBeTruthy()
    act(() => card.click())

    const detail = document.querySelector('.card-detail')
    expect(detail).not.toBeNull()
    expect(detail?.textContent).toContain('Sabotage')
    expect(detail?.textContent).toContain('Shuts down Factory')

    const close = [...(detail?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Close'
    ) as HTMLButtonElement
    act(() => close.click())
    expect(document.querySelector('.card-detail')).toBeNull()
  })
})
