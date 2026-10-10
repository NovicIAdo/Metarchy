// The tutorial's pointing layer (player feedback, 14 y/o): arrows to what to
// click and then to where it may be placed, plus the "why" line under every
// instruction. The geometry is derived from live board coordinates, so this
// mounts the coach with a stub `locate` and reads the SVG back out.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocationId, PlayerView } from '@metarchy/engine'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { TutorialCoach } = await import('../src/screens/game/TutorialCoach.js')
const { PHASE_INTRO_MS } = await import('../src/screens/game/PhaseSplash.js')
const { useUiStore } = await import('../src/stores/ui.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const POINTS: Record<string, { x: number; y: number }> = {
  square: { x: 400, y: 300 },
  university: { x: 600, y: 420 }
}
const locate = (id: LocationId): { x: number; y: number } | null => POINTS[id] ?? null

function p2View(): PlayerView {
  return {
    gameId: 'g1',
    mode: 'tutorial',
    rulesVersion: '1.1.0',
    seat: 0,
    turn: 2,
    maxTurns: 3,
    isTieBreakerTurn: false,
    activeSeats: [0, 1],
    eliminated: [],
    decks: { event: 2, action: 12 },
    values: [
      { power: 0, art: 0, knowledge: 0, fame: 0 },
      { power: 0, art: 0, knowledge: 0, fame: 0 }
    ],
    me: { resources: { product: 1, electricity: 1, recycling: 1 }, hand: [] },
    allies: [],
    others: [{ seat: 1, handCount: 0, resources: null }],
    board: { placements: [], disabledLocations: [] },
    phase: { kind: 'p2_distribution', committedSeats: [], sealed: [] },
    waitingOn: [0, 1],
    seq: 4
  } as unknown as PlayerView
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  useUiStore.getState().reset()
  useUiStore.getState().ensureStagedKey('g1:2')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

/** The phase splash covers the coach for its first beat — let it pass. */
function past(ms = PHASE_INTRO_MS + 50): void {
  act(() => vi.advanceTimersByTime(ms))
}

const render = (): void => {
  act(() => root.render(<TutorialCoach view={p2View()} locate={locate} />))
  past()
}

describe('coach arrows and the "why" line', () => {
  it('an Actor in hand gets one arrow per Location it may enter', () => {
    useUiStore.getState().selectActor('politician')
    render()
    // Politicians take the Square and the University — and nothing else.
    expect(document.querySelectorAll('.coach-arrow')).toHaveLength(2)
    const arrow = document.querySelector('.coach-arrow')?.getAttribute('d') ?? ''
    expect(arrow).toContain('400') // pointing at the Square's screen center
  })

  it('says why the step matters, next to what to do', () => {
    useUiStore.getState().selectActor('politician')
    render()
    expect(document.querySelector('.coach-why')?.textContent).toBeTruthy()
  })

  it('without board coordinates it degrades to the hint alone — never a stray arrow', () => {
    useUiStore.getState().selectActor('politician')
    act(() => root.render(<TutorialCoach view={p2View()} />))
    past()
    expect(document.querySelectorAll('.coach-arrow')).toHaveLength(0)
    expect(document.querySelector('.coach-banner, .coach-chip')).toBeTruthy()
  })

  it('with nothing in hand there is nothing to point at on the board', () => {
    render()
    expect(document.querySelectorAll('.coach-arrow')).toHaveLength(0)
  })
})
