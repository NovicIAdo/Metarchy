// The matchmaking queue. Pairing is a pure function of (waiting players, now)
// so it can be tested without sockets, clocks, or rooms; the class around it
// only owns the ticker and the messaging.

import type { Mode } from '@metarchy/engine'
import { SEATS_PER_MODE } from '@metarchy/engine'
import type { RatedMode } from './ratings.js'

export interface MatchmakingConfig {
  /** How often the queue looks for matches. */
  tickMs: number
  /** Rating spread a fresh player will accept. */
  baseWindow: number
  /** …widened by this much every `stepMs` of waiting. */
  widenPerStep: number
  stepMs: number
  /** After this long, a player accepts anyone rather than keep waiting. */
  openWaitMs: number
  /** After this long alone, the queue offers a bot game instead. 0 disables. */
  botFallbackMs: number
}

// Invariant: botFallbackMs > openWaitMs. Once a player has waited openWaitMs
// their rating window is Infinite, so any other human still in the queue pairs
// with them; the bot fallback must sit *after* that so two humans are never
// shunted into separate bot games while they could still have matched each other
// (that "it gave me a bot instead of my friend" bug in a small player pool).
//
// The minute is the author's: "Ожидание нового игрока должно быть не более 1
// минуты. Если за минуту не нашёлся реальный игрок, на его место приходит бот."
// openWaitMs comes down with it to keep the invariant — a player accepts anyone
// at 30s, and at 60s a bot takes whatever seat is still empty.
export const DEFAULT_MATCHMAKING: MatchmakingConfig = {
  tickMs: 1000,
  baseWindow: 150,
  widenPerStep: 75,
  stepMs: 5_000,
  openWaitMs: 30_000,
  botFallbackMs: 60_000
}

export interface Waiting {
  userId: string
  rating: number
  joinedAtMs: number
}

/** Rating spread this player will tolerate after waiting `waitedMs`. */
export function windowFor(waitedMs: number, config: MatchmakingConfig): number {
  if (waitedMs >= config.openWaitMs) return Infinity
  return config.baseWindow + config.widenPerStep * Math.floor(waitedMs / config.stepMs)
}

/**
 * The best group of `seats` players, or null. Sorting by rating means any
 * acceptable group is a run of adjacent players, so it is enough to slide a
 * window of that size. A group is acceptable only if its spread fits inside
 * *every* member's tolerance — the newest player's patience binds the match.
 *
 * Among acceptable groups, the one whose longest-waiting member has waited the
 * longest wins: nobody should be stuck behind an endless stream of easy pairs.
 */
export function findMatch<T extends Waiting>(
  entries: T[],
  seats: number,
  nowMs: number,
  config: MatchmakingConfig
): T[] | null {
  if (entries.length < seats) return null
  const sorted = [...entries].sort((a, b) => a.rating - b.rating)

  let best: T[] | null = null
  let bestWait = -1
  for (let i = 0; i + seats <= sorted.length; i++) {
    const group = sorted.slice(i, i + seats)
    const spread = (group[seats - 1] as T).rating - (group[0] as T).rating
    const tolerance = Math.min(...group.map((e) => windowFor(nowMs - e.joinedAtMs, config)))
    if (spread > tolerance) continue

    const longestWait = Math.max(...group.map((e) => nowMs - e.joinedAtMs))
    if (longestWait > bestWait) {
      best = group
      bestWait = longestWait
    }
  }
  return best
}

/** Players who have waited long enough to be offered bots instead. */
export function botFallbackCandidates<T extends Waiting>(
  entries: T[],
  nowMs: number,
  config: MatchmakingConfig
): T[] {
  if (config.botFallbackMs <= 0) return []
  return entries.filter((e) => nowMs - e.joinedAtMs >= config.botFallbackMs)
}

export function seatsForMode(mode: RatedMode): number {
  return SEATS_PER_MODE[mode][0] as number
}

export const QUEUE_MODES: readonly RatedMode[] = ['1v1', 'ffa3']

export function isQueueMode(mode: Mode): mode is RatedMode {
  return (QUEUE_MODES as readonly string[]).includes(mode)
}
