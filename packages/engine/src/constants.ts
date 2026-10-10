// Game constants — spec/Game-Specification.md §1. Rules canon: docs/metarchy-rules.md.

import type {
  ActorType,
  ArgumentType,
  BetType,
  LocationId,
  Outcome,
  ResourceType,
  ValueType
} from './types.js'

// 1.1.0 (2026-07-27): two rule changes landed together — Turn 1 skips Phase 3
// as well as Phase 1, and Phase 4 is never skipped and always ends with the Turn
// Summary. Games carry the version they were played under (games.rules_version),
// which is what explains why a 1.0.0 game cannot be replayed by this engine: its
// Turn 1 contains action.selectCards, and Turn 1 no longer has an Action Phase.
export const RULES_VERSION = '1.1.0'

export const MAX_TURNS = 5
/** The coached tutorial is a taster, not a campaign — three turns then the CTA. */
export const TUTORIAL_MAX_TURNS = 3

export const LOCATIONS: readonly LocationId[] = [
  'square',
  'theatre',
  'university',
  'factory',
  'power_plant',
  'dump'
]

export const ACTOR_TYPES: readonly ActorType[] = ['politician', 'scientist', 'artist', 'robot']

export const ARGUMENT_TYPES: readonly ArgumentType[] = ['rock', 'paper', 'scissors', 'dummy']

export const ALLOWED_LOCATIONS: Record<ActorType, readonly LocationId[]> = {
  politician: ['square', 'university'],
  scientist: ['university', 'theatre'],
  artist: ['square', 'theatre'],
  robot: ['factory', 'power_plant', 'dump']
}

/** What a Robot produces at each robot location. */
export const LOCATION_RESOURCE: Partial<Record<LocationId, ResourceType>> = {
  factory: 'product',
  power_plant: 'electricity',
  dump: 'recycling'
}

/** Which Value a human actor creates (robots produce resources instead). */
export const ACTOR_VALUE: Record<Exclude<ActorType, 'robot'>, Exclude<ValueType, 'fame'>> = {
  politician: 'power',
  scientist: 'knowledge',
  artist: 'art'
}

/** Bet type → the resource that pays for it. */
export const BET_COST: Record<BetType, ResourceType> = {
  win: 'product',
  lose: 'electricity',
  draw: 'recycling'
}

export const BEATS: Record<ArgumentType, readonly ArgumentType[]> = {
  rock: ['scissors', 'dummy'],
  paper: ['rock', 'dummy'],
  scissors: ['paper', 'dummy'],
  dummy: []
}

/** Pairwise argument comparison (rulebook §4). */
export function rpsOutcome(a: ArgumentType, b: ArgumentType): Outcome {
  if (a === b) return 'draw'
  return BEATS[a].includes(b) ? 'win' : 'lose'
}

// --- Decks -------------------------------------------------------------------

export const EVENT_CARDS = [
  'political_repression',
  'educational_crisis',
  'cultural_decline',
  'revolution',
  'help_poor_countries',
  'earth_hour',
  'prevent_eco_crisis'
] as const
export type EventCardId = (typeof EVENT_CARDS)[number]

/**
 * The tutorial's fixed event order (author spec) — a teaching sequence instead
 * of a shuffle. The mirror bot discards 0, so discard events are winnable by
 * discarding ≥ 1 (players start with 1 of each resource); mirrored placements
 * keep the value pools level, so the compare events land on ties and teach the
 * player-vs-player resolution. Turns 2–5 draw the first four; the rest exist
 * only to keep the deck composition canonical.
 */
export const TUTORIAL_EVENT_ORDER: readonly EventCardId[] = [
  'help_poor_countries', // turn 2 — discard product: first win
  'educational_crisis', // turn 3 — compare knowledge: mirrored pools tie → arena
  'earth_hour', // turn 4 — discard electricity
  'cultural_decline', // turn 5 — compare art: 0/0 tie → arena again
  'political_repression',
  'prevent_eco_crisis',
  'revolution'
]

/** Compare events measure a value ('total' = power+art+knowledge+fame); least wins fame. */
export const COMPARE_EVENT_METRIC = {
  political_repression: 'power',
  educational_crisis: 'knowledge',
  cultural_decline: 'art',
  revolution: 'total'
} as const satisfies Partial<Record<EventCardId, ValueType | 'total'>>

/** Discard events: secretly discard any amount of this resource; most discarded wins a card. */
export const DISCARD_EVENT_RESOURCE = {
  help_poor_countries: 'product',
  earth_hour: 'electricity',
  prevent_eco_crisis: 'recycling'
} as const satisfies Partial<Record<EventCardId, ResourceType>>

export type CompareEventId = keyof typeof COMPARE_EVENT_METRIC
export type DiscardEventId = keyof typeof DISCARD_EVENT_RESOURCE

export function eventKind(card: EventCardId): 'compare' | 'discard' {
  return card in COMPARE_EVENT_METRIC ? 'compare' : 'discard'
}

export const BLOCK_CARD_LOCATION = {
  construction_work: 'square',
  charity_event: 'theatre',
  student_protests: 'university',
  sabotage: 'factory',
  cable_stolen: 'power_plant',
  environmental_protests: 'dump'
} as const satisfies Record<string, LocationId>
export type BlockCardId = keyof typeof BLOCK_CARD_LOCATION

export type ActionCardId = BlockCardId | 'relocation' | 'change_values'

export function actionCardKind(card: ActionCardId): 'block' | 'relocation' | 'exchange' {
  if (card === 'relocation') return 'relocation'
  if (card === 'change_values') return 'exchange'
  return 'block'
}

/** 15 cards: 6 unique blockers + 6 relocation + 3 change_values (rulebook §7). */
export const ACTION_DECK_COMPOSITION: readonly ActionCardId[] = [
  ...(Object.keys(BLOCK_CARD_LOCATION) as BlockCardId[]),
  'relocation',
  'relocation',
  'relocation',
  'relocation',
  'relocation',
  'relocation',
  'change_values',
  'change_values',
  'change_values'
]

// --- Starting state & rewards --------------------------------------------------

export const STARTING_RESOURCES: Record<ResourceType, number> = {
  product: 1,
  electricity: 1,
  recycling: 1
}

export const MARKET_COST: Record<ResourceType, number> = {
  product: 1,
  electricity: 1,
  recycling: 1
}

/** Reward units on a Win (values for humans, location resources for robots). */
export const WIN_REWARD: Record<ActorType, number> = {
  politician: 1,
  scientist: 1,
  artist: 1,
  robot: 3
}

/** Reward units on a standing Draw. Politicians never stand a draw — they replay. */
export const DRAW_REWARD: Record<ActorType, number> = {
  politician: 0,
  scientist: 1,
  artist: 0,
  robot: 1
}

// --- Politician deadlock rule (rulebook, Phase 4) ------------------------------

export const POLITICIAN_DEADLOCK_ACTOR_ROUNDS = 10
export const POLITICIAN_DEADLOCK_PLAYER_ROUNDS = 10
