// The phase splash is decorative chrome: it must announce each turn/phase
// change, must never intercept input (pointer-events pass through), and must
// leave the DOM on its own after the animation window — a stuck splash would
// permanently dim the board.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView } from '@metarchy/engine'

const { PhaseSplash, PHASE_SPLASH_MS, PHASE_INTRO_MS, usePhaseIntroCover } =
  await import('../src/screens/game/PhaseSplash.js')

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function viewAt(turn: number, kind: string, isTieBreakerTurn = false): PlayerView {
  return {
    gameId: '44444444-4444-4444-8444-444444444444',
    mode: '1v1',
    rulesVersion: '1.0.0',
    seat: 0,
    turn,
    maxTurns: 5,
    isTieBreakerTurn,
    activeSeats: [0, 1],
    eliminated: [],
    decks: { event: 5, action: 10 },
    values: [
      { power: 0, art: 0, knowledge: 0, fame: 0 },
      { power: 0, art: 0, knowledge: 0, fame: 0 }
    ],
    me: { resources: { product: 1, electricity: 1, recycling: 1 }, hand: [] },
    allies: [],
    others: [{ seat: 1, handCount: 0, resources: null }],
    board: { placements: [], disabledLocations: [] },
    phase: { kind } as PlayerView['phase'],
    played: [],
    eventsPlayed: [],
    waitingOn: [0],
    seq: 1
  } as PlayerView
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const splash = (): HTMLElement | null => document.querySelector('.phase-splash')

describe('PhaseSplash', () => {
  it('announces the phase, stays out of the way, and self-dismisses', () => {
    act(() => root.render(<PhaseSplash view={viewAt(1, 'p2_distribution')} />))

    const el = splash()
    expect(el).not.toBeNull()
    expect(el?.getAttribute('aria-hidden')).toBe('true')
    expect(el?.textContent).toContain('Turn 1 Phase 2')
    expect(el?.textContent).toContain('Distribute actors by location')
    // Direct child of <body>: rendered inside .game-stage (a fixed-position
    // stacking context in Chrome) it can never paint above body-portaled
    // modals — the P1 event modal would swallow the announcement.
    expect(el?.parentElement).toBe(document.body)

    act(() => vi.advanceTimersByTime(PHASE_SPLASH_MS + 50))
    expect(splash()).toBeNull()
  })

  it('re-announces on phase change and labels tie-breaker turns', () => {
    act(() => root.render(<PhaseSplash view={viewAt(2, 'p3_action')} />))
    expect(splash()?.textContent).toContain('Turn 2 Phase 3')

    // Next phase arrives before the previous splash times out.
    act(() => vi.advanceTimersByTime(500))
    act(() => root.render(<PhaseSplash view={viewAt(2, 'p4_conflict', true)} />))
    expect(splash()?.textContent).toContain('Tie-breaker · Phase 4')
    expect(splash()?.textContent).toContain('The conflict')

    // The superseded timer must not tear down the new splash early.
    act(() => vi.advanceTimersByTime(PHASE_SPLASH_MS - 300))
    expect(splash()).not.toBeNull()
    act(() => vi.advanceTimersByTime(400))
    expect(splash()).toBeNull()
  })

  it('renders nothing for finished games or before the first sync', () => {
    act(() => root.render(<PhaseSplash view={null} />))
    expect(splash()).toBeNull()
    act(() => root.render(<PhaseSplash view={viewAt(5, 'finished')} />))
    expect(splash()).toBeNull()
  })
})

/** Phase content mounts behind the opaque splash: covered → revealed. */
function Probe({ view }: { view: PlayerView | null }) {
  return usePhaseIntroCover(view) ? <em data-covered /> : <strong data-revealed />
}

const covered = (): boolean => document.querySelector('[data-covered]') !== null

describe('usePhaseIntroCover', () => {
  it('hides phase content for the intro window, then reveals it', () => {
    act(() => root.render(<Probe view={viewAt(2, 'p1_event')} />))
    expect(covered()).toBe(true)

    act(() => vi.advanceTimersByTime(PHASE_INTRO_MS + 50))
    expect(covered()).toBe(false)
  })

  it('re-covers synchronously on the very first render of the next phase', () => {
    act(() => root.render(<Probe view={viewAt(2, 'p1_event')} />))
    act(() => vi.advanceTimersByTime(PHASE_INTRO_MS + 50))
    expect(covered()).toBe(false)

    // No timer advance: the same committed render that shows the new phase
    // must already be covered — a one-frame flash would read content-first.
    act(() => root.render(<Probe view={viewAt(2, 'p2_distribution')} />))
    expect(covered()).toBe(true)
  })

  it('never covers when there is no announceable phase', () => {
    act(() => root.render(<Probe view={null} />))
    expect(covered()).toBe(false)
    act(() => root.render(<Probe view={viewAt(5, 'finished')} />))
    expect(covered()).toBe(false)
  })
})
