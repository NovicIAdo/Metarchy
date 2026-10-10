// The canonical rulebooks live in docs/ (repo root), which .dockerignore keeps
// out of the client image. Copy each language into src/content so `vite build`
// can bundle them (?raw) inside Docker. A client test asserts the copies match
// the sources, so drift fails CI. Run: pnpm --filter @metarchy/client sync:rules

import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = path.resolve(CLIENT_ROOT, '../../docs')
const OUT = path.join(CLIENT_ROOT, 'src/content')

const FILES: [src: string, dest: string][] = [
  ['metarchy-rules.md', 'rulebook.en.md'],
  ['metarchy-rules.ru.md', 'rulebook.ru.md'],
  ['metarchy-rules.si.md', 'rulebook.si.md']
]

await mkdir(OUT, { recursive: true })
for (const [src, dest] of FILES) {
  await copyFile(path.join(DOCS, src), path.join(OUT, dest))
  console.log(`synced ${src} → src/content/${dest}`)
}
