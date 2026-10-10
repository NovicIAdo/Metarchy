// View-driven scripted player: given a PlayerView (all a real client ever has),
// produce a legal ClientIntent whenever the game waits on this seat. Mirrors the
// engine's legalIntents affordances from the client side of the wire.

import type { PlayerView, SeatId, ValueType } from '@metarchy/engine'
import { ALLOWED_LOCATIONS, DISCARD_EVENT_RESOURCE } from '@metarchy/engine'
import type { ClientIntent } from '@metarchy/protocol'

export type Random = () => number

/** Deterministic [0,1) generator for reproducible scripted games. */
export function mulberry32(seedNum: number): Random {
  let a = seedNum >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (random: Random, n: number): number => Math.min(n - 1, Math.floor(random() * n))

const EXCHANGEABLE: readonly ValueType[] = ['power', 'art', 'knowledge']

function poolIndex(view: PlayerView, seat: SeatId): number {
  if (!view.teams) return seat
  return view.teams[0].includes(seat) ? 0 : 1
}

export function chooseFromView(view: PlayerView, random: Random): ClientIntent | null {
  if (!view.waitingOn.includes(view.seat)) return null
  const phase = view.phase
  switch (phase.kind) {
    case 'p1_event': {
      const stage = phase.stage
      if (stage.t === 'compare_ack' || stage.t === 'discard_ack' || stage.t === 'compare_standoff')
        return { type: 'event.ack' }
      if (stage.t === 'discard_commit') {
        const resource =
          DISCARD_EVENT_RESOURCE[phase.card as keyof typeof DISCARD_EVENT_RESOURCE] ?? 'product'
        const max = view.me.resources[resource]
        return { type: 'event.discard', amount: pick(random, max + 1) }
      }
      return {
        type: 'tiebreak.rps',
        choice: (['rock', 'paper', 'scissors'] as const)[pick(random, 3)]!
      }
    }

    case 'p2_distribution': {
      // The board is revealed and the turn is waiting for the table to look.
      if (phase.revealed) return { type: 'distribution.reveal.ack' }
      const budget = { ...view.me.resources }
      const args = ['rock', 'paper', 'scissors', 'dummy'] as const
      const shuffled = [...args]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = pick(random, i + 1)
        const tmp = shuffled[i]!
        shuffled[i] = shuffled[j]!
        shuffled[j] = tmp
      }
      const placements = (['politician', 'scientist', 'artist', 'robot'] as const).map(
        (actorType, i) => {
          const allowed = ALLOWED_LOCATIONS[actorType]
          const placement: {
            actorType: typeof actorType
            locationId: (typeof allowed)[number]
            argument: (typeof shuffled)[number]
            bet?: 'win' | 'lose' | 'draw'
          } = {
            actorType,
            locationId: allowed[pick(random, allowed.length)]!,
            argument: shuffled[i]!
          }
          if (random() < 0.3) {
            const bet = (['win', 'lose', 'draw'] as const)[pick(random, 3)]!
            const cost = { win: 'product', lose: 'electricity', draw: 'recycling' } as const
            if (budget[cost[bet]] > 0) {
              budget[cost[bet]] -= 1
              placement.bet = bet
            }
          }
          return placement
        }
      )
      return { type: 'distribution.commit', placements }
    }

    case 'p3_action': {
      const step = phase.step
      if (step.t === 'blocks_ack' || step.t === 'relocations_ack' || step.t === 'exchanges_ack')
        return { type: 'action.ack' }
      if (step.t === 'select') {
        const chosen = view.me.hand.filter(() => random() < 0.5).map((c) => c.instanceId)
        return { type: 'action.selectCards', cardInstanceIds: chosen }
      }
      if (step.t === 'relocate') {
        const orders = (step.myOrders ?? []) as { actorId: string; to: string }[]
        const ordered = new Set(orders.map((o) => o.actorId))
        const candidates = view.board.placements.filter((p) => !ordered.has(p.actorId))
        if (candidates.length === 0) return null
        const target = candidates[pick(random, candidates.length)]!
        const options = ALLOWED_LOCATIONS[target.actorType].filter(
          (loc) => loc !== target.locationId
        )
        return {
          type: 'action.relocate',
          actorId: target.actorId,
          to: options[pick(random, options.length)]!
        }
      }
      if (step.t === 'relocate_tiebreak')
        return {
          type: 'tiebreak.rps',
          choice: (['rock', 'paper', 'scissors'] as const)[pick(random, 3)]!
        }
      // exchange — the engine only awaits this slot when a legal exchange exists.
      const myPool = view.values[poolIndex(view, view.seat)]!
      const giveOptions = EXCHANGEABLE.filter((v) => myPool[v] > 0)
      const targets = view.activeSeats.filter((other) => {
        if (other === view.seat) return false
        if (view.teams && poolIndex(view, other) === poolIndex(view, view.seat)) return false
        const pool = view.values[poolIndex(view, other)]!
        return EXCHANGEABLE.some((v) => pool[v] > 0)
      })
      if (giveOptions.length === 0 || targets.length === 0) return null
      const from = targets[pick(random, targets.length)]!
      const fromPool = view.values[poolIndex(view, from)]!
      const takeOptions = EXCHANGEABLE.filter((v) => fromPool[v] > 0)
      return {
        type: 'action.exchange',
        give: giveOptions[pick(random, giveOptions.length)]!,
        from,
        take: takeOptions[pick(random, takeOptions.length)]!
      }
    }

    case 'p4_conflict': {
      const stage = phase.stage
      if (stage.t === 'reveal_ack') return { type: 'conflict.reveal.ack' }
      if (stage.t === 'refight_ack') return { type: 'conflict.refight.ack' }
      if (stage.t === 'result_ack') return { type: 'conflict.result.ack' }
      if (stage.t === 'summary_ack') return { type: 'conflict.summary.ack' }
      if (stage.t === 'rps')
        return {
          type: 'conflict.rps',
          choice: (['rock', 'paper', 'scissors'] as const)[pick(random, 3)]!
        }
      return {
        type: 'tiebreak.rps',
        choice: (['rock', 'paper', 'scissors'] as const)[pick(random, 3)]!
      }
    }

    case 'p5_market': {
      const staged = phase.sealedBuys.find((b) => b.seat === view.seat)?.count ?? 0
      const affordable = Math.min(
        view.me.resources.product,
        view.me.resources.electricity,
        view.me.resources.recycling
      )
      if (view.decks.action > 0 && staged + 1 <= affordable && random() < 0.4)
        return { type: 'market.buy' }
      return { type: 'market.done' }
    }

    case 'finished':
      return null
  }
}
