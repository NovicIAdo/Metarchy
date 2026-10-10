// Glicko-2 (Glickman, "Example of the Glicko-2 system"). One game = one rating
// period: online play cannot wait for a weekly batch, and the RD growth from
// `volatility` alone is close enough at this cadence.
//
// Multiplayer (ffa3) is scored pairwise — each player plays every other player
// once, and all of those results land in the same period. This is the standard
// treatment for free-for-all games and keeps 1v1 as the degenerate case.

import type { Mode, SeatId } from '@metarchy/engine'

/** Modes that move a rating. 2v2 needs team ratings — a separate design. */
export type RatedMode = '1v1' | 'ffa3'

export const RATED_MODES: readonly RatedMode[] = ['1v1', 'ffa3']

export function isRatedMode(mode: Mode): mode is RatedMode {
  return (RATED_MODES as readonly string[]).includes(mode)
}

export const DEFAULT_RATING = 1500
export const DEFAULT_RD = 350
export const DEFAULT_VOLATILITY = 0.06

/** Glicko-2 scale factor: ratings ↔ the internal μ/φ scale. */
const SCALE = 173.7178
/** System constant τ: how much volatility may move per period. 0.3–1.2; 0.5 is Glickman's default. */
const TAU = 0.5
const EPSILON = 0.000001

export interface Rating {
  rating: number
  rd: number
  volatility: number
}

export const UNRATED: Rating = {
  rating: DEFAULT_RATING,
  rd: DEFAULT_RD,
  volatility: DEFAULT_VOLATILITY
}

/** One opponent faced in this period, with the score against them (1 / 0.5 / 0). */
export interface Opponent {
  rating: Rating
  score: number
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
}

function expected(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)))
}

/**
 * Illinois-variant regula falsi for the volatility equation (Glickman step 5).
 * Converges in a handful of iterations; the bracket is guaranteed by construction.
 */
function newVolatility(phi: number, sigma: number, v: number, delta: number): number {
  const a = Math.log(sigma * sigma)
  const phiSq = phi * phi
  const deltaSq = delta * delta

  const f = (x: number): number => {
    const ex = Math.exp(x)
    const denom = phiSq + v + ex
    return (ex * (deltaSq - phiSq - v - ex)) / (2 * denom * denom) - (x - a) / (TAU * TAU)
  }

  let A = a
  let B: number
  if (deltaSq > phiSq + v) {
    B = Math.log(deltaSq - phiSq - v)
  } else {
    let k = 1
    while (f(a - k * TAU) < 0) k += 1
    B = a - k * TAU
  }

  let fA = f(A)
  let fB = f(B)
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA)
    const fC = f(C)
    if (fC * fB <= 0) {
      A = B
      fA = fB
    } else {
      fA = fA / 2
    }
    B = C
    fB = fC
  }
  return Math.exp(A / 2)
}

/**
 * A player's rating after one period. With no opponents the rating stands and
 * only RD grows — an idle player is a less certain player.
 */
export function updateRating(player: Rating, opponents: Opponent[]): Rating {
  const mu = (player.rating - DEFAULT_RATING) / SCALE
  const phi = player.rd / SCALE
  const sigma = player.volatility

  if (opponents.length === 0) {
    return {
      rating: player.rating,
      rd: Math.min(Math.sqrt(phi * phi + sigma * sigma) * SCALE, DEFAULT_RD),
      volatility: sigma
    }
  }

  let vInv = 0
  let deltaSum = 0
  for (const opponent of opponents) {
    const muJ = (opponent.rating.rating - DEFAULT_RATING) / SCALE
    const phiJ = opponent.rating.rd / SCALE
    const gJ = g(phiJ)
    const e = expected(mu, muJ, phiJ)
    vInv += gJ * gJ * e * (1 - e)
    deltaSum += gJ * (opponent.score - e)
  }
  const v = 1 / vInv
  const delta = v * deltaSum

  const sigmaPrime = newVolatility(phi, sigma, v, delta)
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime)
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const muPrime = mu + phiPrime * phiPrime * deltaSum

  return {
    rating: muPrime * SCALE + DEFAULT_RATING,
    rd: Math.min(phiPrime * SCALE, DEFAULT_RD),
    volatility: sigmaPrime
  }
}

// --- Turning a finished game into pairwise scores ------------------------------------

export interface FinishedSeat {
  seat: SeatId
  userId: string
  /** null when the seat never scored (aborted before ranking). */
  finalVp: number | null
  won: boolean
}

/** 1 / 0.5 / 0 for `a` against `b`. Winners beat every non-winner; else VP decides. */
export function scoreAgainst(a: FinishedSeat, b: FinishedSeat): number {
  if (a.won !== b.won) return a.won ? 1 : 0
  const vpA = a.finalVp ?? 0
  const vpB = b.finalVp ?? 0
  if (vpA === vpB) return 0.5
  return vpA > vpB ? 1 : 0
}

export interface RatingChange {
  seat: SeatId
  userId: string
  before: Rating
  after: Rating
}

/**
 * Every seat faces every other seat once. Each player is rated against the
 * opponents' *pre-game* ratings, so the result never depends on seat order.
 */
export function rateGame(seats: FinishedSeat[], before: Map<string, Rating>): RatingChange[] {
  return seats.map((self) => {
    const selfRating = before.get(self.userId) ?? UNRATED
    const opponents: Opponent[] = seats
      .filter((other) => other.userId !== self.userId)
      .map((other) => ({
        rating: before.get(other.userId) ?? UNRATED,
        score: scoreAgainst(self, other)
      }))
    return {
      seat: self.seat,
      userId: self.userId,
      before: selfRating,
      after: updateRating(selfRating, opponents)
    }
  })
}
