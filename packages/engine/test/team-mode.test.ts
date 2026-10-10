// 2v2 team mode — spec §13, rulebook "2 vs. 2": shared team value pools, ally
// full visibility, I-3 four-player compare tie-breaks, cross-team-only exchanges,
// team elimination.

import { describe, expect, it } from 'vitest'
import {
  createGame,
  DISCARD_EVENT_RESOURCE,
  eventKind,
  projectSpectatorView,
  projectView
} from '../src/index.js'
import type { EventCardId, PlacementInput, SeatId, Values } from '../src/index.js'
import {
  customPlacements,
  findSeed,
  passReveal,
  passSummary,
  resolveAll,
  selectNoCards,
  TestGame
} from './helpers.js'

/**
 * One deterministic 2v2 turn: eight conflicts, two of them between allies.
 * Team pools after P4: pool0 = {knowledge 1}, pool1 = {power 2, knowledge 1, art 2}.
 */
function teamPlacements(): Record<number, PlacementInput[]> {
  return {
    0: customPlacements(0, {
      politician: { locationId: 'square', argument: 'rock' },
      scientist: { locationId: 'university', argument: 'paper' },
      artist: { locationId: 'theatre', argument: 'scissors' },
      robot: { locationId: 'factory', argument: 'dummy' }
    }),
    1: customPlacements(1, {
      politician: { locationId: 'university', argument: 'rock' },
      scientist: { locationId: 'theatre', argument: 'paper' },
      artist: { locationId: 'square', argument: 'scissors' },
      robot: { locationId: 'power_plant', argument: 'dummy' }
    }),
    2: customPlacements(2, {
      politician: { locationId: 'university', argument: 'scissors' },
      scientist: { locationId: 'university', argument: 'rock' },
      artist: { locationId: 'square', argument: 'paper' },
      robot: { locationId: 'power_plant', argument: 'dummy' }
    }),
    3: customPlacements(3, {
      politician: { locationId: 'square', argument: 'paper' },
      scientist: { locationId: 'theatre', argument: 'scissors' },
      artist: { locationId: 'theatre', argument: 'rock' },
      robot: { locationId: 'factory', argument: 'dummy' }
    })
  }
}

function playTeamTurnOne(g: TestGame): void {
  const placements = teamPlacements()
  for (const seat of [0, 1, 2, 3] as SeatId[])
    g.apply(seat, { type: 'distribution.commit', placements: placements[seat] as PlacementInput[] })
  passReveal(g)
  selectNoCards(g) // no-op on turn 1, which has no P3 (rulebook §Turn Structure)
  resolveAll(g)
}

describe('2v2: shared team value pools', () => {
  it('rewards land in the team pool; allied same-type actors do conflict', () => {
    const g = new TestGame(createGame({ gameId: 't', mode: '2v2', seed: 'team-pool' }))
    playTeamTurnOne(g)
    // scientists met their own allies at the university (team 0) and theatre (team 1)
    expect(g.state.values[0]).toEqual({ power: 0, art: 0, knowledge: 1, fame: 0 })
    expect(g.state.values[1]).toEqual({ power: 2, art: 2, knowledge: 1, fame: 0 })
    // robot draws paid resources personally (resources stay per seat)
    expect(g.state.inventories[0]?.resources.product).toBe(2)
    expect(g.state.inventories[3]?.resources.product).toBe(2)
    expect(g.state.inventories[1]?.resources.electricity).toBe(2)
    expect(g.state.inventories[2]?.resources.electricity).toBe(2)
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
  })
})

describe('2v2: ally full visibility (rulebook)', () => {
  it('sealed placements are visible to the ally and hidden from the opponents', () => {
    const g = new TestGame(createGame({ gameId: 't', mode: '2v2', seed: 'team-vis' }))
    const events = g.apply(0, {
      type: 'distribution.commit',
      placements: teamPlacements()[0] as PlacementInput[]
    })
    passReveal(g)
    const staged = events.find((e) => e.type === 'distribution.staged')
    expect(staged?.visibility).toEqual([0, 2]) // committer + ally

    const allyView = projectView(g.state, 2)
    if (allyView.phase.kind !== 'p2_distribution') throw new Error('expected p2')
    expect(allyView.phase.sealed).toHaveLength(1)
    expect(allyView.phase.sealed[0]?.placements[0]?.argument).toBeDefined()
    expect(allyView.others.find((o) => o.seat === 0)?.resources).not.toBeNull()

    const enemyView = projectView(g.state, 1)
    if (enemyView.phase.kind !== 'p2_distribution') throw new Error('expected p2')
    expect(enemyView.phase.sealed).toEqual([])
    // Resources are public since the Open Information rule (canon change #10) —
    // only sealed placements stay team-scoped.
    expect(enemyView.others.find((o) => o.seat === 0)?.resources).not.toBeNull()
  })
})

describe('2v2: compare-event tie → all four players play (I-3)', () => {
  it('the tie ends as soon as every survivor belongs to one team', () => {
    const seed = findSeed((s) => s.eventDeck[0] === 'educational_crisis', '2v2')
    const g = new TestGame(createGame({ gameId: 't', mode: '2v2', seed }))
    playTeamTurnOne(g) // knowledge pools tie 1:1
    for (const seat of [0, 1, 2, 3] as SeatId[]) g.apply(seat, { type: 'market.done' })
    expect(g.state.turn).toBe(2)
    const phase = g.state.phase
    if (phase.kind !== 'p1_event') throw new Error('expected p1')
    expect(phase.card).toBe('educational_crisis')
    // The standoff announces the tie to all four before the tie-break arena.
    if (phase.stage.t !== 'compare_standoff') throw new Error('expected a standoff')
    expect(phase.stage.participants).toEqual([0, 1, 2, 3])
    for (const seat of [0, 1, 2, 3] as SeatId[]) g.apply(seat, { type: 'event.ack' })
    const afterAcks = g.state.phase
    if (afterAcks.kind !== 'p1_event' || afterAcks.stage.t !== 'compare_tiebreak')
      throw new Error('expected a team tie')
    expect(afterAcks.stage.tiebreak.participants).toEqual([0, 1, 2, 3])

    // round 1: rocks (0,1) survive scissors (2,3) — survivors span BOTH teams → replay
    g.apply(0, { type: 'tiebreak.rps', choice: 'rock' })
    g.apply(1, { type: 'tiebreak.rps', choice: 'rock' })
    g.apply(2, { type: 'tiebreak.rps', choice: 'scissors' })
    g.apply(3, { type: 'tiebreak.rps', choice: 'scissors' })
    const midPhase = g.state.phase
    if (midPhase.kind !== 'p1_event' || midPhase.stage.t !== 'compare_tiebreak')
      throw new Error('tie-break should continue')
    expect(midPhase.stage.tiebreak.participants).toEqual([0, 1])

    // round 2: seat 0 wins → team 0 takes the fame (after acks)
    g.apply(0, { type: 'tiebreak.rps', choice: 'paper' })
    g.apply(1, { type: 'tiebreak.rps', choice: 'rock' })
    for (const seat of [0, 1, 2, 3] as SeatId[]) g.apply(seat, { type: 'event.ack' })
    expect(g.state.values[0]?.fame).toBe(1)
    expect(g.state.values[1]?.fame).toBe(0)
  })
})

describe('2v2: exchanges target the opposing team only', () => {
  it('rejects an in-team exchange and swaps between team pools', () => {
    const seed = findSeed(
      (s) =>
        s.actionDeck[0] === 'change_values' && eventKind(s.eventDeck[0] as never) === 'compare',
      '2v2'
    )
    const g = new TestGame(createGame({ gameId: 't', mode: '2v2', seed }))
    playTeamTurnOne(g)
    g.apply(0, { type: 'market.buy' })
    for (const seat of [0, 1, 2, 3] as SeatId[]) g.apply(seat, { type: 'market.done' })

    // turn 2 P1: a compare event — pool 0 is behind on power/art/total, so team 0
    // wins outright, or knowledge ties into a tie-break; handle both generically
    while (g.state.phase.kind === 'p1_event') {
      const stage = g.state.phase.stage
      if (stage.t === 'compare_ack' || stage.t === 'compare_standoff') {
        const pending = g.state.activeSeats.find((s) => !stage.acked.includes(s))
        g.apply(pending as SeatId, { type: 'event.ack' })
      } else if (stage.t === 'compare_tiebreak') {
        const tiebreak = stage.tiebreak
        const pending = tiebreak.participants.find((s) => tiebreak.choices[s] === undefined)
        g.apply(pending as SeatId, {
          type: 'tiebreak.rps',
          choice: pending === 0 ? 'rock' : 'scissors'
        })
      } else {
        throw new Error(`unexpected stage ${stage.t}`)
      }
    }
    const placements = teamPlacements()
    for (const seat of [0, 1, 2, 3] as SeatId[])
      g.apply(seat, {
        type: 'distribution.commit',
        placements: placements[seat] as PlacementInput[]
      })
    passReveal(g)
    const card = g.state.inventories[0]?.hand[0]?.instanceId as string
    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [card] })
    for (const seat of [1, 2, 3] as SeatId[])
      g.apply(seat, { type: 'action.selectCards', cardInstanceIds: [] })

    // pool0 owns knowledge (+ maybe fame); exchanging with the ally is illegal
    g.expectReject(
      0,
      { type: 'action.exchange', give: 'knowledge', from: 2, take: 'power' },
      'invalid_payload'
    )
    const pool0Before = { ...(g.state.values[0] as Values) }
    const pool1Before = { ...(g.state.values[1] as Values) }
    g.apply(0, { type: 'action.exchange', give: 'knowledge', from: 3, take: 'power' })
    expect(g.state.values[0]?.knowledge).toBe(pool0Before.knowledge - 1)
    expect(g.state.values[0]?.power).toBe(pool0Before.power + 1)
    expect(g.state.values[1]?.knowledge).toBe(pool1Before.knowledge + 1)
    expect(g.state.values[1]?.power).toBe(pool1Before.power - 1)
  })
})

describe('2v2: team elimination (§12)', () => {
  it('a team fights on with one seat; losing both ends the game for the other team', () => {
    const g = new TestGame(createGame({ gameId: 't', mode: '2v2', seed: 'team-elim' }))
    playTeamTurnOne(g)
    g.apply(1, { type: 'system.eliminate', seat: 1, reason: 'disconnect' })
    expect(g.state.phase.kind).not.toBe('finished') // seat 3 keeps team 1 alive
    expect(g.state.activeSeats).toEqual([0, 2, 3])
    expect(g.state.values[1]?.power).toBe(2) // the pool belongs to the team, it stays

    g.apply(3, { type: 'system.eliminate', seat: 3, reason: 'forfeit' })
    const phase = g.state.phase
    if (phase.kind !== 'finished') throw new Error('expected finished')
    expect(phase.winnerSeats).toEqual([0, 2])
    expect(phase.ranking).toHaveLength(2)
    expect(phase.ranking[0]?.seats).toEqual([0, 2])
    expect(phase.ranking[1]?.seats).toEqual([1, 3])
    expect(g.state.values[1]).toEqual({ power: 0, art: 0, knowledge: 0, fame: 0 }) // pool left with the team
  })
})

describe('2v2: ally full visibility — hands and sealed discards', () => {
  it('the ally sees my actual cards; opponents and spectators only the count', () => {
    const g = new TestGame(createGame({ gameId: 't', mode: '2v2', seed: 'team-hand' }))
    playTeamTurnOne(g)
    g.apply(0, { type: 'market.buy' })
    for (const seat of [0, 1, 2, 3] as SeatId[]) g.apply(seat, { type: 'market.done' })
    const hand = g.state.inventories[0]?.hand ?? []
    expect(hand.length).toBeGreaterThan(0)

    const allyView = projectView(g.state, 2)
    expect(allyView.others.find((o) => o.seat === 0)?.hand).toEqual(hand)
    const enemyView = projectView(g.state, 1)
    expect(enemyView.others.find((o) => o.seat === 0)?.hand).toBeUndefined()
    expect(enemyView.others.find((o) => o.seat === 0)?.handCount).toBe(hand.length)
    const spectator = projectSpectatorView(g.state)
    expect(spectator.others.every((o) => o.hand === undefined)).toBe(true)
  })

  it('a sealed discard amount is ally-visible, hidden from opponents and spectators', () => {
    const seed = findSeed((s) => {
      const card = s.eventDeck[0] as EventCardId
      return (
        eventKind(card) === 'discard' &&
        DISCARD_EVENT_RESOURCE[card as keyof typeof DISCARD_EVENT_RESOURCE] === 'product'
      )
    }, '2v2')
    const g = new TestGame(createGame({ gameId: 't', mode: '2v2', seed }))
    playTeamTurnOne(g) // robot at the factory drew product for seat 0
    for (const seat of [0, 1, 2, 3] as SeatId[]) g.apply(seat, { type: 'market.done' })
    const phase = g.state.phase
    if (phase.kind !== 'p1_event' || phase.stage.t !== 'discard_commit')
      throw new Error('expected a discard event')
    g.apply(0, { type: 'event.discard', amount: 1 })

    const grab = (seat: SeatId) => {
      const v = projectView(g.state, seat)
      if (v.phase.kind !== 'p1_event' || v.phase.stage.t !== 'discard_commit')
        throw new Error('expected discard_commit')
      return v.phase.stage
    }
    expect(grab(2).sealed).toEqual([{ seat: 0, amount: 1 }]) // ally sees the amount
    expect(grab(1).sealed).toEqual([]) // opponent sees only that seat 0 committed
    expect(grab(1).committedSeats).toEqual([0])
    expect(grab(0).myAmount).toBe(1)
    const spectator = projectSpectatorView(g.state)
    if (spectator.phase.kind !== 'p1_event' || spectator.phase.stage.t !== 'discard_commit')
      throw new Error('expected discard_commit')
    expect(spectator.phase.stage.sealed).toEqual([])
  })
})
