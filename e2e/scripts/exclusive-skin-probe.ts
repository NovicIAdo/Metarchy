// Live probe for personal skins: the look one beta tester designed, granted to
// that account and to nobody else. Two halves, and the interesting one is the
// refusal — a cosmetic gate that only works in the UI is not a gate at all.
//
// Run against a deployed server as SOMEBODY ELSE (any smoke account):
//   SMOKE_TOKEN=<supabase access_token> \
//   PROBE_URL=wss://metarchy-staging.fly.dev/ws \
//   pnpm --filter @metarchy/e2e exec tsx scripts/exclusive-skin-probe.ts
//
// The owner's half cannot be probed without her credentials — what is checked
// here is that the art ships, the Shop does not sell it, and the server says no
// to everyone else.

import { EXCLUSIVE_SKINS, skinItemId } from '@metarchy/protocol'
import { GameClient } from '../src/index.js'

const URL = process.env.PROBE_URL ?? 'wss://metarchy-staging.fly.dev/ws'
const HTTP = URL.replace(/^ws/, 'http').replace(/\/ws$/, '')
const token = process.env.SMOKE_TOKEN
if (!token) throw new Error('SMOKE_TOKEN is required (a Supabase access_token)')

const pairs = Object.entries(EXCLUSIVE_SKINS).flatMap(([actor, ids]) =>
  ids.map((id) => ({ actor, id }))
)
if (pairs.length === 0) throw new Error('no personal skins in the catalog — nothing to probe')

async function main(): Promise<void> {
  console.log(`Personal-skin probe against ${HTTP}`)

  // 1. The art ships: a skin nobody can buy still has to load for its owner.
  for (const { actor, id } of pairs) {
    const url = `${HTTP}/themes/cyberpunk/skins/${actor}/${id}.webp`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  }
  console.log(`  ✓ art served for all ${pairs.length} personal skins`)

  const client = await GameClient.connect(URL)
  const welcome = await client.hello(token)
  console.log(`  ✓ connected as ${welcome.p.profile.userId}`)

  // 2. Not in this account's entitlements.
  client.send({ t: 'wallet.get', seq: 900 })
  const wallet = await client.expect('wallet')
  const gifted = pairs.filter((p) => wallet.p.owned.includes(skinItemId(p.actor, p.id)))
  if (gifted.length > 0)
    throw new Error(`someone else's personal skins turned up owned: ${JSON.stringify(gifted)}`)
  console.log(`  ✓ not owned here (${wallet.p.owned.length} items, ${wallet.p.balance} GATO)`)

  // 3. Not for sale at any price.
  const first = pairs[0] as { actor: string; id: string }
  client.send({ t: 'shop.buy', seq: 901, p: { itemId: skinItemId(first.actor, first.id) } })
  const buy = await client.next((m) => m.t === 'error' || m.t === 'wallet')
  if (buy.t !== 'error') throw new Error('the Shop sold a personal skin')
  console.log(`  ✓ Shop refuses to sell it — ${buy.p.code}`)

  // 4. And the equip gate says no, which is the one that actually matters.
  client.send({
    t: 'profile.update',
    seq: 902,
    p: { wardrobe: { skins: { [first.actor]: first.id } } }
  })
  const worn = await client.next((m) => m.t === 'error' || m.t === 'profile.updated')
  if (worn.t !== 'error')
    throw new Error(`the server let a stranger wear ${first.actor}/${first.id}`)
  console.log(`  ✓ wearing it is refused — ${worn.p.code}: ${worn.p.message}`)

  client.close()
  console.log('PROBE PASSED')
}

await main()
