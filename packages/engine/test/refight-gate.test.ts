// Issue 3: a re-fight must pause at a review gate (refight_ack) so players see
// the round that forced it — its throws and bet verdicts — before choosing
// again. Previously the engine flashed straight into the next rps.

import { describe, expect, it } from 'vitest'
import { projectView, waitingOn } from '../src/index.js'
import { customPlacements, newGame, toP4 } from './helpers.js'

describe('conflict re-fight review gate (issue 3)', () => {
  it('a successful lose bet holds at refight_ack with the round on show, then opens rps on consensus', () => {
    const g = newGame() // 1v1: both artists at the theatre; P0 paper+win beats P1 rock+lose.
    toP4(g, {
      0: customPlacements(0, { artist: { argument: 'paper', bet: 'win' } }),
      1: customPlacements(1, { artist: { locationId: 'theatre', argument: 'rock', bet: 'lose' } })
    })
    g.apply(0, { type: 'conflict.reveal.ack' })
    g.apply(1, { type: 'conflict.reveal.ack' })

    // The lose bet fired → a re-fight is due, but the game holds at the gate
    // instead of flashing into the next rps.
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('refight_ack')
    // Both involved players must press "Resolve Conflict Again".
    expect(waitingOn(g.state).slice().sort()).toEqual([0, 1])

    // The projected view carries the round that forced it: the placed arguments
    // (public after reveal) and the bet verdicts.
    const v = projectView(g.state, 1)
    if (v.phase.kind !== 'p4_conflict') throw new Error('expected p4 view')
    expect(v.phase.stage.t).toBe('refight_ack')
    expect(v.phase.resolution?.betResults).toEqual([
      expect.objectContaining({ seat: 0, bet: 'win', success: true }),
      expect.objectContaining({ seat: 1, bet: 'lose', success: true })
    ])
    const artistArg = (seat: number): string | undefined =>
      v.board.placements.find((p) => p.actorType === 'artist' && p.seat === seat)?.argument
    expect(artistArg(0)).toBe('paper')
    expect(artistArg(1)).toBe('rock')

    // One ack isn't enough — consensus opens the fresh rps round.
    g.apply(0, { type: 'conflict.refight.ack' })
    expect((g.state.phase as { stage: { t: string } }).stage.t).toBe('refight_ack')
    g.apply(1, { type: 'conflict.refight.ack' })
    expect((g.state.phase as { stage: { t: string } }).stage.t).toBe('rps')
  })
})
