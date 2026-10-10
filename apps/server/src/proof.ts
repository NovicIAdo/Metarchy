// Proof trail (architecture/Blockchain-Portability.md hooks, Data-Model.md §2):
// keccak256 move commitments and the RNG seed commitment. No chain dependencies —
// hashes are just rows until the post-MVP blockchain stage.

import { randomBytes } from 'node:crypto'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { Intent } from '@metarchy/engine'
import { canonicalStringify } from '@metarchy/engine'
import type { SeatId } from '@metarchy/engine'

export function keccakHex(text: string): string {
  return bytesToHex(keccak_256(utf8ToBytes(text)))
}

/** Published in `games.rng_seed_hash` at creation; seed itself is revealed at game end. */
export function seedCommitment(seed: string): string {
  return keccakHex(seed)
}

export function newSalt(): string {
  return randomBytes(16).toString('hex')
}

export interface MoveCommitmentInput {
  gameId: string
  turn: number
  /** 1..5 (phase number). */
  phase: number
  seat: SeatId
  intent: Intent
}

/** keccak256(canonicalJson({gameId,turn,phase,seat,intent}) || salt) per Data-Model.md. */
export function moveCommitment(input: MoveCommitmentInput, salt: string): string {
  return keccakHex(canonicalStringify(input) + salt)
}

export const PHASE_NUMBER = {
  p1_event: 1,
  p2_distribution: 2,
  p3_action: 3,
  p4_conflict: 4,
  p5_market: 5,
  finished: 0
} as const
