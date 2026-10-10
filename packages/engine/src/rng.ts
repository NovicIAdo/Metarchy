// Deterministic counter-based RNG. Every draw is a pure function of (seed, cursor),
// so any state can be replayed from its `rngCursor` alone — no hidden generator state.
// Not cryptographic: fairness comes from server-side seed secrecy + commit-reveal
// (architecture/Blockchain-Portability.md).

const GOLDEN = 0x9e3779b9

/** FNV-1a 32-bit hash (UTF-16 code units). Used for string seeds and state hashing. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Murmur3-style avalanche of a u32. */
function mix32(x: number): number {
  x ^= x >>> 16
  x = Math.imul(x, 0x21f0aaad)
  x ^= x >>> 15
  x = Math.imul(x, 0x735a2d97)
  x ^= x >>> 15
  return x >>> 0
}

/** The `cursor`-th draw of the stream for this seed hash: u32 in [0, 2^32). O(1) per draw. */
export function randU32(seedHash: number, cursor: number): number {
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    throw new Error(`randU32: cursor must be a non-negative integer, got ${cursor}`)
  return mix32((seedHash + Math.imul(cursor + 1, GOLDEN)) >>> 0)
}

/** Integer in [0, n). Modulo bias < n/2^32 — negligible for game-sized n. */
export function randBelow(seedHash: number, cursor: number, n: number): number {
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`randBelow: n must be a positive integer, got ${n}`)
  return randU32(seedHash, cursor) % n
}

/**
 * Fisher-Yates shuffle consuming exactly `items.length - 1` draws starting at `cursor`.
 * Returns the shuffled copy and the advanced cursor.
 */
export function shuffled<T>(
  items: readonly T[],
  seedHash: number,
  cursor: number
): { items: T[]; cursor: number } {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randBelow(seedHash, cursor, i + 1)
    cursor++
    const tmp = out[i] as T
    out[i] = out[j] as T
    out[j] = tmp
  }
  return { items: out, cursor }
}
