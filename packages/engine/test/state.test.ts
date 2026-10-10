import { describe, expect, it } from 'vitest'
import {
  ACTION_DECK_COMPOSITION,
  EVENT_CARDS,
  RULES_VERSION,
  TEAMS_2V2,
  assertStateInvariants,
  canonicalStringify,
  createGame,
  valuesIndexFor,
  visibilityGroup
} from '../src/index.js'
import type { GameState } from '../src/index.js'

function game(overrides: Partial<Parameters<typeof createGame>[0]> = {}): GameState {
  return createGame({ gameId: 'g1', mode: '1v1', seed: 'seed-1', ...overrides })
}

describe('createGame', () => {
  it('produces a valid starting state that passes all invariants', () => {
    for (const mode of ['1v1', 'ffa3', '2v2', 'vs_bots'] as const) {
      const state = game({ mode })
      assertStateInvariants(state)
      expect(state.turn).toBe(1)
      expect(state.phase.kind).toBe('p2_distribution') // turn 1 skips P1
      expect(state.isTieBreakerTurn).toBe(false)
      expect(state.meta.rulesVersion).toBe(RULES_VERSION)
      for (const inv of state.inventories) {
        expect(inv.resources).toEqual({ product: 1, electricity: 1, recycling: 1 })
        expect(inv.hand).toEqual([])
      }
    }
  })

  it('shuffles both decks into full permutations of the fixed compositions', () => {
    const state = game()
    expect([...state.eventDeck].sort()).toEqual([...EVENT_CARDS].sort())
    expect([...state.actionDeck].sort()).toEqual([...ACTION_DECK_COMPOSITION].sort())
    // 6 draws for the event deck + 14 for the action deck
    expect(state.rngCursor).toBe(20)
  })

  it('is fully deterministic: same seed → byte-identical state', () => {
    expect(canonicalStringify(game())).toBe(canonicalStringify(game()))
  })

  it('different seeds produce different deck orders', () => {
    const a = game({ seed: 'alpha' })
    const b = game({ seed: 'beta' })
    expect(
      a.eventDeck.join() === b.eventDeck.join() && a.actionDeck.join() === b.actionDeck.join()
    ).toBe(false)
  })

  it('seat counts per mode, including the vs_bots range', () => {
    expect(game({ mode: '1v1' }).meta.seats).toHaveLength(2)
    expect(game({ mode: 'ffa3' }).meta.seats).toHaveLength(3)
    expect(game({ mode: '2v2' }).meta.seats).toHaveLength(4)
    expect(game({ mode: 'vs_bots' }).meta.seats).toHaveLength(2)
    expect(game({ mode: 'vs_bots', seatCount: 3 }).meta.seats).toHaveLength(3)
    expect(() => game({ mode: '1v1', seatCount: 3 })).toThrow()
    expect(() => game({ mode: 'vs_bots', seatCount: 4 })).toThrow()
  })

  it('2v2 shares one value pool per team, other modes one per seat', () => {
    const teamGame = game({ mode: '2v2' })
    expect(teamGame.meta.teams).toEqual(TEAMS_2V2)
    expect(teamGame.values).toHaveLength(2)
    expect(valuesIndexFor(teamGame, 0)).toBe(0)
    expect(valuesIndexFor(teamGame, 2)).toBe(0)
    expect(valuesIndexFor(teamGame, 1)).toBe(1)
    expect(valuesIndexFor(teamGame, 3)).toBe(1)
    expect(visibilityGroup(teamGame, 2)).toEqual([0, 2])
    expect(visibilityGroup(teamGame, 3)).toEqual([1, 3])

    const ffa = game({ mode: 'ffa3' })
    expect(ffa.values).toHaveLength(3)
    expect(valuesIndexFor(ffa, 2)).toBe(2)
    expect(visibilityGroup(ffa, 2)).toEqual([2])
  })

  it('marks bot controllers when provided', () => {
    const state = game({ mode: 'vs_bots', controllers: ['human', 'bot'] })
    expect(state.meta.seats[1]?.controller).toBe('bot')
    expect(() => game({ controllers: ['human'] })).toThrow()
  })
})

describe('invariants catch corrupted states', () => {
  it('negative resources', () => {
    const state = game()
    ;(state.inventories[0] as GameState['inventories'][number]).resources.product = -1
    expect(() => assertStateInvariants(state)).toThrow(/non-negative/)
  })

  it('placement in a disallowed location', () => {
    const state = game()
    state.board.placements.push({
      actorId: '0:robot',
      seat: 0,
      actorType: 'robot',
      locationId: 'square',
      argument: 'rock'
    })
    expect(() => assertStateInvariants(state)).toThrow(/disallowed location/)
  })

  it('duplicate argument within a seat', () => {
    const state = game()
    state.board.placements.push(
      {
        actorId: '0:politician',
        seat: 0,
        actorType: 'politician',
        locationId: 'square',
        argument: 'rock'
      },
      { actorId: '0:artist', seat: 0, actorType: 'artist', locationId: 'theatre', argument: 'rock' }
    )
    expect(() => assertStateInvariants(state)).toThrow(/reuse an argument/)
  })

  it('eliminated seat still owning assets or placements', () => {
    const withResources = game()
    withResources.eliminated = [1]
    withResources.activeSeats = [0]
    expect(() => assertStateInvariants(withResources)).toThrow(/still owns/)

    const withPlacement = game()
    withPlacement.eliminated = [1]
    withPlacement.activeSeats = [0]
    const inv = withPlacement.inventories[1] as GameState['inventories'][number]
    inv.resources = { product: 0, electricity: 0, recycling: 0 }
    withPlacement.board.placements.push({
      actorId: '1:robot',
      seat: 1,
      actorType: 'robot',
      locationId: 'dump',
      argument: 'rock'
    })
    expect(() => assertStateInvariants(withPlacement)).toThrow(/appears in a placement/)
  })

  it('seat both active and eliminated', () => {
    const state = game()
    state.eliminated = [0]
    const inv = state.inventories[0] as GameState['inventories'][number]
    inv.resources = { product: 0, electricity: 0, recycling: 0 }
    const values = state.values[0] as GameState['values'][number]
    values.power = 0
    expect(() => assertStateInvariants(state)).toThrow(/both active and eliminated/)
  })

  it('action deck holding more copies than the composition allows', () => {
    const state = game()
    state.actionDeck = [...state.actionDeck.slice(1), 'change_values']
    expect(() => assertStateInvariants(state)).toThrow(/too many|cardsDrawn/)
  })

  it('cardsDrawn out of sync with the action deck', () => {
    const state = game()
    state.actionDeck = state.actionDeck.slice(2)
    expect(() => assertStateInvariants(state)).toThrow(/cardsDrawn/)
  })
})
