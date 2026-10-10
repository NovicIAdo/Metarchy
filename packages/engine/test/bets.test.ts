// Bet pipeline fixtures TC-B1..B8 (spec §15 ← rulebook §Applying of Bets Rules)
// and the politician deadlock 10+10 (§8.6).
//
// Note on TC-B1..B3 argument labels: the rulebook examples say "P1 with Rock ...
// Outcome: P1 Win" against Paper, which contradicts the rulebook's own argument
// matrix (Rock loses to Paper). The matrix is normative; the examples' point is
// the bet mechanics. These fixtures give P1 the genuinely winning argument (paper
// vs rock) and reproduce the examples' bet behavior exactly.

import { describe, expect, it } from 'vitest'
import { POLITICIAN_DEADLOCK_ACTOR_ROUNDS, valuesOf } from '../src/index.js'
import type { PlacementInput, SeatId } from '../src/index.js'
import type { TestGame } from './helpers.js'
import { customPlacements, newGame, passRefight, toP4 } from './helpers.js'

/** 1v1 setup with a single conflict of `actorType`; P1 has the winning argument. */
function duel(
  actorType: 'politician' | 'scientist' | 'artist' | 'robot',
  p0: { argument: PlacementInput['argument']; bet?: PlacementInput['bet'] },
  p1: { argument: PlacementInput['argument']; bet?: PlacementInput['bet'] }
): TestGame {
  const g = newGame()
  const location = {
    politician: 'square',
    scientist: 'university',
    artist: 'theatre',
    robot: 'factory'
  }[actorType] as 'square' | 'university' | 'theatre' | 'factory'
  toP4(g, {
    0: customPlacements(0, {
      [actorType]: { argument: p0.argument, ...(p0.bet ? { bet: p0.bet } : {}) }
    }),
    1: customPlacements(1, {
      [actorType]: {
        locationId: location,
        argument: p1.argument,
        ...(p1.bet ? { bet: p1.bet } : {})
      }
    })
  })
  g.apply(0, { type: 'conflict.reveal.ack' })
  g.apply(1, { type: 'conflict.reveal.ack' })
  return g
}

function finish(g: TestGame): void {
  g.apply(0, { type: 'conflict.result.ack' })
  g.apply(1, { type: 'conflict.result.ack' })
}

describe('TC-B1: artists, win bet vs lose bet', () => {
  const setup = (): TestGame =>
    duel('artist', { argument: 'paper', bet: 'win' }, { argument: 'rock', bet: 'lose' })

  it('P1 wins the re-resolution → 2 art, P2 nothing', () => {
    const g = setup()
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('refight_ack') // successful lose bet forces a re-resolution
    // Both bets judged against the round-1 base and recorded for the views.
    expect(phase.resolution?.betResults).toEqual([
      expect.objectContaining({ seat: 0, bet: 'win', success: true }),
      expect.objectContaining({ seat: 1, bet: 'lose', success: true })
    ])
    expect(valuesOf(g.state, 0).art).toBe(0) // round-1 base rewards cancelled, nothing yet
    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'paper' })
    g.apply(1, { type: 'conflict.rps', choice: 'rock' })
    finish(g)
    expect(valuesOf(g.state, 0).art).toBe(2) // 1 base win + 1 persistent win-bet bonus
    expect(valuesOf(g.state, 1).art).toBe(0)
  })

  it('P2 wins the re-resolution → 1 art each (P1 keeps the bonus, I-2)', () => {
    const g = setup()
    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'rock' })
    g.apply(1, { type: 'conflict.rps', choice: 'paper' })
    finish(g)
    expect(valuesOf(g.state, 0).art).toBe(1) // 0 base + 1 bonus
    expect(valuesOf(g.state, 1).art).toBe(1) // base win
  })

  it('re-resolution draws → artists create nothing; P1 keeps only the bonus', () => {
    const g = setup()
    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'rock' })
    g.apply(1, { type: 'conflict.rps', choice: 'rock' })
    finish(g)
    expect(valuesOf(g.state, 0).art).toBe(1)
    expect(valuesOf(g.state, 1).art).toBe(0)
  })
})

describe('TC-B2: scientists, win bet vs lose bet', () => {
  it('re-resolution draws → both take knowledge, bettor 2 vs 1', () => {
    const g = duel(
      'scientist',
      { argument: 'paper', bet: 'win' },
      { argument: 'rock', bet: 'lose' }
    )
    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'scissors' })
    g.apply(1, { type: 'conflict.rps', choice: 'scissors' })
    finish(g)
    expect(valuesOf(g.state, 0).knowledge).toBe(2) // 1 draw + 1 bonus
    expect(valuesOf(g.state, 1).knowledge).toBe(1) // draw
  })
})

describe('TC-B3: politicians, win bet vs lose bet', () => {
  it('re-resolution draw replays until a winner; bonus persists', () => {
    const g = duel(
      'politician',
      { argument: 'paper', bet: 'win' },
      { argument: 'rock', bet: 'lose' }
    )
    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'rock' })
    g.apply(1, { type: 'conflict.rps', choice: 'rock' }) // draw → politicians replay
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('refight_ack')
    expect(phase.resolution?.politicianRefights).toBe(1)
    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'rock' })
    g.apply(1, { type: 'conflict.rps', choice: 'paper' }) // P2 wins
    finish(g)
    expect(valuesOf(g.state, 0).power).toBe(1) // 0 base + 1 bonus
    expect(valuesOf(g.state, 1).power).toBe(1)
  })
})

describe('TC-B4: robots, draw bet vs draw bet', () => {
  const setup = (): TestGame =>
    duel('robot', { argument: 'dummy', bet: 'draw' }, { argument: 'dummy', bet: 'draw' })

  it('both convert to win → re-resolution without bets decides the 3 resources', () => {
    const g = setup()
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('refight_ack')
    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'paper' })
    g.apply(1, { type: 'conflict.rps', choice: 'rock' })
    finish(g)
    expect(g.state.inventories[0]?.resources.product).toBe(1 + 3)
    expect(g.state.inventories[1]?.resources.product).toBe(1)
    // draw-bet costs burned
    expect(g.state.inventories[0]?.resources.recycling).toBe(0)
    expect(g.state.inventories[1]?.resources.recycling).toBe(0)
  })

  it('re-resolution draws → robots take 1 each (actor draw rule)', () => {
    const g = setup()
    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'rock' })
    g.apply(1, { type: 'conflict.rps', choice: 'rock' })
    finish(g)
    expect(g.state.inventories[0]?.resources.product).toBe(2)
    expect(g.state.inventories[1]?.resources.product).toBe(2)
  })
})

describe('TC-B5: robot vs robot, lose bet forces a fresh fight', () => {
  it('round-1 winner loses its 3 resources; the re-resolution decides everything', () => {
    const g = duel('robot', { argument: 'rock' }, { argument: 'dummy', bet: 'lose' })
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('refight_ack') // base rewards cancelled, new round
    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'rock' })
    g.apply(1, { type: 'conflict.rps', choice: 'paper' })
    finish(g)
    expect(g.state.inventories[0]?.resources.product).toBe(1) // round-1 win cancelled
    expect(g.state.inventories[1]?.resources.product).toBe(1 + 3)
  })
})

// --- 3-player fixtures: the target conflict is square-politician (first in order) ---

function ffa3Politicians(
  args: [PlacementInput['argument'], PlacementInput['argument'], PlacementInput['argument']],
  bets: [PlacementInput['bet']?, PlacementInput['bet']?, PlacementInput['bet']?]
): TestGame {
  const g = newGame('tcb-ffa3', 'ffa3')
  toP4(g, {
    0: customPlacements(0, {
      politician: { locationId: 'square', argument: args[0], ...(bets[0] ? { bet: bets[0] } : {}) },
      scientist: { locationId: 'university' },
      artist: { locationId: 'theatre' },
      robot: { locationId: 'factory' }
    }),
    1: customPlacements(1, {
      politician: { locationId: 'square', argument: args[1], ...(bets[1] ? { bet: bets[1] } : {}) },
      scientist: { locationId: 'theatre' },
      artist: { locationId: 'square' },
      robot: { locationId: 'power_plant' }
    }),
    2: customPlacements(2, {
      politician: { locationId: 'square', argument: args[2], ...(bets[2] ? { bet: bets[2] } : {}) },
      scientist: { locationId: 'university' },
      artist: { locationId: 'theatre' },
      robot: { locationId: 'dump' }
    })
  })
  for (const seat of [0, 1, 2] as SeatId[]) g.apply(seat, { type: 'conflict.reveal.ack' })
  return g
}

describe('TC-B6: rock, scissors, dummy+losebet — betless loser leaves with nothing', () => {
  it('re-resolution runs between the bettor and the round-1 winner only', () => {
    const g = ffa3Politicians(['rock', 'scissors', 'dummy'], [undefined, undefined, 'lose'])
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('refight_ack')
    expect(phase.resolution?.active.sort()).toEqual(['0:politician', '2:politician'])
    passRefight(g)
    // seat 1 (scissors, no bet) is out — it has no move to make
    g.expectReject(1, { type: 'conflict.rps', choice: 'rock' }, 'not_participant')
    g.apply(0, { type: 'conflict.rps', choice: 'paper' })
    g.apply(2, { type: 'conflict.rps', choice: 'rock' })
    for (const seat of [0, 1, 2] as SeatId[]) g.apply(seat, { type: 'conflict.result.ack' })
    expect(valuesOf(g.state, 0).power).toBe(1)
    expect(valuesOf(g.state, 1).power).toBe(0)
    expect(valuesOf(g.state, 2).power).toBe(0)
  })
})

describe('TC-B7: rock vs two dummies with draw bets — bets fail against the field', () => {
  it('global outcomes beat pairwise ones: dummies lose, rock wins alone', () => {
    const g = ffa3Politicians(['rock', 'dummy', 'dummy'], [undefined, 'draw', 'draw'])
    // no re-resolution: rewards apply straight away
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('result_ack')
    expect(valuesOf(g.state, 0).power).toBe(1)
    expect(valuesOf(g.state, 1).power).toBe(0)
    expect(valuesOf(g.state, 2).power).toBe(0)
    // failed draw bets still burned their recycling (seat 2's dump robot then
    // peacefully produced +3 recycling on top of the burned bet: 1 - 1 + 3)
    expect(g.state.inventories[1]?.resources.recycling).toBe(0)
    expect(g.state.inventories[2]?.resources.recycling).toBe(3)
  })
})

describe('TC-B8: paper, rock+losebet, rock — only the bettor returns to fight', () => {
  it('the betless rock is eliminated; re-resolution between paper and the bettor', () => {
    const g = ffa3Politicians(['paper', 'rock', 'rock'], [undefined, 'lose', undefined])
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('refight_ack')
    expect(phase.resolution?.active.sort()).toEqual(['0:politician', '1:politician'])
    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'rock' })
    g.apply(1, { type: 'conflict.rps', choice: 'paper' }) // the bettor turns it around
    for (const seat of [0, 1, 2] as SeatId[]) g.apply(seat, { type: 'conflict.result.ack' })
    expect(valuesOf(g.state, 0).power).toBe(0)
    expect(valuesOf(g.state, 1).power).toBe(1)
    expect(valuesOf(g.state, 2).power).toBe(0)
  })
})

describe('draw bet on a politician pair cancels the re-fight (spec §8.3)', () => {
  it('bettor converts to win, the other politician is denied', () => {
    const g = duel('politician', { argument: 'rock', bet: 'draw' }, { argument: 'rock' })
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('result_ack') // no rps round at all
    expect(phase.resolution?.betResults).toEqual([
      expect.objectContaining({ seat: 0, bet: 'draw', success: true })
    ])
    finish(g)
    expect(valuesOf(g.state, 0).power).toBe(1)
    expect(valuesOf(g.state, 1).power).toBe(0)
  })
})

describe('draw bet among tied artists (spec §8.3.1)', () => {
  it('bettor converts the tie to a base win → 1 art; the betless artist is denied', () => {
    const g = duel('artist', { argument: 'rock', bet: 'draw' }, { argument: 'rock' })
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('result_ack') // single conversion — no re-resolution
    expect(phase.resolution?.betResults).toEqual([
      expect.objectContaining({ seat: 0, bet: 'draw', success: true })
    ])
    expect(phase.resolution?.outcomes).toEqual({ '0:artist': 'win', '1:artist': 'lose' })
    finish(g)
    expect(valuesOf(g.state, 0).art).toBe(1) // base win only — no win-bet bonus
    expect(valuesOf(g.state, 1).art).toBe(0)
  })
})

describe('politician deadlock (§8.6): 10 actor rounds + 10 player rounds', () => {
  function drawnRounds(g: TestGame, count: number, intent: 'conflict.rps' | 'tiebreak.rps'): void {
    for (let i = 0; i < count; i++) {
      if (intent === 'conflict.rps') passRefight(g) // review gate before each re-fight
      g.apply(0, { type: intent, choice: 'rock' })
      g.apply(1, { type: intent, choice: 'rock' })
    }
  }

  it('10 drawn re-fights escalate to a player-level tie-break; its winner takes power', () => {
    const g = duel('politician', { argument: 'rock' }, { argument: 'rock' })
    drawnRounds(g, POLITICIAN_DEADLOCK_ACTOR_ROUNDS, 'conflict.rps')
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('deadlock_tiebreak')
    expect(phase.resolution?.politicianRefights).toBe(10)
    g.apply(0, { type: 'tiebreak.rps', choice: 'paper' })
    g.apply(1, { type: 'tiebreak.rps', choice: 'rock' })
    finish(g)
    expect(valuesOf(g.state, 0).power).toBe(1)
    expect(valuesOf(g.state, 1).power).toBe(0)
  })

  it('10 more drawn player rounds → everyone loses, nobody creates power', () => {
    const g = duel('politician', { argument: 'rock' }, { argument: 'rock' })
    drawnRounds(g, 10, 'conflict.rps')
    drawnRounds(g, 10, 'tiebreak.rps')
    expect(g.eventsOfType('conflict.deadlock')).toHaveLength(1)
    finish(g)
    expect(valuesOf(g.state, 0).power).toBe(0)
    expect(valuesOf(g.state, 1).power).toBe(0)
  })

  it('I-2: a successful round-1 win bet still pays +1 power through the all-lose deadlock', () => {
    const g = duel(
      'politician',
      { argument: 'paper', bet: 'win' },
      { argument: 'rock', bet: 'lose' }
    )
    drawnRounds(g, 10, 'conflict.rps') // lose-bet re-resolution deadlocks
    drawnRounds(g, 10, 'tiebreak.rps')
    finish(g)
    expect(valuesOf(g.state, 0).power).toBe(1) // 0 base + 1 persistent bonus
    expect(valuesOf(g.state, 1).power).toBe(0)
  })
})
