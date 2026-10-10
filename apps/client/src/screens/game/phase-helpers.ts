// Client-side mirrors of the engine's P3 legality checks — instant affordances,
// the server still has the final word. Kept pure for unit tests.

import type {
  ActorType,
  LocationId,
  PlayerView,
  PublicPlacement,
  SeatId,
  ValueType,
  Values
} from '@metarchy/engine'
import { ALLOWED_LOCATIONS } from '@metarchy/engine'
import { valuesPoolIndex } from '../../stores/ui.js'

export const EXCHANGEABLE_VALUES: readonly ValueType[] = ['power', 'art', 'knowledge']

/** Mirror of handleRelocate: allowed for the type, and an actual move. */
export function relocationTargets(actorType: ActorType, currentLocation: LocationId): LocationId[] {
  return ALLOWED_LOCATIONS[actorType].filter((l) => l !== currentLocation)
}

/** Actors this seat may still relocate (not already ordered by me this step). */
export function relocatableActors(view: PlayerView): PublicPlacement[] {
  if (view.phase.kind !== 'p3_action' || view.phase.step.t !== 'relocate') return []
  const myOrders = new Set(
    (view.phase.step.myOrders ?? []).map((o) => (o as { actorId: string }).actorId)
  )
  return view.board.placements.filter((p) => !myOrders.has(p.actorId))
}

/** Value types with a positive count in this pool, fame never (engine mirror). */
export function exchangeableValues(pool: Values): ValueType[] {
  return EXCHANGEABLE_VALUES.filter((v) => pool[v] > 0)
}

export function poolOfSeat(view: PlayerView, seat: SeatId): Values | null {
  if (view.teams) {
    const index = view.teams[0].includes(seat) ? 0 : 1
    return view.values[index] ?? null
  }
  return view.values[seat] ?? null
}

/** Seats I may take a value from (2v2: opposing team only — engine mirror). */
export function exchangeTargetSeats(view: PlayerView): SeatId[] {
  const myPool = view.values[valuesPoolIndex(view)]
  if (!myPool || exchangeableValues(myPool).length === 0) return []
  return view.activeSeats.filter((other) => {
    if (other === view.seat) return false
    if (view.teams) {
      const myTeam = view.teams[0].includes(view.seat) ? 0 : 1
      const otherTeam = view.teams[0].includes(other) ? 0 : 1
      if (myTeam === otherTeam) return false
    }
    const pool = poolOfSeat(view, other)
    return pool !== null && exchangeableValues(pool).length > 0
  })
}
