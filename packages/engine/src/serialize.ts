// Canonical serialization — architecture/Engine.md §1 "Serializable".
// Byte-identical output for equal states: object keys sorted, integers only, plain
// data only. Basis for snapshots, replays, determinism tests, and the proof trail.

import { fnv1a32 } from './rng.js'

export function canonicalStringify(value: unknown): string {
  const parts: string[] = []
  writeValue(value, parts, '$')
  return parts.join('')
}

/** FNV-1a 32-bit hash of the canonical serialization, as 8 hex chars. */
export function canonicalHash(value: unknown): string {
  return fnv1a32(canonicalStringify(value)).toString(16).padStart(8, '0')
}

/**
 * Deep-clone plain data (objects, arrays, primitives) — the only shapes GameState
 * may contain. Runtime-agnostic replacement for structuredClone.
 */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => deepClone(item)) as unknown as T
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) throw new Error('deepClone: non-plain object')
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item !== undefined) out[key] = deepClone(item)
  }
  return out as T
}

function writeValue(value: unknown, parts: string[], path: string): void {
  if (value === null) {
    parts.push('null')
    return
  }
  switch (typeof value) {
    case 'boolean':
      parts.push(value ? 'true' : 'false')
      return
    case 'number':
      if (!Number.isSafeInteger(value))
        throw new Error(`canonicalStringify: non-integer number ${value} at ${path}`)
      // normalize -0 → "0"
      parts.push(value === 0 ? '0' : String(value))
      return
    case 'string':
      parts.push(JSON.stringify(value))
      return
    case 'object':
      break
    default:
      throw new Error(`canonicalStringify: unsupported ${typeof value} at ${path}`)
  }
  if (Array.isArray(value)) {
    parts.push('[')
    for (let i = 0; i < value.length; i++) {
      if (i > 0) parts.push(',')
      if (value[i] === undefined)
        throw new Error(`canonicalStringify: undefined array element at ${path}[${i}]`)
      writeValue(value[i], parts, `${path}[${i}]`)
    }
    parts.push(']')
    return
  }
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null)
    throw new Error(`canonicalStringify: non-plain object at ${path}`)
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
  parts.push('{')
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as string
    if (i > 0) parts.push(',')
    parts.push(JSON.stringify(key), ':')
    writeValue(record[key], parts, `${path}.${key}`)
  }
  parts.push('}')
}
