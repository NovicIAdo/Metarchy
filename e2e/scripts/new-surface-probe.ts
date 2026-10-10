// Live probe for the wire surface the staging smoke does not touch: the Players
// directory, the persisted chat (global room + a DM to yourself being refused),
// achievements riding on the profile reply, and the ranked queue's new roster +
// bot deadline. Read-mostly on purpose — the one write is a global chat message,
// which is exactly the path with a rate limit and a length cap to prove.
//
// Usage:
//   SMOKE_HTTP=https://metarchy-staging.fly.dev SMOKE_TOKEN=<jwt> \
//     pnpm -C e2e exec tsx scripts/new-surface-probe.ts

import { GameClient } from '../src/client.js'

const httpUrl = process.env.SMOKE_HTTP ?? 'https://metarchy-staging.fly.dev'
const wsUrl = httpUrl.replace(/^http/, 'ws') + '/ws'
const token = process.env.SMOKE_TOKEN
if (!token) throw new Error('SMOKE_TOKEN is required')

const ok = (name: string, detail = ''): void =>
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)

console.log(`New-surface probe against ${httpUrl}`)
const client = await GameClient.connect(wsUrl)
client.send({ t: 'hello', p: { accessToken: token } })
const welcome = await client.expect('welcome', 15000)
const me = welcome.p.profile
ok('authenticated', `${me.nickname}`)

// --- Players directory (backlog #2) -----------------------------------------
client.send({ t: 'players.list', seq: 1 })
const players = await client.expect('players', 10000)
if (players.p.rows.length === 0) throw new Error('the roster came back empty')
const self = players.p.rows.find((r) => r.nickname === me.nickname)
if (!self) throw new Error('the roster does not contain the caller')
ok('players.list', `${players.p.rows.length} of ${players.p.total}, ranked rate present`)

// Search must narrow, case-insensitively.
client.send({ t: 'players.list', seq: 2, p: { query: me.nickname.slice(1, 5).toUpperCase() } })
const found = await client.expect('players', 10000)
if (!found.p.rows.some((r) => r.nickname === me.nickname))
  throw new Error(`search for a substring of ${me.nickname} did not return it`)
ok('players.list search', `"${me.nickname.slice(1, 5).toUpperCase()}" → ${found.p.total}`)

// --- Public profile + achievements (backlog #2 + the 2026-07-27 list) --------
client.send({ t: 'player.get', seq: 3, p: { nickname: me.nickname.toLowerCase() } })
const profile = await client.expect('player', 10000)
if (profile.p.card.nickname !== me.nickname)
  throw new Error(`case-insensitive lookup returned ${profile.p.card.nickname}`)
const categories = Object.keys(profile.p.record).sort().join(',')
if (categories !== 'bots,private,ranked,team')
  throw new Error(`unexpected record categories: ${categories}`)
const earned = profile.p.achievements?.earned?.length ?? 0
ok('player.get', `record ${categories}, ${earned} achievement(s) earned`)

// --- Persisted chat (backlog #3) --------------------------------------------
client.send({ t: 'chat.list', seq: 4, p: { scope: { kind: 'global' }, sort: 'new' } })
const room = await client.expect('chat.messages', 10000)
ok('chat.list', `${room.p.total} message(s), cooldown ${room.p.cooldownMs}ms`)

// 256 characters must be refused by the schema, 255 accepted by the server.
client.send({ t: 'chat.post', seq: 5, p: { scope: { kind: 'global' }, body: 'x'.repeat(256) } })
const tooLong = await client.expect('error', 10000)
if (tooLong.p.code !== 'bad_message')
  throw new Error(`256 chars got ${tooLong.p.code}, expected bad_message`)
ok('chat.post rejects 256 characters', tooLong.p.code)

const stamp = new Date().toISOString()
client.send({
  t: 'chat.post',
  seq: 6,
  p: { scope: { kind: 'global' }, body: `deploy probe ${stamp}` }
})
const posted = await client.next((m) => m.t === 'chat.posted' || m.t === 'error', 10000)
if (posted.t === 'error') {
  // A recent probe run leaves the minute limit armed — that IS the rule working.
  if (posted.p.code !== 'rate_limited') throw new Error(`post failed: ${posted.p.code}`)
  ok('chat.post rate limit holds', 'rate_limited (one global message per minute)')
} else {
  ok('chat.post accepted', posted.p.message.body.slice(0, 24) + '…')
}

// A DM to yourself is not a conversation — refused server-side, not by the UI.
client.send({
  t: 'chat.post',
  seq: 7,
  p: { scope: { kind: 'dm', peerId: me.userId }, body: 'talking to myself' }
})
const selfDm = await client.expect('error', 10000)
ok('DM to self refused', selfDm.p.code)

// --- Ranked queue: roster + bot deadline (backlog #9) ------------------------
client.send({ t: 'queue.join', seq: 8, p: { mode: 'ffa3' } })
const queued = await client.expect('queue.status', 10000)
if (queued.p.seats !== 3) throw new Error(`ffa3 reported ${queued.p.seats} seats`)
if (queued.p.botAt === null) throw new Error('no bot deadline on a ranked queue')
const secondsToBot = Math.round((queued.p.botAt - Date.now()) / 1000)
if (secondsToBot < 30 || secondsToBot > 70)
  throw new Error(`bot deadline is ${secondsToBot}s away, expected ~60`)
ok('queue.status', `${queued.p.found.length} found of ${queued.p.seats}, bot in ~${secondsToBot}s`)
client.send({ t: 'queue.leave' })

client.close()
console.log('NEW-SURFACE PROBE PASSED')
