// Normative fixtures TC-C1..C6 (spec §15 ← rulebook §Conflict Resolution examples)
// plus exhaustive small cases for the §8.2 outcome function.

import { describe, expect, it } from 'vitest'
import { baseOutcomes } from '../src/index.js'
import type { ArgumentType, Outcome } from '../src/index.js'

function outcomes(...args: ArgumentType[]): Outcome[] {
  return baseOutcomes(args)
}

describe('§8.2 outcome function — rulebook fixtures', () => {
  it('TC-C1: rock / scissors / paper → circular, every actor draws', () => {
    expect(outcomes('rock', 'scissors', 'paper')).toEqual(['draw', 'draw', 'draw'])
  })

  it('TC-C2: rock / rock / rock → every actor draws', () => {
    expect(outcomes('rock', 'rock', 'rock')).toEqual(['draw', 'draw', 'draw'])
  })

  it('TC-C3: paper, paper vs scissors → scissors wins alone, papers lose', () => {
    expect(outcomes('paper', 'paper', 'scissors')).toEqual(['lose', 'lose', 'win'])
  })

  it('TC-C4: scissors, dummy, rock → dummy clear loser, rock beats scissors', () => {
    expect(outcomes('scissors', 'dummy', 'rock')).toEqual(['lose', 'lose', 'win'])
  })

  it('TC-C5: rock, rock vs scissors → scissors loses; rocks are tied winners (draw among themselves, per I-1)', () => {
    expect(outcomes('rock', 'rock', 'scissors')).toEqual(['draw', 'draw', 'lose'])
  })

  it('TC-C6: dummy / dummy / dummy → every actor draws', () => {
    expect(outcomes('dummy', 'dummy', 'dummy')).toEqual(['draw', 'draw', 'draw'])
  })
})

describe('§8.2 outcome function — two participants (rulebook §4 matrix)', () => {
  it('standard RPS pairs', () => {
    expect(outcomes('rock', 'scissors')).toEqual(['win', 'lose'])
    expect(outcomes('paper', 'rock')).toEqual(['win', 'lose'])
    expect(outcomes('scissors', 'paper')).toEqual(['win', 'lose'])
  })

  it('dummy loses to everything, draws only with dummy', () => {
    expect(outcomes('dummy', 'rock')).toEqual(['lose', 'win'])
    expect(outcomes('paper', 'dummy')).toEqual(['win', 'lose'])
    expect(outcomes('dummy', 'dummy')).toEqual(['draw', 'draw'])
  })

  it('same argument draws', () => {
    expect(outcomes('rock', 'rock')).toEqual(['draw', 'draw'])
  })
})

describe('§8.2 outcome function — four participants (2v2 conflicts)', () => {
  it('all four types: dummy loses, R/P/S circular draw', () => {
    expect(outcomes('rock', 'paper', 'scissors', 'dummy')).toEqual(['draw', 'draw', 'draw', 'lose'])
  })

  it('two rocks + scissors + dummy: rocks tied-win, others lose', () => {
    expect(outcomes('rock', 'rock', 'scissors', 'dummy')).toEqual(['draw', 'draw', 'lose', 'lose'])
  })

  it('two dummies + rock: rock wins alone', () => {
    expect(outcomes('dummy', 'dummy', 'rock')).toEqual(['lose', 'lose', 'win'])
  })

  it('two paper + two rock: papers tied-win, rocks lose', () => {
    expect(outcomes('paper', 'rock', 'paper', 'rock')).toEqual(['draw', 'lose', 'draw', 'lose'])
  })

  it('rejects fewer than 2 participants', () => {
    expect(() => outcomes('rock')).toThrow()
  })
})
