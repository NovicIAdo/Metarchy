// End of Phase 4, every turn: the recap (author request). Two things had to
// change together — Phase 4 may no longer be skipped when nothing is contested
// ("Фазу 4 необходимо показывать!"), and the phase now ends on a consensus gate
// that shows the whole turn's outcome: which Locations held a conflict, and what
// each Actor brought whom.

import { describe, expect, it } from 'vitest'
import { legalIntents } from '../src/index.js'
import type { P4State, SeatId } from '../src/index.js'
import {
  customPlacements,
  newGame,
  passReveal,
  peacefulPlacements,
  playThroughP1
} from './helpers.js'

/** The P4 state, or a readable failure instead of a cast that hides the truth. */
function p4(state: { phase: { kind: string } }): P4State {
  if (state.phase.kind !== 'p4_conflict') throw new Error(`expected P4, got ${state.phase.kind}`)
  return state.phase as unknown as P4State
}

describe('end-of-Phase-4 summary', () => {
  it('opens Phase 4 and stops on the recap even when nothing is contested', () => {
    const g = newGame()
    for (const seat of [0, 1] as SeatId[])
      g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })
    passReveal(g)

    // It used to fall straight through to the Market here, which left the table
    // with no idea what its turn had done.
    const phase = p4(g.state)
    expect(phase.stage.t).toBe('summary_ack')
    expect(phase.conflicts).toEqual([])

    // Eight lone Actors, each of whom collected: that IS the story of the turn.
    expect(phase.summary).toHaveLength(8)
    expect(phase.summary.every((e) => e.peaceful)).toBe(true)
    const robot = phase.summary.find((e) => e.actorType === 'robot')
    expect(robot?.results[0]?.reward).toEqual({ kind: 'resource', type: 'product', amount: 3 })
    const politician = phase.summary.find((e) => e.actorType === 'politician')
    expect(politician?.results[0]?.reward).toEqual({ kind: 'value', type: 'power', amount: 1 })
  })

  it('waits on every active seat, not just the ones that fought', () => {
    const g = newGame()
    for (const seat of [0, 1] as SeatId[])
      g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })
    passReveal(g)

    // Nobody was in a conflict, and yet both seats are offered the recap.
    expect(legalIntents(g.state, 0)).toEqual([{ type: 'conflict.summary.ack' }])
    expect(legalIntents(g.state, 1)).toEqual([{ type: 'conflict.summary.ack' }])

    g.apply(0, { type: 'conflict.summary.ack' })
    expect(g.state.phase.kind).toBe('p4_conflict') // one seat is not consensus
    expect(legalIntents(g.state, 0)).toEqual([])
    g.apply(1, { type: 'conflict.summary.ack' })
    expect(g.state.phase.kind).toBe('p5_market')
  })

  it('records the conflict that happened, with the winner and what it earned', () => {
    const g = newGame()
    // Both politicians to the Square: one conflict, rock beats scissors.
    g.apply(0, {
      type: 'distribution.commit',
      placements: customPlacements(0, { politician: { locationId: 'square', argument: 'rock' } })
    })
    g.apply(1, {
      type: 'distribution.commit',
      placements: customPlacements(1, {
        politician: { locationId: 'square', argument: 'scissors' }
      })
    })
    passReveal(g)
    for (const seat of [0, 1] as SeatId[]) g.apply(seat, { type: 'conflict.reveal.ack' })
    for (const seat of [0, 1] as SeatId[]) g.apply(seat, { type: 'conflict.result.ack' })

    const phase = p4(g.state)
    expect(phase.stage.t).toBe('summary_ack')
    const contested = phase.summary.filter((e) => !e.peaceful)
    expect(contested).toHaveLength(1)
    expect(contested[0]?.locationId).toBe('square')
    expect(contested[0]?.actorType).toBe('politician')
    const outcomes = contested[0]?.results.map((r) => [r.seat, r.outcome])
    expect(outcomes).toEqual([
      [0, 'win'],
      [1, 'lose']
    ])
    // The winner's Power, and nothing for the loser — the numbers the screen shows.
    expect(contested[0]?.results[0]?.reward).toEqual({
      kind: 'value',
      type: 'power',
      amount: 1
    })
    expect(contested[0]?.results[1]?.reward).toBeNull()
    // The peaceful Actors of the same turn are in the same recap.
    expect(phase.summary.filter((e) => e.peaceful).length).toBeGreaterThan(0)
  })

  it('is the only Phase 4 business on a later turn too, and survives into it', () => {
    const g = newGame()
    for (const seat of [0, 1] as SeatId[])
      g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })
    passReveal(g)
    for (const seat of [0, 1] as SeatId[]) g.apply(seat, { type: 'conflict.summary.ack' })
    for (const seat of [0, 1] as SeatId[]) g.apply(seat, { type: 'market.done' })

    // Turn 2: P1, then P2, then P3, and Phase 4 stops again.
    expect(g.state.turn).toBe(2)
    playThroughP1(g)
    for (const seat of [0, 1] as SeatId[])
      g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })
    passReveal(g)
    for (const seat of [0, 1] as SeatId[])
      g.apply(seat, { type: 'action.selectCards', cardInstanceIds: [] })
    const phase = p4(g.state)
    expect(phase.stage.t).toBe('summary_ack')
    // A fresh recap: last turn's entries are gone with last turn's phase.
    expect(phase.summary.every((e) => e.results.length > 0)).toBe(true)
  })

  it('the deadline closes it for a seat that never answers', () => {
    const g = newGame()
    for (const seat of [0, 1] as SeatId[])
      g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })
    passReveal(g)
    expect(p4(g.state).stage.t).toBe('summary_ack')

    // The server's 15-second gate arrives as system.timeout per silent seat.
    g.apply(0, { type: 'system.timeout', seat: 0 })
    g.apply(1, { type: 'system.timeout', seat: 1 })
    expect(g.state.phase.kind).toBe('p5_market')
  })
})
