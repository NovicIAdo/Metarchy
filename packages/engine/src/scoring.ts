// Victory points — spec §10. Fame greedily fills the lowest of power/art/knowledge
// (first equal in that fixed order), then VP = min of the three.

import type { Values } from './types.js'

export function fameDistributed(values: Values): Values {
  const out = { ...values }
  while (out.fame > 0) {
    const min = Math.min(out.power, out.art, out.knowledge)
    if (out.power === min) out.power += 1
    else if (out.art === min) out.art += 1
    else out.knowledge += 1
    out.fame -= 1
  }
  return out
}

export function victoryPoints(values: Values): number {
  const d = fameDistributed(values)
  return Math.min(d.power, d.art, d.knowledge)
}
