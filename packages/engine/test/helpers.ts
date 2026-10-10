import { expect } from 'vitest'
import type {
  ActorType,
  ApplyResult,
  ArgumentType,
  BetType,
  EngineEvent,
  GameState,
  Intent,
  LocationId,
  PlacementInput,
  SeatId
} from '../src/index.js'
import {
  ACTOR_TYPES,
  ARGUMENT_TYPES,
  applyIntent,
  assertStateInvariants,
  createGame,
  eventKind
} from '../src/index.js'

/** Mutable game session for tests: applies intents, asserts success + invariants. */
export class TestGame {
  state: GameState
  log: EngineEvent[] = []

  constructor(state: GameState) {
    this.state = state
  }

  apply(seat: SeatId, intent: Intent): EngineEvent[] {
    const result = applyIntent(this.state, seat, intent)
    if (!result.ok) {
      throw new Error(
        `intent ${intent.type} from seat ${seat} rejected: ${result.error.code} — ${result.error.message}`
      )
    }
    assertStateInvariants(result.state)
    this.state = result.state
    this.log.push(...result.events)
    return result.events
  }

  expectReject(seat: SeatId, intent: Intent, code: string): void {
    const result: ApplyResult = applyIntent(this.state, seat, intent)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(code)
  }

  eventsOfType(type: string): EngineEvent[] {
    return this.log.filter((e) => e.type === type)
  }
}

export function newGame(
  seed = 'test-seed',
  mode: '1v1' | 'ffa3' | '2v2' | 'vs_bots' = '1v1'
): TestGame {
  return new TestGame(createGame({ gameId: 'g-test', mode, seed }))
}

/** Deterministically find a seed whose starting state satisfies a predicate. */
export function findSeed(
  predicate: (state: GameState) => boolean,
  mode: '1v1' | 'ffa3' | '2v2' | 'vs_bots' = '1v1'
): string {
  for (let i = 0; i < 5000; i++) {
    const seed = `probe-${i}`
    const state = createGame({ gameId: 'probe', mode, seed })
    if (predicate(state)) return seed
  }
  throw new Error('findSeed: no seed found in 5000 probes')
}

/** Conflict-free 1v1 layout: no same-type co-locations, everyone peaceful-wins. */
export function peacefulPlacements(seat: SeatId): PlacementInput[] {
  if (seat === 0)
    return [
      { actorType: 'politician', locationId: 'square', argument: 'rock' },
      { actorType: 'scientist', locationId: 'university', argument: 'paper' },
      { actorType: 'artist', locationId: 'theatre', argument: 'scissors' },
      { actorType: 'robot', locationId: 'factory', argument: 'dummy' }
    ]
  return [
    { actorType: 'politician', locationId: 'university', argument: 'rock' },
    { actorType: 'scientist', locationId: 'theatre', argument: 'paper' },
    { actorType: 'artist', locationId: 'square', argument: 'scissors' },
    { actorType: 'robot', locationId: seat === 1 ? 'power_plant' : 'dump', argument: 'dummy' }
  ]
}

/**
 * Placements built from the peaceful base with per-actor overrides. Overridden
 * arguments are honored; the remaining actors take the leftover argument types in
 * actor order, keeping the 4-distinct-arguments rule intact.
 */
export function customPlacements(
  seat: SeatId,
  overrides: Partial<
    Record<ActorType, { locationId?: LocationId; argument?: ArgumentType; bet?: BetType }>
  >
): PlacementInput[] {
  const base = new Map(peacefulPlacements(seat).map((p) => [p.actorType, { ...p }]))
  for (const [actorType, override] of Object.entries(overrides) as [
    ActorType,
    { locationId?: LocationId; argument?: ArgumentType; bet?: BetType }
  ][]) {
    const placement = base.get(actorType)
    if (!placement) continue
    if (override.locationId) placement.locationId = override.locationId
    if (override.bet) placement.bet = override.bet
  }
  const forced = new Map<ActorType, ArgumentType>()
  for (const [actorType, override] of Object.entries(overrides) as [
    ActorType,
    { argument?: ArgumentType }
  ][]) {
    if (override.argument) forced.set(actorType, override.argument)
  }
  const used = new Set(forced.values())
  if (used.size !== forced.size) throw new Error('customPlacements: duplicate forced arguments')
  const free = ARGUMENT_TYPES.filter((a) => !used.has(a))
  let cursor = 0
  return ACTOR_TYPES.map((actorType) => {
    const placement = base.get(actorType) as PlacementInput
    placement.argument = forced.get(actorType) ?? (free[cursor++] as ArgumentType)
    return placement
  })
}

/**
 * Play through a P1 event generically: discard 0 everywhere; in tie-breaks
 * `pickWinner` (default: lowest participant) gets rock and everyone else scissors.
 */
export function playThroughP1(
  g: TestGame,
  pickWinner: (participants: SeatId[]) => SeatId = (p) => Math.min(...p) as SeatId
): void {
  let guard = 0
  while (g.state.phase.kind === 'p1_event') {
    if (++guard > 100) throw new Error('playThroughP1: no progress')
    const phase = g.state.phase
    const stage = phase.stage
    if (stage.t === 'compare_ack' || stage.t === 'discard_ack' || stage.t === 'compare_standoff') {
      const pending = g.state.activeSeats.find((s) => !stage.acked.includes(s))
      if (pending === undefined) throw new Error('ack stage with nobody pending')
      g.apply(pending, { type: 'event.ack' })
      continue
    }
    if (stage.t === 'discard_commit') {
      const pending = g.state.activeSeats.find((s) => stage.amounts[s] === undefined)
      if (pending === undefined) throw new Error('discard stage with nobody pending')
      g.apply(pending, { type: 'event.discard', amount: 0 })
      continue
    }
    const tiebreak = stage.tiebreak
    const pending = tiebreak.participants.find((s) => tiebreak.choices[s] === undefined)
    if (pending === undefined) throw new Error('tiebreak with nobody pending')
    const winner = pickWinner(tiebreak.participants)
    g.apply(pending, { type: 'tiebreak.rps', choice: pending === winner ? 'rock' : 'scissors' })
  }
}

/**
 * Everyone plays no Action Cards. A no-op on turn 1, which has no P3 at all
 * (rulebook §Turn Structure: P2 hands straight to P4) — every driver that walks
 * the phase machine must go through this, or turn 1 rejects with wrong_phase.
 */
export function selectNoCards(g: TestGame): void {
  if (g.state.phase.kind !== 'p3_action') return
  for (const seat of [...g.state.activeSeats])
    g.apply(seat, { type: 'action.selectCards', cardInstanceIds: [] })
}

/** Play one full conflict-free turn from its start to the start of the next turn. */
export function playPeacefulTurn(
  g: TestGame,
  pickWinner?: (participants: SeatId[]) => SeatId
): void {
  if (g.state.phase.kind === 'p1_event') playThroughP1(g, pickWinner)
  expect(g.state.phase.kind).toBe('p2_distribution')
  const turn = g.state.turn
  for (const seat of [...g.state.activeSeats])
    g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })
  // The last commit reveals the board and the phase HOLDS there until everyone
  // has looked, then Turn 1 goes straight to P4 (rulebook: no Action Phase) —
  // where Phase 4 always ENDS with its recap, so resolveAll closes that too.
  passReveal(g)
  expect(g.state.phase.kind).toBe(turn === 1 ? 'p4_conflict' : 'p3_action')
  selectNoCards(g)
  resolveAll(g)
  if (g.state.phase.kind === 'p5_market') {
    for (const seat of [...g.state.activeSeats]) g.apply(seat, { type: 'market.done' })
  }
}

/**
 * Close the Phase 2 reveal: every ACTIVE seat says it has seen the board. The
 * phase now stops there on every turn (author request — "надо чтобы после
 * расстановки своих акторов показывало как оппоненты расставили своих"), so any
 * driver that walks a turn has to pass through it.
 */
export function passReveal(g: TestGame): void {
  for (let i = 0; i < 8; i++) {
    const phase = g.state.phase
    if (phase.kind !== 'p2_distribution' || !phase.revealed) return
    const revealed = phase.revealed
    const waiting = g.state.activeSeats.find((s) => !revealed.acked.includes(s))
    if (waiting === undefined) return
    g.apply(waiting, { type: 'distribution.reveal.ack' })
  }
}

/** Turn-1 shortcut ending in P5, where `buyers` each stage one market buy. */
export function turnOneWithBuys(g: TestGame, buyers: SeatId[]): void {
  for (const seat of [...g.state.activeSeats])
    g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })
  passReveal(g)
  selectNoCards(g)
  resolveAll(g) // Phase 4 always stops for its recap, peaceful board or not
  for (const seat of buyers) g.apply(seat, { type: 'market.buy' })
  for (const seat of [...g.state.activeSeats]) g.apply(seat, { type: 'market.done' })
}

/**
 * Close Phase 4's end-of-turn recap: every ACTIVE seat presses Get It. Phase 4
 * now always stops here, even on a board where nothing was contested, so any
 * fixture that walks a turn has to pass through it (author request — the phase
 * must be shown).
 */
export function passSummary(g: TestGame): void {
  for (let i = 0; i < 8; i++) {
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict' || phase.stage.t !== 'summary_ack') return
    const stage = phase.stage
    const waiting = g.state.activeSeats.find((s) => !stage.acked.includes(s))
    if (waiting === undefined) return
    g.apply(waiting, { type: 'conflict.summary.ack' })
  }
}

export function compareEventCount(state: GameState, firstN: number): number {
  return state.eventDeck.slice(0, firstN).filter((c) => eventKind(c) === 'compare').length
}

/** Commit all seats' placements, then everyone selects no cards → P4 opens. */
export function toP4(g: TestGame, placements: Record<number, PlacementInput[]>): void {
  for (const seat of [...g.state.activeSeats])
    g.apply(seat, { type: 'distribution.commit', placements: placements[seat] as PlacementInput[] })
  passReveal(g)
  selectNoCards(g)
}

/**
 * Generic P4 resolver: acks everything; in rps rounds and deadlock tie-breaks the
 * lowest pending-eligible seat plays paper and everyone else rock (lowest seat wins).
 */
/**
 * Click through P3 results screens (blocks/relocations/exchanges): each wave
 * of played cards now ends in a consensus ack before the next step starts.
 */
export function ackActionResults(g: TestGame): void {
  for (let i = 0; i < 24; i++) {
    const phase = g.state.phase
    if (phase.kind !== 'p3_action') return
    const t = phase.step.t
    if (t !== 'blocks_ack' && t !== 'relocations_ack' && t !== 'exchanges_ack') return
    const step = phase.step as { acked: number[] }
    const next = g.state.activeSeats.find((s) => !step.acked.includes(s))
    if (next === undefined) return
    g.apply(next, { type: 'action.ack' })
  }
}

/** Pass the P4 review gate before a re-fight: ack refight_ack for all involved. */
export function passRefight(g: TestGame): void {
  const phase = g.state.phase
  if (phase.kind !== 'p4_conflict' || phase.stage.t !== 'refight_ack') return
  const conflict = phase.conflicts[phase.index] as { actorIds: string[] }
  const involved = g.state.activeSeats.filter((s) =>
    conflict.actorIds.some((id) => id.startsWith(`${s}:`))
  )
  for (const seat of involved) {
    const stage = g.state.phase.kind === 'p4_conflict' ? g.state.phase.stage : null
    if (stage?.t === 'refight_ack' && !stage.acked.includes(seat))
      g.apply(seat, { type: 'conflict.refight.ack' })
  }
}

export function resolveAll(g: TestGame): void {
  let guard = 0
  while (g.state.phase.kind === 'p4_conflict') {
    if (++guard > 300) throw new Error('resolveAll: no progress')
    const phase = g.state.phase
    const stage = phase.stage
    if (stage.t === 'summary_ack') {
      // The end-of-phase recap waits on every ACTIVE seat, not just the seats
      // that fought — drive them all, or every fixture that plays a whole turn
      // hangs here. Checked before the conflict guard below: by the time the
      // recap is up the conflicts are done, so there is no "current" one.
      const waiting = g.state.activeSeats.find((s) => !stage.acked.includes(s))
      if (waiting === undefined) throw new Error('summary stage with nobody pending')
      g.apply(waiting, { type: 'conflict.summary.ack' })
      continue
    }
    const conflict = phase.conflicts[phase.index]
    if (!conflict) throw new Error('p4 without current conflict')
    if (stage.t === 'reveal_ack' || stage.t === 'refight_ack' || stage.t === 'result_ack') {
      const involved = g.state.activeSeats.filter((s) =>
        conflict.actorIds.some((id) => id.startsWith(`${s}:`))
      )
      const pending = involved.find((s) => !stage.acked.includes(s))
      if (pending === undefined) throw new Error('ack stage with nobody pending')
      g.apply(pending, {
        type:
          stage.t === 'reveal_ack'
            ? 'conflict.reveal.ack'
            : stage.t === 'refight_ack'
              ? 'conflict.refight.ack'
              : 'conflict.result.ack'
      })
      continue
    }
    if (stage.t === 'rps') {
      const owners = (phase.resolution?.active ?? []).map(
        (id) => Number(id.split(':')[0]) as SeatId
      )
      const pending = owners.find((s) => stage.choices[s] === undefined)
      if (pending === undefined) throw new Error('rps stage with nobody pending')
      const lowest = Math.min(...owners)
      g.apply(pending, { type: 'conflict.rps', choice: pending === lowest ? 'paper' : 'rock' })
      continue
    }
    const tiebreak = stage.tiebreak
    const pending = tiebreak.participants.find((s) => tiebreak.choices[s] === undefined)
    if (pending === undefined) throw new Error('deadlock tiebreak with nobody pending')
    const lowest = Math.min(...tiebreak.participants)
    g.apply(pending, { type: 'tiebreak.rps', choice: pending === lowest ? 'paper' : 'rock' })
  }
}
