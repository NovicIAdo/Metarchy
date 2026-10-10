// P3 steps 2–3 — relocations with collisions (§7 step 2, I-6/I-7) and value
// exchanges (§7 step 3, I-4).

import { describe, expect, it } from 'vitest'
import { eventKind, legalIntents, projectView, valuesOf } from '../src/index.js'
import type { GameState } from '../src/index.js'
import {
  ackActionResults,
  findSeed,
  newGame,
  passReveal,
  passSummary,
  peacefulPlacements,
  playThroughP1,
  resolveAll,
  TestGame,
  turnOneWithBuys
} from './helpers.js'

/** Turn 1 with buys, then generic P1, leaving the game at turn 2 P2. */
function toTurn2(seed: string, buyers: (0 | 1)[]): TestGame {
  const g = new TestGame(newGame(seed).state)
  turnOneWithBuys(g, buyers)
  playThroughP1(g)
  expect(g.state.phase.kind).toBe('p2_distribution')
  return g
}

function commitPeaceful(g: TestGame): void {
  for (const seat of [...g.state.activeSeats])
    g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })
  passReveal(g)
}

function handIds(state: GameState, seat: 0 | 1): string[] {
  return (state.inventories[seat]?.hand ?? []).map((c) => c.instanceId)
}

describe('P3 step 2: relocation', () => {
  it('moves any actor (even an opponent’s) with its hidden argument; new co-locations conflict in P4', () => {
    const seed = findSeed(
      (s) => s.actionDeck[0] === 'relocation' && eventKind(s.eventDeck[0]!) === 'compare'
    )
    const g = toTurn2(seed, [0])
    commitPeaceful(g)

    const card = handIds(g.state, 0)[0] as string
    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [card] })
    g.apply(1, { type: 'action.selectCards', cardInstanceIds: [] })

    const phase = g.state.phase
    if (phase.kind !== 'p3_action') throw new Error('expected p3')
    expect(phase.step.t).toBe('relocate')
    expect(legalIntents(g.state, 0)).toEqual([{ type: 'action.relocate', remaining: 1 }])
    expect(legalIntents(g.state, 1)).toEqual([])

    // seat 0 drags seat 1's scientist from the theatre into seat 0's university
    g.apply(0, { type: 'action.relocate', actorId: '1:scientist', to: 'university' })
    const moved = g.eventsOfType('action.relocated')
    expect(moved).toHaveLength(1)
    expect(moved[0]?.payload).toEqual({ actorId: '1:scientist', from: 'theatre', to: 'university' })

    // The relocation wave ends on a results screen everyone must ack.
    const ackPhase = g.state.phase
    if (ackPhase.kind !== 'p3_action' || ackPhase.step.t !== 'relocations_ack')
      throw new Error('expected relocations_ack')
    expect(ackPhase.step.moves).toEqual([
      { seat: 0, actorId: '1:scientist', from: 'theatre', to: 'university' }
    ])
    ackActionResults(g)
    expect(g.eventsOfType('conflict.detected').length).toBeGreaterThan(0)

    const p4 = g.state.phase
    if (p4.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(p4.conflicts[0]).toMatchObject({ locationId: 'university', actorType: 'scientist' })
    // the moved actor kept its hidden argument (both scientists hold paper → draw)
    resolveAll(g)
    expect(valuesOf(g.state, 0).knowledge).toBe(1 + 1) // turn 1 + draw settlement
    expect(valuesOf(g.state, 1).knowledge).toBe(1 + 1)
    expect(g.state.inventories[0]?.hand).toHaveLength(0) // card consumed
    // ...and lands in the public play log, visible to the opponent's view too.
    expect(g.state.played).toEqual([{ seat: 0, card: 'relocation', turn: 2 }])
    expect(projectView(g.state, 1).played).toEqual([{ seat: 0, card: 'relocation', turn: 2 }])
  })

  it('rejects illegal orders: unknown actor, wrong location type, same location, over quota', () => {
    const seed = findSeed(
      (s) => s.actionDeck[0] === 'relocation' && eventKind(s.eventDeck[0]!) === 'compare'
    )
    const g = toTurn2(seed, [0])
    commitPeaceful(g)
    const card = handIds(g.state, 0)[0] as string
    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [card] })
    g.apply(1, { type: 'action.selectCards', cardInstanceIds: [] })

    g.expectReject(
      0,
      { type: 'action.relocate', actorId: '1:robot', to: 'square' },
      'invalid_location'
    )
    g.expectReject(
      0,
      { type: 'action.relocate', actorId: '0:politician', to: 'square' },
      'invalid_location'
    )
    g.expectReject(
      1,
      { type: 'action.relocate', actorId: '0:robot', to: 'dump' },
      'already_committed'
    )
    g.apply(0, { type: 'action.relocate', actorId: '0:robot', to: 'dump' })
    // quota reached → the step completed within that intent (peaceful P4 passes through)
  })

  it('collision: same actor to different destinations → tie-break; loser’s card has no effect', () => {
    const seed = findSeed(
      (s) =>
        s.actionDeck[0] === 'relocation' &&
        s.actionDeck[1] === 'relocation' &&
        eventKind(s.eventDeck[0]!) === 'compare'
    )
    const g = toTurn2(seed, [0, 1])
    commitPeaceful(g)
    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [handIds(g.state, 0)[0] as string] })
    g.apply(1, { type: 'action.selectCards', cardInstanceIds: [handIds(g.state, 1)[0] as string] })

    g.apply(0, { type: 'action.relocate', actorId: '0:robot', to: 'power_plant' })
    g.apply(1, { type: 'action.relocate', actorId: '0:robot', to: 'dump' })

    const phase = g.state.phase
    if (phase.kind !== 'p3_action') throw new Error('expected p3')
    expect(phase.step.t).toBe('relocate_tiebreak')
    g.apply(0, { type: 'tiebreak.rps', choice: 'paper' })
    g.apply(1, { type: 'tiebreak.rps', choice: 'rock' })

    const collision = g.eventsOfType('action.relocationCollision')[0]?.payload as {
      actorId: string
      winner: number
    }
    expect(collision).toMatchObject({ actorId: '0:robot', winner: 0 })
    ackActionResults(g)
    const p4 = g.state.phase
    if (p4.kind !== 'p4_conflict') throw new Error('expected p4')
    // winner's destination applied: both dummy-argument robots now share the plant
    expect(p4.conflicts[0]).toMatchObject({ locationId: 'power_plant', actorType: 'robot' })
    resolveAll(g)
    // dummy vs dummy → draw → 1 electricity each
    // seat 0: 1 start − 1 buy + 1 draw; seat 1: 1 start + 3 (turn-1 plant) − 1 buy + 1 draw
    expect(g.state.inventories[0]?.resources.electricity).toBe(1)
    expect(g.state.inventories[1]?.resources.electricity).toBe(4)
    // both relocation cards are gone
    expect(g.state.inventories[0]?.hand).toHaveLength(0)
    expect(g.state.inventories[1]?.hand).toHaveLength(0)
  })

  it('same actor, same destination: no collision, all cards consumed (I-7)', () => {
    const seed = findSeed(
      (s) =>
        s.actionDeck[0] === 'relocation' &&
        s.actionDeck[1] === 'relocation' &&
        eventKind(s.eventDeck[0]!) === 'compare'
    )
    const g = toTurn2(seed, [0, 1])
    commitPeaceful(g)
    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [handIds(g.state, 0)[0] as string] })
    g.apply(1, { type: 'action.selectCards', cardInstanceIds: [handIds(g.state, 1)[0] as string] })
    g.apply(0, { type: 'action.relocate', actorId: '0:robot', to: 'dump' })
    g.apply(1, { type: 'action.relocate', actorId: '0:robot', to: 'dump' })
    expect(g.eventsOfType('action.relocationCollision')).toHaveLength(0)
    expect(g.eventsOfType('action.relocated')).toHaveLength(1)
    expect(g.eventsOfType('action.relocated')[0]?.payload).toMatchObject({
      actorId: '0:robot',
      to: 'dump'
    })
    ackActionResults(g)
    // peaceful P4 already ran after the results ack: the dump produced recycling
    expect(g.state.inventories[0]?.resources.recycling).toBe(1 - 1 + 3)
    expect(g.state.inventories[0]?.hand).toHaveLength(0)
    expect(g.state.inventories[1]?.hand).toHaveLength(0)
  })

  it('relocation into a disabled location is legal (I-6); the actor produces nothing there', () => {
    const seed = findSeed(
      (s) =>
        s.actionDeck[0] === 'construction_work' &&
        s.actionDeck[1] === 'relocation' &&
        eventKind(s.eventDeck[0]!) === 'compare'
    )
    const g = toTurn2(seed, [0, 1])
    commitPeaceful(g)
    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [handIds(g.state, 0)[0] as string] })
    g.apply(1, { type: 'action.selectCards', cardInstanceIds: [handIds(g.state, 1)[0] as string] })
    // seat 0's construction_work blocked the square during step 1
    expect(g.state.board.disabledLocations).toEqual(['square'])
    // the block wave shows its results screen first
    const blockPhase = g.state.phase
    if (blockPhase.kind !== 'p3_action' || blockPhase.step.t !== 'blocks_ack')
      throw new Error('expected blocks_ack')
    expect(blockPhase.step.blocks).toEqual([
      { seat: 0, card: 'construction_work', locationId: 'square' }
    ])
    ackActionResults(g)
    // seat 1 moves its own politician INTO the blocked square — allowed
    const powerBefore = valuesOf(g.state, 1).power
    g.apply(1, { type: 'action.relocate', actorId: '1:politician', to: 'square' })
    ackActionResults(g)
    resolveAll(g)
    expect(valuesOf(g.state, 1).power).toBe(powerBefore) // no production at a disabled location
  })

  it('timeout burns the relocation card with no move (user rule)', () => {
    const seed = findSeed(
      (s) => s.actionDeck[0] === 'relocation' && eventKind(s.eventDeck[0]!) === 'compare'
    )
    const g = toTurn2(seed, [0])
    commitPeaceful(g)
    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [handIds(g.state, 0)[0] as string] })
    g.apply(1, { type: 'action.selectCards', cardInstanceIds: [] })
    g.apply(0, { type: 'system.timeout', seat: 0 })
    expect(g.eventsOfType('action.relocationsSkipped')[0]?.payload).toMatchObject({
      seat: 0,
      count: 1
    })
    expect(g.eventsOfType('action.relocated')).toHaveLength(0) // nobody moved
    // The card still counts as played and the results screen still shows.
    expect(g.state.inventories[0]?.hand).toHaveLength(0)
    const ackPhase = g.state.phase
    if (ackPhase.kind !== 'p3_action' || ackPhase.step.t !== 'relocations_ack')
      throw new Error('expected relocations_ack')
    expect(ackPhase.step.moves).toEqual([])
    // Deadline defaults ack the results screen too; with nothing moved the
    // peaceful P4 passes straight through to the market.
    for (const seat of [0, 1] as const) g.apply(seat, { type: 'system.timeout', seat })
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
  })
})

describe('P3 step 3: change values', () => {
  it('swaps one own value for another player’s value; fame never moves', () => {
    const seed = findSeed(
      (s) => s.actionDeck[0] === 'change_values' && eventKind(s.eventDeck[0]!) === 'compare'
    )
    const g = toTurn2(seed, [0])
    commitPeaceful(g)
    const card = handIds(g.state, 0)[0] as string
    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [card] })
    g.apply(1, { type: 'action.selectCards', cardInstanceIds: [] })

    const phase = g.state.phase
    if (phase.kind !== 'p3_action') throw new Error('expected p3')
    expect(phase.step.t).toBe('exchange')
    expect(legalIntents(g.state, 0)).toEqual([{ type: 'action.exchange' }])
    expect(legalIntents(g.state, 1)).toEqual([])

    g.expectReject(
      0,
      { type: 'action.exchange', give: 'fame', from: 1, take: 'art' },
      'invalid_payload'
    )
    g.expectReject(
      0,
      { type: 'action.exchange', give: 'art', from: 0, take: 'art' },
      'invalid_payload'
    )

    g.apply(0, { type: 'action.exchange', give: 'art', from: 1, take: 'knowledge' })
    // The exchange wave ends on its results screen.
    const ackPhase = g.state.phase
    if (ackPhase.kind !== 'p3_action' || ackPhase.step.t !== 'exchanges_ack')
      throw new Error('expected exchanges_ack')
    expect(ackPhase.step.exchanges).toEqual([{ seat: 0, from: 1, give: 'art', take: 'knowledge' }])
    ackActionResults(g)
    // after turn 1 both had (1,1,1); the swap moves art→seat1, knowledge→seat0
    // then turn 2's peaceful P4 adds +1 of each again
    resolveAll(g)
    expect(valuesOf(g.state, 0)).toEqual({ power: 2, art: 1, knowledge: 3, fame: 1 })
    expect(valuesOf(g.state, 1)).toEqual({ power: 2, art: 3, knowledge: 1, fame: 0 })
    expect(g.state.inventories[0]?.hand).toHaveLength(0) // card consumed
    expect(g.eventsOfType('action.exchanged')).toHaveLength(1)
  })

  it('returns the card to hand when the giver has no values (I-4)', () => {
    const seed = findSeed(
      (s) => s.actionDeck[0] === 'change_values' && eventKind(s.eventDeck[0]!) === 'compare'
    )
    const g = new TestGame(newGame(seed).state)
    // turn 1: seat 0's humans all lose their duels → seat 0 ends with zero values
    g.apply(0, {
      type: 'distribution.commit',
      placements: [
        { actorType: 'politician', locationId: 'square', argument: 'rock' },
        { actorType: 'scientist', locationId: 'university', argument: 'paper' },
        { actorType: 'artist', locationId: 'theatre', argument: 'scissors' },
        { actorType: 'robot', locationId: 'factory', argument: 'dummy' }
      ]
    })
    g.apply(1, {
      type: 'distribution.commit',
      placements: [
        { actorType: 'politician', locationId: 'square', argument: 'paper' },
        { actorType: 'scientist', locationId: 'university', argument: 'scissors' },
        { actorType: 'artist', locationId: 'theatre', argument: 'rock' },
        { actorType: 'robot', locationId: 'power_plant', argument: 'dummy' }
      ]
    })
    passReveal(g)
    // Turn 1 has no P3 (rulebook §Turn Structure) — the commits opened P4 directly.
    resolveAll(g)
    expect(valuesOf(g.state, 0)).toEqual({ power: 0, art: 0, knowledge: 0, fame: 0 })
    // seat 0 buys the change_values card, then tries to play it on turn 2
    g.apply(0, { type: 'market.buy' })
    g.apply(0, { type: 'market.done' })
    g.apply(1, { type: 'market.done' })
    playThroughP1(g, () => 1) // any fame goes to seat 1? no — compare winner is the min side
    expect(g.state.phase.kind).toBe('p2_distribution')
    commitPeaceful(g)
    const card = handIds(g.state, 0)[0] as string
    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [card] })
    const events = g.apply(1, { type: 'action.selectCards', cardInstanceIds: [] })
    const returned = events.find((e) => e.type === 'action.exchangeReturned')
    expect(returned?.payload).toMatchObject({ seat: 0, reason: 'no_own_values' })
    expect(handIds(g.state, 0)).toContain(card) // still in hand
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market') // after the P4 recap
  })

  it('multiple exchange cards apply strictly in seat order', () => {
    const seed = findSeed(
      (s) =>
        s.actionDeck[0] === 'change_values' &&
        s.actionDeck[1] === 'change_values' &&
        eventKind(s.eventDeck[0]!) === 'compare'
    )
    const g = toTurn2(seed, [0, 1])
    commitPeaceful(g)
    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [handIds(g.state, 0)[0] as string] })
    g.apply(1, { type: 'action.selectCards', cardInstanceIds: [handIds(g.state, 1)[0] as string] })

    // queue: seat 0 first
    expect(legalIntents(g.state, 1)).toEqual([])
    g.expectReject(
      1,
      { type: 'action.exchange', give: 'art', from: 0, take: 'power' },
      'not_participant'
    )
    g.apply(0, { type: 'action.exchange', give: 'art', from: 1, take: 'knowledge' })
    // now seat 1's card is up
    expect(legalIntents(g.state, 1)).toEqual([{ type: 'action.exchange' }])
    g.apply(1, { type: 'action.exchange', give: 'power', from: 0, take: 'knowledge' })
    expect(g.eventsOfType('action.exchanged')).toHaveLength(2)
    ackActionResults(g)
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market') // after the P4 recap
  })
})
