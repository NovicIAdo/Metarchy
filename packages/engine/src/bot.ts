// Random-legal bot: builds a concrete valid intent from legalIntents specs (plus
// state reads for constructive choices). Used by the mass simulation here and as
// the vs_bots seat controller on the game server (plan Stage 2.3).
// Also home of the scripted tutorial "mirror bot" (chooseTutorialBotIntent).

import {
  ALLOWED_LOCATIONS,
  ARGUMENT_TYPES,
  BET_COST,
  MARKET_COST,
  actionCardKind
} from './constants.js'
import type { Intent, PlacementInput } from './intents.js'
import { legalIntents } from './legal.js'
import type { GameState, TieBreakState } from './state.js'
import { valuesIndexFor } from './state.js'
import type { ArgumentType, BetType, LocationId, Rps, SeatId, ValueType, Values } from './types.js'

/** Uniform integer in [0, n) from a [0,1) source. */
type Pick = (n: number) => number

export function makePick(random: () => number): Pick {
  return (n) => Math.min(n - 1, Math.floor(random() * n))
}

const BETS: readonly BetType[] = ['win', 'lose', 'draw']
const EXCHANGEABLE: readonly ValueType[] = ['power', 'art', 'knowledge']

/**
 * A uniformly random legal intent for this seat, or null when the seat has nothing
 * to do. Always returns a constructible intent for every spec legalIntents offers —
 * the simulation asserts exactly that (legalIntents ∘ applyIntent never errors).
 */
export function chooseBotIntent(
  state: GameState,
  seat: SeatId,
  random: () => number
): Intent | null {
  const pick = makePick(random)
  const specs = legalIntents(state, seat)
  if (specs.length === 0) return null
  const spec = specs[pick(specs.length)] as (typeof specs)[number]
  switch (spec.type) {
    case 'event.ack':
      return { type: 'event.ack' }
    case 'event.discard':
      return { type: 'event.discard', amount: pick(spec.max + 1) }
    case 'tiebreak.rps':
      return { type: 'tiebreak.rps', choice: spec.choices[pick(spec.choices.length)] as Rps }
    case 'conflict.rps':
      return { type: 'conflict.rps', choice: spec.choices[pick(spec.choices.length)] as Rps }
    case 'conflict.reveal.ack':
      return { type: 'conflict.reveal.ack' }
    case 'conflict.refight.ack':
      return { type: 'conflict.refight.ack' }
    case 'conflict.result.ack':
      return { type: 'conflict.result.ack' }
    case 'conflict.summary.ack':
      return { type: 'conflict.summary.ack' }
    case 'distribution.reveal.ack':
      return { type: 'distribution.reveal.ack' }
    case 'distribution.commit':
      return randomCommit(state, seat, pick)
    case 'action.selectCards': {
      const chosen = spec.cardInstanceIds.filter(() => pick(2) === 0)
      return { type: 'action.selectCards', cardInstanceIds: chosen }
    }
    case 'action.relocate':
      return randomRelocation(state, seat, pick)
    case 'action.exchange':
      return randomExchange(state, seat, pick)
    case 'action.ack':
      return { type: 'action.ack' }
    case 'market.buy':
      // spec present iff a buy is legal; buy sometimes, otherwise fall through to done
      if (pick(5) < 2) return { type: 'market.buy' }
      return { type: 'market.done' }
    case 'market.done':
      return { type: 'market.done' }
  }
}

/** The throw that LOSES to the given one (rock beats scissors, …). */
const LOSES_TO: Record<Rps, Rps> = { rock: 'scissors', paper: 'rock', scissors: 'paper' }

/**
 * The scripted tutorial "mirror bot" (author spec): on TURN 1 it plays to TEACH,
 * not to win — every teaching moment is guaranteed instead of left to chance.
 *
 * - P2, turn 1: waits for the player's commit, then sends its actors to the SAME
 *   locations with the SAME arguments (never bets). Every actor the player
 *   placed pairs into a conflict that opens as a draw, so the player meets
 *   each draw rule live: politicians re-fight, scientists both take Knowledge,
 *   artists get nothing, robots each mine the location — and a draw bet, if
 *   the player placed one, succeeds.
 * - P2, turns 2-3: one turn of guaranteed draws teaches the rule; a second and
 *   third are just tedious (author feedback). The bot keeps mirroring the
 *   LOCATIONS, so the conflicts still happen everywhere the player went, but
 *   rolls its own arguments — from here the outcomes are anyone's guess.
 * - Live RPS (politician re-fights, event tie-breaks): on turn 1 the first round
 *   repeats the player's throw — one more draw teaches "a draw leads to another
 *   round" — then round 2+ deliberately loses so the tutorial always advances.
 *   From turn 2 the throws are random like everything else (the engine's
 *   deadlock cap still ends any run of draws).
 * - Discard events: always discards 0 — the player wins by discarding ≥ 1,
 *   and a 0/0 tie demonstrates the player-vs-player resolution instead.
 * - The one exception to passivity (author spec): on turn 1 the bot buys ONE
 *   Action Card at the market and plays it on turn 2 — the player must see
 *   that opponents play cards too, and what that does to the board. A drawn
 *   Relocation moves one of the PLAYER's actors (the loudest demo); an
 *   exchange trades with the player; a block just lands. Otherwise no buys.
 *
 * Simultaneous stages return null until the player has moved; the room's
 * scheduler re-polls after every applied intent, and the tutorial room has no
 * deadlines, so waiting is safe.
 */
export function chooseTutorialBotIntent(
  state: GameState,
  seat: SeatId,
  random: () => number
): Intent | null {
  const player = state.activeSeats.find((s) => s !== seat)
  // No human left to mirror (or an unexpected shape) — behave like a normal bot.
  if (player === undefined || state.activeSeats.length !== 2)
    return chooseBotIntent(state, seat, random)
  const phase = state.phase
  // Turn 1 is the scripted lesson; from turn 2 the bot argues for itself.
  const scripted = state.turn === 1
  const pick = makePick(random)
  switch (phase.kind) {
    case 'p1_event': {
      const stage = phase.stage
      if (stage.t === 'compare_ack' || stage.t === 'compare_standoff' || stage.t === 'discard_ack')
        return stage.acked.includes(seat) ? null : { type: 'event.ack' }
      if (stage.t === 'discard_commit')
        return stage.amounts[seat] === undefined ? { type: 'event.discard', amount: 0 } : null
      return tiebreakThrow(stage.tiebreak, seat, player, scripted, pick)
    }
    case 'p2_distribution': {
      // The reveal waits on every active seat, so the bot has to say "seen" too.
      // In the tutorial there is no clock, so the player still reads at their pace.
      if (phase.revealed)
        return phase.revealed.acked.includes(seat) ? null : { type: 'distribution.reveal.ack' }
      if (phase.committed[seat]) return null
      const theirs = phase.committed[player]
      if (!theirs) return null // the mirror needs the player's move first
      // Locations always mirrored (that is what guarantees the conflicts);
      // arguments only on turn 1, when the draws are the lesson.
      const rolled = scripted ? null : shuffledArguments(pick)
      return {
        type: 'distribution.commit',
        placements: theirs.map((p, i) => ({
          actorType: p.actorType,
          locationId: p.locationId,
          argument: rolled ? (rolled[i] as ArgumentType) : p.argument
        }))
      }
    }
    case 'p3_action': {
      const step = phase.step
      if (step.t === 'select') {
        if (step.committed[seat]) return null
        // The card-demo turn: play everything in hand that can complete (the
        // turn-1 market buy — one card). A doomed pick would wedge the step.
        const hand = state.inventories[seat]?.hand ?? []
        const playable = hand.filter((c) => canDemoCard(state, seat, player, c.card))
        return { type: 'action.selectCards', cardInstanceIds: playable.map((c) => c.instanceId) }
      }
      if (step.t === 'relocate') {
        const ordered = new Set((step.orders[seat] ?? []).map((o) => o.actorId))
        // Demo: move one of the PLAYER's actors — the loudest possible lesson —
        // falling back to any actor, then to a skip (burns the card, never wedges).
        const target =
          state.board.placements.find((p) => p.seat === player && !ordered.has(p.actorId)) ??
          state.board.placements.find((p) => !ordered.has(p.actorId))
        const to = target
          ? ALLOWED_LOCATIONS[target.actorType].find((l) => l !== target.locationId)
          : undefined
        if (!target || !to) return { type: 'action.relocateSkip' }
        return { type: 'action.relocate', actorId: target.actorId, to }
      }
      if (step.t === 'exchange') {
        const slot = step.queue[step.index]
        if (!slot || slot.seat !== seat) return null
        const mine = state.values[valuesIndexFor(state, seat)]
        const theirs = state.values[valuesIndexFor(state, player)]
        const give = EXCHANGEABLE.find((v) => (mine?.[v as 'power'] ?? 0) > 0)
        const take = EXCHANGEABLE.find((v) => (theirs?.[v as 'power'] ?? 0) > 0)
        if (!give || !take) return null // guarded at select time
        return { type: 'action.exchange', give, from: player, take }
      }
      if (step.t === 'blocks_ack' || step.t === 'relocations_ack' || step.t === 'exchanges_ack')
        return step.acked.includes(seat) ? null : { type: 'action.ack' }
      return null // relocate_tiebreak: needs two relocators — never the lone demo
    }
    case 'p4_conflict': {
      const stage = phase.stage
      // Ack stages wait only on the seats involved in the current conflict.
      const conflict = phase.conflicts[phase.index]
      const involved = conflict?.actorIds.some((id) => id.startsWith(`${seat}:`)) ?? false
      if (stage.t === 'reveal_ack' || stage.t === 'refight_ack' || stage.t === 'result_ack') {
        if (!involved || stage.acked.includes(seat)) return null
        if (stage.t === 'reveal_ack') return { type: 'conflict.reveal.ack' }
        if (stage.t === 'refight_ack') return { type: 'conflict.refight.ack' }
        return { type: 'conflict.result.ack' }
      }
      // The end-of-phase recap waits on EVERY active seat, so the bot must close
      // its half or the turn never ends. It reads at the player's pace either
      // way: the tutorial has no deadlines, so the player closes theirs when
      // they are ready.
      if (stage.t === 'summary_ack')
        return stage.acked.includes(seat) ? null : { type: 'conflict.summary.ack' }
      if (stage.t === 'rps') {
        if (stage.choices[seat] !== undefined) return null
        if (!scripted) return { type: 'conflict.rps', choice: randomRps(pick) }
        const theirs = stage.choices[player]
        if (theirs === undefined) return null
        // resolution.round is still 1 during the first live re-fight round.
        const round = phase.resolution?.round ?? 1
        return { type: 'conflict.rps', choice: round <= 1 ? theirs : LOSES_TO[theirs] }
      }
      return tiebreakThrow(stage.tiebreak, seat, player, scripted, pick) // deadlock_tiebreak
    }
    case 'p5_market': {
      if (phase.done.includes(seat)) return null
      // Turn 1 only: buy the single card for the turn-2 "opponents play cards
      // too" demo (start 1/1/1 covers the cost; mirroring never spends).
      const resources = state.inventories[seat]?.resources
      const affordable =
        resources !== undefined &&
        (Object.keys(MARKET_COST) as (keyof typeof MARKET_COST)[]).every(
          (r) => resources[r] >= MARKET_COST[r]
        )
      if (state.turn === 1 && (phase.staged[seat] ?? 0) === 0 && affordable)
        return { type: 'market.buy' }
      return { type: 'market.done' }
    }
    case 'finished':
      return null
  }
}

/** Can the bot fully play this card right now? (A wedged pick would stall P3.) */
function canDemoCard(state: GameState, seat: SeatId, player: SeatId, card: string): boolean {
  const kind = actionCardKind(card as Parameters<typeof actionCardKind>[0])
  if (kind === 'block') return true
  if (kind === 'relocation') return state.board.placements.length > 0
  const mine = state.values[valuesIndexFor(state, seat)]
  const theirs = state.values[valuesIndexFor(state, player)]
  return (
    EXCHANGEABLE.some((v) => (mine?.[v as 'power'] ?? 0) > 0) &&
    EXCHANGEABLE.some((v) => (theirs?.[v as 'power'] ?? 0) > 0)
  )
}

/** Turn 1: repeat the player's round-1 throw (the draw lesson), then throw to
    lose. Later turns: an honest random throw, no peeking needed. */
function tiebreakThrow(
  tiebreak: TieBreakState,
  seat: SeatId,
  player: SeatId,
  scripted: boolean,
  pick: Pick
): Intent | null {
  if (!tiebreak.participants.includes(seat)) return null
  if (tiebreak.choices[seat] !== undefined) return null
  if (!scripted) return { type: 'tiebreak.rps', choice: randomRps(pick) }
  const theirs = tiebreak.choices[player]
  if (theirs === undefined) return null
  return { type: 'tiebreak.rps', choice: tiebreak.round <= 1 ? theirs : LOSES_TO[theirs] }
}

const RPS_THROWS: readonly Rps[] = ['rock', 'paper', 'scissors']

function randomRps(pick: Pick): Rps {
  return RPS_THROWS[pick(RPS_THROWS.length)] as Rps
}

/** A random permutation of the four Arguments. A seat's placements must carry
    distinct ones (handlers.ts), and four Actors use up exactly the whole set. */
function shuffledArguments(pick: Pick): ArgumentType[] {
  const args: ArgumentType[] = [...ARGUMENT_TYPES]
  for (let i = args.length - 1; i > 0; i--) {
    const j = pick(i + 1)
    const tmp = args[i] as ArgumentType
    args[i] = args[j] as ArgumentType
    args[j] = tmp
  }
  return args
}

function randomCommit(state: GameState, seat: SeatId, pick: Pick): Intent {
  const inv = state.inventories[seat]
  const budget = { ...(inv?.resources ?? { product: 0, electricity: 0, recycling: 0 }) }
  const args = shuffledArguments(pick)
  const placements: PlacementInput[] = (
    ['politician', 'scientist', 'artist', 'robot'] as const
  ).map((actorType, i) => {
    const allowed = ALLOWED_LOCATIONS[actorType]
    const input: PlacementInput = {
      actorType,
      locationId: allowed[pick(allowed.length)] as LocationId,
      argument: args[i] as ArgumentType
    }
    if (pick(10) < 3) {
      const bet = BETS[pick(BETS.length)] as BetType
      const resource = BET_COST[bet]
      if (budget[resource] > 0) {
        budget[resource] -= 1
        input.bet = bet
      }
    }
    return input
  })
  return { type: 'distribution.commit', placements }
}

function randomRelocation(state: GameState, seat: SeatId, pick: Pick): Intent | null {
  const phase = state.phase
  if (phase.kind !== 'p3_action' || phase.step.t !== 'relocate') return null
  const ordered = new Set((phase.step.orders[seat] ?? []).map((o) => o.actorId))
  const candidates = state.board.placements.filter((p) => !ordered.has(p.actorId))
  if (candidates.length === 0) return null
  const placement = candidates[pick(candidates.length)] as (typeof candidates)[number]
  const options = ALLOWED_LOCATIONS[placement.actorType].filter(
    (loc) => loc !== placement.locationId
  )
  return {
    type: 'action.relocate',
    actorId: placement.actorId,
    to: options[pick(options.length)] as LocationId
  }
}

function randomExchange(state: GameState, seat: SeatId, pick: Pick): Intent | null {
  const myPool = state.values[valuesIndexFor(state, seat)] as Values
  const giveOptions = EXCHANGEABLE.filter((v) => myPool[v as 'power'] > 0)
  const targets = state.activeSeats.filter((other) => {
    if (other === seat) return false
    if (state.meta.teams && valuesIndexFor(state, other) === valuesIndexFor(state, seat))
      return false
    const pool = state.values[valuesIndexFor(state, other)] as Values
    return EXCHANGEABLE.some((v) => pool[v as 'power'] > 0)
  })
  if (giveOptions.length === 0 || targets.length === 0) return null
  const from = targets[pick(targets.length)] as SeatId
  const pool = state.values[valuesIndexFor(state, from)] as Values
  const takeOptions = EXCHANGEABLE.filter((v) => pool[v as 'power'] > 0)
  return {
    type: 'action.exchange',
    give: giveOptions[pick(giveOptions.length)] as ValueType,
    from,
    take: takeOptions[pick(takeOptions.length)] as ValueType
  }
}
