// State invariants — spec/Game-Specification.md §2. Asserted in tests and simulation
// after every applyIntent; a violation is always an engine bug.

import { ACTION_DECK_COMPOSITION, ALLOWED_LOCATIONS, EVENT_CARDS, LOCATIONS } from './constants.js'
import type { GameState } from './state.js'
import { actorIdOf, seatCount, valuesIndexFor } from './state.js'
import type { SeatId } from './types.js'

class InvariantViolation extends Error {
  constructor(message: string) {
    super(`invariant violated: ${message}`)
    this.name = 'InvariantViolation'
  }
}

function check(condition: boolean, message: () => string): void {
  if (!condition) throw new InvariantViolation(message())
}

function isCount(n: unknown): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
}

export function assertStateInvariants(state: GameState): void {
  const seats = state.meta.seats.map((s) => s.seat)
  check(
    Number.isSafeInteger(state.turn) && state.turn >= 1,
    () => `turn must be >= 1, got ${state.turn}`
  )
  check(isCount(state.rngCursor), () => `rngCursor must be a count, got ${state.rngCursor}`)
  check(isCount(state.seq), () => `seq must be a count, got ${state.seq}`)
  check(isCount(state.cardsDrawn), () => `cardsDrawn must be a count, got ${state.cardsDrawn}`)

  // Seats: 0..n-1 in order
  seats.forEach((s, i) => check(s === i, () => `seat list must be 0..n-1, got ${seats.join(',')}`))

  // eliminated / activeSeats
  for (const s of state.eliminated) check(seats.includes(s), () => `eliminated unknown seat ${s}`)
  check(
    new Set(state.eliminated).size === state.eliminated.length,
    () => 'eliminated has duplicates'
  )
  check(
    new Set(state.activeSeats).size === state.activeSeats.length,
    () => 'activeSeats has duplicates'
  )
  for (const s of state.activeSeats) {
    check(seats.includes(s), () => `active unknown seat ${s}`)
    check(!state.eliminated.includes(s), () => `seat ${s} is both active and eliminated`)
  }
  if (state.phase.kind !== 'finished')
    check(state.activeSeats.length > 0, () => 'no active seats in a running game')

  // Values pools
  const pools = state.meta.mode === '2v2' ? 2 : seatCount(state)
  check(
    state.values.length === pools,
    () => `values must have ${pools} pools, got ${state.values.length}`
  )
  state.values.forEach((v, i) => {
    for (const [k, n] of Object.entries(v))
      check(isCount(n), () => `values[${i}].${k} must be a non-negative integer, got ${n}`)
  })

  // Inventories
  check(
    state.inventories.length === seatCount(state),
    () => `inventories length ${state.inventories.length} != seats ${seatCount(state)}`
  )
  const seenInstances = new Set<string>()
  state.inventories.forEach((inv, seat) => {
    for (const [k, n] of Object.entries(inv.resources))
      check(isCount(n), () => `resources[${seat}].${k} must be a non-negative integer, got ${n}`)
    for (const c of inv.hand) {
      check(!seenInstances.has(c.instanceId), () => `duplicate card instance ${c.instanceId}`)
      seenInstances.add(c.instanceId)
    }
  })

  // Eliminated seats own nothing (spec §12); in 2v2 the pool belongs to the team.
  for (const s of state.eliminated) {
    const inv = state.inventories[s]
    check(inv !== undefined, () => `eliminated seat ${s} has no inventory entry`)
    if (inv) {
      const { product, electricity, recycling } = inv.resources
      check(
        product === 0 && electricity === 0 && recycling === 0,
        () => `eliminated seat ${s} still owns resources`
      )
      check(inv.hand.length === 0, () => `eliminated seat ${s} still holds cards`)
    }
    if (state.meta.mode !== '2v2') {
      const v = state.values[valuesIndexFor(state, s)]
      check(
        v !== undefined && v.power === 0 && v.art === 0 && v.knowledge === 0 && v.fame === 0,
        () => `eliminated seat ${s} still owns values`
      )
    }
  }

  // Decks are non-replenishing subsets of the fixed compositions
  check(state.eventDeck.length <= EVENT_CARDS.length, () => 'event deck too large')
  check(new Set(state.eventDeck).size === state.eventDeck.length, () => 'event deck has duplicates')
  for (const c of state.eventDeck)
    check((EVENT_CARDS as readonly string[]).includes(c), () => `unknown event card ${c}`)
  check(state.actionDeck.length <= ACTION_DECK_COMPOSITION.length, () => 'action deck too large')
  const remaining = new Map<string, number>()
  for (const c of ACTION_DECK_COMPOSITION) remaining.set(c, (remaining.get(c) ?? 0) + 1)
  for (const c of state.actionDeck) {
    const left = remaining.get(c) ?? 0
    check(left > 0, () => `action deck holds too many '${c}'`)
    remaining.set(c, left - 1)
  }
  check(
    state.cardsDrawn === ACTION_DECK_COMPOSITION.length - state.actionDeck.length,
    () =>
      `cardsDrawn ${state.cardsDrawn} != issued ${ACTION_DECK_COMPOSITION.length - state.actionDeck.length}`
  )

  // Board
  for (const loc of state.board.disabledLocations)
    check(LOCATIONS.includes(loc), () => `unknown disabled location ${loc}`)
  check(
    new Set(state.board.disabledLocations).size === state.board.disabledLocations.length,
    () => 'disabledLocations has duplicates'
  )
  const bySeat = new Map<SeatId, typeof state.board.placements>()
  for (const p of state.board.placements) {
    check(
      p.actorId === actorIdOf(p.seat, p.actorType),
      () => `placement actorId ${p.actorId} does not match seat ${p.seat} + type ${p.actorType}`
    )
    check(
      ALLOWED_LOCATIONS[p.actorType].includes(p.locationId),
      () => `${p.actorType} placed in disallowed location ${p.locationId}`
    )
    check(
      !state.eliminated.includes(p.seat),
      () => `eliminated seat ${p.seat} appears in a placement`
    )
    const list = bySeat.get(p.seat) ?? []
    list.push(p)
    bySeat.set(p.seat, list)
  }
  for (const [seat, list] of bySeat) {
    check(list.length <= 4, () => `seat ${seat} has ${list.length} placements`)
    check(
      new Set(list.map((p) => p.argument)).size === list.length,
      () => `seat ${seat} placements reuse an argument`
    )
    check(
      new Set(list.map((p) => p.actorType)).size === list.length,
      () => `seat ${seat} placed an actor type twice`
    )
  }

  assertPhaseShape(state)
}

function assertPhaseShape(state: GameState): void {
  const phase = state.phase
  const active = (s: SeatId): boolean => state.activeSeats.includes(s)
  switch (phase.kind) {
    case 'p2_distribution':
      for (const key of Object.keys(phase.committed))
        check(active(Number(key) as SeatId), () => `p2 commit from non-active seat ${key}`)
      break
    case 'p1_event':
      if (phase.stage.t === 'discard_commit')
        for (const [key, amount] of Object.entries(phase.stage.amounts))
          check(
            active(Number(key) as SeatId) && isCount(amount),
            () => `p1 discard commit invalid for seat ${key}`
          )
      break
    case 'p3_action':
    case 'p4_conflict':
    case 'p5_market':
    case 'finished':
      break
  }
}
