// Staging smoke (plan Stage 2 DoD): against a deployed server, verify
//   1. /healthz answers,
//   2. a garbage token is rejected through the real Supabase JWKS path,
//   3. a real Supabase user token authenticates, and
//   4. a full vs_bots game runs to completion over wss.
//
// Usage:
//   SMOKE_HTTP=https://metarchy-staging.fly.dev \
//   SMOKE_TOKEN=<supabase access_token> pnpm exec tsx scripts/staging-smoke.ts

import { mulberry32 } from '../src/autoplayer.js'
import { GameClient } from '../src/client.js'

const httpUrl = process.env.SMOKE_HTTP ?? 'https://metarchy-staging.fly.dev'
const wsUrl = httpUrl.replace(/^http/, 'ws') + '/ws'
const token = process.env.SMOKE_TOKEN

function ok(name: string, detail = ''): void {
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log(`Smoke against ${httpUrl}`)

const health = await fetch(`${httpUrl}/healthz`)
if (!health.ok) throw new Error(`healthz ${health.status}`)
ok('healthz', JSON.stringify(await health.json()))

{
  const bad = await GameClient.connect(wsUrl)
  const reply = await bad
    .hello('definitely-not-a-jwt')
    .then(() => null)
    .catch((e: Error) => e.message)
  if (!reply || !reply.includes('auth_failed')) throw new Error(`expected auth_failed: ${reply}`)
  ok('garbage token rejected via real JWKS', 'auth_failed')
}

if (!token) {
  console.log('  – SMOKE_TOKEN not set: skipping the real-token game')
  process.exit(0)
}

const client = await GameClient.connect(wsUrl)
const welcome = await client.hello(token)
ok('real Supabase token accepted', `user ${welcome.p.profile.userId}`)

const created = await client.createGame({ mode: 'vs_bots' })
ok('vs_bots game created', created.p.gameId)
await client.expect('game.started', 10_000)

const startedAt = Date.now()
const outcome = await client.playUntilFinished(created.p.gameId, mulberry32(0x57a6e), {
  throttleMs: 250,
  idleTimeoutMs: 60_000,
  maxSteps: 10_000
})
ok(
  'full game finished on staging',
  `winners ${JSON.stringify(outcome.winnerSeats)}, ranking ${JSON.stringify(outcome.ranking)}, ${Math.round((Date.now() - startedAt) / 1000)}s`
)
client.close()
console.log('SMOKE PASSED')
process.exit(0)
