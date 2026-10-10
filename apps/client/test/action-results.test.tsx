// P3 results ceremonies (user rule): after every wave of played action cards
// humans see one screen with everything that happened — who blocked what,
// who moved whom where, who traded which values — held behind Get It!.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView } from '@metarchy/engine'
import type { ClientIntent } from '@metarchy/protocol'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { ActionResultsModal } = await import('../src/screens/game/ActionResultsModal.js')
const { useGameStore } = await import('../src/stores/game.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function ackStepView(step: unknown): PlayerView {
  return {
    gameId: '77777777-7777-4777-8777-777777777777',
    mode: '1v1',
    rulesVersion: '1.0.0',
    seat: 0,
    turn: 2,
    maxTurns: 5,
    isTieBreakerTurn: false,
    activeSeats: [0, 1],
    eliminated: [],
    decks: { event: 6, action: 12 },
    values: [
      { power: 1, art: 1, knowledge: 1, fame: 0 },
      { power: 1, art: 1, knowledge: 1, fame: 0 }
    ],
    me: { resources: { product: 1, electricity: 1, recycling: 1 }, hand: [] },
    allies: [],
    others: [{ seat: 1, handCount: 0, resources: { product: 0, electricity: 0, recycling: 0 } }],
    board: { placements: [], disabledLocations: ['factory'] },
    phase: { kind: 'p3_action', selectedCounts: null, step },
    played: [],
    eventsPlayed: [],
    waitingOn: [0, 1],
    seq: 12
  } as PlayerView
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useGameStore.getState().resetGame()
  useGameStore.getState().setPlayers([
    { seat: 0, nickname: 'me', bot: false, avatar: null },
    { seat: 1, nickname: 'rival', bot: true, avatar: null }
  ])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('P3 results screens', () => {
  it('announces blocked locations with the culprit and the card', () => {
    const view = ackStepView({
      t: 'blocks_ack',
      blocks: [{ seat: 1, card: 'sabotage', locationId: 'factory' }],
      acked: []
    })
    act(() => root.render(<ActionResultsModal view={view} send={() => {}} />))

    const text = document.body.textContent ?? ''
    expect(text).toContain('Locations blocked')
    expect(text).toContain('rival 🤖 played Sabotage')
    expect(text).toContain('will not work this turn')
    expect(text).toContain('Get It!')
  })

  it('lists every applied relocation with from → to', () => {
    const view = ackStepView({
      t: 'relocations_ack',
      moves: [{ seat: 0, actorId: '1:scientist', from: 'theatre', to: 'university' }],
      acked: []
    })
    act(() => root.render(<ActionResultsModal view={view} send={() => {}} />))

    const text = document.body.textContent ?? ''
    expect(text).toContain('Relocations')
    expect(text).toContain('You played Relocation')
    expect(text).toContain('Scientist')
    expect(text).toMatch(/Theatre.*University/)
  })

  it('explains a fully-cancelled relocation wave', () => {
    const view = ackStepView({ t: 'relocations_ack', moves: [], acked: [] })
    act(() => root.render(<ActionResultsModal view={view} send={() => {}} />))
    expect(document.body.textContent).toContain('nothing moved')
  })

  it('shows who traded which values with whom and acks with action.ack', () => {
    const sent: ClientIntent[] = []
    const view = ackStepView({
      t: 'exchanges_ack',
      exchanges: [{ seat: 1, from: 0, give: 'art', take: 'knowledge' }],
      acked: []
    })
    act(() => root.render(<ActionResultsModal view={view} send={(i) => sent.push(i)} />))

    const text = document.body.textContent ?? ''
    expect(text).toContain('Values exchanged')
    expect(text).toContain('rival 🤖 played Change of Values')
    expect(text).toMatch(/gave.*Art.*took.*Knowledge/)

    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Get It!')
    )
    act(() => btn?.click())
    expect(sent).toEqual([{ type: 'action.ack' }])
  })

  it('waits quietly once I have acked', () => {
    const view = {
      ...ackStepView({
        t: 'blocks_ack',
        blocks: [{ seat: 0, card: 'cable_stolen', locationId: 'power_plant' }],
        acked: [0]
      }),
      waitingOn: [1]
    } as PlayerView
    act(() => root.render(<ActionResultsModal view={view} send={() => {}} />))

    expect(document.body.textContent).not.toContain('Get It!')
    expect(document.body.textContent).toContain('Waiting for others')
  })
})
