// Cosmetic drops from finished ranked games (author, 2026-08-01: «сейчас выдаём
// предметы за РАНКЕД ГЕЙМ, потом переделаем, ща для тестирования»).
//
// Drops exist for the market, not for the wardrobe. A shelf stocked only with
// Shop goods is dead on arrival — nobody pays a player more than the Shop's own
// price for something the Shop will sell them on demand — so the market needs
// goods that arrive by luck rather than by purchase (plan/Market-Plan.md §2).
// A dropped item is an ordinary entitlement: wearable, and listable like any
// other, which is the whole point.
//
// Deliberately simple while it is being tested: one roll for the winner(s) of a
// finished ranked game, uniform over the tradable goods they do not already own.
// The rarity tiers, the drop rates and whether losers roll too are the author's
// next pass — this one exists to put objects into players' hands and watch what
// they do with them.

import type { Mode, SeatId } from '@metarchy/engine'
import { SHOP_CATALOG, isTradable } from '@metarchy/protocol'
import { isRatedMode } from './ratings.js'

/** Every good a drop may produce, in catalog order (the roll indexes into this). */
export const DROPPABLE_ITEM_IDS: readonly string[] = SHOP_CATALOG.map((i) => i.id).filter(
  isTradable
)

export interface DropCandidate {
  seat: SeatId
  userId: string
}

/**
 * Who rolls for a drop in this game. Same gate as the rating update minus the
 * all-human rule — a bot in a ranked seat does not cancel the humans' luck — and
 * private games are excluded exactly as they are excluded from rating and pay:
 * two friends must not be able to farm goods off each other.
 */
export function dropCandidates(input: {
  mode: Mode
  isPrivate: boolean
  seats: { seat: SeatId; userId: string | null }[]
  /** Finishing order, best first; one group per place (seats can share one). */
  ranking: SeatId[][]
}): DropCandidate[] {
  if (input.isPrivate || !isRatedMode(input.mode)) return []
  const winners = new Set(input.ranking[0] ?? [])
  return input.seats
    .filter((s): s is { seat: SeatId; userId: string } => s.userId !== null)
    .filter((s) => winners.has(s.seat))
}

/**
 * What this player wins, or null when they already own every tradable good —
 * "rolled and got nothing" is a real outcome and the caller records it, so a
 * completionist is not re-rolled forever by a recovered finish.
 *
 * `roll` is a float in [0, 1); the caller supplies it so the choice is testable.
 */
export function rollDrop(owned: readonly string[], roll: number): string | null {
  const has = new Set(owned)
  const pool = DROPPABLE_ITEM_IDS.filter((id) => !has.has(id))
  if (pool.length === 0) return null
  const index = Math.min(Math.floor(roll * pool.length), pool.length - 1)
  return pool[index] as string
}
