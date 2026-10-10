import { describe, expect, it } from 'vitest'
import { canonicalHash, canonicalStringify } from '../src/index.js'

describe('canonical serialization', () => {
  it('is independent of key insertion order', () => {
    const a = { x: 1, y: [{ b: 2, a: 1 }], z: 'ok' }
    const b = { z: 'ok', x: 1, y: [{ a: 1, b: 2 }] }
    expect(canonicalStringify(a)).toBe(canonicalStringify(b))
    expect(canonicalHash(a)).toBe(canonicalHash(b))
  })

  it('produces parseable JSON that round-trips', () => {
    const value = { turn: 3, board: { placements: [], disabled: ['square'] }, ok: true, n: null }
    const text = canonicalStringify(value)
    expect(JSON.parse(text)).toEqual(value)
  })

  it('sorts keys lexicographically at every level', () => {
    expect(canonicalStringify({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}')
  })

  it('skips undefined object properties (JSON semantics)', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('normalizes -0 to 0', () => {
    expect(canonicalStringify(-0)).toBe('0')
  })

  it('rejects non-integer numbers — the engine is integer-only', () => {
    expect(() => canonicalStringify({ vp: 1.5 })).toThrow(/non-integer/)
    expect(() => canonicalStringify(Number.NaN)).toThrow(/non-integer/)
    expect(() => canonicalStringify(Number.MAX_SAFE_INTEGER + 2)).toThrow(/non-integer/)
  })

  it('rejects undefined array elements and non-plain objects', () => {
    expect(() => canonicalStringify([1, undefined, 3])).toThrow(/undefined array element/)
    expect(() => canonicalStringify(new Date())).toThrow(/non-plain/)
    expect(() => canonicalStringify(new Map())).toThrow(/non-plain/)
    expect(() => canonicalStringify({ f: () => 1 })).toThrow(/unsupported/)
  })

  it('escapes strings exactly like JSON', () => {
    expect(canonicalStringify({ s: 'a"b\n\\' })).toBe('{"s":"a\\"b\\n\\\\"}')
  })
})
