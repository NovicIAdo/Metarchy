// 2v2 team transparency: the ally column shows the ally's actual cards (engine
// shares hands inside a visibility group) and their live P2 draft — actor →
// location with argument/bet — before the ally commits.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView } from '@metarchy/engine'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { AllyPanel } = await import('../src/screens/game/AllyPanel.js')
const { useGameStore } = await import('../src/stores/game.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function teamView(): PlayerView {
  return {
    gameId: '55555555-5555-4555-8555-555555555555',
    mode: '2v2',
    rulesVersion: '1.0.0',
    seat: 0,
    teams: [
      [0, 2],
      [1, 3]
    ],
    turn: 2,
    isTieBreakerTurn: false,
    activeSeats: [0, 1, 2, 3],
    eliminated: [],
    decks: { event: 5, action: 12 },
    values: [
      { power: 1, art: 0, knowledge: 0, fame: 0 },
      { power: 0, art: 1, knowledge: 0, fame: 0 }
    ],
    me: { resources: { product: 2, electricity: 1, recycling: 0 }, hand: [] },
    allies: [2],
    others: [
      { seat: 1, handCount: 1, resources: null },
      {
        seat: 2,
        handCount: 2,
        resources: null,
        hand: [
          { instanceId: 'c1', card: 'sabotage' },
          { instanceId: 'c2', card: 'relocation' }
        ]
      },
      { seat: 3, handCount: 0, resources: null }
    ],
    board: { placements: [], disabledLocations: [] },
    phase: { kind: 'p2_distribution', committedSeats: [], sealed: [] },
    played: [],
    eventsPlayed: [],
    waitingOn: [0, 1, 2, 3],
    seq: 30
  } as unknown as PlayerView
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useGameStore.getState().resetGame()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('AllyPanel', () => {
  it('shows the ally hand and the live staged plan with location badges', () => {
    act(() => {
      useGameStore.getState().setPlayers([
        { seat: 0, nickname: 'me', bot: false, avatar: null },
        { seat: 2, nickname: 'buddy', bot: false, avatar: null }
      ])
      useGameStore.getState().setAllyStaging({
        fromSeat: 2,
        staging: {
          kind: 'p2',
          turn: 2,
          placements: [
            { actorType: 'politician', locationId: 'square', argument: 'rock', bet: 'win' }
          ]
        }
      })
      root.render(<AllyPanel view={teamView()} />)
    })
    expect(host.textContent).toContain('buddy')
    expect(host.querySelectorAll('.ally-hand-card')).toHaveLength(2)
    const stagedOrb = host.querySelector('.ally-orb.staged')
    expect(stagedOrb).not.toBeNull()
    expect(stagedOrb?.textContent).toContain('…') // staged, not yet sealed
    expect(host.querySelectorAll('.ally-orb.idle')).toHaveLength(3)
    expect(stagedOrb?.querySelectorAll('.ally-orb-badges img')).toHaveLength(2) // argument + bet
  })

  it('a clear retracts the plan; sealed placements win over drafts', () => {
    const view = teamView()
    if (view.phase.kind === 'p2_distribution') {
      view.phase.committedSeats = [2]
      view.phase.sealed = [
        {
          seat: 2,
          placements: [
            {
              actorId: '2:politician',
              seat: 2,
              actorType: 'politician',
              locationId: 'theatre',
              argument: 'paper'
            }
          ]
        }
      ]
    }
    act(() => {
      useGameStore.getState().setAllyStaging({
        fromSeat: 2,
        staging: {
          kind: 'p2',
          turn: 2,
          placements: [
            { actorType: 'politician', locationId: 'square', argument: 'rock', bet: 'win' }
          ]
        }
      })
      root.render(<AllyPanel view={view} />)
    })
    // Committed → the sealed placement renders (✓), the stale draft does not.
    const placed = host.querySelector('.ally-orb.placed')
    expect(placed).not.toBeNull()
    expect(placed?.textContent).toContain('✓')
    expect(host.querySelector('.ally-orb.staged')).toBeNull()

    act(() => {
      useGameStore.getState().setAllyStaging({ fromSeat: 2, staging: { kind: 'clear', turn: 2 } })
    })
    expect(useGameStore.getState().allyStaging).toBeNull()
  })
})
