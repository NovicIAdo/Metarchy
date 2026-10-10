// The Phase 2 reveal beat (author, 2026-07-30): "я расставляю своих акторов, и
// потом сразу перепрыгивает на конфликт, и я не вижу куда бот расставил своих
// акторов. Надо чтобы после расстановки своих акторов показывало как оппоненты
// расставили своих."
//
// Before this, the last commit revealed the board and moved the turn on inside
// the same intent — so on Turn 1, which has no Action Phase, the player went
// from their own commit bar straight into the conflict arena and never saw the
// full board. The phase now holds on a consensus gate instead.

import { describe, expect, it } from 'vitest'
import { legalIntents } from '../src/index.js'
import type { P2State, SeatId } from '../src/index.js'
import { customPlacements, newGame, peacefulPlacements, playThroughP1 } from './helpers.js'

/** The P2 state, or a readable failure instead of a cast that hides the truth. */
function p2(state: { phase: { kind: string } }): P2State {
  if (state.phase.kind !== 'p2_distribution')
    throw new Error(`expected P2, got ${state.phase.kind}`)
  return state.phase as unknown as P2State
}

describe('Phase 2 reveal', () => {
  it('holds the phase once everyone has committed, instead of running on', () => {
    const g = newGame()
    g.apply(0, { type: 'distribution.commit', placements: peacefulPlacements(0) })
    // One seat left to commit: nothing is revealed yet.
    expect(p2(g.state).revealed).toBeUndefined()

    g.apply(1, { type: 'distribution.commit', placements: peacefulPlacements(1) })
    // It used to be in Phase 4 by now.
    expect(g.state.phase.kind).toBe('p2_distribution')
    expect(p2(g.state).revealed).toEqual({ acked: [] })
  })

  it('puts every Actor on the board, with Arguments and Bets still sealed', () => {
    const g = newGame()
    for (const seat of [0, 1] as SeatId[])
      g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })

    // The whole point: the opponent's Actors are visible, and where they stand.
    const theirs = g.state.board.placements.filter((p) => p.seat === 1)
    expect(theirs).toHaveLength(4)
    expect(theirs.map((p) => p.actorType).sort()).toEqual([
      'artist',
      'politician',
      'robot',
      'scientist'
    ])

    // What the OTHERS may see of it is the view's business; the reveal event
    // carries locations and actor types only, never arguments or bets.
    const revealed = g.log.find((e) => e.type === 'distribution.revealed')
    const payload = revealed?.payload as { placements: Record<string, unknown>[] }
    expect(payload.placements).toHaveLength(8)
    for (const p of payload.placements) {
      expect(p.locationId).toBeDefined()
      expect(p.argument).toBeUndefined()
      expect(p.bet).toBeUndefined()
    }
  })

  it('waits on every active seat and only then moves the turn on', () => {
    const g = newGame()
    for (const seat of [0, 1] as SeatId[])
      g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })

    expect(legalIntents(g.state, 0)).toEqual([{ type: 'distribution.reveal.ack' }])
    expect(legalIntents(g.state, 1)).toEqual([{ type: 'distribution.reveal.ack' }])

    g.apply(0, { type: 'distribution.reveal.ack' })
    expect(g.state.phase.kind).toBe('p2_distribution') // one seat is not consensus
    expect(legalIntents(g.state, 0)).toEqual([])

    g.apply(1, { type: 'distribution.reveal.ack' })
    // Turn 1 has no Action Phase, so the reveal hands straight to the Conflicts.
    expect(g.state.phase.kind).toBe('p4_conflict')
  })

  it('leads into Phase 3 on a later turn, not into the Conflicts', () => {
    const g = newGame()
    for (const seat of [0, 1] as SeatId[])
      g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })
    for (const seat of [0, 1] as SeatId[]) g.apply(seat, { type: 'distribution.reveal.ack' })
    for (const seat of [0, 1] as SeatId[]) g.apply(seat, { type: 'conflict.summary.ack' })
    for (const seat of [0, 1] as SeatId[]) g.apply(seat, { type: 'market.done' })

    expect(g.state.turn).toBe(2)
    playThroughP1(g)
    for (const seat of [0, 1] as SeatId[])
      g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })
    expect(p2(g.state).revealed).toEqual({ acked: [] })
    for (const seat of [0, 1] as SeatId[]) g.apply(seat, { type: 'distribution.reveal.ack' })
    expect(g.state.phase.kind).toBe('p3_action')
  })

  it('the deadline closes it for a seat that never answers', () => {
    const g = newGame()
    for (const seat of [0, 1] as SeatId[])
      g.apply(seat, {
        type: 'distribution.commit',
        placements: customPlacements(seat, {})
      })
    expect(p2(g.state).revealed).toBeDefined()

    g.apply(0, { type: 'system.timeout', seat: 0 })
    g.apply(1, { type: 'system.timeout', seat: 1 })
    expect(g.state.phase.kind).not.toBe('p2_distribution')
  })

  it('an eliminated seat is not waited on', () => {
    const g = newGame('test-seed', 'ffa3')
    for (const seat of [0, 1] as SeatId[])
      g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })
    // Seat 2 never commits and drops; the remaining two are all that is left.
    g.apply(2, { type: 'system.eliminate', seat: 2, reason: 'disconnect' })
    expect(p2(g.state).revealed).toBeDefined()

    g.apply(0, { type: 'distribution.reveal.ack' })
    g.apply(1, { type: 'distribution.reveal.ack' })
    expect(g.state.phase.kind).toBe('p4_conflict')
  })
})
