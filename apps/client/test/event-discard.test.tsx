// The secret-discard event is a bidding decision: how much you throw in
// depends on how deep the rivals' pockets are. Public stocks of the event's
// resource (rulebook §Open Information) must be visible IN the modal — the
// HUD behind the overlay is dimmed exactly when the number matters most.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView } from '@metarchy/engine'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { EventModal } = await import('../src/screens/game/EventModal.js')
const { useGameStore } = await import('../src/stores/game.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function discardView(): PlayerView {
  return {
    gameId: '55555555-5555-4555-8555-555555555555',
    mode: '1v1',
    rulesVersion: '1.0.0',
    seat: 0,
    turn: 2,
    maxTurns: 5,
    isTieBreakerTurn: false,
    activeSeats: [0, 1],
    eliminated: [],
    decks: { event: 6, action: 14 },
    values: [
      { power: 1, art: 0, knowledge: 0, fame: 0 },
      { power: 0, art: 1, knowledge: 0, fame: 0 }
    ],
    me: {
      resources: { product: 2, electricity: 1, recycling: 0 },
      hand: []
    },
    allies: [],
    others: [
      {
        seat: 1,
        handCount: 1,
        resources: { product: 3, electricity: 0, recycling: 1 }
      }
    ],
    board: { placements: [], disabledLocations: [] },
    phase: {
      kind: 'p1_event',
      card: 'help_poor_countries',
      stage: { t: 'discard_commit', committedSeats: [], myAmount: null, sealed: [] }
    },
    played: [],
    eventsPlayed: [],
    waitingOn: [0, 1],
    seq: 7
  } as PlayerView
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useGameStore.getState().resetGame()
  useGameStore.getState().setPlayers([
    { seat: 0, nickname: 'me', bot: false, avatar: null },
    { seat: 1, nickname: 'rival', bot: false, avatar: null }
  ])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('discard event modal', () => {
  it('shows every player’s stock of the event resource next to the slider', () => {
    act(() => {
      root.render(<EventModal view={discardView()} send={() => undefined} />)
    })

    const overlay = document.querySelector('.modal-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay?.textContent).toContain('Product on hand')
    const rows = [...(overlay?.querySelectorAll('.event-rows li') ?? [])].map(
      (li) => li.textContent
    )
    expect(rows).toEqual(['You2', 'rival3'])
    // The bidding slider is still there, capped by my own stock.
    expect(overlay?.querySelector('input[type=range]')?.getAttribute('max')).toBe('2')
  })
})
