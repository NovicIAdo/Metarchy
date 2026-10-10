// P4 view-model: everything the arena and sidebar render, derived purely from
// PlayerView. Reward math mirrors the engine's grantReward (WIN_REWARD/DRAW_REWARD
// + persistent win-bet bonus) so results can be presented without folding events.

import type {
  ActorId,
  ActorType,
  ArgumentType,
  BetType,
  LocationId,
  Outcome,
  PlayerView,
  PublicPlacement,
  ResourceType,
  SeatId,
  ValueType
} from '@metarchy/engine'
import { ACTOR_VALUE, DRAW_REWARD, LOCATION_RESOURCE, WIN_REWARD } from '@metarchy/engine'

export interface RewardPreview {
  kind: 'value' | 'resource'
  type: ValueType | ResourceType
  amount: number
}

/** Mirror of engine grantReward: base by outcome + 1 if the win bet succeeded. */
export function rewardFor(
  actorType: ActorType,
  locationId: LocationId,
  outcome: Outcome,
  winBet: boolean
): RewardPreview | null {
  const base =
    outcome === 'win' ? WIN_REWARD[actorType] : outcome === 'draw' ? DRAW_REWARD[actorType] : 0
  const amount = base + (winBet ? 1 : 0)
  if (amount === 0) return null
  if (actorType === 'robot') {
    const resource = LOCATION_RESOURCE[locationId]
    return resource ? { kind: 'resource', type: resource, amount } : null
  }
  return { kind: 'value', type: ACTOR_VALUE[actorType], amount }
}

export interface ArenaParticipant {
  actorId: ActorId
  seat: SeatId
  mine: boolean
  /**
   * What the card shows. null = sealed «?»: pre-reveal, and again while a
   * re-round is pending (everyone re-picks — only my own fresh choice shows
   * early). Resolved re-rounds override the placement argument.
   */
  argument: ArgumentType | null
  /** Round-1 argument as revealed — stays put while re-round coins churn above. */
  placedArgument: ArgumentType | null
  bet: BetType | null
  /** Bet verdict vs the round-1 base outcome; null while sealed / no bet. */
  betSuccess: boolean | null
  outcome: Outcome | null
  winBet: boolean
  /** Fighting in the current re-resolution round. */
  active: boolean
  /** Has already made the choice/ack the current stage waits for. */
  done: boolean
  reward: RewardPreview | null
}

export type ArenaStage =
  | { t: 'reveal'; myAck: boolean; ackedSeats: SeatId[] }
  /** Review the round that forced a re-fight before choosing again. */
  | { t: 'refight'; round: number; myAck: boolean }
  | { t: 'rps'; round: number; myTurn: boolean; chosen: SeatId[] }
  | { t: 'deadlock'; round: number; myTurn: boolean; chosen: SeatId[] }
  | { t: 'result'; myAck: boolean }

export interface ArenaModel {
  index: number
  total: number
  locationId: LocationId
  actorType: ActorType
  involved: boolean
  stage: ArenaStage
  participants: ArenaParticipant[]
}

export type SidebarItem =
  | {
      t: 'conflict'
      index: number
      locationId: LocationId
      actorType: ActorType
      status: 'resolved' | 'current' | 'upcoming'
    }
  | { t: 'peaceful'; actorType: ActorType; locationId: LocationId; reward: RewardPreview | null }
  | { t: 'blocked'; actorType: ActorType; locationId: LocationId }

export interface ConflictUi {
  arena: ArenaModel | null
  /** My conflicts checklist + my peaceful/blocked actors (rulebook sidebar). */
  sidebar: SidebarItem[]
}

function seatOfActor(actorId: ActorId): SeatId {
  return Number(actorId.split(':')[0]) as SeatId
}

export function deriveConflictUi(view: PlayerView | null): ConflictUi {
  if (!view || view.phase.kind !== 'p4_conflict') return { arena: null, sidebar: [] }
  const phase = view.phase
  const placementOf = new Map<ActorId, PublicPlacement>(
    view.board.placements.map((p) => [p.actorId, p])
  )

  const conflict = phase.conflicts[phase.index] ?? null
  let arena: ArenaModel | null = null
  // A watcher has no seat in any conflict, so `involved` never fires for them —
  // the arena is gated on that elsewhere. Show them the fight regardless; every
  // interactive affordance already resolves to "not me" off their sentinel seat.
  const watching = view.spectator === true
  if (conflict && (!watching ? true : conflict.actorIds.length >= 2)) {
    const stage = phase.stage
    const resolution = phase.resolution
    const activeSet = new Set(resolution?.active ?? [])
    const rpsPending = stage.t === 'rps'
    const myRps = stage.t === 'rps' ? stage.myChoice : null
    const revealedRps = resolution?.revealedRps ?? {}
    const chosen: SeatId[] =
      stage.t === 'rps'
        ? stage.chosen
        : stage.t === 'deadlock_tiebreak'
          ? stage.tiebreak.chosen
          : stage.t === 'reveal_ack' || stage.t === 'result_ack' || stage.t === 'refight_ack'
            ? stage.acked
            : []
    const chosenSet = new Set(chosen)

    const participants: ArenaParticipant[] = conflict.actorIds
      .map((actorId) => {
        const placement = placementOf.get(actorId)
        if (!placement) return null
        const outcome = resolution?.outcomes[actorId] ?? null
        const winBet = resolution?.winBonusActorIds.includes(actorId) ?? false
        const betResult = resolution?.betResults.find((b) => b.actorId === actorId) ?? null
        return {
          actorId,
          seat: placement.seat,
          mine: placement.seat === view.seat,
          argument:
            rpsPending && activeSet.has(actorId)
              ? placement.seat === view.seat
                ? myRps
                : null
              : (revealedRps[placement.seat] ?? placement.argument ?? null),
          placedArgument: placement.argument ?? null,
          bet: placement.bet ?? null,
          betSuccess: betResult?.success ?? null,
          outcome,
          winBet,
          active: activeSet.has(actorId),
          done: chosenSet.has(placement.seat),
          reward: outcome
            ? rewardFor(placement.actorType, placement.locationId, outcome, winBet)
            : null
        }
      })
      .filter((p): p is ArenaParticipant => p !== null)

    const involved = participants.some((p) => p.mine)
    const round = (resolution?.round ?? 1) + 1
    const arenaStage: ArenaStage =
      stage.t === 'reveal_ack'
        ? { t: 'reveal', myAck: stage.acked.includes(view.seat), ackedSeats: stage.acked }
        : stage.t === 'rps'
          ? {
              t: 'rps',
              round,
              myTurn:
                (resolution?.active ?? []).some((id) => seatOfActor(id) === view.seat) &&
                stage.myChoice === null,
              chosen: stage.chosen
            }
          : stage.t === 'deadlock_tiebreak'
            ? {
                t: 'deadlock',
                round: stage.tiebreak.round + 1,
                myTurn:
                  stage.tiebreak.participants.includes(view.seat) &&
                  stage.tiebreak.myChoice === null,
                chosen: stage.tiebreak.chosen
              }
            : stage.t === 'refight_ack'
              ? {
                  t: 'refight',
                  round: resolution?.round ?? 1,
                  myAck: stage.acked.includes(view.seat)
                }
              : { t: 'result', myAck: stage.acked.includes(view.seat) }

    arena = {
      index: phase.index,
      total: phase.conflicts.length,
      locationId: conflict.locationId,
      actorType: conflict.actorType,
      involved,
      stage: arenaStage,
      participants
    }
  }

  // Sidebar: my conflicts in order, then my peaceful / blocked actors.
  const sidebar: SidebarItem[] = []
  const inConflict = new Set<ActorId>()
  phase.conflicts.forEach((c, i) => {
    for (const id of c.actorIds) inConflict.add(id)
    if (!c.actorIds.some((id) => seatOfActor(id) === view.seat)) return
    sidebar.push({
      t: 'conflict',
      index: i,
      locationId: c.locationId,
      actorType: c.actorType,
      status: i < phase.index ? 'resolved' : i === phase.index ? 'current' : 'upcoming'
    })
  })
  const disabled = new Set(view.board.disabledLocations)
  for (const p of view.board.placements) {
    if (p.seat !== view.seat || inConflict.has(p.actorId)) continue
    if (disabled.has(p.locationId)) {
      sidebar.push({ t: 'blocked', actorType: p.actorType, locationId: p.locationId })
    } else {
      sidebar.push({
        t: 'peaceful',
        actorType: p.actorType,
        locationId: p.locationId,
        reward: rewardFor(p.actorType, p.locationId, 'win', p.bet === 'win')
      })
    }
  }

  return { arena, sidebar }
}
