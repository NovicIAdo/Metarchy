// Dedicated scenario tests from spec §15: scoring fixtures TC-V1..V5, deck
// depletion, the recursive tie-breaker deep past turn 5, and elimination
// asset-removal / consensus recomputation (§12).

import { describe, expect, it } from 'vitest'
import { eventKind, legalIntents, valuesOf, victoryPoints } from '../src/index.js'
import type { GameState, PlacementInput, SeatId } from '../src/index.js'
import {
  customPlacements,
  findSeed,
  newGame,
  passRefight,
  passReveal,
  passSummary,
  peacefulPlacements,
  playPeacefulTurn,
  playThroughP1,
  resolveAll,
  selectNoCards,
  TestGame,
  toP4
} from './helpers.js'

describe('scoring fixtures TC-V1..V5 (spec §10, §15)', () => {
  const vp = (power: number, art: number, knowledge: number, fame: number): number =>
    victoryPoints({ power, art, knowledge, fame })

  it('TC-V1: (5,2,4)+0 fame → 2', () => expect(vp(5, 2, 4, 0)).toBe(2))
  it('TC-V2: (5,2,4)+2 fame → 4', () => expect(vp(5, 2, 4, 2)).toBe(4))
  it('TC-V3: (3,1,2)+3 fame → 3', () => expect(vp(3, 1, 2, 3)).toBe(3))
  it('TC-V4: (1,1,1)+9 fame → 4', () => expect(vp(1, 1, 1, 9)).toBe(4))
  it('TC-V5: (10,0,8)+3 fame → 3', () => expect(vp(10, 0, 8, 3)).toBe(3))
})

describe('action deck depletion (rulebook §7)', () => {
  function drainActionDeck(state: GameState): void {
    state.actionDeck = []
    state.cardsDrawn = 15
  }

  it('market "buy" becomes unavailable and is rejected', () => {
    const g = newGame()
    g.apply(0, { type: 'distribution.commit', placements: peacefulPlacements(0) })
    g.apply(1, { type: 'distribution.commit', placements: peacefulPlacements(1) })
    passReveal(g)
    // Turn 1 has no P3 (rulebook §Turn Structure) and the board is peaceful.
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
    drainActionDeck(g.state)
    expect(legalIntents(g.state, 0)).toEqual([{ type: 'market.done' }])
    g.expectReject(0, { type: 'market.buy' }, 'deck_empty')
  })

  it('a discard-event winner receives nothing; discarded resources are gone regardless', () => {
    const seed = findSeed((s) => eventKind(s.eventDeck[0] as never) === 'discard')
    const g = new TestGame(newGame(seed).state)
    playPeacefulTurn(g)
    expect(g.state.phase.kind).toBe('p1_event')
    drainActionDeck(g.state)
    g.apply(0, { type: 'event.discard', amount: 1 })
    const reveal = g.apply(1, { type: 'event.discard', amount: 0 })
    const resolved = reveal.find((e) => e.type === 'event.resolved')
    expect(resolved?.payload).toMatchObject({ winner: 0, drewCard: false })
    expect(reveal.some((e) => e.type === 'event.cardAwarded')).toBe(false)
    expect(g.state.inventories[0]?.hand).toHaveLength(0)
  })
})

describe('event deck depletion + recursive tie-breaker (spec §3, §10)', () => {
  it('symmetric play ties through turns 5–8; turn 9+ skips P1 with event.deckEmpty', () => {
    const g = newGame('deep-tie')
    // keep fame balanced so VP stays tied at every scoring
    const pickBalanced = (participants: SeatId[]): SeatId => {
      const byFame = [...participants].sort(
        (a, b) => (valuesOf(g.state, a).fame ?? 0) - (valuesOf(g.state, b).fame ?? 0) || a - b
      )
      return byFame[0] as SeatId
    }
    while (g.state.turn < 9) playPeacefulTurn(g, pickBalanced)

    expect(g.state.turn).toBe(9)
    expect(g.state.isTieBreakerTurn).toBe(true)
    expect(g.state.eventDeck).toHaveLength(0)
    expect(g.eventsOfType('event.deckEmpty')).toHaveLength(1)
    expect(g.state.phase.kind).toBe('p2_distribution') // P1 skipped
    // scorings happened at turns 5..8, all tied, nobody eliminated
    expect(g.eventsOfType('scoring.result')).toHaveLength(4)
    expect(g.state.eliminated).toEqual([])

    playPeacefulTurn(g) // turn 9 also ties (fame frozen, values symmetric)
    expect(g.state.turn).toBe(10)
    expect(g.eventsOfType('event.deckEmpty')).toHaveLength(2)

    g.apply(1, { type: 'system.eliminate', seat: 1, reason: 'forfeit' })
    const phase = g.state.phase
    if (phase.kind !== 'finished') throw new Error('expected finished')
    expect(phase.winnerSeats).toEqual([0])
  })
})

describe('elimination (§12): consensus recomputation and asset removal', () => {
  it('mid-P2: the missing commit is no longer awaited; assets leave the game', () => {
    const g = newGame('ffa3-elim', 'ffa3')
    const placements: Record<number, PlacementInput[]> = {
      0: customPlacements(0, { robot: { locationId: 'factory' } }),
      1: customPlacements(1, {
        politician: { locationId: 'university' },
        scientist: { locationId: 'theatre' },
        artist: { locationId: 'square' },
        robot: { locationId: 'power_plant' }
      })
    }
    g.apply(0, { type: 'distribution.commit', placements: placements[0] as PlacementInput[] })
    g.apply(1, { type: 'distribution.commit', placements: placements[1] as PlacementInput[] })
    // seat 2 never commits — it disconnects; the reveal must fire for the other two
    const events = g.apply(2, { type: 'system.eliminate', seat: 2, reason: 'disconnect' })
    const revealed = events.find((e) => e.type === 'distribution.revealed')
    expect(revealed).toBeDefined()
    // The reveal now HOLDS the phase until the two survivors have looked; then
    // turn 1 goes straight to P4 (rulebook: no Action Phase) and the peaceful
    // board lands the turn in the Market after its recap. The eight surviving
    // actors are read off the reveal rather than off the board, which P4 clears.
    passReveal(g)
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
    expect(g.state.activeSeats).toEqual([0, 1])
    expect((revealed?.payload as { placements: unknown[] }).placements).toHaveLength(8)
    expect(g.state.inventories[2]?.resources).toEqual({
      product: 0,
      electricity: 0,
      recycling: 0
    })
    expect(valuesOf(g.state, 2)).toEqual({ power: 0, art: 0, knowledge: 0, fame: 0 })
  })

  it('mid-conflict rps: the leaver’s actor drops out; later conflicts shrink to trivial wins', () => {
    const g = newGame('ffa3-rps-elim', 'ffa3')
    // square: three politicians, all rock → draw → re-fight among 3
    // university: sci0 vs sci2 (a second conflict that must survive seat 2 leaving)
    toP4(g, {
      0: customPlacements(0, {
        politician: { locationId: 'square', argument: 'rock' },
        scientist: { locationId: 'university', argument: 'paper' },
        artist: { locationId: 'theatre' },
        robot: { locationId: 'factory' }
      }),
      1: customPlacements(1, {
        politician: { locationId: 'square', argument: 'rock' },
        scientist: { locationId: 'theatre' },
        artist: { locationId: 'square' },
        robot: { locationId: 'power_plant' }
      }),
      2: customPlacements(2, {
        politician: { locationId: 'square', argument: 'rock' },
        scientist: { locationId: 'university', argument: 'scissors' },
        artist: { locationId: 'theatre' },
        robot: { locationId: 'dump' }
      })
    })
    for (const seat of [0, 1, 2] as SeatId[]) g.apply(seat, { type: 'conflict.reveal.ack' })
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('refight_ack')
    expect(phase.resolution?.active).toHaveLength(3)

    passRefight(g)
    g.apply(0, { type: 'conflict.rps', choice: 'rock' })
    g.apply(2, { type: 'system.eliminate', seat: 2, reason: 'disconnect' })
    // seat 2's politician left the re-fight; the round now needs only seats 0 and 1
    g.apply(1, { type: 'conflict.rps', choice: 'scissors' })
    expect(valuesOf(g.state, 0).power).toBe(1)
    expect(valuesOf(g.state, 1).power).toBe(0)

    resolveAll(g) // the university "conflict" is now sci0 alone → trivial unopposed win
    expect(valuesOf(g.state, 0).knowledge).toBe(1)
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
  })

  // Regression (found by the Stage-6 load test): a disconnect elimination while a
  // conflict sits at reveal_ack shrank it below 2 participants and beginResolution
  // crashed in baseOutcomes, wedging the room. The survivor must win unopposed.
  const contestedEverywhere = (): Record<number, PlacementInput[]> => ({
    // Seat 2 fights seat 0 at every venue: politician@square, sci@university,
    // artist@theatre. Seat 1 stays out of the way; robots never collide.
    0: customPlacements(0, {
      politician: { locationId: 'square', argument: 'rock' },
      scientist: { locationId: 'university', argument: 'paper' },
      artist: { locationId: 'theatre', argument: 'scissors' },
      robot: { locationId: 'factory' }
    }),
    1: customPlacements(1, {
      politician: { locationId: 'university' },
      scientist: { locationId: 'theatre' },
      artist: { locationId: 'square' },
      robot: { locationId: 'power_plant' }
    }),
    2: customPlacements(2, {
      politician: { locationId: 'square', argument: 'rock' },
      scientist: { locationId: 'university', argument: 'scissors' },
      artist: { locationId: 'theatre', argument: 'paper' },
      robot: { locationId: 'dump' }
    })
  })

  it('reveal_ack elimination empties the open conflict → survivor wins unopposed (ack first)', () => {
    const g = newGame('ffa3-revealack-elim', 'ffa3')
    toP4(g, contestedEverywhere())
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('reveal_ack')

    g.apply(0, { type: 'conflict.reveal.ack' })
    // The other participant of the open conflict disconnects: every remaining
    // conflict is seat 0 alone and must resolve as a chain of walkovers.
    const events = g.apply(2, { type: 'system.eliminate', seat: 2, reason: 'disconnect' })
    const rewards = events.filter((e) => e.type === 'conflict.rewards')
    expect(rewards.length).toBeGreaterThanOrEqual(3)
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
    expect(g.state.eliminated).toEqual([2])
    expect(valuesOf(g.state, 0).power).toBe(1)
    expect(valuesOf(g.state, 0).knowledge).toBe(1)
    expect(valuesOf(g.state, 0).art).toBe(1)
  })

  it('reveal_ack elimination empties the open conflict → survivor wins unopposed (ack last)', () => {
    const g = newGame('ffa3-revealack-elim2', 'ffa3')
    toP4(g, contestedEverywhere())
    g.apply(2, { type: 'system.eliminate', seat: 2, reason: 'disconnect' })
    expect(g.state.phase.kind).toBe('p4_conflict')
    // Seat 0 is now the only involved seat; its ack completes the reveal.
    const events = g.apply(0, { type: 'conflict.reveal.ack' })
    expect(events.filter((e) => e.type === 'conflict.rewards').length).toBeGreaterThanOrEqual(3)
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
    expect(valuesOf(g.state, 0).power).toBe(1)
    expect(valuesOf(g.state, 0).knowledge).toBe(1)
    expect(valuesOf(g.state, 0).art).toBe(1)
  })

  it('scoring elimination: the loser leaves with rank and VP; leaders play on to a winner', () => {
    const game = new TestGame(newGame('ffa3-scoring', 'ffa3').state)

    const seatPlacements = (turn6Twist: boolean): Record<number, PlacementInput[]> => ({
      // seat 0: politician beats seat 2, artist beats seat 2, scientist peaceful
      0: customPlacements(0, {
        politician: { locationId: 'square', argument: 'paper' },
        scientist: { locationId: 'theatre', argument: 'rock' },
        artist: { locationId: 'theatre', argument: 'scissors' },
        robot: { locationId: 'factory', argument: 'dummy' }
      }),
      // seat 1: scientist beats seat 2, politician/artist peaceful
      1: turn6Twist
        ? customPlacements(1, {
            politician: { locationId: 'university', argument: 'rock' },
            scientist: { locationId: 'university', argument: 'scissors' },
            artist: { locationId: 'theatre', argument: 'paper' }, // loses to art0
            robot: { locationId: 'power_plant', argument: 'dummy' }
          })
        : customPlacements(1, {
            politician: { locationId: 'university', argument: 'rock' },
            scientist: { locationId: 'university', argument: 'paper' },
            artist: { locationId: 'square', argument: 'scissors' },
            robot: { locationId: 'power_plant', argument: 'dummy' }
          }),
      // seat 2: loses every conflict it is in
      2: customPlacements(2, {
        politician: { locationId: 'square', argument: 'rock' },
        scientist: { locationId: 'university', argument: 'dummy' },
        artist: { locationId: 'theatre', argument: 'paper' },
        robot: { locationId: 'dump', argument: 'scissors' }
      })
    })

    for (let turn = 1; turn <= 5; turn++) {
      if (game.state.phase.kind === 'p1_event') playThroughP1(game)
      const placements = seatPlacements(false)
      for (const seat of [...game.state.activeSeats])
        game.apply(seat, {
          type: 'distribution.commit',
          placements: placements[seat] as PlacementInput[]
        })
      passReveal(game)
      selectNoCards(game) // no-op on turn 1, which has no P3 (rulebook)
      resolveAll(game)
      if (game.state.phase.kind === 'p5_market')
        for (const seat of [...game.state.activeSeats]) game.apply(seat, { type: 'market.done' })
    }

    // turn-5 scoring: seats 0 and 1 tie at VP 5, seat 2 is eliminated
    expect(game.state.turn).toBe(6)
    expect(game.state.isTieBreakerTurn).toBe(true)
    expect(game.state.eliminated).toEqual([2])
    expect(game.state.eliminationLog[0]).toMatchObject({ seat: 2, turn: 5 })
    expect(game.state.activeSeats).toEqual([0, 1])

    // turn 6: seat 1's artist walks into seat 0's and loses → seat 0 takes the game
    if (game.state.phase.kind === 'p1_event') playThroughP1(game)
    const placements = seatPlacements(true)
    for (const seat of [...game.state.activeSeats])
      game.apply(seat, {
        type: 'distribution.commit',
        placements: placements[seat] as PlacementInput[]
      })
    passReveal(game)
    selectNoCards(game)
    resolveAll(game)

    const phase = game.state.phase
    if (phase.kind !== 'finished') throw new Error(`expected finished, got ${phase.kind}`)
    expect(phase.winnerSeats).toEqual([0])
    expect(phase.ranking).toHaveLength(3)
    expect(phase.ranking[0]?.seats).toEqual([0])
    expect(phase.ranking[1]?.seats).toEqual([1])
    expect(phase.ranking[2]?.seats).toEqual([2])
    expect(phase.ranking[2]?.vp).toBe(game.state.eliminationLog[0]?.vp)
  })
})
