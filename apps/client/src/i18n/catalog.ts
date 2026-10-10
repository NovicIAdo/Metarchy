// The merged string catalog. Every module under ./strings/*.ts that exports one
// or more `Strings` objects is folded in automatically (Vite glob), so adding a
// new screen's translations is a matter of dropping a file in that folder — no
// edit here, no merge contention when several are added in parallel. Keys are
// namespaced per module, so the merge never collides.

import { sinhala } from './sinhala.js'
import type { Entry } from './types.js'

const modules = import.meta.glob('./strings/*.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>

export const catalog: Record<string, Entry> = {}

for (const mod of Object.values(modules)) {
  for (const exported of Object.values(mod)) {
    if (exported && typeof exported === 'object') {
      Object.assign(catalog, exported as Record<string, Entry>)
    }
  }
}

// Later languages arrive as one key→string map each and are folded onto the
// authored entries. A key the map has not reached yet simply keeps falling back
// to English (see translate()), and a stale key it still carries is ignored.
for (const [key, value] of Object.entries(sinhala)) {
  const entry = catalog[key]
  if (entry) entry.si = value
}
