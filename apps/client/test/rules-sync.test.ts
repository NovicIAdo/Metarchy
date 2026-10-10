// The in-app rulebooks are build-time copies of the canonical docs/*.md (docs/ is
// .dockerignored, so the client can't read it at build). This guards the copies
// against drift — if a canon changes, run `pnpm sync:rules`.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const CASES: [canon: string, copy: string][] = [
  ['docs/metarchy-rules.md', 'apps/client/src/content/rulebook.en.md'],
  ['docs/metarchy-rules.ru.md', 'apps/client/src/content/rulebook.ru.md'],
  ['docs/metarchy-rules.si.md', 'apps/client/src/content/rulebook.si.md']
]

describe('in-app rulebooks', () => {
  const repoRoot = path.resolve(__dirname, '../../..')
  it.each(CASES)('%s matches its synced copy verbatim', (canon, copy) => {
    expect(readFileSync(path.join(repoRoot, copy), 'utf8')).toBe(
      readFileSync(path.join(repoRoot, canon), 'utf8')
    )
  })
})
