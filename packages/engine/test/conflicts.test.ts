// P4 conflict machine integration — spec §8.1, §8.2, §8.5, §8.6 (betless flows;
// the bet pipeline lands in step 1.4).

import { describe, expect, it } from 'vitest'
import { legalIntents, projectView, valuesOf } from '../src/index.js'
import type { SeatId } from '../src/index.js'
import type { TestGame } from './helpers.js'
import { customPlacements, newGame, passRefight, passSummary, resolveAll, toP4 } from './helpers.js'

function ackAll(
  g: TestGame,
  seats: SeatId[],
  which: 'conflict.reveal.ack' | 'conflict.result.ack'
): void {
  for (const seat of seats) g.apply(seat, { type: which })
}

describe('single conflict: artists duel (win/lose)', () => {
  it('runs open → reveal acks → reveal → outcomes → rewards → result acks → P5', () => {
    const g = newGame()
    toP4(g, {
      0: customPlacements(0, { artist: { argument: 'paper' } }),
      1: customPlacements(1, { artist: { locationId: 'theatre', argument: 'rock' } })
    })

    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error(`expected p4, got ${phase.kind}`)
    expect(phase.conflicts).toHaveLength(1)
    expect(phase.conflicts[0]).toMatchObject({ locationId: 'theatre', actorType: 'artist' })
    expect(phase.stage.t).toBe('reveal_ack')

    // arguments still hidden from the opponent before the reveal consensus
    const view1 = projectView(g.state, 1)
    const enemyArtist = view1.board.placements.find((p) => p.actorId === '0:artist')
    expect(enemyArtist?.argument).toBeUndefined()
    expect(legalIntents(g.state, 0)).toEqual([{ type: 'conflict.reveal.ack' }])

    g.apply(0, { type: 'conflict.reveal.ack' })
    expect(g.eventsOfType('conflict.revealed')).toHaveLength(0) // still waiting on seat 1
    const events = g.apply(1, { type: 'conflict.reveal.ack' })

    const revealed = events.find((e) => e.type === 'conflict.revealed')
    expect(revealed?.visibility).toBe('public')
    const round = events.find((e) => e.type === 'conflict.roundResolved')
    expect((round?.payload as { outcomes: Record<string, string> }).outcomes).toEqual({
      '0:artist': 'win',
      '1:artist': 'lose'
    })
    const rewards = events.find((e) => e.type === 'conflict.rewards')
    expect(rewards).toBeDefined()

    // now the opponent's argument is public
    const view1After = projectView(g.state, 1)
    expect(view1After.board.placements.find((p) => p.actorId === '0:artist')?.argument).toBe(
      'paper'
    )

    // rewards applied atomically: winner 1 art, loser nothing
    expect(valuesOf(g.state, 0).art).toBe(1)
    expect(valuesOf(g.state, 1).art).toBe(0)
    // peaceful actors of both seats still produced
    expect(valuesOf(g.state, 0).power).toBe(1)
    expect(valuesOf(g.state, 1).knowledge).toBe(1)

    ackAll(g, [0, 1], 'conflict.result.ack')
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
    expect(g.state.board.placements).toHaveLength(0) // actors returned home
  })
})

describe('draw settlement by actor type (§8.5, I-1)', () => {
  it('scientists draw: both take 1 knowledge, no re-fight', () => {
    const g = newGame()
    toP4(g, {
      0: customPlacements(0, { scientist: { argument: 'paper' } }),
      1: customPlacements(1, {
        scientist: { locationId: 'university', argument: 'paper' },
        politician: { locationId: 'square' } // keep politicians apart? no: square has pol0
      })
    })
    // politician collision was introduced intentionally? — no: verify conflict list
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    // resolve conflicts one by one with generic acks/choices until P5
    resolveAll(g)
    expect(valuesOf(g.state, 0).knowledge).toBe(1)
    expect(valuesOf(g.state, 1).knowledge).toBe(1)
  })

  it('artists draw: nobody creates art', () => {
    const g = newGame()
    toP4(g, {
      0: customPlacements(0, { artist: { argument: 'rock' } }),
      1: customPlacements(1, { artist: { locationId: 'theatre', argument: 'rock' } })
    })
    resolveAll(g)
    expect(valuesOf(g.state, 0).art).toBe(0)
    expect(valuesOf(g.state, 1).art).toBe(0)
  })

  it('robots draw: 1 location resource each', () => {
    const g = newGame()
    toP4(g, {
      0: customPlacements(0, { robot: { argument: 'dummy' } }),
      1: customPlacements(1, { robot: { locationId: 'factory', argument: 'dummy' } })
    })
    const productBefore0 = 1
    resolveAll(g)
    expect(g.state.inventories[0]?.resources.product).toBe(productBefore0 + 1)
    expect(g.state.inventories[1]?.resources.product).toBe(1 + 1)
  })
})

describe('politician re-fights (§8.6 stage 1)', () => {
  it('a politician draw replays with fresh sealed rock/paper/scissors until win/lose', () => {
    const g = newGame()
    toP4(g, {
      0: customPlacements(0, { politician: { argument: 'rock' } }),
      1: customPlacements(1, { politician: { locationId: 'square', argument: 'rock' } })
    })
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.conflicts[0]).toMatchObject({ locationId: 'square', actorType: 'politician' })

    ackAll(g, [0, 1], 'conflict.reveal.ack')
    // round 1 (arguments) drew → the review gate opens before the re-fight
    const afterReveal = g.state.phase
    if (afterReveal.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(afterReveal.stage.t).toBe('refight_ack')
    passRefight(g) // "Resolve Conflict Again" → the fresh rps opens
    expect(legalIntents(g.state, 0)).toEqual([
      { type: 'conflict.rps', choices: ['rock', 'paper', 'scissors'] }
    ])

    // replay branch: identical choices draw again
    g.apply(0, { type: 'conflict.rps', choice: 'rock' })
    const replay = g.apply(1, { type: 'conflict.rps', choice: 'rock' })
    expect(replay.some((e) => e.type === 'conflict.roundResolved')).toBe(true)
    const midPhase = g.state.phase
    if (midPhase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(midPhase.resolution?.politicianRefights).toBe(1)
    expect(midPhase.stage.t).toBe('refight_ack')
    // the resolved round's choices are now public — both seats see them in the view
    expect(midPhase.resolution?.revealedRps).toEqual({ 0: 'rock', 1: 'rock' })
    for (const seat of [0, 1] as SeatId[]) {
      const v = projectView(g.state, seat)
      if (v.phase.kind !== 'p4_conflict') throw new Error('expected p4 view')
      expect(v.phase.resolution?.revealedRps).toEqual({ 0: 'rock', 1: 'rock' })
    }

    // decisive round
    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'paper' })
    const final = g.apply(1, { type: 'conflict.rps', choice: 'rock' })
    const rewards = final.find((e) => e.type === 'conflict.rewards')
    expect(rewards).toBeDefined()
    const donePhase = g.state.phase
    if (donePhase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(donePhase.resolution?.revealedRps).toEqual({ 0: 'paper', 1: 'rock' })
    expect(valuesOf(g.state, 0).power).toBe(1)
    expect(valuesOf(g.state, 1).power).toBe(0)

    ackAll(g, [0, 1], 'conflict.result.ack')
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
  })

  it('rps deadline: the owner who chose wins the round, the misser auto-loses (user rule)', () => {
    const g = newGame()
    toP4(g, {
      0: customPlacements(0, { politician: { argument: 'rock' } }),
      1: customPlacements(1, { politician: { locationId: 'square', argument: 'rock' } })
    })
    ackAll(g, [0, 1], 'conflict.reveal.ack')
    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'rock' })
    const events = g.apply(1, { type: 'system.timeout', seat: 1 }) // missed → auto-lose
    expect(events.some((e) => e.type === 'conflict.choiceMissed')).toBe(true)
    expect(events.some((e) => e.type === 'conflict.rewards')).toBe(true)
    // Politician win at the square creates power for seat 0 only.
    expect(valuesOf(g.state, 0).power).toBe(1)
    expect(valuesOf(g.state, 1).power).toBe(0)
    ackAll(g, [0, 1], 'conflict.result.ack')
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
  })

  it('everyone misses the rps deadline → every actor loses, even politicians (user rule)', () => {
    const g = newGame()
    toP4(g, {
      0: customPlacements(0, { politician: { argument: 'rock' } }),
      1: customPlacements(1, { politician: { locationId: 'square', argument: 'rock' } })
    })
    ackAll(g, [0, 1], 'conflict.reveal.ack')
    passRefight(g)
    g.apply(0, { type: 'system.timeout', seat: 0 })
    g.apply(1, { type: 'system.timeout', seat: 1 })
    // No replay, no deadlock — both chose nothing, both lose, nobody creates power.
    expect(valuesOf(g.state, 0).power).toBe(0)
    expect(valuesOf(g.state, 1).power).toBe(0)
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('result_ack')
    ackAll(g, [0, 1], 'conflict.result.ack')
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
  })
})

describe('ffa3: multiple conflicts resolve strictly sequentially (§8.1)', () => {
  it('fixed order square→theatre→university; the next opens only after all result acks', () => {
    const g = newGame('ffa3-seed', 'ffa3')
    // square: pol0(R) vs pol2(P) → P wins; theatre: art0(P) vs art2(S) → S wins;
    // university: sci0(S), sci1(D), sci2(R) → TC-C4 → R wins.
    toP4(g, {
      0: customPlacements(0, {
        scientist: { locationId: 'university', argument: 'scissors' },
        politician: { locationId: 'square', argument: 'rock' },
        artist: { locationId: 'theatre', argument: 'paper' },
        robot: { locationId: 'factory' }
      }),
      1: customPlacements(1, {
        scientist: { locationId: 'university', argument: 'dummy' },
        politician: { locationId: 'university', argument: 'rock' },
        artist: { locationId: 'square', argument: 'paper' },
        robot: { locationId: 'power_plant' }
      }),
      2: customPlacements(2, {
        scientist: { locationId: 'university', argument: 'rock' },
        politician: { locationId: 'square', argument: 'paper' },
        artist: { locationId: 'theatre', argument: 'scissors' },
        robot: { locationId: 'dump' }
      })
    })

    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(
      phase.conflicts.map((c) => `${c.locationId}:${c.actorType}:${c.actorIds.length}`)
    ).toEqual(['square:politician:2', 'theatre:artist:2', 'university:scientist:3'])

    // conflict 1: politicians of seats 0 and 2; seat 1 is not involved
    expect(legalIntents(g.state, 1)).toEqual([])
    g.expectReject(1, { type: 'conflict.reveal.ack' }, 'not_participant')
    ackAll(g, [0, 2], 'conflict.reveal.ack')
    expect(valuesOf(g.state, 2).power).toBe(1) // pol2 paper beat pol0 rock
    ackAll(g, [0, 2], 'conflict.result.ack')

    // conflict 2 opened only now
    expect(g.eventsOfType('conflict.opened')).toHaveLength(2)
    ackAll(g, [0, 2], 'conflict.reveal.ack')
    expect(valuesOf(g.state, 2).art).toBe(1) // art2 scissors beat art0 paper
    ackAll(g, [0, 2], 'conflict.result.ack')

    // conflict 3: TC-C4 in vivo — dummy clear loser, rock beats scissors
    ackAll(g, [0, 1, 2], 'conflict.reveal.ack')
    expect(valuesOf(g.state, 2).knowledge).toBe(1)
    expect(valuesOf(g.state, 0).knowledge).toBe(0)
    expect(valuesOf(g.state, 1).knowledge).toBe(0)
    ackAll(g, [0, 1, 2], 'conflict.result.ack')

    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
    // peaceful actors: pol1@university +1 power, art1@square +1 art
    expect(valuesOf(g.state, 1)).toEqual({ power: 1, art: 1, knowledge: 0, fame: 0 })
    expect(valuesOf(g.state, 0)).toEqual({ power: 0, art: 0, knowledge: 0, fame: 0 })
    expect(valuesOf(g.state, 2)).toEqual({ power: 1, art: 1, knowledge: 1, fame: 0 })
  })

  it('TC-C5 in vivo: tied-win scientists both take knowledge, the beaten one nothing', () => {
    const g = newGame('ffa3-c5', 'ffa3')
    toP4(g, {
      0: customPlacements(0, {
        scientist: { locationId: 'university', argument: 'rock' },
        politician: { locationId: 'square', argument: 'paper' },
        artist: { locationId: 'theatre', argument: 'scissors' },
        robot: { locationId: 'factory' }
      }),
      1: customPlacements(1, {
        scientist: { locationId: 'university', argument: 'rock' },
        politician: { locationId: 'university', argument: 'scissors' },
        artist: { locationId: 'square', argument: 'paper' },
        robot: { locationId: 'power_plant' }
      }),
      2: customPlacements(2, {
        scientist: { locationId: 'university', argument: 'scissors' },
        politician: { locationId: 'square', argument: 'rock' },
        artist: { locationId: 'theatre', argument: 'paper' },
        robot: { locationId: 'dump' }
      })
    })
    resolveAll(g)
    // university scientists: R,R,S → seat2 loses; seats 0,1 tied-win → 1 knowledge each
    expect(valuesOf(g.state, 0).knowledge).toBe(1)
    expect(valuesOf(g.state, 1).knowledge).toBe(1)
    expect(valuesOf(g.state, 2).knowledge).toBe(0)
  })
})
