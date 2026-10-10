// Intent handlers — validate a seat's input against the current phase/stage, record
// it, and let flow.maybeAdvanceStage() decide whether consensus is reached.

import {
  ACTOR_TYPES,
  ALLOWED_LOCATIONS,
  ARGUMENT_TYPES,
  BET_COST,
  DISCARD_EVENT_RESOURCE
} from './constants.js'
import type { Ctx } from './ctx.js'
import { emit, reject } from './ctx.js'
import {
  applyExchange,
  defaultIntentFor,
  eliminateSeat,
  maybeAdvanceStage,
  relocationQuota
} from './flow.js'
import type { Intent, PlacementInput } from './intents.js'
import type { GameState, TieBreakState } from './state.js'
import { actorIdOf, valuesIndexFor, visibilityGroup } from './state.js'
import type { BetType, LocationId, Placement, ResourceType, SeatId } from './types.js'

export function handleIntent(ctx: Ctx, seat: SeatId, intent: Intent): void {
  const s = ctx.state
  if (intent.type === 'system.eliminate') {
    if (s.phase.kind === 'finished') reject('game_finished', 'the game is over')
    requireKnownSeat(s, intent.seat)
    if (s.eliminated.includes(intent.seat))
      reject('already_eliminated', `seat ${intent.seat} is already eliminated`)
    eliminateSeat(ctx, intent.seat, intent.reason)
    return
  }
  if (intent.type === 'system.timeout') {
    if (s.phase.kind === 'finished') reject('game_finished', 'the game is over')
    requireKnownSeat(s, intent.seat)
    requireActive(s, intent.seat)
    const fallback = defaultIntentFor(ctx, intent.seat)
    if (!fallback) reject('nothing_pending', `seat ${intent.seat} has no pending input`)
    handlePlayerIntent(ctx, intent.seat, fallback)
    return
  }
  if (s.phase.kind === 'finished') reject('game_finished', 'the game is over')
  requireKnownSeat(s, seat)
  requireActive(s, seat)
  handlePlayerIntent(ctx, seat, intent)
}

function requireKnownSeat(state: GameState, seat: SeatId): void {
  if (!state.meta.seats.some((m) => m.seat === seat))
    reject('unknown_seat', `seat ${seat} is not part of this game`)
}

function requireActive(state: GameState, seat: SeatId): void {
  if (!state.activeSeats.includes(seat))
    reject('seat_not_active', `seat ${seat} is not active in this game`)
}

function handlePlayerIntent(ctx: Ctx, seat: SeatId, intent: Intent): void {
  switch (intent.type) {
    case 'event.ack':
      return handleEventAck(ctx, seat)
    case 'event.discard':
      return handleEventDiscard(ctx, seat, intent.amount)
    case 'tiebreak.rps':
      return handleTiebreakRps(ctx, seat, intent.choice)
    case 'tiebreak.skip':
      return handleTiebreakSkip(ctx, seat)
    case 'distribution.commit':
      return handleDistributionCommit(ctx, seat, intent.placements)
    case 'action.selectCards':
      return handleSelectCards(ctx, seat, intent.cardInstanceIds)
    case 'action.relocate':
      return handleRelocate(ctx, seat, intent.actorId, intent.to)
    case 'action.exchange':
      return handleExchange(ctx, seat, intent.give, intent.from, intent.take)
    case 'action.ack':
      return handleActionAck(ctx, seat)
    case 'action.relocateSkip':
      return handleRelocateSkip(ctx, seat)
    case 'conflict.reveal.ack':
      return handleConflictAck(ctx, seat, 'reveal_ack')
    case 'conflict.refight.ack':
      return handleConflictAck(ctx, seat, 'refight_ack')
    case 'conflict.result.ack':
      return handleConflictAck(ctx, seat, 'result_ack')
    case 'conflict.summary.ack':
      return handleSummaryAck(ctx, seat)
    case 'distribution.reveal.ack':
      return handleDistributionRevealAck(ctx, seat)
    case 'conflict.rps':
      return handleConflictRps(ctx, seat, intent.choice)
    case 'conflict.rpsSkip':
      return handleConflictRpsSkip(ctx, seat)
    case 'market.buy':
      return handleMarketBuy(ctx, seat)
    case 'market.done':
      return handleMarketDone(ctx, seat)
    case 'system.timeout':
    case 'system.eliminate':
      return reject('internal', 'system intents are handled before dispatch')
  }
}

// --- P1 ------------------------------------------------------------------------

function handleEventAck(ctx: Ctx, seat: SeatId): void {
  const phase = ctx.state.phase
  if (phase.kind !== 'p1_event') reject('wrong_phase', 'event.ack is only valid in P1')
  const stage = phase.stage
  if (stage.t !== 'compare_ack' && stage.t !== 'discard_ack' && stage.t !== 'compare_standoff')
    reject('wrong_stage', 'nothing to acknowledge right now')
  if (stage.acked.includes(seat)) reject('already_committed', 'already acknowledged')
  stage.acked.push(seat)
  emit(ctx, 'event.acked', { seat }, 'public')
  maybeAdvanceStage(ctx)
}

/** Consensus ack of a P3 results screen (blocks / relocations / exchanges). */
function handleActionAck(ctx: Ctx, seat: SeatId): void {
  const phase = ctx.state.phase
  if (phase.kind !== 'p3_action') reject('wrong_phase', 'action.ack is only valid in P3')
  const step = phase.step
  if (step.t !== 'blocks_ack' && step.t !== 'relocations_ack' && step.t !== 'exchanges_ack')
    reject('wrong_stage', 'nothing to acknowledge right now')
  if (step.acked.includes(seat)) reject('already_committed', 'already acknowledged')
  step.acked.push(seat)
  emit(ctx, 'action.acked', { seat }, 'public')
  maybeAdvanceStage(ctx)
}

function handleEventDiscard(ctx: Ctx, seat: SeatId, amount: number): void {
  const s = ctx.state
  const phase = s.phase
  if (phase.kind !== 'p1_event') reject('wrong_phase', 'event.discard is only valid in P1')
  const stage = phase.stage
  if (stage.t !== 'discard_commit') reject('wrong_stage', 'no discard is being collected')
  if (stage.amounts[seat] !== undefined) reject('already_committed', 'already discarded')
  const resource = DISCARD_EVENT_RESOURCE[
    phase.card as keyof typeof DISCARD_EVENT_RESOURCE
  ] as ResourceType
  const owned = s.inventories[seat]?.resources[resource] ?? 0
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > owned)
    reject('invalid_payload', `discard amount must be an integer in [0, ${owned}]`)
  stage.amounts[seat] = amount
  emit(ctx, 'event.discardCommitted', { seat }, 'public')
  maybeAdvanceStage(ctx)
}

// --- Tie-breaks (§11) ---------------------------------------------------------------

/** The tie-break awaiting choices in the current stage, if any. */
function currentTiebreak(state: GameState): TieBreakState | null {
  const phase = state.phase
  if (phase.kind === 'p1_event') {
    if (phase.stage.t === 'compare_tiebreak' || phase.stage.t === 'discard_tiebreak')
      return phase.stage.tiebreak
    return null
  }
  if (phase.kind === 'p3_action' && phase.step.t === 'relocate_tiebreak') return phase.step.tiebreak
  if (phase.kind === 'p4_conflict' && phase.stage.t === 'deadlock_tiebreak')
    return phase.stage.tiebreak
  return null
}

function handleTiebreakRps(ctx: Ctx, seat: SeatId, choice: unknown): void {
  const tiebreak = currentTiebreak(ctx.state)
  if (!tiebreak) reject('wrong_stage', 'no tie-break is running')
  if (!tiebreak.participants.includes(seat))
    reject('not_participant', 'seat is not part of this tie-break')
  if (tiebreak.choices[seat] !== undefined) reject('already_committed', 'choice already made')
  if ((tiebreak.missed ?? []).includes(seat))
    reject('already_committed', 'the choice window has expired for this seat')
  if (choice !== 'rock' && choice !== 'paper' && choice !== 'scissors')
    reject('invalid_payload', 'tie-break choice must be rock, paper or scissors')
  tiebreak.choices[seat] = choice
  emit(ctx, 'tiebreak.choiceCommitted', { seat, round: tiebreak.round }, 'public')
  maybeAdvanceStage(ctx)
}

/**
 * Deadline default (user rule): the seat made no choice in time — it is
 * treated as having chosen nothing and auto-loses this round.
 */
function handleTiebreakSkip(ctx: Ctx, seat: SeatId): void {
  const tiebreak = currentTiebreak(ctx.state)
  if (!tiebreak) reject('wrong_stage', 'no tie-break is running')
  if (!tiebreak.participants.includes(seat))
    reject('not_participant', 'seat is not part of this tie-break')
  if (tiebreak.choices[seat] !== undefined) reject('already_committed', 'choice already made')
  if ((tiebreak.missed ?? []).includes(seat))
    reject('already_committed', 'seat already marked as missed')
  ;(tiebreak.missed ??= []).push(seat)
  emit(ctx, 'tiebreak.choiceMissed', { seat, round: tiebreak.round }, 'public')
  maybeAdvanceStage(ctx)
}

// --- P2 ------------------------------------------------------------------------------

function handleDistributionCommit(ctx: Ctx, seat: SeatId, placements: PlacementInput[]): void {
  const s = ctx.state
  const phase = s.phase
  if (phase.kind !== 'p2_distribution')
    reject('wrong_phase', 'distribution.commit is only valid in P2')
  if (phase.committed[seat]) reject('already_committed', 'placements already committed')
  // Partial commits are legal (user rule): unplaced actors simply sit this
  // turn out — the deadline default commits an empty set, never random moves.
  if (!Array.isArray(placements) || placements.length > 4)
    reject('invalid_payload', 'at most 4 placements (one per actor)')

  const byType = new Map<PlacementInput['actorType'], PlacementInput>()
  for (const input of placements) {
    if (!ACTOR_TYPES.includes(input.actorType))
      reject('invalid_payload', `unknown actor type ${String(input.actorType)}`)
    if (byType.has(input.actorType))
      reject('invalid_payload', `actor type ${input.actorType} placed twice`)
    if (!ARGUMENT_TYPES.includes(input.argument))
      reject('invalid_payload', `unknown argument ${String(input.argument)}`)
    if (!ALLOWED_LOCATIONS[input.actorType].includes(input.locationId))
      reject(
        'invalid_location',
        `${input.actorType} cannot go to ${String(input.locationId)} (allowed: ${ALLOWED_LOCATIONS[input.actorType].join(', ')})`
      )
    if (input.bet !== undefined && !(input.bet in BET_COST))
      reject('invalid_payload', `unknown bet ${String(input.bet)}`)
    byType.set(input.actorType, input)
  }
  const args = new Set(placements.map((p) => p.argument))
  if (args.size !== placements.length)
    reject('invalid_payload', 'placed actors must carry distinct arguments')

  // Bets are paid at commit and never returned (rulebook).
  const inv = s.inventories[seat]
  if (!inv) reject('internal', `seat ${seat} has no inventory`)
  const betCost = new Map<ResourceType, number>()
  for (const input of placements) {
    if (!input.bet) continue
    const resource = BET_COST[input.bet]
    betCost.set(resource, (betCost.get(resource) ?? 0) + 1)
  }
  for (const [resource, cost] of betCost) {
    if (inv.resources[resource] < cost)
      reject(
        'insufficient_resources',
        `bets need ${cost} ${resource}, seat has ${inv.resources[resource]}`
      )
  }
  for (const [resource, cost] of betCost) inv.resources[resource] -= cost

  const stored: Placement[] = ACTOR_TYPES.filter((t) => byType.has(t)).map((actorType) => {
    const input = byType.get(actorType) as PlacementInput
    const placement: Placement = {
      actorId: actorIdOf(seat, actorType),
      seat,
      actorType,
      locationId: input.locationId,
      argument: input.argument
    }
    if (input.bet) placement.bet = input.bet as BetType
    return placement
  })
  phase.committed[seat] = stored
  emit(ctx, 'distribution.committed', { seat }, 'public')
  emit(ctx, 'distribution.staged', { seat, placements: stored }, visibilityGroup(s, seat))
  maybeAdvanceStage(ctx)
}

// --- P3 ------------------------------------------------------------------------------------

function handleSelectCards(ctx: Ctx, seat: SeatId, cardInstanceIds: string[]): void {
  const s = ctx.state
  const phase = s.phase
  if (phase.kind !== 'p3_action' || phase.step.t !== 'select')
    reject('wrong_phase', 'action.selectCards is only valid in P3 step 0')
  if (phase.step.committed[seat]) reject('already_committed', 'selection already committed')
  if (!Array.isArray(cardInstanceIds) || cardInstanceIds.some((id) => typeof id !== 'string'))
    reject('invalid_payload', 'cardInstanceIds must be an array of strings')
  if (new Set(cardInstanceIds).size !== cardInstanceIds.length)
    reject('invalid_payload', 'duplicate card instance ids')
  const hand = s.inventories[seat]?.hand ?? []
  for (const id of cardInstanceIds) {
    if (!hand.some((c) => c.instanceId === id))
      reject('invalid_payload', `card ${id} is not in hand`)
  }
  phase.step.committed[seat] = [...cardInstanceIds]
  emit(ctx, 'action.selectionCommitted', { seat, count: cardInstanceIds.length }, 'public')
  maybeAdvanceStage(ctx)
}

// --- P3 steps 2–3 (§7) -------------------------------------------------------------------------

/**
 * Deadline default for the relocate step (user rule): the committed cards
 * count as played, but no actor moves — never a random relocation.
 */
function handleRelocateSkip(ctx: Ctx, seat: SeatId): void {
  const s = ctx.state
  const phase = s.phase
  if (phase.kind !== 'p3_action' || phase.step.t !== 'relocate')
    reject('wrong_phase', 'action.relocateSkip is only valid in P3 step 2')
  const step = phase.step
  const pending =
    relocationQuota(s, seat) - (step.orders[seat]?.length ?? 0) - (step.skipped?.[seat] ?? 0)
  if (pending <= 0) reject('nothing_pending', 'no relocation cards left to skip')
  // spread keeps pre-field snapshots (skipped undefined) replayable
  step.skipped = { ...(step.skipped ?? {}), [seat]: (step.skipped?.[seat] ?? 0) + pending }
  emit(ctx, 'action.relocationsSkipped', { seat, count: pending }, 'public')
  maybeAdvanceStage(ctx)
}

function handleRelocate(ctx: Ctx, seat: SeatId, actorId: unknown, to: unknown): void {
  const s = ctx.state
  const phase = s.phase
  if (phase.kind !== 'p3_action' || phase.step.t !== 'relocate')
    reject('wrong_phase', 'action.relocate is only valid in P3 step 2')
  const step = phase.step
  const quota = relocationQuota(s, seat) - (step.skipped?.[seat] ?? 0)
  const mine = step.orders[seat] ?? []
  if (mine.length >= quota)
    reject('already_committed', 'all committed relocation cards already have orders')
  const placement = s.board.placements.find((p) => p.actorId === actorId)
  if (!placement) reject('invalid_payload', `no actor ${String(actorId)} on the board`)
  if (mine.some((o) => o.actorId === placement.actorId))
    reject('invalid_payload', 'this seat already relocates that actor')
  if (typeof to !== 'string' || !ALLOWED_LOCATIONS[placement.actorType].includes(to as LocationId))
    reject(
      'invalid_location',
      `${placement.actorType} cannot go to ${String(to)} (allowed: ${ALLOWED_LOCATIONS[placement.actorType].join(', ')})`
    )
  if (to === placement.locationId)
    reject('invalid_location', 'relocation must move the actor to another location')
  // Relocation into a disabled location is legal (I-6).
  const order = { actorId: placement.actorId, to: to as LocationId }
  step.orders[seat] = [...mine, order]
  emit(ctx, 'action.relocateCommitted', { seat, count: mine.length + 1 }, 'public')
  emit(ctx, 'action.relocateStaged', { seat, order }, visibilityGroup(s, seat))
  maybeAdvanceStage(ctx)
}

function handleExchange(ctx: Ctx, seat: SeatId, give: unknown, from: unknown, take: unknown): void {
  const s = ctx.state
  const phase = s.phase
  if (phase.kind !== 'p3_action' || phase.step.t !== 'exchange')
    reject('wrong_phase', 'action.exchange is only valid in P3 step 3')
  const step = phase.step
  const slot = step.queue[step.index]
  if (!slot || slot.seat !== seat)
    reject('not_participant', "it is not this seat's turn to exchange")
  const exchangeable = ['power', 'art', 'knowledge']
  if (typeof give !== 'string' || !exchangeable.includes(give))
    reject('invalid_payload', 'give must be power, art or knowledge (never fame)')
  if (typeof take !== 'string' || !exchangeable.includes(take))
    reject('invalid_payload', 'take must be power, art or knowledge (never fame)')
  if (typeof from !== 'number' || !s.activeSeats.includes(from as SeatId) || from === seat)
    reject('invalid_payload', 'from must be another active seat')
  const fromSeat = from as SeatId
  if (s.meta.teams && valuesIndexFor(s, fromSeat) === valuesIndexFor(s, seat))
    reject('invalid_payload', 'in 2v2, exchanges target the opposing team only')
  const myPool = s.values[valuesIndexFor(s, seat)]
  const targetPool = s.values[valuesIndexFor(s, fromSeat)]
  if (!myPool || myPool[give as 'power'] <= 0) reject('invalid_payload', `no ${give} to give away`)
  if (!targetPool || targetPool[take as 'power'] <= 0)
    reject('invalid_payload', `target has no ${take} to take`)
  applyExchange(ctx, seat, give as 'power', fromSeat, take as 'power')
}

/**
 * "I have seen where everyone stands." Every ACTIVE seat is asked, because the
 * revealed board is the whole table's information — not, as in a conflict, only
 * the business of the seats standing in one Location.
 */
function handleDistributionRevealAck(ctx: Ctx, seat: SeatId): void {
  const s = ctx.state
  const phase = s.phase
  if (phase.kind !== 'p2_distribution')
    reject('wrong_phase', 'the distribution reveal is only valid in P2')
  if (!phase.revealed) reject('wrong_stage', 'placements are still being committed')
  if (!s.activeSeats.includes(seat)) reject('not_participant', 'seat is out of the game')
  if (phase.revealed.acked.includes(seat)) reject('already_committed', 'already acknowledged')
  phase.revealed.acked.push(seat)
  emit(ctx, 'distribution.revealAcked', { seat }, 'public')
  maybeAdvanceStage(ctx)
}

// --- P4 (§8) ---------------------------------------------------------------------------------

function handleConflictAck(
  ctx: Ctx,
  seat: SeatId,
  which: 'reveal_ack' | 'refight_ack' | 'result_ack'
): void {
  const s = ctx.state
  const phase = s.phase
  if (phase.kind !== 'p4_conflict') reject('wrong_phase', 'conflict acks are only valid in P4')
  const stage = phase.stage
  if (stage.t !== which) reject('wrong_stage', `expected stage ${which}, got ${stage.t}`)
  const conflict = phase.conflicts[phase.index]
  if (!conflict || !conflict.actorIds.some((id) => id.startsWith(`${seat}:`)))
    reject('not_participant', 'seat has no actor in the current conflict')
  if (stage.acked.includes(seat)) reject('already_committed', 'already acknowledged')
  stage.acked.push(seat)
  emit(ctx, 'conflict.acked', { seat, stage: which }, 'public')
  maybeAdvanceStage(ctx)
}

/**
 * The end-of-Phase-4 summary is the table's, not a conflict's: every ACTIVE seat
 * may close it, including seats that never had an Actor in a conflict — which is
 * the whole point on a turn where no conflict happened at all.
 */
function handleSummaryAck(ctx: Ctx, seat: SeatId): void {
  const s = ctx.state
  const phase = s.phase
  if (phase.kind !== 'p4_conflict') reject('wrong_phase', 'the summary is only valid in P4')
  const stage = phase.stage
  if (stage.t !== 'summary_ack') reject('wrong_stage', `expected summary_ack, got ${stage.t}`)
  if (!s.activeSeats.includes(seat)) reject('not_participant', 'seat is out of the game')
  if (stage.acked.includes(seat)) reject('already_committed', 'already acknowledged')
  stage.acked.push(seat)
  emit(ctx, 'conflict.acked', { seat, stage: 'summary_ack' }, 'public')
  maybeAdvanceStage(ctx)
}

function handleConflictRps(ctx: Ctx, seat: SeatId, choice: unknown): void {
  const s = ctx.state
  const phase = s.phase
  if (phase.kind !== 'p4_conflict') reject('wrong_phase', 'conflict.rps is only valid in P4')
  const stage = phase.stage
  if (stage.t !== 'rps') reject('wrong_stage', 'no re-resolution round is running')
  const active = phase.resolution?.active ?? []
  if (!active.some((id) => id.startsWith(`${seat}:`)))
    reject('not_participant', 'seat has no actor in this re-resolution round')
  if (stage.choices[seat] !== undefined) reject('already_committed', 'choice already made')
  if (choice !== 'rock' && choice !== 'paper' && choice !== 'scissors')
    reject('invalid_payload', 'conflict.rps choice must be rock, paper or scissors')
  stage.choices[seat] = choice
  emit(ctx, 'conflict.choiceCommitted', { seat }, 'public')
  maybeAdvanceStage(ctx)
}

/**
 * Deadline default (user rule): the owner made no choice in time — the actor
 * is treated as having no argument and auto-loses this re-resolution round.
 */
function handleConflictRpsSkip(ctx: Ctx, seat: SeatId): void {
  const s = ctx.state
  const phase = s.phase
  if (phase.kind !== 'p4_conflict') reject('wrong_phase', 'conflict.rpsSkip is only valid in P4')
  const stage = phase.stage
  if (stage.t !== 'rps') reject('wrong_stage', 'no re-resolution round is running')
  const active = phase.resolution?.active ?? []
  if (!active.some((id) => id.startsWith(`${seat}:`)))
    reject('not_participant', 'seat has no actor in this re-resolution round')
  if (stage.choices[seat] !== undefined) reject('already_committed', 'choice already made')
  if ((stage.missed ?? []).includes(seat))
    reject('already_committed', 'seat already marked as missed')
  ;(stage.missed ??= []).push(seat)
  emit(ctx, 'conflict.choiceMissed', { seat }, 'public')
  maybeAdvanceStage(ctx)
}

// --- P5 --------------------------------------------------------------------------------------

function handleMarketBuy(ctx: Ctx, seat: SeatId): void {
  const s = ctx.state
  const phase = s.phase
  if (phase.kind !== 'p5_market') reject('wrong_phase', 'market.buy is only valid in P5')
  if (phase.done.includes(seat)) reject('already_committed', 'shopping already finished')
  if (s.actionDeck.length === 0) reject('deck_empty', 'the action deck is empty')
  const staged = phase.staged[seat] ?? 0
  const inv = s.inventories[seat]
  if (!inv) reject('internal', `seat ${seat} has no inventory`)
  const affordable = Math.min(
    inv.resources.product,
    inv.resources.electricity,
    inv.resources.recycling
  )
  if (staged + 1 > affordable)
    reject('insufficient_resources', 'a buy needs 1 product + 1 electricity + 1 recycling')
  phase.staged[seat] = staged + 1
  emit(ctx, 'market.buyStaged', { seat, staged: staged + 1 }, visibilityGroup(s, seat))
  maybeAdvanceStage(ctx)
}

function handleMarketDone(ctx: Ctx, seat: SeatId): void {
  const phase = ctx.state.phase
  if (phase.kind !== 'p5_market') reject('wrong_phase', 'market.done is only valid in P5')
  if (phase.done.includes(seat)) reject('already_committed', 'shopping already finished')
  phase.done.push(seat)
  emit(ctx, 'market.done', { seat }, 'public')
  maybeAdvanceStage(ctx)
}
