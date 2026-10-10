// The P1 event tie-break follows the prototype (Meta_scratch): a tied PLAYER
// gets the full conflict scene — arena backdrop, avatar cards, RPS coins —
// not a row of buttons in the small modal. Spectators of someone else's tie
// keep the compact modal. The smoke drives the tie via `.arena-rps` buttons,
// so those must exist in the arena under the same class and label.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView, Rps, SeatId } from '@metarchy/engine'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { EventModal } = await import('../src/screens/game/EventModal.js')
const { useGameStore } = await import('../src/stores/game.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function tieView(participants: SeatId[], myChoice: Rps | null): PlayerView {
  return {
    gameId: '66666666-6666-4666-8666-666666666666',
    mode: 'ffa3',
    rulesVersion: '1.0.0',
    seat: 0,
    turn: 2,
    maxTurns: 5,
    isTieBreakerTurn: false,
    activeSeats: [0, 1, 2],
    eliminated: [],
    decks: { event: 6, action: 14 },
    values: [
      { power: 1, art: 0, knowledge: 0, fame: 0 },
      { power: 1, art: 0, knowledge: 0, fame: 0 },
      { power: 2, art: 0, knowledge: 0, fame: 0 }
    ],
    me: { resources: { product: 1, electricity: 1, recycling: 1 }, hand: [] },
    allies: [],
    others: [
      { seat: 1, handCount: 0, resources: { product: 0, electricity: 0, recycling: 0 } },
      { seat: 2, handCount: 0, resources: { product: 0, electricity: 0, recycling: 0 } }
    ],
    board: { placements: [], disabledLocations: [] },
    phase: {
      kind: 'p1_event',
      card: 'political_repression',
      stage: {
        t: 'compare_tiebreak',
        tiebreak: {
          participants,
          round: 1,
          chosen: myChoice === null ? [] : [0],
          myChoice,
          revealed: null
        }
      }
    },
    played: [],
    eventsPlayed: [],
    waitingOn: myChoice === null ? participants : participants.filter((s) => s !== 0),
    seq: 9
  } as PlayerView
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useGameStore.getState().resetGame()
  useGameStore.getState().setPlayers([
    { seat: 0, nickname: 'me', bot: false, avatar: 'golden' },
    { seat: 1, nickname: 'rival', bot: true, avatar: null },
    { seat: 2, nickname: 'third', bot: true, avatar: 'viper' }
  ])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('event tie-break arena', () => {
  it('replaces the modal with the conflict scene when I am tied', () => {
    act(() => root.render(<EventModal view={tieView([0, 1], null)} send={() => {}} />))

    const arena = document.querySelector('.arena')
    expect(arena).not.toBeNull()
    expect(document.querySelector('.event-modal')).toBeNull()
    // Both tied players stand as avatar cards; the third player is absent.
    expect(document.querySelectorAll('.arena-player-frame')).toHaveLength(2)
    // The smoke clicks these: same class, same localized labels as P4.
    const rps = [...document.querySelectorAll('.arena-rps')]
    expect(rps.map((b) => b.textContent)).toEqual(['Rock', 'Paper', 'Scissors'])
  })

  it('seals my throw and waits once I have chosen', () => {
    act(() => root.render(<EventModal view={tieView([0, 1], 'rock')} send={() => {}} />))

    expect(document.querySelector('.arena')).not.toBeNull()
    expect(document.querySelectorAll('.arena-rps')).toHaveLength(0)
    expect(document.body.textContent).toContain('Waiting for others')
  })

  it('keeps the compact modal for a tie I am not part of', () => {
    act(() => root.render(<EventModal view={tieView([1, 2], null)} send={() => {}} />))

    expect(document.querySelector('.arena')).toBeNull()
    expect(document.querySelector('.event-modal')).not.toBeNull()
    expect(document.body.textContent).toContain('Tie between')
  })

  it('flips the previous round’s throws open on the coins after a drawn round', () => {
    const view = tieView([0, 1], null)
    const phase = view.phase as Extract<PlayerView['phase'], { kind: 'p1_event' }>
    const stage = phase.stage as Extract<typeof phase.stage, { t: 'compare_tiebreak' }>
    stage.tiebreak.round = 2
    stage.tiebreak.revealed = { round: 1, choices: { 0: 'rock', 1: 'rock' } }
    act(() => root.render(<EventModal view={view} send={() => {}} />))

    // Both coins show the revealed round-1 throws (dimmed), no sealed "?" left.
    const prev = [...document.querySelectorAll('.arena-arg img.arena-arg-prev')]
    expect(prev.map((i) => i.getAttribute('alt'))).toEqual(['rock', 'rock'])
    expect(document.querySelector('.arena-sealed')).toBeNull()
    expect(document.body.textContent).toContain('Tie, go again')
  })

  it('replaces my previous throw with my fresh pick, opponent keeps the revealed one', () => {
    const view = tieView([0, 1], 'paper')
    const phase = view.phase as Extract<PlayerView['phase'], { kind: 'p1_event' }>
    const stage = phase.stage as Extract<typeof phase.stage, { t: 'compare_tiebreak' }>
    stage.tiebreak.round = 2
    stage.tiebreak.revealed = { round: 1, choices: { 0: 'rock', 1: 'rock' } }
    act(() => root.render(<EventModal view={view} send={() => {}} />))

    const fresh = [...document.querySelectorAll('.arena-arg img:not(.arena-arg-prev)')]
    expect(fresh.map((i) => i.getAttribute('alt'))).toEqual(['paper'])
    const prev = [...document.querySelectorAll('.arena-arg img.arena-arg-prev')]
    expect(prev.map((i) => i.getAttribute('alt'))).toEqual(['rock'])
  })
})

function ackView(tiebreakChoices: Record<number, string>, winnerSeat: number): PlayerView {
  const view = tieView([0, 1], null)
  return {
    ...view,
    phase: {
      kind: 'p1_event',
      card: 'political_repression',
      stage: {
        t: 'compare_ack',
        winner: { kind: 'seat', seat: winnerSeat },
        acked: [],
        tiebreakChoices
      }
    }
  } as PlayerView
}

describe('event tie-break reveal (ack stage)', () => {
  it('shows the final throws and the outcome in the arena when I fought the tie', () => {
    act(() =>
      root.render(<EventModal view={ackView({ 0: 'rock', 1: 'scissors' }, 0)} send={() => {}} />)
    )

    expect(document.querySelector('.arena')).not.toBeNull()
    expect(document.querySelector('.event-modal')).toBeNull()
    // Both coins flipped open: my rock beats their scissors.
    const coins = [...document.querySelectorAll('.arena-arg img')].map((i) => i.getAttribute('alt'))
    expect(coins.sort()).toEqual(['rock', 'scissors'])
    const badges = [...document.querySelectorAll('.outcome-badge')].map((b) => b.textContent)
    expect(badges.sort()).toEqual(['LOSE', 'WIN'])
    // The ack lives inside the arena now.
    expect(document.body.textContent).toContain('Get It!')
  })

  it('keeps the compact modal when the resolved tie was not mine', () => {
    act(() =>
      root.render(<EventModal view={ackView({ 1: 'rock', 2: 'paper' }, 2)} send={() => {}} />)
    )

    expect(document.querySelector('.arena')).toBeNull()
    expect(document.querySelector('.event-modal')).not.toBeNull()
  })
})
