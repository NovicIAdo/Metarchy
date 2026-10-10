// Conflict detection (§8.1) and the round outcome function (§8.2) — the pure heart
// of Phase 4. Normative fixtures TC-C1..C6 test baseOutcomes directly.

import { ACTOR_TYPES, LOCATIONS, rpsOutcome } from './constants.js'
import type { ConflictGroup, GameState } from './state.js'
import type { ArgumentType, Outcome } from './types.js'

export function detectGroups(state: GameState): ConflictGroup[] {
  const groups: ConflictGroup[] = []
  for (const locationId of LOCATIONS) {
    if (state.board.disabledLocations.includes(locationId)) continue
    for (const actorType of ACTOR_TYPES) {
      const members = state.board.placements.filter(
        (p) => p.locationId === locationId && p.actorType === actorType
      )
      if (members.length > 0)
        groups.push({ locationId, actorType, actorIds: members.map((m) => m.actorId) })
    }
  }
  return groups
}

/**
 * Per-participant outcomes of one resolution round (§8.2), any N ≥ 2.
 *
 * Let T be the distinct argument types present:
 * - |T| = 1 → everyone draws (identical arguments, dummy-only included);
 * - dummy is a clear loser whenever any non-dummy argument is present;
 * - the non-dummy remainder T′: {rock,paper,scissors} → circular, all draw;
 *   one type → its single holder wins (several holders: tied-win → draw among
 *   themselves, settled by the actor's draw rule per I-1); two types → the
 *   beating type wins (again: unique holder → win, several → draw), beaten → lose.
 *
 * Re-resolution rounds (§8.4) use the same function — dummy simply never occurs.
 */
export function baseOutcomes(argumentsList: readonly ArgumentType[]): Outcome[] {
  if (argumentsList.length < 2)
    throw new Error(`baseOutcomes: need at least 2 participants, got ${argumentsList.length}`)
  const types = new Set(argumentsList)
  if (types.size === 1) return argumentsList.map(() => 'draw')

  const nonDummy = [...types].filter((t): t is Exclude<ArgumentType, 'dummy'> => t !== 'dummy')
  if (nonDummy.length === 3) {
    return argumentsList.map((a) => (a === 'dummy' ? 'lose' : 'draw'))
  }
  if (nonDummy.length === 1) {
    const holders = argumentsList.filter((a) => a !== 'dummy').length
    return argumentsList.map((a) => (a === 'dummy' ? 'lose' : holders === 1 ? 'win' : 'draw'))
  }
  const [first, second] = nonDummy as [ArgumentType, ArgumentType]
  const winnerType = rpsOutcome(first, second) === 'win' ? first : second
  const winners = argumentsList.filter((a) => a === winnerType).length
  return argumentsList.map((a) =>
    a === 'dummy' || a !== winnerType ? 'lose' : winners === 1 ? 'win' : 'draw'
  )
}
