// Watching a game (author request): a watcher must see WHAT is happening in
// Phase 1 — which event is on the table, everyone's stock, and the tie-break as
// it resolves — while never seeing anything a player could be coached with.
// The engine already withholds sealed amounts (spectator-view.test.ts); these
// tests pin the client half: read-only, no controls, no leaked numbers.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView, SeatId } from '@metarchy/engine'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { EventModal } = await import('../src/screens/game/EventModal.js')
const { useGameStore } = await import('../src/stores/game.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** The seatless, strictly-public view the server sends a watcher. */
function watcherView(stage: unknown): PlayerView {
  return {
    gameId: '55555555-5555-4555-8555-555555555555',
    mode: '1v1',
    rulesVersion: '1.0.0',
    seat: -1 as SeatId,
    spectator: true,
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
    me: { resources: { product: 0, electricity: 0, recycling: 0 }, hand: [] },
    allies: [],
    others: [
      { seat: 0, handCount: 1, resources: { product: 2, electricity: 1, recycling: 0 } },
      { seat: 1, handCount: 1, resources: { product: 3, electricity: 0, recycling: 1 } }
    ],
    board: { placements: [], disabledLocations: [] },
    phase: { kind: 'p1_event', card: 'help_poor_countries', stage },
    played: [],
    eventsPlayed: [],
    waitingOn: [0, 1],
    seq: 7
  } as unknown as PlayerView
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useGameStore.getState().resetGame()
  useGameStore.getState().setPlayers([
    { seat: 0, nickname: 'alice', bot: false, avatar: null },
    { seat: 1, nickname: 'bob', bot: false, avatar: null }
  ])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('watching Phase 1', () => {
  it('shows the event card and stocks, with progress instead of the amounts', () => {
    act(() =>
      root.render(
        <EventModal
          view={watcherView({
            t: 'discard_commit',
            committedSeats: [0],
            myAmount: null,
            sealed: []
          })}
          send={() => undefined}
        />
      )
    )
    const overlay = document.querySelector('.modal-overlay')
    expect(overlay).not.toBeNull()
    // Which event is in play — the thing that was missing when watching.
    expect(overlay?.textContent).toContain('Help Poor Countries')
    // Everyone's stock of the event resource, the watcher's own seat excluded.
    const rows = [...(overlay?.querySelectorAll('.event-rows li') ?? [])].map(
      (li) => li.textContent
    )
    expect(rows).toEqual(['alice2', 'bob3'])
    // Progress only — no amount is on screen before the reveal.
    expect(overlay?.textContent).toContain('1 of 2 have sealed their discard')
    // And nothing to click with: a watcher cannot act into a live game.
    expect(overlay?.querySelector('input[type=range]')).toBeNull()
    expect(overlay?.querySelectorAll('button')).toHaveLength(0)
  })

  it('opens the amounts once the engine reveals them', () => {
    act(() =>
      root.render(
        <EventModal
          view={watcherView({
            t: 'discard_ack',
            winner: 1,
            drewCard: true,
            acked: [],
            revealed: { 0: 1, 1: 3 }
          })}
          send={() => undefined}
        />
      )
    )
    const overlay = document.querySelector('.modal-overlay')
    const rows = [...(overlay?.querySelectorAll('.event-rows li') ?? [])].map(
      (li) => li.textContent
    )
    expect(rows).toEqual(['alice discarded1', 'bob discarded3'])
    // The result is narrated, but the "Get It!" ack belongs to the players.
    expect(overlay?.textContent).toContain('bob')
    expect(overlay?.querySelectorAll('button')).toHaveLength(0)
  })

  it('rides along in the tie-break arena — throw count now, coins when settled', () => {
    act(() =>
      root.render(
        <EventModal
          view={watcherView({
            t: 'discard_tiebreak',
            revealed: { 0: 2, 1: 2 },
            tiebreak: {
              participants: [0, 1],
              round: 1,
              chosen: [0],
              myChoice: null,
              revealed: null
            }
          })}
          send={() => undefined}
        />
      )
    )
    const arena = document.querySelector('.arena')
    // The watcher gets the full arena, not the compact modal (author request).
    expect(arena).not.toBeNull()
    expect(arena?.textContent).toContain('1 of 2 have thrown')
    // Both coins are still face down and there is no way to throw one.
    expect(arena?.querySelectorAll('.arena-sealed')).toHaveLength(2)
    expect(arena?.querySelectorAll('.arena-rps')).toHaveLength(0)
  })
})
