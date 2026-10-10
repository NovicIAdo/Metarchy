import { describe, expect, it } from 'vitest'
import { fnv1a32, randBelow, randU32, shuffled } from '../src/index.js'

describe('counter-based rng', () => {
  it('is a pure function of (seed, cursor)', () => {
    const h = fnv1a32('game-42')
    for (let cursor = 0; cursor < 100; cursor++) {
      expect(randU32(h, cursor)).toBe(randU32(h, cursor))
    }
  })

  it('different seeds give different streams', () => {
    const a = Array.from({ length: 16 }, (_, i) => randU32(fnv1a32('seed-a'), i))
    const b = Array.from({ length: 16 }, (_, i) => randU32(fnv1a32('seed-b'), i))
    expect(a).not.toEqual(b)
  })

  it('randBelow stays in range and covers the whole range over many draws', () => {
    const h = fnv1a32('coverage')
    const seen = new Set<number>()
    for (let cursor = 0; cursor < 2000; cursor++) {
      const v = randBelow(h, cursor, 15)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(15)
      seen.add(v)
    }
    expect(seen.size).toBe(15)
  })

  it('randBelow rejects non-positive n', () => {
    expect(() => randBelow(1, 0, 0)).toThrow()
    expect(() => randBelow(1, 0, -3)).toThrow()
  })

  it('randU32 rejects negative or fractional cursors', () => {
    expect(() => randU32(1, -1)).toThrow()
    expect(() => randU32(1, 0.5)).toThrow()
  })

  it('shuffled is deterministic, preserves the multiset, and consumes n-1 draws', () => {
    const deck = ['a', 'b', 'b', 'c', 'd', 'e', 'f', 'f', 'f']
    const h = fnv1a32('shuffle-seed')
    const first = shuffled(deck, h, 7)
    const second = shuffled(deck, h, 7)
    expect(first.items).toEqual(second.items)
    expect(first.cursor).toBe(7 + deck.length - 1)
    expect([...first.items].sort()).toEqual([...deck].sort())
    expect(deck[0]).toBe('a') // input untouched
  })

  it('different cursors give different permutations (fixed seeds)', () => {
    const deck = Array.from({ length: 15 }, (_, i) => i)
    const h = fnv1a32('perm')
    expect(shuffled(deck, h, 0).items).not.toEqual(shuffled(deck, h, 100).items)
  })
})
