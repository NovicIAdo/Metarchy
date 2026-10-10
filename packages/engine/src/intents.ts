// Intent & IntentSpec catalog — spec/Game-Specification.md §4, architecture/Engine.md §2.
// Everything a player (or the server, for system.*) can do is an Intent.

import type {
  ActorId,
  ActorType,
  ArgumentType,
  BetType,
  LocationId,
  ResourceType,
  Rps,
  SeatId,
  ValueType
} from './types.js'

/** distribution.commit input: actorId is derivable, so only the choice fields. */
export interface PlacementInput {
  actorType: ActorType
  locationId: LocationId
  argument: ArgumentType
  bet?: BetType
}

export type Intent =
  | { type: 'event.ack' }
  | { type: 'event.discard'; amount: number }
  | { type: 'tiebreak.rps'; choice: Rps }
  /** Engine-internal (deadline default): no pick in time = auto-lose the round. */
  | { type: 'tiebreak.skip' }
  | { type: 'distribution.commit'; placements: PlacementInput[] }
  | { type: 'action.selectCards'; cardInstanceIds: string[] }
  | { type: 'action.relocate'; actorId: ActorId; to: LocationId }
  | { type: 'action.exchange'; give: ValueType; from: SeatId; take: ValueType }
  | { type: 'action.ack' }
  /** Engine-internal (deadline default): relocation cards play with no move. */
  | { type: 'action.relocateSkip' }
  | { type: 'conflict.reveal.ack' }
  /** Consensus ack before a re-fight opens: everyone reviews the round that
      forced it (throws + bet verdicts) before choosing again. */
  | { type: 'conflict.refight.ack' }
  | { type: 'conflict.rps'; choice: Rps }
  /** Engine-internal (deadline default): no pick in time = the actor auto-loses. */
  | { type: 'conflict.rpsSkip' }
  | { type: 'conflict.result.ack' }
  | { type: 'conflict.summary.ack' }
  | { type: 'distribution.reveal.ack' }
  | { type: 'market.buy' }
  | { type: 'market.done' }
  /** Server-injected on deadline expiry: performs the seat's default action. */
  | { type: 'system.timeout'; seat: SeatId }
  /** Server-injected on disconnect timeout / forfeit. */
  | { type: 'system.eliminate'; seat: SeatId; reason: 'disconnect' | 'forfeit' }

/**
 * What a seat may do right now, with enough constraints to construct a valid intent.
 * Drives UI affordances, bots, and server-side validation (architecture/Engine.md §2).
 */
export type IntentSpec =
  | { type: 'event.ack' }
  | { type: 'event.discard'; resource: ResourceType; max: number }
  | { type: 'tiebreak.rps'; choices: readonly Rps[] }
  | { type: 'distribution.commit' }
  | { type: 'action.selectCards'; cardInstanceIds: string[] }
  | { type: 'action.relocate'; remaining: number }
  | { type: 'action.exchange' }
  | { type: 'action.ack' }
  | { type: 'conflict.reveal.ack' }
  | { type: 'conflict.refight.ack' }
  | { type: 'conflict.rps'; choices: readonly Rps[] }
  | { type: 'conflict.result.ack' }
  | { type: 'conflict.summary.ack' }
  | { type: 'distribution.reveal.ack' }
  | { type: 'market.buy' }
  | { type: 'market.done' }

export interface RuleViolation {
  code: string
  message: string
}
