// Client-sendable intents: the engine Intent union minus server-injected system.*
// intents, which must never be accepted from a socket. Strict objects: unknown keys
// are rejected, not stripped.

import type { Intent, PlacementInput } from '@metarchy/engine'
import { z } from 'zod'
import type { AssertTrue } from './common.js'
import {
  ActorIdSchema,
  ActorTypeSchema,
  ArgumentTypeSchema,
  BetTypeSchema,
  LocationIdSchema,
  RpsSchema,
  SeatIdSchema,
  ValueTypeSchema
} from './common.js'

export type ClientIntent = Exclude<
  Intent,
  // The skip intents are the engine's deadline defaults, never client messages.
  | { type: 'system.timeout' }
  | { type: 'system.eliminate' }
  | { type: 'action.relocateSkip' }
  | { type: 'tiebreak.skip' }
  | { type: 'conflict.rpsSkip' }
>

export const PlacementInputSchema = z.strictObject({
  actorType: ActorTypeSchema,
  locationId: LocationIdSchema,
  argument: ArgumentTypeSchema,
  bet: BetTypeSchema.optional()
})

export const ClientIntentSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('event.ack') }),
  z.strictObject({ type: z.literal('event.discard'), amount: z.number().int().min(0).max(1e6) }),
  z.strictObject({ type: z.literal('tiebreak.rps'), choice: RpsSchema }),
  z.strictObject({
    type: z.literal('distribution.commit'),
    placements: z.array(PlacementInputSchema).max(4)
  }),
  z.strictObject({
    type: z.literal('action.selectCards'),
    cardInstanceIds: z.array(z.string().max(32)).max(15)
  }),
  z.strictObject({
    type: z.literal('action.relocate'),
    actorId: ActorIdSchema,
    to: LocationIdSchema
  }),
  z.strictObject({
    type: z.literal('action.exchange'),
    give: ValueTypeSchema,
    from: SeatIdSchema,
    take: ValueTypeSchema
  }),
  z.strictObject({ type: z.literal('action.ack') }),
  z.strictObject({ type: z.literal('conflict.reveal.ack') }),
  z.strictObject({ type: z.literal('conflict.refight.ack') }),
  z.strictObject({ type: z.literal('conflict.rps'), choice: RpsSchema }),
  z.strictObject({ type: z.literal('conflict.result.ack') }),
  z.strictObject({ type: z.literal('conflict.summary.ack') }),
  z.strictObject({ type: z.literal('distribution.reveal.ack') }),
  z.strictObject({ type: z.literal('market.buy') }),
  z.strictObject({ type: z.literal('market.done') })
])

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

export type IntentTypeChecks = [
  AssertTrue<Equal<z.infer<typeof PlacementInputSchema>, PlacementInput>>,
  AssertTrue<Equal<z.infer<typeof ClientIntentSchema>, ClientIntent>>
]
