// Deadline policy (architecture/Game-Server.md §5): map the state's current
// waiting stage to a duration. The stage key identifies one deadline window —
// it changes exactly when a new wait begins (new stage, next tie-break round,
// next conflict, next re-resolution round), not when individual seats commit.

import type { GameState } from '@metarchy/engine'
import type { TimeoutPolicy } from '../config.js'

/** Opaque deadline window id; sent to clients as `phaseRef`. */
export function stageKey(state: GameState): string | null {
  const phase = state.phase
  switch (phase.kind) {
    case 'p1_event': {
      const stage = phase.stage
      const round =
        stage.t === 'compare_tiebreak' || stage.t === 'discard_tiebreak' ? stage.tiebreak.round : 0
      return `${state.turn}:p1:${stage.t}:${round}`
    }
    case 'p2_distribution':
      // The reveal is its own gate with its own clock, so it needs its own key —
      // otherwise the commit deadline would carry straight through it.
      return phase.revealed ? `${state.turn}:p2:revealed` : `${state.turn}:p2`
    case 'p3_action': {
      const step = phase.step
      if (step.t === 'relocate_tiebreak')
        return `${state.turn}:p3:${step.t}:${step.index}:${step.tiebreak.round}`
      if (step.t === 'exchange') return `${state.turn}:p3:${step.t}:${step.index}`
      return `${state.turn}:p3:${step.t}`
    }
    case 'p4_conflict': {
      const stage = phase.stage
      const round = phase.resolution?.round ?? 0
      const tb = stage.t === 'deadlock_tiebreak' ? stage.tiebreak.round : 0
      return `${state.turn}:p4:${phase.index}:${stage.t}:${round}:${tb}`
    }
    case 'p5_market':
      return `${state.turn}:p5`
    case 'finished':
      return null
  }
}

export function stageWaitMs(state: GameState, policy: TimeoutPolicy): number {
  const phase = state.phase
  switch (phase.kind) {
    case 'p1_event':
      switch (phase.stage.t) {
        case 'compare_ack':
        case 'compare_standoff':
        case 'discard_ack':
          return policy.ackMs
        case 'discard_commit':
          return policy.discardMs
        case 'compare_tiebreak':
        case 'discard_tiebreak':
          return policy.rpsMs
      }
      break
    case 'p2_distribution':
      // Looking at the revealed board is a read, not a decision — same beat as the
      // end-of-Phase-4 recap, not the two minutes a placement gets.
      return phase.revealed ? policy.summaryMs : policy.distributionMs
    case 'p3_action':
      if (phase.step.t === 'relocate_tiebreak') return policy.rpsMs
      if (
        phase.step.t === 'blocks_ack' ||
        phase.step.t === 'relocations_ack' ||
        phase.step.t === 'exchanges_ack'
      )
        return policy.ackMs
      return policy.actionStepMs
    case 'p4_conflict':
      switch (phase.stage.t) {
        case 'reveal_ack':
        case 'refight_ack':
        case 'result_ack':
          return policy.ackMs
        case 'summary_ack':
          return policy.summaryMs
        case 'rps':
        case 'deadlock_tiebreak':
          return policy.rpsMs
      }
      break
    case 'p5_market':
      return policy.marketMs
    case 'finished':
      return 0
  }
  return policy.ackMs
}
