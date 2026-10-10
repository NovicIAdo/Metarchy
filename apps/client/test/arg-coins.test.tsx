// Argument coins are a per-player cosmetic, so the only way to get them wrong
// is to paint one player's set on another player's coin. These tests pin the
// ownership rule end to end: the pure key builder, the seat-resolving hook, and
// the ally panel as a real consumer.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView } from '@metarchy/engine'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { AllyPanel } = await import('../src/screens/game/AllyPanel.js')
const { useArgCoins } = await import('../src/lib/argCoins.js')
const { useGameStore } = await import('../src/stores/game.js')
const { useSessionStore } = await import('../src/stores/session.js')
const { argumentAssetKey } = await import('../src/theme.js')

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
      { power: 0, art: 0, knowledge: 0, fame: 0 },
      { power: 0, art: 0, knowledge: 0, fame: 0 }
    ],
    me: { resources: { product: 2, electricity: 1, recycling: 0 }, hand: [] },
    allies: [2],
    others: [
      { seat: 1, handCount: 0, resources: null },
      { seat: 2, handCount: 0, resources: null, hand: [] },
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
  useSessionStore.getState().setProfile(null)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('argumentAssetKey', () => {
  it('falls back to the free coins and only swaps on a bought set', () => {
    expect(argumentAssetKey('rock', null)).toBe('argument.rock')
    expect(argumentAssetKey('rock', {})).toBe('argument.rock')
    expect(argumentAssetKey('dummy', { arguments: null })).toBe('argument.dummy')
    expect(argumentAssetKey('dummy', { arguments: 'matrix' })).toBe('argSkin.matrix.dummy')
    // A whole-figure actor skin must not leak into the coin key.
    expect(argumentAssetKey('paper', { skins: { robot: 'industrial' } })).toBe('argument.paper')
  })
})

describe('useArgCoins', () => {
  /** Renders the hook and reports what it resolves for a few (argument, seat) pairs. */
  function resolve(pairs: [string, number | null][]): string[] {
    const out: string[] = []
    function Probe() {
      const coin = useArgCoins()
      for (const [arg, seat] of pairs) out.push(coin(arg, seat as never))
      return null
    }
    act(() => root.render(<Probe />))
    return out
  }

  it('dresses each seat in its own set and never borrows the viewer’s', () => {
    act(() => {
      useGameStore.getState().setView(teamView(), 30)
      useGameStore.getState().setPlayers([
        { seat: 0, nickname: 'me', bot: false, avatar: null, wardrobe: { arguments: 'matrix' } },
        { seat: 1, nickname: 'rival', bot: false, avatar: null, wardrobe: { arguments: 'silver' } },
        { seat: 2, nickname: 'buddy', bot: false, avatar: null, wardrobe: null }
      ])
    })
    const [mine, implicitMine, rival, plainAlly, unknownSeat] = resolve([
      ['rock', 0],
      ['rock', null],
      ['rock', 1],
      ['rock', 2],
      ['rock', 3]
    ])
    expect(mine).toContain('arg-skins/matrix/rock')
    // A null seat means "mine" — pickers pass no seat.
    expect(implicitMine).toBe(mine)
    expect(rival).toContain('arg-skins/silver/rock')
    // Undressed and unseated players keep the free coins, not the viewer's set.
    expect(plainAlly).toContain('/arguments/rock')
    expect(unknownSeat).toContain('/arguments/rock')
  })

  it('uses my own profile before the roster arrives (shop and profile previews)', () => {
    act(() =>
      useSessionStore.getState().setProfile({
        userId: '11111111-1111-4111-8111-111111111111',
        nickname: 'me',
        avatar: null,
        wardrobe: { arguments: 'bronze' }
      })
    )
    const [mine] = resolve([['scissors', null]])
    expect(mine).toContain('arg-skins/bronze/scissors')
  })
})

describe('AllyPanel coins', () => {
  it('shows the ally draft in the ally’s set, not the viewer’s', () => {
    act(() => {
      useSessionStore.getState().setProfile({
        userId: '11111111-1111-4111-8111-111111111111',
        nickname: 'me',
        avatar: null,
        wardrobe: { arguments: 'matrix' }
      })
      useGameStore.getState().setPlayers([
        { seat: 0, nickname: 'me', bot: false, avatar: null, wardrobe: { arguments: 'matrix' } },
        { seat: 2, nickname: 'buddy', bot: false, avatar: null, wardrobe: { arguments: 'silver' } }
      ])
      useGameStore.getState().setAllyStaging({
        fromSeat: 2,
        staging: {
          kind: 'p2',
          turn: 2,
          placements: [{ actorType: 'politician', locationId: 'square', argument: 'rock' }]
        }
      })
      root.render(<AllyPanel view={teamView()} />)
    })
    const badge = host.querySelector('.ally-orb.staged .ally-orb-badges img')
    expect(badge?.getAttribute('src')).toContain('arg-skins/silver/rock')
  })
})
