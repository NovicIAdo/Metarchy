// The ranked bot: what fills an empty seat in a rated queue once the 60-second
// wait for a human runs out. It plays to WIN, unlike the tutorial mirror bot
// (which plays to teach) and the random-legal bot (which plays to prove the
// engine never refuses a legal intent).
//
// Every numbered rule below is the author's, verbatim in intent (backlog
// 2026-07-26 §11). The unnumbered ones are ours, marked "(ours)", and exist to
// stop the bot reading like a machine: the guiding principle is that anything
// deterministic is exploitable. A human who learns "its politician always holds
// the Dummy on turn 1" wins every politician conflict forever, so wherever the
// author's rules leave a genuine tie, we break it at random rather than by
// declaration order.
//
// Safety rule for the whole file: never return an intent the engine would
// refuse, and never return a multi-card play that cannot be completed — a
// doomed pick wedges the P3 step and the room waits on a bot that has no legal
// follow-up. Every constructive choice is therefore taken from legalIntents'
// spec or guarded against the same conditions legal.ts checks.

import {
  ACTOR_VALUE,
  ALLOWED_LOCATIONS,
  BET_COST,
  BLOCK_CARD_LOCATION,
  LOCATION_RESOURCE,
  MARKET_COST,
  actionCardKind
} from './constants.js'
import type { BlockCardId } from './constants.js'
import type { Intent, PlacementInput } from './intents.js'
import { legalIntents } from './legal.js'
import { victoryPoints } from './scoring.js'
import type { CardInstance, GameState } from './state.js'
import { valuesIndexFor } from './state.js'
import { makePick } from './bot.js'
import type {
  ActorType,
  ArgumentType,
  BetType,
  LocationId,
  ResourceType,
  Rps,
  SeatId,
  ValueType,
  Values
} from './types.js'

/** Uniform integer in [0, n) — the same shape bot.ts uses. */
type Pick = (n: number) => number

const HUMAN_ACTORS: readonly Exclude<ActorType, 'robot'>[] = ['politician', 'scientist', 'artist']
const REAL_ARGUMENTS: readonly Exclude<ArgumentType, 'dummy'>[] = ['rock', 'paper', 'scissors']
const EXCHANGEABLE: readonly Exclude<ValueType, 'fame'>[] = ['power', 'art', 'knowledge']

/**
 * Author rule: draw bets go on the Artist first, the Scientist second, the
 * Politician third. The rulebook agrees with the ordering for its own reasons —
 * a Politician never stands a draw, it replays, so a draw bet on one is a bet
 * on an event that cannot happen.
 */
const DRAW_BET_PREFERENCE: readonly Exclude<ActorType, 'robot'>[] = [
  'artist',
  'scientist',
  'politician'
]

/**
 * The order specs are considered in. Priority, not preference: whichever of
 * these the engine currently offers, the bot answers the most urgent one. Acks
 * come first because a bot that sits on an ack stalls the whole table.
 */
const SPEC_PRIORITY: readonly Intent['type'][] = [
  'event.ack',
  'conflict.reveal.ack',
  'conflict.refight.ack',
  'conflict.result.ack',
  'conflict.summary.ack',
  'distribution.reveal.ack',
  'action.ack',
  'event.discard',
  'tiebreak.rps',
  'conflict.rps',
  'distribution.commit',
  'action.selectCards',
  'action.relocate',
  'action.exchange',
  'market.buy',
  'market.done'
]

export function chooseRankedBotIntent(
  state: GameState,
  seat: SeatId,
  random: () => number
): Intent | null {
  const pick = makePick(random)
  const specs = legalIntents(state, seat)
  if (specs.length === 0) return null
  const spec = SPEC_PRIORITY.map((t) => specs.find((s) => s.type === t)).find(
    (s) => s !== undefined
  )
  if (!spec) return null

  switch (spec.type) {
    case 'event.ack':
      return { type: 'event.ack' }
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
    case 'action.ack':
      return { type: 'action.ack' }
    case 'event.discard':
      return { type: 'event.discard', amount: discardAmount(state, seat, spec.resource, spec.max) }
    // (ours) Rock-paper-scissors stays uniformly random on purpose. Any bias at
    // all — favouring a throw, mirroring, switching after a draw — is a pattern
    // a human can learn and beat every time; uniform cannot be beaten.
    case 'tiebreak.rps':
      return { type: 'tiebreak.rps', choice: spec.choices[pick(spec.choices.length)] as Rps }
    case 'conflict.rps':
      return { type: 'conflict.rps', choice: spec.choices[pick(spec.choices.length)] as Rps }
    case 'distribution.commit':
      return rankedCommit(state, seat, pick)
    case 'action.selectCards':
      return { type: 'action.selectCards', cardInstanceIds: cardsToPlay(state, seat, spec) }
    case 'action.relocate':
      return rankedRelocation(state, seat, pick)
    case 'action.exchange':
      return rankedExchange(state, seat, pick)
    case 'market.buy':
      return wantsCard(state, seat) ? { type: 'market.buy' } : { type: 'market.done' }
    case 'market.done':
      return { type: 'market.done' }
  }
}

// --- Reading the table ------------------------------------------------------------------

/** Seats playing against us — in 2v2 an ally shares our Value pool, so it is not one. */
function opponentsOf(state: GameState, seat: SeatId): SeatId[] {
  const mine = valuesIndexFor(state, seat)
  return state.activeSeats.filter((s) => s !== seat && valuesIndexFor(state, s) !== mine)
}

/**
 * The opponent worth playing against: the one closest to winning, by victory
 * points and then by raw Values. In 1v1 this is simply "them"; in ffa3 it keeps
 * the bot from spending its whole turn on the player who is already losing.
 */
function leadOpponent(state: GameState, seat: SeatId): SeatId | undefined {
  const ranked = opponentsOf(state, seat)
    .map((s) => {
      const pool = valuesOf(state, s)
      return { seat: s, vp: victoryPoints(pool), total: totalValues(pool) }
    })
    .sort((a, b) => b.vp - a.vp || b.total - a.total || a.seat - b.seat)
  return ranked[0]?.seat
}

function valuesOf(state: GameState, seat: SeatId): Values {
  return state.values[valuesIndexFor(state, seat)] as Values
}

function totalValues(pool: Values): number {
  return pool.power + pool.art + pool.knowledge + pool.fame
}

function resourcesOf(state: GameState, seat: SeatId): Record<ResourceType, number> {
  return { ...(state.inventories[seat]?.resources ?? { product: 0, electricity: 0, recycling: 0 }) }
}

function handOf(state: GameState, seat: SeatId): CardInstance[] {
  return state.inventories[seat]?.hand ?? []
}

// --- P1: discard events ------------------------------------------------------------------

/**
 * Author rules, and they collapse into one ladder because resources are public
 * information (rulebook §Open Information — the bot may legitimately read them):
 *   - opponent at 0 of this resource → discard exactly 1;
 *   - otherwise discard one more than the opponent can, or the same;
 *   - holding fewer than the opponent → discard 0.
 * The first is the second with `them = 0`, so: below them, fold; at or above
 * them, spend the minimum that cannot be beaten. Never overpay — every unit
 * discarded is a unit not spent on a bet or a card.
 */
function discardAmount(
  state: GameState,
  seat: SeatId,
  resource: ResourceType,
  max: number
): number {
  const mine = Math.min(resourcesOf(state, seat)[resource], max)
  const theirs = Math.max(
    0,
    ...opponentsOf(state, seat).map((s) => resourcesOf(state, s)[resource])
  )
  if (mine < theirs) return 0 // cannot win it — keep the stock
  return Math.min(theirs + 1, mine)
}

// --- P2: placement, arguments, bets ------------------------------------------------------

function rankedCommit(state: GameState, seat: SeatId, pick: Pick): Intent {
  const myValues = valuesOf(state, seat)
  const budget = resourcesOf(state, seat)
  const hand = handOf(state, seat)

  // Author rule: hold a shutdown card for a Location and none of our own Actors
  // go there — we are about to turn its lights off in Phase 3.
  const goingDark = new Set<LocationId>(
    hand
      .filter((c) => actionCardKind(c.card) === 'block')
      .map((c) => BLOCK_CARD_LOCATION[c.card as BlockCardId])
  )

  // Author rules: chase the Values we are short of, keep them even, and let the
  // Actor chasing an already-abundant Value carry the Dummy. Ties are broken at
  // random (ours) — a readable Dummy is a free win for the opponent.
  const byAbundance = [...HUMAN_ACTORS]
    .map((actor) => ({ actor, held: myValues[ACTOR_VALUE[actor]], jitter: pick(1000) }))
    .sort((a, b) => b.held - a.held || a.jitter - b.jitter)
  const dummyHolder = (byAbundance[0] as { actor: Exclude<ActorType, 'robot'> }).actor
  const scarcest = (byAbundance[byAbundance.length - 1] as { actor: Exclude<ActorType, 'robot'> })
    .actor

  const args = assignArguments(dummyHolder, pick)
  const bets = assignBets({ budget, dummyHolder, scarcest, pick })

  const placements: PlacementInput[] = (
    ['politician', 'scientist', 'artist', 'robot'] as const
  ).map((actorType) => {
    const input: PlacementInput = {
      actorType,
      locationId:
        actorType === 'robot'
          ? robotLocation(state, seat, pick)
          : humanLocation(actorType, goingDark, pick),
      argument: args[actorType]
    }
    const bet = bets[actorType]
    if (bet) input.bet = bet
    return input
  })
  return { type: 'distribution.commit', placements }
}

/**
 * Author rule: send the Robot where the opponent's resources are thin. Short of
 * electricity and recycling → Power Plant or Dump at 50/50; short of nothing at
 * all → one of the three at 1/3. An opponent holding all three lands on the
 * same uniform fallback, which is why one line covers both ends.
 */
function robotLocation(state: GameState, seat: SeatId, pick: Pick): LocationId {
  const target = leadOpponent(state, seat)
  const theirs = target === undefined ? null : resourcesOf(state, target)
  const all = ALLOWED_LOCATIONS.robot
  const thin = all.filter((l) => {
    const resource = LOCATION_RESOURCE[l]
    return resource !== undefined && theirs !== null && theirs[resource] === 0
  })
  const pool = thin.length > 0 ? thin : all
  return pool[pick(pool.length)] as LocationId
}

/** Anywhere allowed that we are not about to shut down; if both, we must stand somewhere. */
function humanLocation(
  actorType: Exclude<ActorType, 'robot'>,
  goingDark: Set<LocationId>,
  pick: Pick
): LocationId {
  const allowed = ALLOWED_LOCATIONS[actorType]
  const open = allowed.filter((l) => !goingDark.has(l))
  const pool = open.length > 0 ? open : allowed
  return pool[pick(pool.length)] as LocationId
}

/**
 * One argument per Actor, all four used, so the Dummy always goes to somebody.
 * It goes to the Actor named by the abundance rule; rock/paper/scissors are
 * shuffled across the rest (ours — a fixed mapping would be readable).
 */
function assignArguments(
  dummyHolder: Exclude<ActorType, 'robot'>,
  pick: Pick
): Record<ActorType, ArgumentType> {
  const rest: ActorType[] = (['politician', 'scientist', 'artist', 'robot'] as ActorType[]).filter(
    (a) => a !== dummyHolder
  )
  const real = [...REAL_ARGUMENTS]
  for (let i = real.length - 1; i > 0; i--) {
    const j = pick(i + 1)
    const tmp = real[i] as Exclude<ArgumentType, 'dummy'>
    real[i] = real[j] as Exclude<ArgumentType, 'dummy'>
    real[j] = tmp
  }
  const out = { [dummyHolder]: 'dummy' } as Record<ActorType, ArgumentType>
  rest.forEach((actor, i) => {
    out[actor] = real[i] as ArgumentType
  })
  return out
}

/**
 * Bets, in the author's order of value, each paid from its own resource
 * (BET_COST: win←product, lose←electricity, draw←recycling):
 *   1. the Dummy loses every comparison it is in, so back that with a Lose bet;
 *   2. a Win bet on the Actor whose Value we are shortest of — never on a Robot;
 *   3. a Draw bet on Artist, else Scientist, else Politician — never on a Robot.
 * (ours) At most two bets a turn. A bet is a gamble and the market is not:
 * spending all three resources on bets means no card that turn and nothing left
 * for the next discard event.
 */
function assignBets(opts: {
  budget: Record<ResourceType, number>
  dummyHolder: Exclude<ActorType, 'robot'>
  scarcest: Exclude<ActorType, 'robot'>
  pick: Pick
}): Partial<Record<ActorType, BetType>> {
  const { budget, dummyHolder, scarcest } = opts
  const out: Partial<Record<ActorType, BetType>> = {}
  const MAX_BETS = 2
  const place = (actor: ActorType, bet: BetType): boolean => {
    if (Object.keys(out).length >= MAX_BETS) return false
    const resource = BET_COST[bet]
    if (budget[resource] < 1 || out[actor]) return false
    budget[resource] -= 1
    out[actor] = bet
    return true
  }

  place(dummyHolder, 'lose')
  if (scarcest !== dummyHolder) place(scarcest, 'win')
  for (const actor of DRAW_BET_PREFERENCE) {
    if (actor === dummyHolder) continue // a Dummy cannot draw against a real argument
    if (place(actor, 'draw')) break
  }
  return out
}

// --- P3: which cards to play -------------------------------------------------------------

/**
 * Author rules: play the shutdown card on the Location we kept our Actors out
 * of, and if a Relocation is in hand alongside it, always play that too — the
 * pair is the point (drag their Actors into the dark, or pull ours out of it).
 * change_values goes down when it can actually move a Value we are short of.
 *
 * Everything here is guarded the way legal.ts guards it: a card that cannot be
 * carried out would wedge the step with the room waiting on us.
 */
function cardsToPlay(
  state: GameState,
  seat: SeatId,
  spec: { cardInstanceIds: string[] }
): string[] {
  const playable = new Set(spec.cardInstanceIds)
  const hand = handOf(state, seat).filter((c) => playable.has(c.instanceId))
  const of = (kind: ReturnType<typeof actionCardKind>): CardInstance[] =>
    hand.filter((c) => actionCardKind(c.card) === kind)

  const chosen: string[] = []

  // The shutdown that hurts most: the Location where they stand and we do not.
  const blocks = of('block')
    .map((c) => {
      const location = BLOCK_CARD_LOCATION[c.card as BlockCardId]
      const standing = state.board.placements.filter((p) => p.locationId === location)
      return {
        card: c,
        theirs: standing.filter((p) => p.seat !== seat).length,
        mine: standing.filter((p) => p.seat === seat).length
      }
    })
    .sort((a, b) => b.theirs - a.theirs || a.mine - b.mine)
  const block = blocks[0]
  if (block && (block.theirs > 0 || state.board.placements.length === 0))
    chosen.push(block.card.instanceId)

  // Relocation rides with a shutdown; on its own it is still worth playing when
  // there is anything on the board to move (the relocate step picks the target).
  const relocation = of('relocation')[0]
  if (relocation && state.board.placements.length > 0) chosen.push(relocation.instanceId)

  // change_values only helps if we have something to give AND they something to take.
  const exchange = of('exchange')[0]
  if (exchange && exchangeTargets(state, seat).length > 0) {
    const mine = valuesOf(state, seat)
    if (EXCHANGEABLE.some((v) => mine[v] > 0)) chosen.push(exchange.instanceId)
  }
  return chosen
}

/** Seats we could legally take a Value from — they must actually hold one. */
function exchangeTargets(state: GameState, seat: SeatId): SeatId[] {
  return opponentsOf(state, seat).filter((other) => {
    const pool = valuesOf(state, other)
    return EXCHANGEABLE.some((v) => pool[v] > 0)
  })
}

// --- P3: the relocate step ---------------------------------------------------------------

/**
 * Author rule, in order: drag the opponent's Actors into the shut Location, or
 * rescue our own from it. (ours) With no shut Location in play, move one of our
 * Actors somewhere nobody of its type stands — an uncontested Location is a
 * reward with no conflict attached.
 *
 * relocateSkip is the always-legal escape hatch: burning the order is far better
 * than returning an illegal one and wedging the step.
 */
function rankedRelocation(state: GameState, seat: SeatId, pick: Pick): Intent {
  const phase = state.phase
  if (phase.kind !== 'p3_action' || phase.step.t !== 'relocate')
    return { type: 'action.relocateSkip' }
  const ordered = new Set((phase.step.orders[seat] ?? []).map((o) => o.actorId))
  const movable = state.board.placements.filter((p) => !ordered.has(p.actorId))
  const dark = state.board.disabledLocations

  // Into the dark: an opponent Actor whose type may legally stand there.
  for (const location of dark) {
    const victim = movable.find(
      (p) => p.seat !== seat && p.locationId !== location && canStand(p.actorType, location)
    )
    if (victim) return { type: 'action.relocate', actorId: victim.actorId, to: location }
  }

  // Out of the dark: our own Actor caught in a Location we shut down.
  const trapped = movable.find((p) => p.seat === seat && dark.includes(p.locationId))
  if (trapped) {
    const out = ALLOWED_LOCATIONS[trapped.actorType].filter(
      (l) => l !== trapped.locationId && !dark.includes(l)
    )
    if (out.length > 0)
      return {
        type: 'action.relocate',
        actorId: trapped.actorId,
        to: out[pick(out.length)] as LocationId
      }
  }

  // Otherwise: park one of ours where its type stands alone.
  const mine = movable.filter((p) => p.seat === seat)
  for (const p of mine) {
    const quiet = ALLOWED_LOCATIONS[p.actorType].filter(
      (l) =>
        l !== p.locationId &&
        !dark.includes(l) &&
        !state.board.placements.some((o) => o.locationId === l && o.actorType === p.actorType)
    )
    if (quiet.length > 0)
      return {
        type: 'action.relocate',
        actorId: p.actorId,
        to: quiet[pick(quiet.length)] as LocationId
      }
  }
  return { type: 'action.relocateSkip' }
}

function canStand(actorType: ActorType, location: LocationId): boolean {
  return ALLOWED_LOCATIONS[actorType].includes(location)
}

// --- P3: change_values -------------------------------------------------------------------

/**
 * Author rule: chase what we are short of. So give away the Value we hold most
 * of and take the one we hold least of, from the opponent closest to winning —
 * which also slows the leader down. Falls back to any legal pair.
 */
function rankedExchange(state: GameState, seat: SeatId, pick: Pick): Intent | null {
  const targets = exchangeTargets(state, seat)
  if (targets.length === 0) return null
  const mine = valuesOf(state, seat)
  const giveOptions = EXCHANGEABLE.filter((v) => mine[v] > 0)
  if (giveOptions.length === 0) return null
  const give = [...giveOptions].sort((a, b) => mine[b] - mine[a])[0] as ValueType

  const lead = leadOpponent(state, seat)
  const from = (
    lead !== undefined && targets.includes(lead) ? lead : targets[pick(targets.length)]
  ) as SeatId
  const pool = valuesOf(state, from)
  const takeOptions = EXCHANGEABLE.filter((v) => pool[v] > 0)
  if (takeOptions.length === 0) return null
  const take = [...takeOptions].sort((a, b) => mine[a] - mine[b])[0] as ValueType
  return { type: 'action.exchange', give, from, take }
}

// --- P5: the market ----------------------------------------------------------------------

/**
 * (ours) Cards win games — a shutdown plus a Relocation is the bot's strongest
 * combination — so buy whenever the stock allows, but stop at a small hand.
 * Resources spent here are resources not available for bets or for the next
 * discard event, and a hoarded hand cannot all be played in one Phase 3 anyway.
 */
const HAND_TARGET = 2

function wantsCard(state: GameState, seat: SeatId): boolean {
  if (handOf(state, seat).length >= HAND_TARGET) return false
  const resources = resourcesOf(state, seat)
  return (Object.keys(MARKET_COST) as ResourceType[]).every(
    (r) => resources[r] >= MARKET_COST[r as keyof typeof MARKET_COST]
  )
}

/** The label recorded on the seat (game_players.bot_strategy) for these games. */
export const RANKED_BOT_STRATEGY = 'ranked-hard'
