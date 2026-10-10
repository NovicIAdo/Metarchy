// A VP tie at game end extends the game by a deciding turn (isTieBreakerTurn).
// TieBreakerAnnounce explains that once the phase splash clears: the tied
// leaders (activeSeats — non-leaders are eliminated) and their equal VP.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView } from '@metarchy/engine'

const { TieBreakerAnnounce } = await import('../src/screens/game/TieBreakerAnnounce.js')
const { PHASE_INTRO_MS } = await import('../src/screens/game/PhaseSplash.js')
const { useGameStore } = await import('../src/stores/game.js')

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function tieView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    gameId: '44444444-4444-4444-8444-444444444444',
    mode: 'ffa3',
    rulesVersion: '1.0.0',
    seat: 0,
    turn: 6,
    isTieBreakerTurn: true,
    activeSeats: [0, 1],
    eliminated: [2],
    decks: { event: 0, action: 10 },
    values: [
      { power: 1, art: 1, knowledge: 1, fame: 0 }, // seat 0 → 1 VP
      { power: 1, art: 1, knowledge: 1, fame: 0 }, // seat 1 → 1 VP
      { power: 0, art: 0, knowledge: 0, fame: 0 } // seat 2 (eliminated)
    ],
    me: { resources: { product: 0, electricity: 0, recycling: 0 }, hand: [] },
    allies: [],
    others: [],
    board: { placements: [], disabledLocations: [] },
    phase: { kind: 'p2_distribution', committedSeats: [], sealed: [] } as PlayerView['phase'],
    played: [],
    eventsPlayed: [],
    waitingOn: [0],
    seq: 1,
    ...overrides
  } as PlayerView
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  useGameStore.setState({
    players: [
      { seat: 0, nickname: 'Alice', bot: false, avatar: null },
      { seat: 1, nickname: 'Bob', bot: false, avatar: null },
      { seat: 2, nickname: 'Cara', bot: false, avatar: null }
    ] as unknown as PlayerView['others']
  } as never)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const card = (): HTMLElement | null => document.querySelector('.tiebreak-card')

describe('TieBreakerAnnounce', () => {
  it('announces the tied leaders and their VP once the splash clears', () => {
    act(() => root.render(<TieBreakerAnnounce view={tieView()} />))
    expect(card()).toBeNull() // covered by the phase intro at first

    act(() => vi.advanceTimersByTime(PHASE_INTRO_MS + 50))
    const el = card()
    expect(el).not.toBeNull()
    // Tied leaders shown; the eliminated seat is not.
    expect(el?.textContent).toContain('Alice')
    expect(el?.textContent).toContain('Bob')
    expect(el?.textContent).not.toContain('Cara')
    // victoryPoints({1,1,1,0}) === 1 for each leader.
    const vps = [...document.querySelectorAll('.tiebreak-vp')].map((n) => n.textContent)
    expect(vps).toHaveLength(2)
    expect(vps.every((v) => v?.includes('1'))).toBe(true)
  })

  it('shows nothing on a normal (non-tie-breaker) turn', () => {
    act(() =>
      root.render(<TieBreakerAnnounce view={tieView({ isTieBreakerTurn: false, turn: 3 })} />)
    )
    act(() => vi.advanceTimersByTime(PHASE_INTRO_MS + 50))
    expect(card()).toBeNull()
  })
})
