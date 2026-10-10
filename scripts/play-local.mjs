// One-command local run: the game server on http://localhost:8080 hosting the
// built client, with an embedded Postgres on disk (.data/) and the public
// Supabase Auth project the client is built against. Any variable already set
// in the environment wins.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'apps/client/dist')
if (!existsSync(path.join(dist, 'index.html'))) {
  process.stderr.write('Client is not built — run `pnpm start` (it builds first).\n')
  process.exit(1)
}

// The client's public Supabase settings (URL + anon key) double as the server's.
const clientEnv = Object.fromEntries(
  readFileSync(path.join(root, 'apps/client/.env.production'), 'utf8')
    .split('\n')
    .filter((line) => /^VITE_[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()])
)

const port = process.env.PORT ?? '8080'
// Embedded Postgres creates its data directory but not the parent.
if (!process.env.DATABASE_URL) mkdirSync(path.join(root, '.data'), { recursive: true })
const env = {
  ...process.env,
  PORT: port,
  STATIC_DIR: process.env.STATIC_DIR ?? dist,
  DATABASE_URL: process.env.DATABASE_URL ?? `pglite:${path.join(root, '.data/metarchy')}`,
  SUPABASE_URL: process.env.SUPABASE_URL ?? clientEnv.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? clientEnv.VITE_SUPABASE_ANON_KEY,
  SOLANA_AUTH_URL: process.env.SOLANA_AUTH_URL ?? `http://localhost:${port}/`,
  SOLANA_AUTH_ALLOWED_ORIGINS:
    process.env.SOLANA_AUTH_ALLOWED_ORIGINS ?? `http://localhost:${port},http://127.0.0.1:${port}`
}

process.stdout.write(`Metarchy → http://localhost:${port}\n`)
const server = spawn('pnpm', ['--filter', '@metarchy/server', 'start'], {
  cwd: root,
  env,
  stdio: 'inherit'
})
server.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))
