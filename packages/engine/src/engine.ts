// Public engine API — architecture/Engine.md §2. applyIntent is the only mutation
// path: pure, deterministic (seed + rngCursor live in the state), integer-only.

import { RuleError } from './ctx.js'
import type { EngineEvent } from './events.js'
import { handleIntent } from './handlers.js'
import type { Intent, RuleViolation } from './intents.js'
import { deepClone } from './serialize.js'
import type { GameState } from './state.js'
import type { SeatId } from './types.js'

export type ApplyResult =
  { ok: true; state: GameState; events: EngineEvent[] } | { ok: false; error: RuleViolation }

export function applyIntent(state: GameState, seat: SeatId, intent: Intent): ApplyResult {
  try {
    const ctx = { state: deepClone(state), events: [] as EngineEvent[] }
    handleIntent(ctx, seat, intent)
    return { ok: true, state: ctx.state, events: ctx.events }
  } catch (error) {
    if (error instanceof RuleError)
      return { ok: false, error: { code: error.code, message: error.message } }
    throw error
  }
}
