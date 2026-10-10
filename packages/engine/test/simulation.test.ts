// Mass simulation — plan step 1.6 / architecture §7.4: random-legal bots complete
// full games with zero rule violations, invariants asserted after every intent,
// and legalIntents-closure checked for every waiting seat at every step.
//
// CI default keeps the run fast; the full Stage-1 DoD run is
//   SIM_GAMES=10000 pnpm -F @metarchy/engine test simulation

import { describe, expect, it } from 'vitest'
import {
  applyIntent,
  assertStateInvariants,
  canonicalHash,
  chooseBotIntent,
  createGame,
  fnv1a32,
  randU32,
  waitingOn
} from '../src/index.js'
import type { GameState, Mode } from '../src/index.js'

const GAMES = Number(process.env.SIM_GAMES ?? 400)
const MODES: Mode[] = ['1v1', 'ffa3', '2v2', 'vs_bots']
const STEP_LIMIT = 20_000

/** Deterministic [0,1) stream so every simulated game is replayable by seed. */
function botRandom(seed: string): () => number {
  const hash = fnv1a32(seed)
  let cursor = 0
  return () => randU32(hash, cursor++) / 2 ** 32
}

interface GameStats {
  turns: number
  steps: number
}

function playFullGame(seed: string, mode: Mode): GameStats {
  const random = botRandom(`bot:${seed}`)
  let state: GameState = createGame({ gameId: `sim-${seed}`, mode, seed })
  let steps = 0
  while (state.phase.kind !== 'finished') {
    if (++steps > STEP_LIMIT)
      throw new Error(`game ${seed} (${mode}) exceeded ${STEP_LIMIT} steps at turn ${state.turn}`)
    const waiting = waitingOn(state)
    if (waiting.length === 0)
      throw new Error(`game ${seed} (${mode}) is stuck: nobody to act in ${state.phase.kind}`)
    // legalIntents-closure: every waiting seat must have a constructible intent
    const intents = waiting.map((seat) => ({ seat, intent: chooseBotIntent(state, seat, random) }))
    for (const { seat, intent } of intents) {
      if (!intent)
        throw new Error(
          `game ${seed} (${mode}): waiting seat ${seat} has no legal intent in ${state.phase.kind}`
        )
    }
    const actor = intents[0] as (typeof intents)[number]
    const result = applyIntent(state, actor.seat, actor.intent as NonNullable<typeof actor.intent>)
    if (!result.ok)
      throw new Error(
        `game ${seed} (${mode}): legal intent rejected — ${result.error.code}: ${result.error.message}`
      )
    assertStateInvariants(result.state)
    state = result.state
  }
  return { turns: state.turn, steps }
}

// ~2ms per game; scale the timeout with the requested count (SIM_GAMES=10000 ≈ 30s)
const SIM_TIMEOUT_MS = Math.max(30_000, GAMES * 15)

describe(`mass simulation: ${GAMES} random-bot games across all modes`, () => {
  it('every game terminates with zero violations', { timeout: SIM_TIMEOUT_MS }, () => {
    const stats: GameStats[] = []
    for (let i = 0; i < GAMES; i++) {
      const mode = MODES[i % MODES.length] as Mode
      stats.push(playFullGame(`sim-seed-${i}`, mode))
    }
    expect(stats).toHaveLength(GAMES)
    const avgTurns = stats.reduce((a, s) => a + s.turns, 0) / stats.length
    const maxTurns = Math.max(...stats.map((s) => s.turns))
    const avgSteps = Math.round(stats.reduce((a, s) => a + s.steps, 0) / stats.length)

    console.info(
      `simulation: ${GAMES} games ok — avg ${avgTurns.toFixed(1)} turns (max ${maxTurns}), avg ${avgSteps} intents/game`
    )
  })

  it('same seed → byte-identical replay (determinism)', () => {
    const seeds = ['replay-a', 'replay-b', 'replay-c']
    for (const [i, seed] of seeds.entries()) {
      const mode = MODES[i % MODES.length] as Mode
      const first = replayHash(seed, mode)
      const second = replayHash(seed, mode)
      expect(second).toBe(first)
    }
  })
})

function replayHash(seed: string, mode: Mode): string {
  const random = botRandom(`bot:${seed}`)
  let state: GameState = createGame({ gameId: 'replay', mode, seed })
  let steps = 0
  while (state.phase.kind !== 'finished' && ++steps < STEP_LIMIT) {
    const waiting = waitingOn(state)
    const seat = waiting[0] as NonNullable<(typeof waiting)[number]>
    const intent = chooseBotIntent(state, seat, random)
    if (!intent) throw new Error('no intent in replay')
    const result = applyIntent(state, seat, intent)
    if (!result.ok) throw new Error(`replay rejected: ${result.error.code}`)
    state = result.state
  }
  return canonicalHash(state)
}
