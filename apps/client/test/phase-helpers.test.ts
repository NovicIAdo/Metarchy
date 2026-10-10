// P3 legality mirrors: relocation targets and exchange give/from/take options
// must match the engine's handlers so the UI never offers a rejected intent.

import type { PlayerView } from '@metarchy/engine'
import { describe, expect, it } from 'vitest'
import {
  exchangeTargetSeats,
  exchangeableValues,
  poolOfSeat,
  relocatableActors,
  relocationTargets
} from '../src/screens/game/phase-helpers.js'

describe('relocation', () => {
  it('targets are the actor-type locations minus the current one', () => {
    expect(relocationTargets('robot', 'factory').sort()).toEqual(['dump', 'power_plant'])
    expect(relocationTargets('politician', 'square')).toEqual(['university'])
  })

  it('relocatable actors exclude those I already ordered this step', () => {
    const view = {
      phase: {
        kind: 'p3_action',
        selectedCounts: null,
        step: { t: 'relocate', committedSeats: [], myOrders: [{ actorId: '1:robot', to: 'dump' }] }
      },
      board: {
        placements: [
          { actorId: '0:robot', seat: 0, actorType: 'robot', locationId: 'factory' },
          { actorId: '1:robot', seat: 1, actorType: 'robot', locationId: 'factory' }
        ],
        disabledLocations: []
      }
    } as unknown as PlayerView
    expect(relocatableActors(view).map((p) => p.actorId)).toEqual(['0:robot'])
  })
})

describe('exchange', () => {
  const base = {
    seat: 0 as const,
    activeSeats: [0, 1, 2],
    values: [
      { power: 1, art: 0, knowledge: 0, fame: 3 },
      { power: 0, art: 0, knowledge: 0, fame: 5 },
      { power: 0, art: 2, knowledge: 0, fame: 0 }
    ]
  } as unknown as PlayerView

  it('fame is never exchangeable; zero pools drop out', () => {
    expect(exchangeableValues({ power: 1, art: 0, knowledge: 2, fame: 9 })).toEqual([
      'power',
      'knowledge'
    ])
  })

  it('targets need a non-empty pool and never include me', () => {
    expect(exchangeTargetSeats(base)).toEqual([2]) // seat 1 has only fame
  })

  it('no targets when I have nothing to give', () => {
    const broke = {
      ...base,
      values: [{ power: 0, art: 0, knowledge: 0, fame: 3 }, ...base.values.slice(1)]
    } as PlayerView
    expect(exchangeTargetSeats(broke)).toEqual([])
  })

  it('2v2 exchanges target the opposing team pool only', () => {
    const teams = {
      seat: 0 as const,
      teams: [
        [0, 2],
        [1, 3]
      ],
      activeSeats: [0, 1, 2, 3],
      values: [
        { power: 1, art: 0, knowledge: 0, fame: 0 }, // team 0 pool
        { power: 0, art: 1, knowledge: 0, fame: 0 } // team 1 pool
      ]
    } as unknown as PlayerView
    expect(exchangeTargetSeats(teams)).toEqual([1, 3])
    expect(poolOfSeat(teams, 3)).toEqual({ power: 0, art: 1, knowledge: 0, fame: 0 })
  })
})
