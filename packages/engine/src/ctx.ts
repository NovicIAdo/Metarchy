// Internal mutation context: a structuredClone draft of the state plus the events
// emitted while handling one intent. Handlers mutate the draft freely; applyIntent
// discards it wholesale on a RuleError, so partial mutation before a reject is safe.

import type { EngineEvent, Visibility } from './events.js'
import { fnv1a32, randBelow } from './rng.js'
import type { GameState } from './state.js'

export interface Ctx {
  state: GameState
  events: EngineEvent[]
}

export class RuleError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RuleError'
    this.code = code
  }
}

export function reject(code: string, message: string): never {
  throw new RuleError(code, message)
}

export function emit(ctx: Ctx, type: string, payload: unknown, visibility: Visibility): void {
  ctx.state.seq += 1
  ctx.events.push({ seq: ctx.state.seq, type, payload, visibility })
}

/** Consume one RNG draw: integer in [0, n). Advances state.rngCursor. */
export function drawBelow(ctx: Ctx, n: number): number {
  const value = randBelow(fnv1a32(ctx.state.meta.seed), ctx.state.rngCursor, n)
  ctx.state.rngCursor += 1
  return value
}
