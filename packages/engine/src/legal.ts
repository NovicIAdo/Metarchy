// legalIntents — architecture/Engine.md §2: the anti-drift mechanism. The server
// rejects anything outside it, the client renders only what it offers, bots choose
// from it. Returns constraint-bearing specs, not enumerated concrete intents.

import { DISCARD_EVENT_RESOURCE } from './constants.js'
import { relocationQuota } from './flow.js'
import type { IntentSpec } from './intents.js'
import type { GameState } from './state.js'
import type { ResourceType, Rps, SeatId } from './types.js'

const RPS_CHOICES: readonly Rps[] = ['rock', 'paper', 'scissors']

export function legalIntents(state: GameState, seat: SeatId): IntentSpec[] {
  if (!state.meta.seats.some((m) => m.seat === seat)) return []
  if (!state.activeSeats.includes(seat)) return []
  const phase = state.phase
  switch (phase.kind) {
    case 'p1_event': {
      const stage = phase.stage
      if (stage.t === 'compare_ack' || stage.t === 'discard_ack' || stage.t === 'compare_standoff')
        return stage.acked.includes(seat) ? [] : [{ type: 'event.ack' }]
      if (stage.t === 'discard_commit') {
        if (stage.amounts[seat] !== undefined) return []
        const resource = DISCARD_EVENT_RESOURCE[
          phase.card as keyof typeof DISCARD_EVENT_RESOURCE
        ] as ResourceType
        const max = state.inventories[seat]?.resources[resource] ?? 0
        return [{ type: 'event.discard', resource, max }]
      }
      // compare_tiebreak | discard_tiebreak
      const tiebreak = stage.tiebreak
      if (tiebreak.participants.includes(seat) && tiebreak.choices[seat] === undefined)
        return [{ type: 'tiebreak.rps', choices: RPS_CHOICES }]
      return []
    }
    case 'p2_distribution':
      // Once the board is revealed the only thing left in P2 is looking at it.
      if (phase.revealed)
        return phase.revealed.acked.includes(seat) ? [] : [{ type: 'distribution.reveal.ack' }]
      return phase.committed[seat] ? [] : [{ type: 'distribution.commit' }]
    case 'p3_action': {
      const step = phase.step
      if (step.t === 'blocks_ack' || step.t === 'relocations_ack' || step.t === 'exchanges_ack')
        return step.acked.includes(seat) ? [] : [{ type: 'action.ack' }]
      if (step.t === 'select') {
        if (step.committed[seat]) return []
        const hand = state.inventories[seat]?.hand ?? []
        return [{ type: 'action.selectCards', cardInstanceIds: hand.map((c) => c.instanceId) }]
      }
      if (step.t === 'relocate_tiebreak') {
        const tiebreak = step.tiebreak
        if (tiebreak.participants.includes(seat) && tiebreak.choices[seat] === undefined)
          return [{ type: 'tiebreak.rps', choices: RPS_CHOICES }]
        return []
      }
      if (step.t === 'relocate') {
        const remaining =
          relocationQuota(state, seat) -
          (step.orders[seat]?.length ?? 0) -
          (step.skipped?.[seat] ?? 0)
        return remaining > 0 ? [{ type: 'action.relocate', remaining }] : []
      }
      // exchange: only the current queue slot's owner may act
      const slot = step.queue[step.index]
      return slot && slot.seat === seat ? [{ type: 'action.exchange' }] : []
    }
    case 'p4_conflict': {
      const stage = phase.stage
      const conflict = phase.conflicts[phase.index]
      const involved = conflict?.actorIds.some((id) => id.startsWith(`${seat}:`)) ?? false
      if (stage.t === 'reveal_ack')
        return involved && !stage.acked.includes(seat) ? [{ type: 'conflict.reveal.ack' }] : []
      if (stage.t === 'refight_ack')
        return involved && !stage.acked.includes(seat) ? [{ type: 'conflict.refight.ack' }] : []
      if (stage.t === 'result_ack')
        return involved && !stage.acked.includes(seat) ? [{ type: 'conflict.result.ack' }] : []
      // The summary belongs to the whole table — no `involved` gate.
      if (stage.t === 'summary_ack')
        return stage.acked.includes(seat) ? [] : [{ type: 'conflict.summary.ack' }]
      if (stage.t === 'rps') {
        const mustChoose =
          (phase.resolution?.active ?? []).some((id) => id.startsWith(`${seat}:`)) &&
          stage.choices[seat] === undefined
        return mustChoose ? [{ type: 'conflict.rps', choices: RPS_CHOICES }] : []
      }
      // deadlock_tiebreak
      const tiebreak = stage.tiebreak
      if (tiebreak.participants.includes(seat) && tiebreak.choices[seat] === undefined)
        return [{ type: 'tiebreak.rps', choices: RPS_CHOICES }]
      return []
    }
    case 'p5_market': {
      if (phase.done.includes(seat)) return []
      const specs: IntentSpec[] = []
      const inv = state.inventories[seat]
      const staged = phase.staged[seat] ?? 0
      const affordable = inv
        ? Math.min(inv.resources.product, inv.resources.electricity, inv.resources.recycling)
        : 0
      if (state.actionDeck.length > 0 && staged + 1 <= affordable)
        specs.push({ type: 'market.buy' })
      specs.push({ type: 'market.done' })
      return specs
    }
    case 'finished':
      return []
  }
}
