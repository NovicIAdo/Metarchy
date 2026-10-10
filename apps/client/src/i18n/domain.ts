// Language-aware display names for engine identifiers — the i18n replacement for
// the English-only maps in screens/game/labels.ts. Consumers call `useDomain()`
// and get, e.g., `d.actor('politician')` localized to the current language.

import type {
  ActionCardId,
  ActorType,
  ArgumentType,
  BetType,
  EventCardId,
  LocationId,
  ResourceType,
  ValueType
} from '@metarchy/engine'
import { useT, type TFunction } from './index.js'

export interface DomainLabels {
  actor(a: ActorType): string
  argument(a: ArgumentType): string
  bet(b: BetType): string
  resource(r: ResourceType): string
  value(v: ValueType): string
  location(l: LocationId): string
  /** Accepts a phase kind ('p1_event' … 'finished'). */
  phase(kind: string): string
  eventCard(id: EventCardId): string
  eventCardRule(id: EventCardId): string
  actionCard(id: ActionCardId): string
  actionCardRule(id: ActionCardId): string
}

export function makeDomainLabels(t: TFunction): DomainLabels {
  return {
    actor: (a) => t(`actor.${a}`),
    argument: (a) => t(`arg.${a}`),
    bet: (b) => t(`bet.${b}`),
    resource: (r) => t(`resource.${r}`),
    value: (v) => t(`value.${v}`),
    location: (l) => t(`location.${l}`),
    phase: (kind) => t(`phase.${kind}`),
    eventCard: (id) => t(`card.event.${id}`),
    eventCardRule: (id) => t(`card.event.${id}.rule`),
    actionCard: (id) => t(`card.action.${id}`),
    actionCardRule: (id) => t(`card.action.${id}.rule`)
  }
}

/** Reactive: re-renders the caller when the language changes. */
export function useDomain(): DomainLabels {
  return makeDomainLabels(useT())
}
