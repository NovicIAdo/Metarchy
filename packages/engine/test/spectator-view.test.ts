import { describe, expect, it } from 'vitest'
import type { SeatId } from '../src/index.js'
import { projectSpectatorView } from '../src/index.js'
import {
  compareEventCount,
  customPlacements,
  findSeed,
  newGame,
  passReveal,
  peacefulPlacements,
  playPeacefulTurn,
  toP4
} from './helpers.js'

describe('projectSpectatorView — a watcher sees only public information', () => {
  it('during P2 shows who committed but never the sealed placements, and carries no hand', () => {
    const g = newGame()
    g.apply(0, { type: 'distribution.commit', placements: peacefulPlacements(0) })
    passReveal(g)

    const spec = projectSpectatorView(g.state)
    expect(spec.spectator).toBe(true)
    expect(spec.me.hand).toEqual([])
    // Sees the fact seat 0 committed, not the content — like a rival, not an ally.
    expect(spec.phase.kind).toBe('p2_distribution')
    if (spec.phase.kind === 'p2_distribution') {
      expect(spec.phase.committedSeats).toEqual([0])
      expect(spec.phase.sealed).toEqual([])
    }
    // Public roster: both seats listed; nothing on the board until P2 resolves.
    expect(spec.others.map((o) => o.seat).sort()).toEqual([0, 1])
    expect(spec.board.placements).toHaveLength(0)
  })

  it('keeps a contested argument sealed to a spectator until the conflict reveals', () => {
    const g = newGame()
    const p0 = customPlacements(0, { politician: { locationId: 'square', argument: 'rock' } })
    const p1 = customPlacements(1, { politician: { locationId: 'square', argument: 'paper' } })
    toP4(g, { 0: p0, 1: p1 })
    expect(g.state.phase.kind).toBe('p4_conflict')

    const squarePolis = (v: ReturnType<typeof projectSpectatorView>) =>
      v.board.placements.filter((p) => p.locationId === 'square' && p.actorType === 'politician')

    // At the reveal-ack gate the arguments are still hidden from a spectator.
    let spec = projectSpectatorView(g.state)
    expect(squarePolis(spec)).toHaveLength(2)
    for (const p of squarePolis(spec)) expect(p.argument).toBeUndefined()

    // Both duelists ack the reveal → arguments become public to the whole table,
    // spectators included (same instant the players see them — no early leak).
    for (const seat of [0, 1] as const) g.apply(seat, { type: 'conflict.reveal.ack' })
    spec = projectSpectatorView(g.state)
    for (const p of squarePolis(spec)) expect(p.argument).toBeDefined()
    expect(spec.me.hand).toEqual([])
    expect(spec.spectator).toBe(true)
  })

  it('during a discard event shows the card and who sealed, but no amount until the reveal', () => {
    // A watcher must never be able to whisper "he dumped three" into a live
    // game: progress is public, the numbers are not, until the engine opens them.
    const g = newGame(findSeed((st) => compareEventCount(st, 1) === 0))
    playPeacefulTurn(g) // turn 1 carries no event — turn 2 opens on the discard card
    const phase = g.state.phase
    if (phase.kind !== 'p1_event' || phase.stage.t !== 'discard_commit')
      throw new Error('expected a discard event')

    g.apply(0, { type: 'event.discard', amount: 1 })
    const mid = projectSpectatorView(g.state)
    expect(mid.phase.kind).toBe('p1_event')
    if (mid.phase.kind === 'p1_event' && mid.phase.stage.t === 'discard_commit') {
      // The card in play is public — that is the whole point of watching.
      expect(mid.phase.card).toBe(phase.card)
      expect(mid.phase.stage.committedSeats).toEqual([0])
      // …but nothing that could be relayed to the other player.
      expect(mid.phase.stage.myAmount).toBeNull()
      expect(mid.phase.stage.sealed).toEqual([])
      expect(JSON.stringify(mid.phase.stage)).not.toContain('"amount"')
    } else throw new Error('expected discard_commit for the watcher')

    // Everyone has sealed → the engine reveals, and only now does the watcher
    // see who discarded how much.
    g.apply(1, { type: 'event.discard', amount: 0 })
    const after = projectSpectatorView(g.state)
    if (after.phase.kind === 'p1_event' && after.phase.stage.t === 'discard_ack') {
      expect(after.phase.stage.revealed).toEqual({ 0: 1, 1: 0 })
      expect(after.phase.stage.winner).toBe(0)
    } else throw new Error('expected the discard reveal for the watcher')
  })

  it('during an event tie-break shows the throw count, and the throws only once settled', () => {
    // The tie-break is the part the author wants watchable — but a coin turns
    // over for the stands at the same instant it does for the players.
    const g = newGame(findSeed((st) => compareEventCount(st, 1) === 0))
    playPeacefulTurn(g)
    // Equal discards → the engine goes to a tie-break instead of a winner.
    g.apply(0, { type: 'event.discard', amount: 0 })
    g.apply(1, { type: 'event.discard', amount: 0 })
    const phase = g.state.phase
    if (phase.kind !== 'p1_event' || phase.stage.t !== 'discard_tiebreak')
      throw new Error('expected a tie-break on equal discards')

    g.apply(0, { type: 'tiebreak.rps', choice: 'rock' })
    const mid = projectSpectatorView(g.state)
    if (mid.phase.kind === 'p1_event' && mid.phase.stage.t === 'discard_tiebreak') {
      const tb = mid.phase.stage.tiebreak
      // Who has thrown is public; what they threw is not.
      expect(tb.chosen).toEqual([0])
      expect(tb.myChoice).toBeNull()
      expect(tb.revealed).toBeNull()
      expect(JSON.stringify(tb)).not.toContain('rock')
      // The stakes that led here are already open — they were revealed above.
      expect(mid.phase.stage.revealed).toEqual({ 0: 0, 1: 0 })
    } else throw new Error('expected discard_tiebreak for the watcher')

    // Both threw → the settled round is public to the stands as well.
    g.apply(1, { type: 'tiebreak.rps', choice: 'scissors' })
    const settled = projectSpectatorView(g.state)
    if (settled.phase.kind === 'p1_event' && settled.phase.stage.t === 'discard_ack') {
      const choices = settled.phase.stage.tiebreakChoices as Partial<Record<SeatId, string>>
      expect(choices[0 as SeatId]).toBe('rock')
      expect(choices[1 as SeatId]).toBe('scissors')
      expect(settled.phase.stage.winner).toBe(0)
    } else throw new Error('expected the tie-break result for the watcher')
  })
})
