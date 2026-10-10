// EngineEvent — spec/Game-Specification.md §4 (events), architecture/Engine.md §3
// (visibility model). The server broadcasts each event only to the seats listed.

import type { SeatId } from './types.js'

export type Visibility = 'public' | SeatId[]

export interface EngineEvent {
  seq: number
  type: string
  payload: unknown
  visibility: Visibility
}
