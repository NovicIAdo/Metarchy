// Core identifiers — spec/Game-Specification.md §1

export type SeatId = 0 | 1 | 2 | 3
export type Mode = '1v1' | 'ffa3' | '2v2' | 'vs_bots' | 'tutorial'
export type ActorType = 'politician' | 'scientist' | 'artist' | 'robot'
export type ArgumentType = 'rock' | 'paper' | 'scissors' | 'dummy'
/** Tie-breaks and re-fights: no dummy (rulebook). */
export type Rps = 'rock' | 'paper' | 'scissors'
export type LocationId = 'square' | 'theatre' | 'university' | 'factory' | 'power_plant' | 'dump'
export type ValueType = 'power' | 'art' | 'knowledge' | 'fame'
export type ResourceType = 'product' | 'electricity' | 'recycling'
export type BetType = 'win' | 'lose' | 'draw'
export type Outcome = 'win' | 'lose' | 'draw'
/** 2v2 teams: team 0 = seats [0,2], team 1 = seats [1,3]. */
export type TeamId = 0 | 1

/** Each seat owns exactly one actor of each type, so identity is derivable. */
export type ActorId = `${SeatId}:${ActorType}`

export interface Values {
  power: number
  art: number
  knowledge: number
  fame: number
}

export interface Resources {
  product: number
  electricity: number
  recycling: number
}

/** An actor on the board (spec §2). Argument/bet stay hidden until P4 reveal. */
export interface Placement {
  actorId: ActorId
  seat: SeatId
  actorType: ActorType
  locationId: LocationId
  argument: ArgumentType
  bet?: BetType
}
