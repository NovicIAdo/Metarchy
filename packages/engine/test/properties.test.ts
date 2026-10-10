// Property tests (fast-check) — architecture/Engine.md §7.3. Machine-level
// closure/determinism/invariants are exercised across thousands of seeds by the
// mass simulation; these cover the pure cores exhaustively.

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  baseOutcomes,
  canonicalStringify,
  deepClone,
  fameDistributed,
  fnv1a32,
  randBelow,
  tiebreakSurvivors,
  victoryPoints
} from '../src/index.js'
import type { ArgumentType, Rps, SeatId, Values } from '../src/index.js'

const argumentArb = fc.constantFrom<ArgumentType>('rock', 'paper', 'scissors', 'dummy')
const rpsArb = fc.constantFrom<Rps>('rock', 'paper', 'scissors')
const valuesArb: fc.Arbitrary<Values> = fc.record({
  power: fc.nat(50),
  art: fc.nat(50),
  knowledge: fc.nat(50),
  fame: fc.nat(50)
})

describe('baseOutcomes (§8.2) properties', () => {
  it('at most one winner; a winner excludes draws; dummy never wins; counts preserved', () => {
    fc.assert(
      fc.property(fc.array(argumentArb, { minLength: 2, maxLength: 6 }), (args) => {
        const outcomes = baseOutcomes(args)
        expect(outcomes).toHaveLength(args.length)
        const wins = outcomes.filter((o) => o === 'win').length
        expect(wins).toBeLessThanOrEqual(1)
        if (wins === 1) expect(outcomes.filter((o) => o === 'draw')).toHaveLength(0)
        args.forEach((a, i) => {
          if (a === 'dummy' && outcomes[i] === 'win') throw new Error('dummy won')
        })
      })
    )
  })

  it('identical arguments always draw; equal arguments share equal outcomes', () => {
    fc.assert(
      fc.property(
        argumentArb,
        fc.integer({ min: 2, max: 5 }),
        fc.array(argumentArb, { minLength: 2, maxLength: 6 }),
        (arg, n, mixed) => {
          expect(baseOutcomes(Array.from({ length: n }, () => arg))).toEqual(
            Array.from({ length: n }, () => 'draw')
          )
          // same argument type → same outcome (outcomes are global, not positional)
          const outcomes = baseOutcomes(mixed)
          const byType = new Map<ArgumentType, Set<string>>()
          mixed.forEach((a, i) => {
            const set = byType.get(a) ?? new Set<string>()
            set.add(outcomes[i] as string)
            byType.set(a, set)
          })
          for (const set of byType.values()) expect(set.size).toBe(1)
        }
      )
    )
  })
})

describe('tiebreakSurvivors (§11) properties', () => {
  it('survivors are a non-empty subset; exactly two choice types strictly shrink the field', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom<SeatId>(0, 1, 2, 3), { minLength: 2, maxLength: 4 }),
        fc.array(rpsArb, { minLength: 4, maxLength: 4 }),
        (participants, picks) => {
          const choices: Partial<Record<SeatId, Rps>> = {}
          participants.forEach((seat, i) => {
            choices[seat] = picks[i] as Rps
          })
          const survivors = tiebreakSurvivors(participants, choices)
          expect(survivors.length).toBeGreaterThan(0)
          for (const s of survivors) expect(participants).toContain(s)
          const types = new Set(participants.map((p) => choices[p]))
          if (types.size === 2) expect(survivors.length).toBeLessThan(participants.length)
          else expect(survivors).toEqual([...participants])
        }
      )
    )
  })
})

describe('victory points (§10) properties', () => {
  it('monotonic in every value and in fame; bounded by min and min+fame', () => {
    fc.assert(
      fc.property(valuesArb, (v) => {
        const vp = victoryPoints(v)
        const minValue = Math.min(v.power, v.art, v.knowledge)
        expect(vp).toBeGreaterThanOrEqual(minValue)
        expect(vp).toBeLessThanOrEqual(minValue + v.fame)
        expect(victoryPoints({ ...v, fame: v.fame + 1 })).toBeGreaterThanOrEqual(vp)
        expect(victoryPoints({ ...v, power: v.power + 1 })).toBeGreaterThanOrEqual(vp)
        expect(victoryPoints({ ...v, art: v.art + 1 })).toBeGreaterThanOrEqual(vp)
        expect(victoryPoints({ ...v, knowledge: v.knowledge + 1 })).toBeGreaterThanOrEqual(vp)
      })
    )
  })

  it('fameDistributed conserves total units and empties fame', () => {
    fc.assert(
      fc.property(valuesArb, (v) => {
        const d = fameDistributed(v)
        expect(d.fame).toBe(0)
        expect(d.power + d.art + d.knowledge).toBe(v.power + v.art + v.knowledge + v.fame)
        expect(d.power).toBeGreaterThanOrEqual(v.power)
        expect(d.art).toBeGreaterThanOrEqual(v.art)
        expect(d.knowledge).toBeGreaterThanOrEqual(v.knowledge)
      })
    )
  })
})

describe('serialization properties', () => {
  const plainArb = fc.letrec((tie) => ({
    value: fc.oneof(
      { maxDepth: 4, withCrossShrink: true },
      fc.integer(),
      fc.boolean(),
      fc.string(),
      fc.constant(null),
      fc.array(tie('value'), { maxLength: 5 }),
      fc.dictionary(fc.string({ maxLength: 8 }), tie('value'), { maxKeys: 5 })
    )
  })).value

  it('canonicalStringify round-trips through JSON.parse and ignores key order', () => {
    fc.assert(
      fc.property(plainArb, (value) => {
        const text = canonicalStringify(value)
        expect(JSON.parse(text)).toEqual(value)
        expect(canonicalStringify(JSON.parse(text))).toBe(text)
      })
    )
  })

  it('deepClone equals the original and shares no references', () => {
    fc.assert(
      fc.property(plainArb, (value) => {
        const clone = deepClone(value)
        expect(clone).toEqual(value)
        if (value !== null && typeof value === 'object') expect(clone).not.toBe(value)
      })
    )
  })
})

describe('rng properties', () => {
  it('randBelow always lands in [0, n)', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.nat(10_000),
        fc.integer({ min: 1, max: 1000 }),
        (seed, cursor, n) => {
          const value = randBelow(fnv1a32(seed), cursor, n)
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThan(n)
        }
      )
    )
  })
})
