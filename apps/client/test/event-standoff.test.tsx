// The compare-tie standoff (user rule): before the tie-break arena the modal
// must SHOW the tied minimum — every player's compared amount — say the winner
// comes from a conflict resolution, and offer "Resolve the Conflict" instead
// of silently teleporting players into the arena.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView } from '@metarchy/engine'
import type { ClientIntent } from '@metarchy/protocol'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { EventModal } = await import('../src/screens/game/EventModal.js')
const { useGameStore } = await import('../src/stores/game.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function standoffView(): PlayerView {
  return {
    gameId: '77777777-7777-4777-8777-777777777777',
    mode: '1v1',
    rulesVersion: '1.0.0',
    seat: 0,
    turn: 2,
    isTieBreakerTurn: false,
    activeSeats: [0, 1],
    eliminated: [],
    decks: { event: 6, action: 14 },
    values: [
      { power: 0, art: 0, knowledge: 1, fame: 0 },
      { power: 0, art: 0, knowledge: 1, fame: 0 }
    ],
    me: { resources: { product: 1, electricity: 1, recycling: 1 }, hand: [] },
    allies: [],
    others: [{ seat: 1, handCount: 0, resources: null }],
    board: { placements: [], disabledLocations: [] },
    phase: {
      kind: 'p1_event',
      card: 'educational_crisis', // compares knowledge
      stage: { t: 'compare_standoff', participants: [0, 1], acked: [] }
    },
    played: [],
    eventsPlayed: [],
    waitingOn: [0, 1],
    seq: 9
  } as unknown as PlayerView
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

describe('compare standoff modal', () => {
  it('shows tied amounts, explains the coming resolution, and acks on the button', () => {
    const sent: ClientIntent[] = []
    act(() => {
      root.render(<EventModal view={standoffView()} send={(i) => sent.push(i)} />)
    })

    const overlay = document.querySelector('.modal-overlay')
    expect(overlay).not.toBeNull()
    const rows = [...(overlay?.querySelectorAll('.event-rows li') ?? [])].map(
      (li) => li.textContent
    )
    expect(rows).toEqual(['You1', 'rival1'])
    expect(overlay?.textContent).toContain('decided by a conflict resolution')

    const button = [...(overlay?.querySelectorAll('button') ?? [])].find((b) =>
      /resolve the conflict/i.test(b.textContent ?? '')
    )
    expect(button).toBeTruthy()
    act(() => button?.click())
    expect(sent).toEqual([{ type: 'event.ack' }])
  })
})
