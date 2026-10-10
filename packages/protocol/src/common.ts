// Wire schemas for engine primitives — engine types are re-used, never redefined.
// The exported ProtocolTypeChecks tuple fails to compile if any wire enum drifts
// from its engine counterpart (both directions).

import type {
  ActorId,
  ActorType,
  ArgumentType,
  BetType,
  LocationId,
  Mode,
  Rps,
  SeatId,
  ValueType
} from '@metarchy/engine'
import { z } from 'zod'

export const SeatIdSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
export const ModeSchema = z.enum(['1v1', 'ffa3', '2v2', 'vs_bots', 'tutorial'])
/** Modes a matchmaking queue exists for (vs_bots and private games are created directly). */
export const RankedModeSchema = z.enum(['1v1', 'ffa3', '2v2'])
export type RankedMode = z.infer<typeof RankedModeSchema>
export const ActorTypeSchema = z.enum(['politician', 'scientist', 'artist', 'robot'])
export const ArgumentTypeSchema = z.enum(['rock', 'paper', 'scissors', 'dummy'])
export const RpsSchema = z.enum(['rock', 'paper', 'scissors'])
export const BetTypeSchema = z.enum(['win', 'lose', 'draw'])
export const ValueTypeSchema = z.enum(['power', 'art', 'knowledge', 'fame'])
export const LocationIdSchema = z.enum([
  'square',
  'theatre',
  'university',
  'factory',
  'power_plant',
  'dump'
])

// --- WebSocket close codes (application range 4000–4999) --------------------------
// Shared contract: the server closes with these, the client reads them off the
// CloseEvent to decide whether reconnecting makes sense.

/** A newer connection for the same user took over (another tab or device). */
export const CLOSE_SUPERSEDED = 4000
export const CLOSE_AUTH_FAILED = 4001
export const CLOSE_HELLO_TIMEOUT = 4002

const ACTOR_ID_RE = /^[0-3]:(politician|scientist|artist|robot)$/
export const ActorIdSchema = z.custom<ActorId>(
  (v) => typeof v === 'string' && ACTOR_ID_RE.test(v),
  'invalid actor id'
)

export const GameIdSchema = z.uuid()

// --- Compile-time engine↔wire sync ------------------------------------------------

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
export type AssertTrue<T extends true> = T

export type ProtocolTypeChecks = [
  AssertTrue<Equal<z.infer<typeof SeatIdSchema>, SeatId>>,
  AssertTrue<Equal<z.infer<typeof ModeSchema>, Mode>>,
  AssertTrue<Equal<z.infer<typeof ActorTypeSchema>, ActorType>>,
  AssertTrue<Equal<z.infer<typeof ArgumentTypeSchema>, ArgumentType>>,
  AssertTrue<Equal<z.infer<typeof RpsSchema>, Rps>>,
  AssertTrue<Equal<z.infer<typeof BetTypeSchema>, BetType>>,
  AssertTrue<Equal<z.infer<typeof ValueTypeSchema>, ValueType>>,
  AssertTrue<Equal<z.infer<typeof LocationIdSchema>, LocationId>>,
  AssertTrue<Equal<z.infer<typeof ActorIdSchema>, ActorId>>
]
