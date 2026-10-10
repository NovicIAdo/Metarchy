import { describe, expect, it } from 'vitest'
import {
  ACTION_DECK_COMPOSITION,
  ACTOR_TYPES,
  ALLOWED_LOCATIONS,
  ARGUMENT_TYPES,
  BET_COST,
  BLOCK_CARD_LOCATION,
  EVENT_CARDS,
  LOCATIONS,
  MAX_TURNS,
  rpsOutcome
} from '../src/index.js'
import type { ArgumentType } from '../src/index.js'

describe('argument matrix (rulebook §4)', () => {
  it('equal arguments always draw', () => {
    for (const a of ARGUMENT_TYPES) expect(rpsOutcome(a, a)).toBe('draw')
  })

  it('is antisymmetric: a beats b ⇔ b loses to a', () => {
    for (const a of ARGUMENT_TYPES)
      for (const b of ARGUMENT_TYPES) {
        if (a === b) continue
        const ab = rpsOutcome(a, b)
        const ba = rpsOutcome(b, a)
        expect(ab === 'win' ? 'lose' : 'win').toBe(ba)
      }
  })

  it('dummy loses to every non-dummy argument and beats nothing', () => {
    for (const other of ['rock', 'paper', 'scissors'] as const) {
      expect(rpsOutcome('dummy', other)).toBe('lose')
      expect(rpsOutcome(other, 'dummy')).toBe('win')
    }
  })

  it('rock/paper/scissors each beat exactly two arguments and lose to exactly one', () => {
    for (const a of ['rock', 'paper', 'scissors'] as const) {
      const others = ARGUMENT_TYPES.filter((x): x is ArgumentType => x !== a)
      const wins = others.filter((b) => rpsOutcome(a, b) === 'win')
      const losses = others.filter((b) => rpsOutcome(a, b) === 'lose')
      expect(wins).toHaveLength(2)
      expect(losses).toHaveLength(1)
    }
  })
})

describe('decks (rulebook §7–§8)', () => {
  it('event deck has exactly 7 unique cards', () => {
    expect(EVENT_CARDS).toHaveLength(7)
    expect(new Set(EVENT_CARDS).size).toBe(7)
  })

  it('action deck has 15 cards: 6 unique blockers + 6 relocation + 3 change_values', () => {
    expect(ACTION_DECK_COMPOSITION).toHaveLength(15)
    const blockers = ACTION_DECK_COMPOSITION.filter((c) => c in BLOCK_CARD_LOCATION)
    expect(blockers).toHaveLength(6)
    expect(new Set(blockers).size).toBe(6)
    expect(ACTION_DECK_COMPOSITION.filter((c) => c === 'relocation')).toHaveLength(6)
    expect(ACTION_DECK_COMPOSITION.filter((c) => c === 'change_values')).toHaveLength(3)
  })

  it('every location has exactly one blocker card', () => {
    const blocked = Object.values(BLOCK_CARD_LOCATION)
    expect(new Set(blocked).size).toBe(LOCATIONS.length)
  })
})

describe('placement rules (rulebook §2–§3)', () => {
  it('matches the rulebook location table exactly', () => {
    expect(ALLOWED_LOCATIONS.politician).toEqual(['square', 'university'])
    expect(ALLOWED_LOCATIONS.scientist).toEqual(['university', 'theatre'])
    expect(ALLOWED_LOCATIONS.artist).toEqual(['square', 'theatre'])
    expect(ALLOWED_LOCATIONS.robot).toEqual(['factory', 'power_plant', 'dump'])
  })

  it('humans never enter robot locations and vice versa', () => {
    const robotLocations = new Set(ALLOWED_LOCATIONS.robot)
    for (const actor of ACTOR_TYPES.filter((a) => a !== 'robot'))
      for (const loc of ALLOWED_LOCATIONS[actor]) expect(robotLocations.has(loc)).toBe(false)
  })
})

describe('bets & game length', () => {
  it('bet costs map to the rulebook resources', () => {
    expect(BET_COST).toEqual({ win: 'product', lose: 'electricity', draw: 'recycling' })
  })

  it('a game lasts 5 turns', () => {
    expect(MAX_TURNS).toBe(5)
  })
})
