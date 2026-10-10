// The exchange and relocation-tiebreak modals render inside the transformed
// .hud-bottom container, where a non-portaled position:fixed overlay collapses
// into the panel's box (transform makes the ancestor its containing block) —
// invisible and unclickable, softlocking the step until the server deadline.
// This pins the fix: every modal must land as a direct child of <body>.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView } from '@metarchy/engine'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { ActionPhasePanel } = await import('../src/screens/game/ActionPhasePanel.js')

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const VALUES = { power: 1, art: 0, knowledge: 0, fame: 0 }
const OTHER_VALUES = { power: 0, art: 2, knowledge: 0, fame: 0 }

/** Minimal 1v1 view sitting on my exchange slot. */
function exchangeView(): PlayerView {
  return {
    gameId: '44444444-4444-4444-8444-444444444444',
    mode: '1v1',
    rulesVersion: '1.0.0',
    seat: 0,
    turn: 1,
    maxTurns: 5,
    isTieBreakerTurn: false,
    activeSeats: [0, 1],
    eliminated: [],
    decks: { event: 5, action: 10 },
    values: [VALUES, OTHER_VALUES],
    me: { resources: { product: 1, electricity: 1, recycling: 1 }, hand: [] },
    allies: [],
    others: [{ seat: 1, handCount: 0, resources: null }],
    board: { placements: [], disabledLocations: [] },
    phase: {
      kind: 'p3_action',
      selectedCounts: null,
      step: { t: 'exchange', queue: [{ seat: 0, instanceId: 'card-1' }], index: 0 }
    },
    played: [],
    eventsPlayed: [],
    waitingOn: [0],
    seq: 42
  } as PlayerView
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  // The real render location: a transformed HUD container.
  host = document.createElement('div')
  host.style.transform = 'translateX(-50%)'
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('modal portals', () => {
  it('the exchange modal escapes the transformed HUD container to <body>', () => {
    act(() => {
      root.render(<ActionPhasePanel view={exchangeView()} send={() => undefined} />)
    })

    const overlay = document.querySelector('.modal-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay?.parentElement).toBe(document.body)
    expect(host.querySelector('.modal-overlay')).toBeNull()
    // And it is the real exchange UI, options included.
    expect(overlay?.textContent).toContain('Change of Values')
    expect(overlay?.textContent).toContain('Give one of yours')
  })
})
