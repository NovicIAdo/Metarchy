// Phase transitions and consensus advancement — spec §3, §5–§10, §12.
// Handlers only record a seat's input and call maybeAdvanceStage(); every
// "all inputs are in → advance" decision lives here, so elimination-driven
// consensus recomputation (§12) reuses the exact same logic.

import {
  ACTOR_VALUE,
  BLOCK_CARD_LOCATION,
  COMPARE_EVENT_METRIC,
  DISCARD_EVENT_RESOURCE,
  DRAW_REWARD,
  LOCATION_RESOURCE,
  MARKET_COST,
  POLITICIAN_DEADLOCK_ACTOR_ROUNDS,
  POLITICIAN_DEADLOCK_PLAYER_ROUNDS,
  WIN_REWARD,
  actionCardKind,
  eventKind
} from './constants.js'
import type { ActionCardId } from './constants.js'
import type { Intent } from './intents.js'
import { baseOutcomes, detectGroups } from './conflict.js'
import type { Ctx } from './ctx.js'
import { drawBelow, emit, reject } from './ctx.js'
import { victoryPoints } from './scoring.js'
import type {
  BlockPlay,
  CardInstance,
  ConflictGroup,
  ConflictResolution,
  EventWinner,
  GameState,
  P1State,
  P2State,
  P3State,
  P4Stage,
  P4State,
  P5State,
  RankingEntry,
  RelocationCollision,
  RelocationMove,
  RelocationOrder,
  RewardGrant,
  TieBreakState,
  TurnSummaryResult
} from './state.js'
import { isLastTurn, maxTurnsOf, seatOfActor, valuesIndexFor, visibilityGroup } from './state.js'
import { tiebreakSurvivors } from './tiebreak.js'
import type { EventCardId } from './constants.js'
import type {
  ActorId,
  ActorType,
  BetType,
  LocationId,
  Outcome,
  Placement,
  ResourceType,
  Rps,
  SeatId,
  TeamId,
  ValueType,
  Values
} from './types.js'

export function notImplemented(what: string): never {
  reject('not_implemented', `${what} is not implemented yet (later Stage-1 step)`)
}

// --- Sides (a seat, or a team in 2v2) -------------------------------------------

export interface Side {
  seats: SeatId[]
  /** Index into state.values. */
  pool: number
}

/** Sides still in the game (2v2: teams with at least one active seat). */
export function activeSides(state: GameState): Side[] {
  if (state.meta.teams) {
    return state.meta.teams
      .map((team, pool) => ({
        seats: team.filter((s) => state.activeSeats.includes(s)),
        pool
      }))
      .filter((side) => side.seats.length > 0)
  }
  return state.activeSeats.map((seat) => ({ seats: [seat], pool: seat }))
}

function allActiveIn(state: GameState, seats: Iterable<SeatId>): boolean {
  const set = new Set(seats)
  return state.activeSeats.every((s) => set.has(s))
}

function committedSeats(record: Partial<Record<SeatId, unknown>>): SeatId[] {
  return Object.keys(record).map((k) => Number(k) as SeatId)
}

const ZERO_RESOURCES = { product: 0, electricity: 0, recycling: 0 }
const ZERO_VALUES = { power: 0, art: 0, knowledge: 0, fame: 0 }

// --- Cards ------------------------------------------------------------------------

/** Draw the top action card as a new instance; null when the deck is empty. */
export function drawActionCard(ctx: Ctx): CardInstance | null {
  const s = ctx.state
  const card = s.actionDeck.shift()
  if (!card) return null
  s.cardsDrawn += 1
  return { instanceId: `c${s.cardsDrawn}`, card }
}

// --- Rewards ------------------------------------------------------------------------

export type { RewardGrant } from './state.js'

/**
 * Apply an actor's conflict reward: base by final outcome (§1.6) plus the persistent
 * win-bet modifier (+1 of the same unit, on any final outcome — I-2).
 */
export function grantReward(
  ctx: Ctx,
  placement: Placement,
  outcome: 'win' | 'lose' | 'draw',
  winBet: boolean
): RewardGrant | null {
  const s = ctx.state
  const base =
    outcome === 'win'
      ? WIN_REWARD[placement.actorType]
      : outcome === 'draw'
        ? DRAW_REWARD[placement.actorType]
        : 0
  const amount = base + (winBet ? 1 : 0)
  if (amount === 0) return null
  if (placement.actorType === 'robot') {
    const resource = LOCATION_RESOURCE[placement.locationId] as ResourceType
    const inv = ctx.state.inventories[placement.seat]
    if (!inv) return null
    inv.resources[resource] += amount
    return { kind: 'resource', type: resource, amount }
  }
  const value = ACTOR_VALUE[placement.actorType]
  const pool = s.values[valuesIndexFor(s, placement.seat)] as Values
  pool[value] += amount
  return { kind: 'value', type: value, amount }
}

/**
 * Record what a Location produced, for the end-of-Phase-4 summary (author
 * request). Called wherever `conflict.rewards` is emitted, so the two never
 * disagree: the event is what happened, this is what the screen will say.
 */
function recordSummary(
  phase: P4State,
  entry: {
    locationId: LocationId
    actorType: ActorType
    peaceful: boolean
    results: TurnSummaryResult[]
  }
): void {
  phase.summary.push(entry)
}

// --- Turn & phase entries -------------------------------------------------------------

export function enterTurn(ctx: Ctx): void {
  const s = ctx.state
  s.turn += 1
  s.isTieBreakerTurn = s.turn > maxTurnsOf(s)
  s.board.disabledLocations = []
  s.board.placements = []
  emit(ctx, 'turn.advanced', { turn: s.turn, isTieBreakerTurn: s.isTieBreakerTurn }, 'public')
  if (s.eventDeck.length === 0) {
    // 7 event cards cover turns 2–8; deep tie-breaker turns skip P1 (rulebook).
    emit(ctx, 'event.deckEmpty', {}, 'public')
    enterP2(ctx)
  } else {
    enterP1(ctx)
  }
}

export function enterP2(ctx: Ctx): void {
  ctx.state.phase = { kind: 'p2_distribution', committed: {} }
}

function enterP3(ctx: Ctx): void {
  ctx.state.phase = { kind: 'p3_action', selected: {}, step: { t: 'select', committed: {} } }
}

function enterP5(ctx: Ctx): void {
  ctx.state.phase = { kind: 'p5_market', staged: {}, done: [] }
}

// --- P1 Event (§5) -----------------------------------------------------------------------

function enterP1(ctx: Ctx): void {
  const s = ctx.state
  const card = s.eventDeck.shift() as EventCardId
  emit(ctx, 'event.drawn', { card }, 'public')
  if (eventKind(card) === 'compare') {
    const metricName = COMPARE_EVENT_METRIC[card as keyof typeof COMPARE_EVENT_METRIC]
    const sides = activeSides(s)
    const metrics = sides.map((side) => {
      const v = s.values[side.pool] as Values
      const value = metricName === 'total' ? v.power + v.art + v.knowledge + v.fame : v[metricName]
      return { side, value }
    })
    const min = Math.min(...metrics.map((m) => m.value))
    const qualifiers = metrics.filter((m) => m.value === min).map((m) => m.side)
    if (qualifiers.length === 1) {
      s.phase = {
        kind: 'p1_event',
        card,
        stage: { t: 'compare_ack', winner: sideToWinner(s, qualifiers[0] as Side), acked: [] }
      }
    } else {
      // 2v2 compare tie: all four (active) players play together (I-3).
      const participants = s.meta.teams
        ? [...s.activeSeats]
        : qualifiers.flatMap((side) => side.seats)
      // User rule: never jump into the tie-break arena unannounced — first a
      // standoff screen explains the tied minimum; the tie-break starts once
      // everyone confirms (or the ack deadline confirms for them).
      s.phase = {
        kind: 'p1_event',
        card,
        stage: { t: 'compare_standoff', participants, acked: [] }
      }
    }
  } else {
    s.phase = { kind: 'p1_event', card, stage: { t: 'discard_commit', amounts: {} } }
  }
}

function sideToWinner(state: GameState, side: Side): EventWinner {
  return state.meta.teams
    ? { kind: 'team', team: side.pool as TeamId }
    : { kind: 'seat', seat: side.seats[0] as SeatId }
}

function maybeAdvanceP1(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P1State
  const stage = phase.stage
  switch (stage.t) {
    case 'compare_ack': {
      if (!allActiveIn(s, stage.acked)) return
      let fame = 0
      if (stage.winner) {
        fame = applyFame(s, stage.winner)
      }
      emit(
        ctx,
        'event.resolved',
        { card: phase.card, kind: 'compare', winner: stage.winner, fame },
        'public'
      )
      ;(s.eventsPlayed ??= []).push({ card: phase.card, turn: s.turn })
      enterP2(ctx)
      return
    }
    case 'compare_standoff': {
      // Only the tied PARTICIPANTS confirm the standoff — a non-tied leader is a
      // spectator here and must not block the tie-break (that stall was the "click
      // Resolve the Conflict, nothing happens until the timer" bug in 3-player games).
      const participants = stage.participants.filter((seat) => s.activeSeats.includes(seat))
      if (!participants.every((seat) => stage.acked.includes(seat))) return
      phase.stage = { t: 'compare_tiebreak', tiebreak: startTiebreak(ctx, participants, 'event') }
      maybeAdvanceP1(ctx)
      return
    }
    case 'compare_tiebreak': {
      const result = settleTiebreakRound(ctx, stage.tiebreak, { teamsWin: !!s.meta.teams })
      if (result === null) return
      const winner: EventWinner | null =
        result.kind === 'empty'
          ? null
          : result.kind === 'team'
            ? { kind: 'team', team: result.team }
            : { kind: 'seat', seat: result.seat }
      phase.stage = {
        t: 'compare_ack',
        winner,
        acked: [],
        ...(stage.tiebreak.lastRevealed
          ? { tiebreakChoices: stage.tiebreak.lastRevealed.choices }
          : {})
      }
      maybeAdvanceP1(ctx) // in case no active seat needs to ack (degenerate)
      return
    }
    case 'discard_commit': {
      if (!allActiveIn(s, committedSeats(stage.amounts))) return
      const resource = DISCARD_EVENT_RESOURCE[
        phase.card as keyof typeof DISCARD_EVENT_RESOURCE
      ] as ResourceType
      const amounts: Partial<Record<SeatId, number>> = {}
      for (const seat of s.activeSeats) {
        const amount = stage.amounts[seat] ?? 0
        amounts[seat] = amount
        const inv = s.inventories[seat]
        if (inv) inv.resources[resource] -= amount
      }
      emit(ctx, 'event.discardsRevealed', { amounts }, 'public')
      const max = Math.max(...s.activeSeats.map((seat) => amounts[seat] ?? 0))
      const qualifiers = s.activeSeats.filter((seat) => (amounts[seat] ?? 0) === max)
      if (qualifiers.length === 1) {
        resolveDiscardWinner(ctx, qualifiers[0] as SeatId, amounts)
      } else {
        // Includes the all-zero case: everyone discarded equally, all qualify (rulebook).
        phase.stage = {
          t: 'discard_tiebreak',
          revealed: amounts,
          tiebreak: startTiebreak(ctx, qualifiers, 'event')
        }
      }
      return
    }
    case 'discard_tiebreak': {
      const result = settleTiebreakRound(ctx, stage.tiebreak, { teamsWin: false })
      if (result === null) return
      resolveDiscardWinner(
        ctx,
        result.kind === 'seat' ? result.seat : null,
        stage.revealed,
        stage.tiebreak.lastRevealed?.choices
      )
      return
    }
    case 'discard_ack': {
      if (!allActiveIn(s, stage.acked)) return
      enterP2(ctx)
      return
    }
  }
}

function applyFame(state: GameState, winner: EventWinner): number {
  if (winner.kind === 'seat') {
    if (state.eliminated.includes(winner.seat)) return 0
    const pool = state.values[valuesIndexFor(state, winner.seat)] as Values
    pool.fame += 1
    return 1
  }
  const team = state.meta.teams?.[winner.team] ?? []
  if (!team.some((seat) => state.activeSeats.includes(seat))) return 0
  const pool = state.values[winner.team] as Values
  pool.fame += 1
  return 1
}

function resolveDiscardWinner(
  ctx: Ctx,
  winner: SeatId | null,
  revealed: Partial<Record<SeatId, number>>,
  tiebreakChoices?: Partial<Record<SeatId, Rps>>
): void {
  const s = ctx.state
  const phase = s.phase as P1State
  let drewCard = false
  if (winner !== null) {
    const instance = drawActionCard(ctx)
    if (instance) {
      const inv = s.inventories[winner]
      if (inv) {
        inv.hand.push(instance)
        drewCard = true
        emit(
          ctx,
          'event.cardAwarded',
          { seat: winner, instanceId: instance.instanceId, card: instance.card },
          visibilityGroup(s, winner)
        )
      }
    }
  }
  emit(ctx, 'event.resolved', { card: phase.card, kind: 'discard', winner, drewCard }, 'public')
  ;(s.eventsPlayed ??= []).push({ card: phase.card, turn: s.turn })
  phase.stage = {
    t: 'discard_ack',
    winner,
    drewCard,
    acked: [],
    revealed,
    ...(tiebreakChoices ? { tiebreakChoices } : {})
  }
  maybeAdvanceP1(ctx)
}

// --- Tie-break wiring (§11) ------------------------------------------------------------------

export function startTiebreak(ctx: Ctx, participants: SeatId[], context: string): TieBreakState {
  const tiebreak: TieBreakState = { participants: [...participants], round: 1, choices: {} }
  emit(
    ctx,
    'tiebreak.roundStarted',
    { context, participants: tiebreak.participants, round: 1 },
    'public'
  )
  return tiebreak
}

export type TiebreakResult =
  { kind: 'seat'; seat: SeatId } | { kind: 'team'; team: TeamId } | { kind: 'empty' }

/**
 * Advance one tie-break: resolves the round if all choices are in, shrinking
 * participants (losers drop out) until one winner. Returns null while unresolved.
 * With teamsWin (2v2 compare events), the tie ends as soon as every survivor
 * belongs to one team (I-3).
 */
export function settleTiebreakRound(
  ctx: Ctx,
  tiebreak: TieBreakState,
  opts: { teamsWin: boolean }
): TiebreakResult | null {
  const s = ctx.state
  for (;;) {
    if (tiebreak.participants.length === 0) return { kind: 'empty' }
    if (opts.teamsWin) {
      const teams = new Set(tiebreak.participants.map((seat) => teamOfSeat(s, seat)))
      if (teams.size === 1) {
        const team = [...teams][0] as TeamId
        emit(ctx, 'tiebreak.resolved', { winner: { kind: 'team', team } }, 'public')
        return { kind: 'team', team }
      }
    } else if (tiebreak.participants.length === 1) {
      const seat = tiebreak.participants[0] as SeatId
      emit(ctx, 'tiebreak.resolved', { winner: { kind: 'seat', seat } }, 'public')
      return { kind: 'seat', seat }
    }
    const missed = tiebreak.missed ?? []
    if (
      !tiebreak.participants.every(
        (seat) => tiebreak.choices[seat] !== undefined || missed.includes(seat)
      )
    )
      return null
    emit(
      ctx,
      'tiebreak.choicesRevealed',
      { round: tiebreak.round, choices: { ...tiebreak.choices }, missed: [...missed] },
      'public'
    )
    // Same payload the event stream just made public — kept on state so the
    // view can show participants the reveal (spread: replayable over
    // pre-field snapshots).
    tiebreak.lastRevealed = { round: tiebreak.round, choices: { ...tiebreak.choices } }
    // User rule: whoever missed the deadline chose nothing and loses this
    // round outright; the players who did choose resolve among themselves.
    // Everyone missed → nobody survives (empty result on the next loop pass).
    const choosers = tiebreak.participants.filter((seat) => tiebreak.choices[seat] !== undefined)
    const survivors =
      choosers.length <= 1 ? choosers : tiebreakSurvivors(choosers, tiebreak.choices)
    tiebreak.participants = survivors
    tiebreak.round += 1
    tiebreak.choices = {}
    tiebreak.missed = []
    if (
      survivors.length > 1 &&
      !(opts.teamsWin && new Set(survivors.map((x) => teamOfSeat(s, x))).size === 1)
    ) {
      emit(
        ctx,
        'tiebreak.roundStarted',
        { participants: survivors, round: tiebreak.round },
        'public'
      )
      return null
    }
    // Single survivor (or one team left): loop once more to emit the resolution.
  }
}

function teamOfSeat(state: GameState, seat: SeatId): TeamId {
  return state.meta.teams && state.meta.teams[0].includes(seat) ? 0 : 1
}

// --- P2 Distribution (§6) ------------------------------------------------------------------------

function maybeAdvanceP2(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P2State
  // Second call: the board is already revealed and we are waiting for the table
  // to finish looking at it.
  if (phase.revealed) {
    if (s.activeSeats.every((seat) => phase.revealed?.acked.includes(seat))) leaveP2(ctx)
    return
  }
  if (!allActiveIn(s, committedSeats(phase.committed))) return
  const placements: Placement[] = []
  for (const seat of s.activeSeats) {
    for (const p of phase.committed[seat] ?? []) placements.push(p)
  }
  s.board.placements = placements
  emit(
    ctx,
    'distribution.revealed',
    {
      placements: placements.map((p) => ({
        actorId: p.actorId,
        seat: p.seat,
        actorType: p.actorType,
        locationId: p.locationId
        // arguments and bets stay hidden until P4 reveal (rulebook)
      }))
    },
    'public'
  )
  // Hold here: everyone can now see where everyone else stands, and that is worth
  // a beat of its own (author request). Consensus or the deadline moves the turn on.
  phase.revealed = { acked: [] }
  maybeAdvanceP2(ctx) // nobody left to look (all eliminated) → do not wedge the turn
}

/**
 * The reveal has been seen: on to the Action Phase, or straight to the Conflicts.
 *
 * Turn 1 skips P3 as well (rulebook §Turn Structure): hands start empty and the
 * only two ways to get an Action Card — winning a discard Event (P1, skipped on
 * turn 1) or buying at the Market (end of the turn) — cannot have fired yet, so
 * the phase could only ask everyone to press "Play No Cards". Deliberately keyed
 * on turn 1 and not on "nobody holds a card": on any later turn an empty hand is
 * information (the others' selections are still hidden), and tie-breaker turns
 * (turn > maxTurns) are late turns where players do hold cards.
 */
function leaveP2(ctx: Ctx): void {
  if (ctx.state.turn === 1) enterP4(ctx)
  else enterP3(ctx)
}

// --- P3 Action (§7) ---------------------------------------------------------------------------------

function maybeAdvanceP3(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P3State
  switch (phase.step.t) {
    case 'blocks_ack':
      if (allActiveIn(s, phase.step.acked)) proceedAfterBlocks(ctx)
      return
    case 'relocations_ack':
      if (allActiveIn(s, phase.step.acked)) enterExchangeStepOrP4(ctx)
      return
    case 'exchanges_ack':
      if (allActiveIn(s, phase.step.acked)) enterP4(ctx)
      return
    case 'select':
      if (!allActiveIn(s, committedSeats(phase.step.committed))) return
      revealSelectionsAndApplyBlocks(ctx)
      return
    case 'relocate':
      maybeAdvanceRelocate(ctx)
      return
    case 'relocate_tiebreak':
      maybeAdvanceRelocateTiebreak(ctx)
      return
    case 'exchange':
      processExchangeQueue(ctx)
      return
  }
}

/** Public play log (rulebook §Open Information). ??= keeps pre-log snapshots replayable. */
function recordPlayed(s: GameState, seat: SeatId, card: ActionCardId): void {
  ;(s.played ??= []).push({ seat, card, turn: s.turn })
}

function revealSelectionsAndApplyBlocks(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P3State
  const step = phase.step as Extract<P3State['step'], { t: 'select' }>
  phase.selected = {}
  const summary: { seat: SeatId; block: number; relocation: number; exchange: number }[] = []
  for (const seat of s.activeSeats) {
    const ids = step.committed[seat] ?? []
    phase.selected[seat] = [...ids]
    const hand = s.inventories[seat]?.hand ?? []
    const kinds = ids.map((id) => {
      const instance = hand.find((c) => c.instanceId === id)
      if (!instance) reject('internal', `selected card ${id} vanished from seat ${seat} hand`)
      return actionCardKind(instance.card)
    })
    summary.push({
      seat,
      block: kinds.filter((k) => k === 'block').length,
      relocation: kinds.filter((k) => k === 'relocation').length,
      exchange: kinds.filter((k) => k === 'exchange').length
    })
  }
  phase.summary = summary
  emit(ctx, 'action.selectionsRevealed', { selections: summary }, 'public')

  // Step 1 BLOCK — block cards are hardwired to their location (rulebook §7 card list),
  // so the step applies automatically: no further player input exists.
  const blocks: BlockPlay[] = []
  for (const seat of s.activeSeats) {
    const inv = s.inventories[seat]
    if (!inv) continue
    for (const id of phase.selected[seat] ?? []) {
      const instance = inv.hand.find((c) => c.instanceId === id)
      if (!instance || actionCardKind(instance.card) !== 'block') continue
      inv.hand = inv.hand.filter((c) => c.instanceId !== id)
      recordPlayed(s, seat, instance.card)
      const locationId = BLOCK_CARD_LOCATION[instance.card as keyof typeof BLOCK_CARD_LOCATION]
      if (!s.board.disabledLocations.includes(locationId))
        s.board.disabledLocations.push(locationId)
      emit(ctx, 'action.locationBlocked', { seat, card: instance.card, locationId }, 'public')
      blocks.push({ seat, card: instance.card, locationId })
    }
  }

  // Results ceremony: whoever is human reads what the wave changed, bots and
  // deadline defaults ack instantly (legalIntents → action.ack).
  if (blocks.length > 0) {
    phase.step = { t: 'blocks_ack', blocks, acked: [] }
    return
  }
  proceedAfterBlocks(ctx)
}

/** Continuation after the block wave (and its ack screen, when shown). */
function proceedAfterBlocks(ctx: Ctx): void {
  const phase = ctx.state.phase as P3State
  const anyRelocation = (phase.summary ?? []).some((x) => x.relocation > 0)
  if (anyRelocation) {
    phase.step = { t: 'relocate', orders: {} }
    return
  }
  enterExchangeStepOrP4(ctx)
}

// --- P3 step 2 RELOCATE (§7) ---------------------------------------------------------

/** Relocation cards a seat committed to playing (fixed at step-0 reveal). */
export function relocationQuota(state: GameState, seat: SeatId): number {
  const phase = state.phase
  if (phase.kind !== 'p3_action') return 0
  return phase.summary?.find((x) => x.seat === seat)?.relocation ?? 0
}

function maybeAdvanceRelocate(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P3State
  const step = phase.step as Extract<P3State['step'], { t: 'relocate' }>
  const complete = s.activeSeats.every(
    (seat) =>
      (step.orders[seat]?.length ?? 0) + (step.skipped?.[seat] ?? 0) >= relocationQuota(s, seat)
  )
  if (!complete) return
  revealRelocations(ctx)
}

function revealRelocations(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P3State
  const step = phase.step as Extract<P3State['step'], { t: 'relocate' }>
  const orders = step.orders
  emit(ctx, 'action.relocationsRevealed', { orders: { ...orders } }, 'public')

  // All committed relocation cards are consumed now — collision losers' and
  // deadline-skipped cards are "discarded with no effect" (rulebook), winners' apply below.
  for (const seat of s.activeSeats) {
    if ((phase.summary?.find((x) => x.seat === seat)?.relocation ?? 0) === 0) continue
    const inv = s.inventories[seat]
    if (!inv) continue
    const selectedIds = phase.selected[seat] ?? []
    const consumed = inv.hand.filter(
      (c) => c.card === 'relocation' && selectedIds.includes(c.instanceId)
    )
    inv.hand = inv.hand.filter(
      (c) => c.card !== 'relocation' || !selectedIds.includes(c.instanceId)
    )
    for (const card of consumed) recordPlayed(s, seat, card.card)
  }

  // Collision: the same actor sent to different destinations by different seats (§7).
  const byActor = new Map<ActorId, { seat: SeatId; to: LocationId }[]>()
  for (const seat of s.activeSeats) {
    for (const order of orders[seat] ?? []) {
      const list = byActor.get(order.actorId) ?? []
      list.push({ seat, to: order.to })
      byActor.set(order.actorId, list)
    }
  }
  const collisions: RelocationCollision[] = []
  for (const [actorId, contenders] of [...byActor.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (new Set(contenders.map((c) => c.to)).size >= 2) collisions.push({ actorId, contenders })
  }
  if (collisions.length === 0) {
    applyRelocations(ctx, orders, [])
    return
  }
  const first = collisions[0] as RelocationCollision
  phase.step = {
    t: 'relocate_tiebreak',
    orders,
    collisions,
    index: 0,
    tiebreak: startTiebreak(
      ctx,
      first.contenders.map((c) => c.seat),
      'relocation'
    )
  }
}

function maybeAdvanceRelocateTiebreak(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P3State
  const step = phase.step as Extract<P3State['step'], { t: 'relocate_tiebreak' }>
  const result = settleTiebreakRound(ctx, step.tiebreak, { teamsWin: false })
  if (result === null) return
  const collision = step.collisions[step.index] as RelocationCollision
  if (result.kind === 'seat') collision.winner = result.seat
  emit(
    ctx,
    'action.relocationCollision',
    {
      actorId: collision.actorId,
      contenders: collision.contenders,
      winner: collision.winner ?? null
    },
    'public'
  )
  step.index += 1
  const next = step.collisions[step.index]
  if (next) {
    step.tiebreak = startTiebreak(
      ctx,
      next.contenders.map((c) => c.seat).filter((seat) => s.activeSeats.includes(seat)),
      'relocation'
    )
    maybeAdvanceRelocateTiebreak(ctx) // participants may already be < 2 after eliminations
    return
  }
  applyRelocations(ctx, step.orders, step.collisions)
}

/**
 * Apply all relocations simultaneously: collision winners' orders and every
 * non-colliding order; the actor moves with its hidden argument and bet unchanged.
 */
function applyRelocations(
  ctx: Ctx,
  orders: Partial<Record<SeatId, RelocationOrder[]>>,
  collisions: RelocationCollision[]
): void {
  const s = ctx.state
  const moves: RelocationMove[] = []
  const byActor = new Map<ActorId, { seat: SeatId; to: LocationId }[]>()
  for (const seat of s.activeSeats) {
    for (const order of orders[seat] ?? []) {
      const list = byActor.get(order.actorId) ?? []
      list.push({ seat, to: order.to })
      byActor.set(order.actorId, list)
    }
  }
  for (const [actorId, contenders] of [...byActor.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const collision = collisions.find((c) => c.actorId === actorId)
    let target: LocationId | null
    if (collision) {
      target =
        collision.winner !== undefined
          ? (collision.contenders.find((c) => c.seat === collision.winner)?.to ?? null)
          : null // every contender eliminated mid-tie-break → all cards void
    } else {
      target = (contenders[0] as { to: LocationId }).to // same destination for all (I-7)
    }
    if (target === null) continue
    const placement = findPlacement(s, actorId)
    if (!placement) continue // actor's owner eliminated after orders were sealed
    const from = placement.locationId
    if (from === target) continue
    placement.locationId = target
    emit(ctx, 'action.relocated', { actorId, from, to: target }, 'public')
    const bySeat = collisions.find((c) => c.actorId === actorId)?.winner
    moves.push({
      seat: bySeat ?? (contenders[0] as { seat: SeatId }).seat,
      actorId,
      from,
      to: target
    })
  }
  // Relocation cards were committed (this step only runs then) — show the
  // outcome even when every order cancelled out.
  const phase3 = s.phase as P3State
  phase3.step = { t: 'relocations_ack', moves, acked: [] }
}

// --- P3 step 3 EXCHANGE (§7, I-4) ------------------------------------------------------

function enterExchangeStepOrP4(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P3State
  const queue: { seat: SeatId; instanceId: string }[] = []
  for (const seat of s.activeSeats) {
    const inv = s.inventories[seat]
    if (!inv) continue
    for (const id of phase.selected[seat] ?? []) {
      const instance = inv.hand.find((c) => c.instanceId === id)
      if (instance && actionCardKind(instance.card) === 'exchange')
        queue.push({ seat, instanceId: id })
    }
  }
  if (queue.length === 0) {
    enterP4(ctx)
    return
  }
  phase.step = { t: 'exchange', queue, index: 0, applied: [] }
  processExchangeQueue(ctx)
}

const EXCHANGEABLE: readonly (keyof Values)[] = ['power', 'art', 'knowledge']

/** Value types with a positive count in this pool (fame is never exchangeable). */
function exchangeableValues(pool: Values): (keyof Values)[] {
  return EXCHANGEABLE.filter((v) => pool[v] > 0)
}

/** Seats this seat may take a value from (2v2: opposing team only — rulebook). */
function exchangeTargets(state: GameState, seat: SeatId): SeatId[] {
  return state.activeSeats.filter((other) => {
    if (other === seat) return false
    if (state.meta.teams && teamOfSeat(state, other) === teamOfSeat(state, seat)) return false
    const pool = state.values[valuesIndexFor(state, other)] as Values
    return exchangeableValues(pool).length > 0
  })
}

/**
 * Advance the exchange queue: cards whose preconditions fail at application time
 * return to hand (I-4); otherwise wait for the slot owner's action.exchange.
 */
function processExchangeQueue(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P3State
  const step = phase.step as Extract<P3State['step'], { t: 'exchange' }>
  for (;;) {
    const slot = step.queue[step.index]
    if (!slot) {
      const applied = step.applied ?? []
      if (applied.length > 0) {
        phase.step = { t: 'exchanges_ack', exchanges: applied, acked: [] }
        return
      }
      enterP4(ctx)
      return
    }
    if (!s.activeSeats.includes(slot.seat)) {
      step.index += 1
      continue
    }
    const myPool = s.values[valuesIndexFor(s, slot.seat)] as Values
    const giveOptions = exchangeableValues(myPool)
    const targets = exchangeTargets(s, slot.seat)
    if (giveOptions.length === 0 || targets.length === 0) {
      emit(
        ctx,
        'action.exchangeReturned',
        {
          seat: slot.seat,
          instanceId: slot.instanceId,
          reason: giveOptions.length === 0 ? 'no_own_values' : 'no_valid_target'
        },
        'public'
      )
      step.index += 1
      continue
    }
    return // await action.exchange from slot.seat
  }
}

export function applyExchange(
  ctx: Ctx,
  seat: SeatId,
  give: keyof Values,
  from: SeatId,
  take: keyof Values
): void {
  const s = ctx.state
  const phase = s.phase as P3State
  const step = phase.step as Extract<P3State['step'], { t: 'exchange' }>
  const slot = step.queue[step.index] as { seat: SeatId; instanceId: string }
  const myPool = s.values[valuesIndexFor(s, seat)] as Values
  const targetPool = s.values[valuesIndexFor(s, from)] as Values
  myPool[give] -= 1
  myPool[take] += 1
  targetPool[take] -= 1
  targetPool[give] += 1
  const inv = s.inventories[seat]
  if (inv) inv.hand = inv.hand.filter((c) => c.instanceId !== slot.instanceId)
  recordPlayed(s, seat, 'change_values')
  emit(ctx, 'action.exchanged', { seat, from, give, take }, 'public')
  // spread keeps pre-field snapshots (applied undefined) replayable
  step.applied = [...(step.applied ?? []), { seat, from, give, take }]
  step.index += 1
  processExchangeQueue(ctx)
}

// --- P4 Conflict (§8) ------------------------------------------------------------------------------------

export function enterP4(ctx: Ctx): void {
  const s = ctx.state
  const groups = detectGroups(s)
  const conflicts = groups.filter((g) => g.actorIds.length >= 2)
  emit(ctx, 'conflict.detected', { conflicts }, 'public')

  // The phase always opens, even with nothing to resolve (author: "Фазу 4
  // необходимо показывать!"). It used to jump straight to the Market when no two
  // Actors met, which left the table wondering what had just happened to their
  // turn. Its summary stage is where a conflict-free turn gets explained.
  s.phase = {
    kind: 'p4_conflict',
    conflicts,
    index: 0,
    stage: { t: 'reveal_ack', acked: [] },
    summary: []
  }
  const phase = s.phase

  // Peaceful actors (§8.1): unopposed at an enabled location → Win; win bet succeeds,
  // draw/lose bets fail. Actors at disabled locations get nothing (bets burn silently).
  for (const group of groups) {
    if (group.actorIds.length !== 1) continue
    const placement = s.board.placements.find((p) => p.actorId === group.actorIds[0])
    if (!placement) continue
    const reward = grantReward(ctx, placement, 'win', placement.bet === 'win')
    const results: TurnSummaryResult[] = [
      {
        actorId: placement.actorId,
        seat: placement.seat,
        outcome: 'win',
        winBet: placement.bet === 'win',
        reward
      }
    ]
    recordSummary(phase, {
      locationId: group.locationId,
      actorType: group.actorType,
      peaceful: true,
      results
    })
    emit(
      ctx,
      'conflict.rewards',
      {
        locationId: group.locationId,
        actorType: group.actorType,
        peaceful: true,
        results
      },
      'public'
    )
  }

  if (conflicts.length === 0) {
    openSummary(ctx)
    return
  }
  openConflict(ctx)
}

/**
 * Close Phase 4 with its summary instead of walking straight out of it. Waits on
 * every ACTIVE seat (not just the seats that had a conflict) — it is the table's
 * recap. `endP4` runs on consensus, or when the server's ack deadline fires.
 */
function openSummary(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P4State
  phase.stage = { t: 'summary_ack', acked: [] }
  delete phase.resolution
  emit(ctx, 'conflict.summary', { entries: phase.summary }, 'public')
  // Nobody left to read it (every seat eliminated) — do not wedge the turn.
  maybeAdvanceP4(ctx)
}

export function endP4(ctx: Ctx): void {
  const s = ctx.state
  s.board.placements = [] // actors return to their owners
  if (isLastTurn(s)) runScoring(ctx)
  else enterP5(ctx)
}

function findPlacement(state: GameState, actorId: string): Placement | undefined {
  return state.board.placements.find((p) => p.actorId === actorId)
}

function involvedActiveSeats(state: GameState, conflict: ConflictGroup): SeatId[] {
  return state.activeSeats.filter((seat) =>
    conflict.actorIds.some((id) => id.startsWith(`${seat}:`))
  )
}

/**
 * Open conflicts[index]: arguments stay hidden until every involved seat sends
 * conflict.reveal.ack (rulebook: players click "Reveal Conflict" first). Conflicts
 * reduced below 2 participants by eliminations resolve trivially and are skipped.
 */
function openConflict(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P4State
  for (;;) {
    const conflict = phase.conflicts[phase.index]
    if (!conflict) {
      openSummary(ctx)
      return
    }
    if (conflict.actorIds.length < 2) {
      resolveUnopposed(ctx, phase.index, conflict)
      phase.index += 1
      continue
    }
    phase.stage = { t: 'reveal_ack', acked: [] }
    delete phase.resolution
    emit(
      ctx,
      'conflict.opened',
      {
        index: phase.index,
        locationId: conflict.locationId,
        actorType: conflict.actorType,
        actorIds: conflict.actorIds
      },
      'public'
    )
    return
  }
}

/**
 * Reduced below 2 actors by eliminations → the survivor (if any) wins unopposed,
 * like a peaceful actor. Shared by pre-open skipping and mid-ack shrinkage.
 */
function resolveUnopposed(ctx: Ctx, index: number, conflict: ConflictGroup): void {
  const placement =
    conflict.actorIds.length === 1
      ? findPlacement(ctx.state, conflict.actorIds[0] as ActorId)
      : undefined
  if (!placement) return
  const reward = grantReward(ctx, placement, 'win', placement.bet === 'win')
  const results: TurnSummaryResult[] = [
    {
      actorId: placement.actorId,
      seat: placement.seat,
      outcome: 'win',
      winBet: placement.bet === 'win',
      reward
    }
  ]
  // Everyone else was eliminated out of this group, so nobody actually fought
  // here — the summary says "stood alone", which is what the table saw.
  recordSummary(ctx.state.phase as P4State, {
    locationId: conflict.locationId,
    actorType: conflict.actorType,
    peaceful: true,
    results
  })
  emit(
    ctx,
    'conflict.rewards',
    {
      index,
      locationId: conflict.locationId,
      actorType: conflict.actorType,
      results
    },
    'public'
  )
}

/** All involved seats acked the open → reveal arguments+bets and run round 1 (§8.2). */
function beginResolution(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P4State
  const conflict = phase.conflicts[phase.index] as ConflictGroup
  if (conflict.actorIds.length < 2) {
    // Eliminations emptied the conflict between opening and reveal (the server
    // injects system.eliminate on disconnect): same rule as pre-open shrinkage.
    resolveUnopposed(ctx, phase.index, conflict)
    phase.index += 1
    openConflict(ctx)
    return
  }
  const placements = conflict.actorIds
    .map((id) => findPlacement(s, id))
    .filter((p): p is Placement => p !== undefined)
  emit(
    ctx,
    'conflict.revealed',
    {
      index: phase.index,
      locationId: conflict.locationId,
      actorType: conflict.actorType,
      participants: placements.map((p) => ({
        actorId: p.actorId,
        seat: p.seat,
        argument: p.argument,
        ...(p.bet ? { bet: p.bet } : {})
      }))
    },
    'public'
  )
  const outcomes = baseOutcomes(placements.map((p) => p.argument))
  const resolution: ConflictResolution = {
    outcomes: {},
    winBonusActorIds: [],
    active: [],
    round: 1,
    revealedRps: {},
    politicianRefights: 0,
    deadlockPlayerRounds: 0
  }
  placements.forEach((p, i) => {
    resolution.outcomes[p.actorId] = outcomes[i] as Outcome
  })
  phase.resolution = resolution
  emit(
    ctx,
    'conflict.roundResolved',
    { index: phase.index, round: 1, outcomes: { ...resolution.outcomes } },
    'public'
  )
  applyBets(ctx, placements)
}

/**
 * Bet pipeline (§8.3), round 1 only. Every bet is evaluated against its §8.2 base
 * outcome, then applied in order draw → lose → win:
 * 1. successful draw bets convert their holders draw→win and deny the rest of the
 *    draw group (politicians lose the re-fight they would have had — spec);
 *    multiple conversions → re-resolution among the converted (§8.3.1);
 * 2. any successful lose bet cancels round-1 base rewards; losers without one leave
 *    with nothing; re-resolution among {lose-bettors + win/tied-win actors} (§8.3.2);
 * 3. successful win bets apply their effect once, here: the +1 reward unit is earned
 *    now; later rounds run purely by the standard rules and set only the base reward
 *    (I-2) — the earned bonus is added at finalize.
 */
function applyBets(ctx: Ctx, placements: Placement[]): void {
  const phase = ctx.state.phase as P4State
  const resolution = phase.resolution as ConflictResolution
  const base: Partial<Record<ActorId, Outcome>> = { ...resolution.outcomes }

  const betResults: { actorId: ActorId; seat: SeatId; bet: BetType; success: boolean }[] = []
  for (const p of placements) {
    if (!p.bet) continue
    betResults.push({
      actorId: p.actorId,
      seat: p.seat,
      bet: p.bet,
      success: base[p.actorId] === p.bet
    })
  }
  resolution.betResults = betResults

  // 1. Draw bets
  const drawGroup = placements.filter((p) => base[p.actorId] === 'draw')
  const converted: ActorId[] = []
  if (drawGroup.some((p) => p.bet === 'draw')) {
    for (const p of drawGroup) {
      if (p.bet === 'draw') {
        resolution.outcomes[p.actorId] = 'win'
        converted.push(p.actorId)
      } else {
        resolution.outcomes[p.actorId] = 'lose' // denied the draw reward
      }
    }
  }

  // 3. Win bets (order does not matter for the modifier — recorded before rounds run)
  for (const p of placements) {
    if (p.bet === 'win' && base[p.actorId] === 'win') resolution.winBonusActorIds.push(p.actorId)
  }

  if (betResults.length > 0)
    emit(ctx, 'conflict.betsApplied', { index: phase.index, bets: betResults }, 'public')

  // 2. Lose bets
  const loseBettors = placements.filter((p) => p.bet === 'lose' && base[p.actorId] === 'lose')
  if (loseBettors.length > 0) {
    const fighters = placements
      .filter(
        (p) =>
          loseBettors.includes(p) ||
          resolution.outcomes[p.actorId] === 'win' ||
          resolution.outcomes[p.actorId] === 'draw'
      )
      .map((p) => p.actorId)
    startReResolution(ctx, fighters)
    return
  }
  if (converted.length >= 2) {
    startReResolution(ctx, converted)
    return
  }
  settleDraws(ctx)
}

function startReResolution(ctx: Ctx, actors: ActorId[]): void {
  const phase = ctx.state.phase as P4State
  const resolution = phase.resolution as ConflictResolution
  resolution.active = actors
  // Gate: everyone reviews the round that forced the re-fight (throws + bet
  // verdicts) before the fresh rps opens — see maybeAdvanceP4's refight_ack case.
  phase.stage = { t: 'refight_ack', acked: [] }
}

/**
 * Standing draws settle by actor type (§8.5, I-1): politicians re-fight until
 * win/lose; everyone else keeps the draw and takes the draw reward at finalize.
 */
function settleDraws(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P4State
  const conflict = phase.conflicts[phase.index] as ConflictGroup
  const resolution = phase.resolution as ConflictResolution
  const draws = conflict.actorIds.filter((id) => resolution.outcomes[id] === 'draw')
  if (conflict.actorType === 'politician' && draws.length >= 2) {
    resolution.active = draws
    // Same review gate as startReResolution before the standing-draw re-fight.
    phase.stage = { t: 'refight_ack', acked: [] }
    return
  }
  finalizeConflict(ctx)
}

/** A re-resolution round (§8.4): fresh sealed rock/paper/scissors, no bets. */
function resolveRpsRound(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P4State
  const stage = phase.stage as Extract<P4Stage, { t: 'rps' }>
  const resolution = phase.resolution as ConflictResolution
  const conflict = phase.conflicts[phase.index] as ConflictGroup
  const actors = [...resolution.active]
  // User rule: an owner who missed the deadline chose nothing — their actor
  // loses this round outright; the actors whose owners chose fight it out.
  const missedSeats = new Set(stage.missed ?? [])
  const fighters = actors.filter((id) => !missedSeats.has(seatOfActor(id)))
  const choices = fighters.map((id) => stage.choices[seatOfActor(id)] as Rps)
  const outcomes =
    fighters.length === 0
      ? []
      : fighters.length === 1
        ? (['win'] as Outcome[])
        : baseOutcomes(choices)
  // spread keeps pre-field snapshots (revealedRps undefined) replayable
  resolution.revealedRps = { ...resolution.revealedRps, ...stage.choices }
  resolution.round += 1
  const perActor: Partial<Record<string, Outcome>> = {}
  for (const id of actors) perActor[id] = 'lose' // missed owners
  fighters.forEach((id, i) => {
    perActor[id] = outcomes[i] as Outcome
  })
  emit(
    ctx,
    'conflict.roundResolved',
    {
      index: phase.index,
      round: resolution.round,
      choices: { ...stage.choices },
      missed: [...missedSeats],
      outcomes: perActor
    },
    'public'
  )

  // Everyone missed → everyone loses; no replay, even for politicians
  // (user rule: no pick in time = chose nothing = lost).
  if (fighters.length === 0) {
    for (const id of actors) resolution.outcomes[id] = 'lose'
    resolution.active = []
    finalizeConflict(ctx)
    return
  }

  // Assign every actor's round outcome first — a stale pre-round outcome (converted
  // win, tied-win draw) must never survive into finalize.
  const survivors: ActorId[] = []
  let winner: ActorId | null = null
  for (const id of actors) {
    const outcome = perActor[id] as Outcome
    if (outcome === 'lose') resolution.outcomes[id] = 'lose'
    else if (outcome === 'win') winner = id
    else survivors.push(id)
  }
  if (winner) {
    // a single winner implies no draws in this round — everyone else was set to lose
    resolution.outcomes[winner] = 'win'
    resolution.active = []
    finalizeConflict(ctx)
    return
  }
  // survivors all drew among themselves
  if (conflict.actorType === 'politician') {
    resolution.politicianRefights += 1
    if (resolution.politicianRefights >= POLITICIAN_DEADLOCK_ACTOR_ROUNDS) {
      // §8.6 stage 2: player-level tie-break among the owners, capped at 10 rounds.
      resolution.active = survivors
      const owners = survivors
        .map((id) => seatOfActor(id))
        .filter((seat) => s.activeSeats.includes(seat))
      phase.stage = {
        t: 'deadlock_tiebreak',
        tiebreak: startTiebreak(ctx, owners, 'politician_deadlock')
      }
      return
    }
    startReResolution(ctx, survivors)
    return
  }
  for (const id of survivors) resolution.outcomes[id] = 'draw'
  resolution.active = []
  finalizeConflict(ctx)
}

/** Deadlock stage 2 ends with this seat's politician winning (§8.6). */
function resolveDeadlockWinner(ctx: Ctx, seat: SeatId): void {
  const phase = ctx.state.phase as P4State
  const resolution = phase.resolution as ConflictResolution
  emit(ctx, 'tiebreak.resolved', { winner: { kind: 'seat', seat } }, 'public')
  for (const id of resolution.active) {
    resolution.outcomes[id] = seatOfActor(id) === seat ? 'win' : 'lose'
  }
  resolution.active = []
  finalizeConflict(ctx)
}

/** §8.6 endgame: nobody creates power (successful round-1 win bets still pay — I-2). */
function resolveDeadlockAllLose(ctx: Ctx): void {
  const phase = ctx.state.phase as P4State
  const resolution = phase.resolution as ConflictResolution
  emit(ctx, 'conflict.deadlock', { index: phase.index, losers: resolution.active }, 'public')
  for (const id of resolution.active) resolution.outcomes[id] = 'lose'
  resolution.active = []
  finalizeConflict(ctx)
}

/** Rewards apply atomically per conflict at its end (§8.7). */
function finalizeConflict(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P4State
  const conflict = phase.conflicts[phase.index] as ConflictGroup
  const resolution = phase.resolution as ConflictResolution
  const results: TurnSummaryResult[] = []
  for (const id of conflict.actorIds) {
    const placement = findPlacement(s, id)
    if (!placement) continue
    const outcome = resolution.outcomes[id] ?? 'lose'
    const winBet = resolution.winBonusActorIds.includes(id)
    const reward = grantReward(ctx, placement, outcome, winBet)
    results.push({ actorId: id, seat: placement.seat, outcome, winBet, reward })
  }
  recordSummary(phase, {
    locationId: conflict.locationId,
    actorType: conflict.actorType,
    peaceful: false,
    results
  })
  emit(
    ctx,
    'conflict.rewards',
    {
      index: phase.index,
      locationId: conflict.locationId,
      actorType: conflict.actorType,
      results
    },
    'public'
  )
  phase.stage = { t: 'result_ack', acked: [] }
  maybeAdvanceP4(ctx) // zero involved active seats → advance immediately
}

function maybeAdvanceP4(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P4State
  // Checked first: the recap runs when the conflicts are done (or there never
  // were any), so `conflicts[index]` is legitimately absent here.
  if (phase.stage.t === 'summary_ack') {
    const stage = phase.stage
    if (s.activeSeats.every((seat) => stage.acked.includes(seat))) endP4(ctx)
    return
  }
  const conflict = phase.conflicts[phase.index]
  if (!conflict) return
  const stage = phase.stage
  switch (stage.t) {
    case 'reveal_ack': {
      const involved = involvedActiveSeats(s, conflict)
      if (involved.every((seat) => stage.acked.includes(seat))) beginResolution(ctx)
      return
    }
    case 'refight_ack': {
      const involved = involvedActiveSeats(s, conflict)
      if (!involved.every((seat) => stage.acked.includes(seat))) return
      const resolution = phase.resolution as ConflictResolution
      // Eliminations during the review can collapse the fight — mirror rps guards.
      if (resolution.active.length <= 1) {
        if (resolution.active.length === 1)
          resolution.outcomes[resolution.active[0] as ActorId] = 'win'
        resolution.active = []
        finalizeConflict(ctx)
        return
      }
      phase.stage = { t: 'rps', choices: {} }
      emit(
        ctx,
        'conflict.roundStarted',
        { index: phase.index, round: resolution.round + 1, actorIds: resolution.active },
        'public'
      )
      return
    }
    case 'rps': {
      const resolution = phase.resolution as ConflictResolution
      if (resolution.active.length === 1) {
        // eliminations left a single fighter → it wins the re-resolution
        resolution.outcomes[resolution.active[0] as ActorId] = 'win'
        resolution.active = []
        finalizeConflict(ctx)
        return
      }
      if (resolution.active.length === 0) {
        finalizeConflict(ctx)
        return
      }
      const owners = resolution.active
        .map((id) => seatOfActor(id))
        .filter((seat) => s.activeSeats.includes(seat))
      const missed = stage.missed ?? []
      if (owners.every((seat) => stage.choices[seat] !== undefined || missed.includes(seat)))
        resolveRpsRound(ctx)
      return
    }
    case 'deadlock_tiebreak': {
      const resolution = phase.resolution as ConflictResolution
      const tiebreak = stage.tiebreak
      if (tiebreak.participants.length === 0) {
        // every owner eliminated mid-deadlock → remaining actors lose
        for (const id of resolution.active) resolution.outcomes[id] = 'lose'
        resolution.active = []
        finalizeConflict(ctx)
        return
      }
      if (tiebreak.participants.length === 1) {
        resolveDeadlockWinner(ctx, tiebreak.participants[0] as SeatId)
        return
      }
      const missed = tiebreak.missed ?? []
      if (
        !tiebreak.participants.every(
          (seat) => tiebreak.choices[seat] !== undefined || missed.includes(seat)
        )
      )
        return
      emit(
        ctx,
        'tiebreak.choicesRevealed',
        { round: tiebreak.round, choices: { ...tiebreak.choices }, missed: [...missed] },
        'public'
      )
      // Deadlock throws are per-seat like re-fight throws — feed the same
      // public revealedRps pipeline the arena already renders (spreads keep
      // pre-field snapshots replayable).
      resolution.revealedRps = { ...resolution.revealedRps, ...tiebreak.choices }
      tiebreak.lastRevealed = { round: tiebreak.round, choices: { ...tiebreak.choices } }
      // User rule: a missed deadline = no choice = the seat loses this round;
      // the seats who chose settle among themselves.
      const choosers = tiebreak.participants.filter((seat) => tiebreak.choices[seat] !== undefined)
      const survivors =
        choosers.length <= 1 ? choosers : tiebreakSurvivors(choosers, tiebreak.choices)
      resolution.deadlockPlayerRounds += 1
      if (survivors.length === 1) {
        resolveDeadlockWinner(ctx, survivors[0] as SeatId)
        return
      }
      if (survivors.length === 0) {
        // Everyone missed — they all chose nothing, they all lose (user rule).
        resolveDeadlockAllLose(ctx)
        return
      }
      if (resolution.deadlockPlayerRounds >= POLITICIAN_DEADLOCK_PLAYER_ROUNDS) {
        resolveDeadlockAllLose(ctx)
        return
      }
      tiebreak.participants = survivors
      tiebreak.round += 1
      tiebreak.choices = {}
      tiebreak.missed = []
      emit(
        ctx,
        'tiebreak.roundStarted',
        { participants: survivors, round: tiebreak.round },
        'public'
      )
      return
    }
    case 'result_ack': {
      const involved = involvedActiveSeats(s, conflict)
      if (involved.every((seat) => stage.acked.includes(seat))) {
        phase.index += 1
        openConflict(ctx)
      }
      return
    }
  }
}

// --- Scoring & finish (§10) ----------------------------------------------------------------------------------

function runScoring(ctx: Ctx): void {
  const s = ctx.state
  const scored = activeSides(s).map((side) => ({
    side,
    vp: victoryPoints(s.values[side.pool] as Values)
  }))
  emit(
    ctx,
    'scoring.result',
    { sides: scored.map((x) => ({ seats: x.side.seats, vp: x.vp })) },
    'public'
  )
  const maxVp = Math.max(...scored.map((x) => x.vp))
  const leaders = scored.filter((x) => x.vp === maxVp)
  if (leaders.length === 1) {
    finishGame(ctx, (leaders[0] as (typeof scored)[number]).side, scored)
    return
  }
  // The tutorial is exactly 3 turns and its HUD says so ("Turn n/3"). Its bot
  // argues at random from turn 2, and three short turns rarely make a VP at all,
  // so a tie is common — and must not drag the lesson into extra tie-breaker
  // turns. Nothing here is rated or recorded, so the leaders simply share it.
  if (ctx.state.meta.mode === 'tutorial') {
    const first = leaders[0] as (typeof scored)[number]
    finishGame(
      ctx,
      first.side,
      scored,
      leaders.flatMap((x) => [...x.side.seats])
    )
    return
  }
  // Tie: non-leaders are eliminated (§10); leaders play this turn's P5, then an extra turn.
  for (const loser of scored.filter((x) => x.vp !== maxVp)) {
    for (const seat of [...loser.side.seats]) {
      eliminateSeat(ctx, seat, 'scoring', loser.vp, { poke: false })
    }
  }
  enterP5(ctx)
}

export function finishGame(
  ctx: Ctx,
  winner: Side,
  scored?: { side: Side; vp: number }[],
  /** Seats that share the win (a tutorial tie). The ranking still lists every
      side on its own row with its own pool — only nobody is told they lost.
      Defaults to the winner's own seats. */
  sharedWinners?: SeatId[]
): void {
  const s = ctx.state
  const vpOf = (side: Side): number =>
    scored?.find((x) => x.side.pool === side.pool)?.vp ??
    victoryPoints(s.values[side.pool] as Values)

  const ranking: RankingEntry[] = []
  if (s.meta.teams) {
    const winnerTeam = s.meta.teams[winner.pool as TeamId] as SeatId[]
    const loserPool = (winner.pool === 0 ? 1 : 0) as TeamId
    const loserTeam = s.meta.teams[loserPool] as SeatId[]
    const loserActive = loserTeam.some((seat) => s.activeSeats.includes(seat))
    const loserVp = loserActive
      ? vpOf({ seats: loserTeam, pool: loserPool })
      : Math.max(0, ...s.eliminationLog.filter((e) => loserTeam.includes(e.seat)).map((e) => e.vp))
    ranking.push({ seats: [...winnerTeam], vp: vpOf(winner) })
    ranking.push({ seats: [...loserTeam], vp: loserVp })
    s.phase = { kind: 'finished', winnerSeats: sharedWinners ?? [...winnerTeam], ranking }
  } else {
    ranking.push({ seats: [...winner.seats], vp: vpOf(winner) })
    const othersActive = (scored ?? [])
      .filter((x) => x.side.pool !== winner.pool)
      .sort((a, b) => b.vp - a.vp || (a.side.seats[0] as number) - (b.side.seats[0] as number))
    for (const x of othersActive) ranking.push({ seats: [...x.side.seats], vp: x.vp })
    const eliminatedEntries = [...s.eliminationLog].sort(
      (a, b) => b.turn - a.turn || b.vp - a.vp || a.seat - b.seat
    )
    for (const e of eliminatedEntries) ranking.push({ seats: [e.seat], vp: e.vp })
    s.phase = { kind: 'finished', winnerSeats: sharedWinners ?? [...winner.seats], ranking }
  }
  // Final pools ride along (per team in 2v2): the score screen shows what the
  // VP were made of. Mutating the shared entries also updates s.phase.ranking.
  for (const entry of ranking)
    entry.values = { ...(s.values[valuesIndexFor(s, entry.seats[0] as SeatId)] as Values) }
  emit(ctx, 'game.finished', { winnerSeats: s.phase.winnerSeats, ranking }, 'public')
}

// --- Elimination (§12) -------------------------------------------------------------------------------------------

export function eliminateSeat(
  ctx: Ctx,
  seat: SeatId,
  reason: 'disconnect' | 'forfeit' | 'scoring',
  vpOverride?: number,
  opts?: { poke?: boolean }
): void {
  const s = ctx.state
  if (s.phase.kind === 'finished' || s.eliminated.includes(seat)) return
  const pool = valuesIndexFor(s, seat)
  const vp = vpOverride ?? (s.meta.teams ? 0 : victoryPoints(s.values[pool] as Values))
  s.activeSeats = s.activeSeats.filter((x) => x !== seat)
  s.eliminated.push(seat)
  s.eliminationLog.push({ seat, turn: s.turn, vp })
  s.inventories[seat] = { resources: { ...ZERO_RESOURCES }, hand: [] }
  if (!s.meta.teams) {
    s.values[pool] = { ...ZERO_VALUES }
  } else {
    const team = s.meta.teams[pool as TeamId] as SeatId[]
    if (!team.some((x) => s.activeSeats.includes(x))) s.values[pool] = { ...ZERO_VALUES }
  }
  s.board.placements = s.board.placements.filter((p) => p.seat !== seat)
  prunePendingInputs(s, seat)
  emit(ctx, 'player.eliminated', { seat, reason }, 'public')

  const sides = activeSides(s)
  if (sides.length <= 1) {
    if (sides.length === 1) finishGame(ctx, sides[0] as Side)
    else {
      s.phase = { kind: 'finished', winnerSeats: [], ranking: [] }
      emit(ctx, 'game.finished', { winnerSeats: [], ranking: [] }, 'public')
    }
    return
  }
  if (opts?.poke !== false) maybeAdvanceStage(ctx)
}

/** Discard a seat's pending sealed data so consensus recomputes without it (§12). */
function prunePendingInputs(state: GameState, seat: SeatId): void {
  const phase = state.phase
  switch (phase.kind) {
    case 'p1_event': {
      const stage = phase.stage
      if (stage.t === 'compare_ack' || stage.t === 'discard_ack')
        stage.acked = stage.acked.filter((x) => x !== seat)
      if (stage.t === 'compare_standoff') {
        stage.acked = stage.acked.filter((x) => x !== seat)
        stage.participants = stage.participants.filter((x) => x !== seat)
      }
      if (stage.t === 'discard_commit') delete stage.amounts[seat]
      if (stage.t === 'compare_tiebreak' || stage.t === 'discard_tiebreak')
        pruneTiebreak(stage.tiebreak, seat)
      return
    }
    case 'p2_distribution':
      delete phase.committed[seat]
      if (phase.revealed) phase.revealed.acked = phase.revealed.acked.filter((x) => x !== seat)
      return
    case 'p3_action': {
      delete phase.selected[seat]
      const step = phase.step
      if (step.t === 'select') delete step.committed[seat]
      if (step.t === 'relocate') delete step.orders[seat]
      if (step.t === 'relocate_tiebreak') pruneTiebreak(step.tiebreak, seat)
      if (step.t === 'exchange')
        step.queue = step.queue.filter((q, i) => i < step.index || q.seat !== seat)
      return
    }
    case 'p4_conflict': {
      const stage = phase.stage
      if (
        stage.t === 'reveal_ack' ||
        stage.t === 'result_ack' ||
        stage.t === 'refight_ack' ||
        stage.t === 'summary_ack'
      )
        stage.acked = stage.acked.filter((x) => x !== seat)
      if (stage.t === 'rps') {
        delete stage.choices[seat]
        if (stage.missed) stage.missed = stage.missed.filter((x) => x !== seat)
      }
      if (stage.t === 'deadlock_tiebreak') pruneTiebreak(stage.tiebreak, seat)
      if (phase.resolution)
        phase.resolution.active = phase.resolution.active.filter(
          (actorId) => !actorId.startsWith(`${seat}:`)
        )
      for (const conflict of phase.conflicts)
        conflict.actorIds = conflict.actorIds.filter((id) => !id.startsWith(`${seat}:`))
      return
    }
    case 'p5_market':
      delete phase.staged[seat]
      phase.done = phase.done.filter((x) => x !== seat)
      return
    case 'finished':
      return
  }
}

function pruneTiebreak(tiebreak: TieBreakState, seat: SeatId): void {
  tiebreak.participants = tiebreak.participants.filter((x) => x !== seat)
  delete tiebreak.choices[seat]
  if (tiebreak.missed) tiebreak.missed = tiebreak.missed.filter((x) => x !== seat)
}

// --- P5 Market (§9) -----------------------------------------------------------------------------------------------

function maybeAdvanceP5(ctx: Ctx): void {
  const s = ctx.state
  const phase = s.phase as P5State
  if (!s.activeSeats.every((seat) => phase.done.includes(seat))) return
  // Apply sealed buys in seat order (I-5); a buy the deck can no longer satisfy is void.
  phase.bought = {}
  for (const seat of s.activeSeats) {
    const requested = phase.staged[seat] ?? 0
    if (requested === 0) {
      // "Didn't buy" is a fact the recap states too — 0 cards, not silence.
      phase.bought[seat] = 0
      continue
    }
    const inv = s.inventories[seat]
    if (!inv) continue
    let bought = 0
    for (let i = 0; i < requested; i++) {
      const instance = drawActionCard(ctx)
      if (!instance) break
      for (const [resource, cost] of Object.entries(MARKET_COST) as [ResourceType, number][])
        inv.resources[resource] -= cost
      inv.hand.push(instance)
      emit(
        ctx,
        'market.cardDrawn',
        { seat, instanceId: instance.instanceId, card: instance.card },
        visibilityGroup(s, seat)
      )
      bought += 1
    }
    phase.bought[seat] = bought
    emit(ctx, 'market.bought', { seat, requested, bought }, 'public')
  }
  enterTurn(ctx)
}

// --- Consensus dispatcher ---------------------------------------------------------------------------------------------

export function maybeAdvanceStage(ctx: Ctx): void {
  switch (ctx.state.phase.kind) {
    case 'p1_event':
      return maybeAdvanceP1(ctx)
    case 'p2_distribution':
      return maybeAdvanceP2(ctx)
    case 'p3_action':
      return maybeAdvanceP3(ctx)
    case 'p4_conflict':
      return maybeAdvanceP4(ctx)
    case 'p5_market':
      return maybeAdvanceP5(ctx)
    case 'finished':
      return
  }
}

// --- Timeout defaults -------------------------------------------------------------------------------------------------

/**
 * The engine-defined default action for a seat when the server fires system.timeout:
 * passive where possible (ack / discard 0 / select nothing / done), random where an
 * input is structurally required (tie-break choices, distribution placements).
 */
/** Timeout default for a pending exchange slot: a uniformly random legal exchange. */
function randomExchange(ctx: Ctx, seat: SeatId): Intent | null {
  const s = ctx.state
  const myPool = s.values[valuesIndexFor(s, seat)] as Values
  const giveOptions = exchangeableValues(myPool)
  const targets = exchangeTargets(s, seat)
  if (giveOptions.length === 0 || targets.length === 0) return null
  const give = giveOptions[drawBelow(ctx, giveOptions.length)] as ValueType
  const from = targets[drawBelow(ctx, targets.length)] as SeatId
  const targetPool = s.values[valuesIndexFor(s, from)] as Values
  const takeOptions = exchangeableValues(targetPool)
  const take = takeOptions[drawBelow(ctx, takeOptions.length)] as ValueType
  return { type: 'action.exchange', give, from, take }
}

export function defaultIntentFor(ctx: Ctx, seat: SeatId): Intent | null {
  const s = ctx.state
  const phase = s.phase
  switch (phase.kind) {
    case 'p1_event': {
      const stage = phase.stage
      if ((stage.t === 'compare_ack' || stage.t === 'discard_ack') && !stage.acked.includes(seat))
        return { type: 'event.ack' }
      // Standoff: only the tied participants owe an ack (spectators never block it).
      if (
        stage.t === 'compare_standoff' &&
        stage.participants.includes(seat) &&
        !stage.acked.includes(seat)
      )
        return { type: 'event.ack' }
      if (stage.t === 'discard_commit' && stage.amounts[seat] === undefined)
        return { type: 'event.discard', amount: 0 }
      // User rule: no pick in time = chose nothing = auto-lose the round.
      if (
        (stage.t === 'compare_tiebreak' || stage.t === 'discard_tiebreak') &&
        stage.tiebreak.participants.includes(seat) &&
        stage.tiebreak.choices[seat] === undefined &&
        !(stage.tiebreak.missed ?? []).includes(seat)
      )
        return { type: 'tiebreak.skip' }
      return null
    }
    case 'p2_distribution':
      // The reveal gate has its own deadline: a seat that never says "seen" must
      // not hold the turn open (checked first — by then nothing is left to place).
      if (phase.revealed)
        return phase.revealed.acked.includes(seat) ? null : { type: 'distribution.reveal.ack' }
      // User rule: the deadline never auto-places — actors the player did not
      // commit simply sit this turn out (the client auto-commits its staged
      // subset just before the deadline; a dead tab commits nothing).
      if (phase.committed[seat] === undefined)
        return { type: 'distribution.commit', placements: [] }
      return null
    case 'p3_action': {
      const step = phase.step
      if (
        (step.t === 'blocks_ack' || step.t === 'relocations_ack' || step.t === 'exchanges_ack') &&
        !step.acked.includes(seat)
      )
        return { type: 'action.ack' }
      if (step.t === 'select' && step.committed[seat] === undefined)
        return { type: 'action.selectCards', cardInstanceIds: [] }
      if (step.t === 'relocate') {
        const pending =
          relocationQuota(s, seat) - (step.orders[seat]?.length ?? 0) - (step.skipped?.[seat] ?? 0)
        // User rule: running out of time never moves an actor for you — the
        // committed cards burn with no effect.
        if (pending > 0) return { type: 'action.relocateSkip' }
      }
      // User rule: no pick in time = chose nothing = auto-lose the round.
      if (
        step.t === 'relocate_tiebreak' &&
        step.tiebreak.participants.includes(seat) &&
        step.tiebreak.choices[seat] === undefined &&
        !(step.tiebreak.missed ?? []).includes(seat)
      )
        return { type: 'tiebreak.skip' }
      if (step.t === 'exchange') {
        const slot = step.queue[step.index]
        if (slot && slot.seat === seat) return randomExchange(ctx, seat)
      }
      return null
    }
    case 'p4_conflict': {
      const stage = phase.stage
      // Author: 15 seconds to read the recap, or sooner if everyone presses Get
      // It. This is the "or the deadline confirms" half — and it is checked
      // before the conflict guard, because the recap outlives the conflicts.
      if (stage.t === 'summary_ack')
        return stage.acked.includes(seat) ? null : { type: 'conflict.summary.ack' }
      const conflict = phase.conflicts[phase.index]
      if (!conflict) return null
      const involved = conflict.actorIds.some((id) => id.startsWith(`${seat}:`))
      if (stage.t === 'reveal_ack' && involved && !stage.acked.includes(seat))
        return { type: 'conflict.reveal.ack' }
      if (stage.t === 'refight_ack' && involved && !stage.acked.includes(seat))
        return { type: 'conflict.refight.ack' }
      if (stage.t === 'result_ack' && involved && !stage.acked.includes(seat))
        return { type: 'conflict.result.ack' }
      // User rule: no pick in time = chose nothing = the actor auto-loses.
      if (stage.t === 'rps') {
        const mustChoose =
          (phase.resolution?.active ?? []).some((id) => id.startsWith(`${seat}:`)) &&
          stage.choices[seat] === undefined &&
          !(stage.missed ?? []).includes(seat)
        if (mustChoose) return { type: 'conflict.rpsSkip' }
      }
      if (
        stage.t === 'deadlock_tiebreak' &&
        stage.tiebreak.participants.includes(seat) &&
        stage.tiebreak.choices[seat] === undefined &&
        !(stage.tiebreak.missed ?? []).includes(seat)
      )
        return { type: 'tiebreak.skip' }
      return null
    }
    case 'p5_market':
      if (!phase.done.includes(seat)) return { type: 'market.done' }
      return null
    case 'finished':
      return null
  }
}
