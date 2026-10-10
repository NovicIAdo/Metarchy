// Market contract, run against both backends — MemoryStore and the SQL store
// over embedded Postgres (PGlite) with the real supabase/migrations schema.
//
// The sale is the part worth pinning hardest. The Sql boundary has no
// transaction API, so buyListing is ONE statement built out of data-modifying
// CTEs; if any branch of it silently stopped firing, the failure mode is a good
// duplicated or destroyed and money that went nowhere. Every assertion below
// checks BOTH sides of the exchange, never just the buyer's.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GATO_START_BALANCE, MARKET_LISTING_TTL_DAYS } from '@metarchy/protocol'
import { makePgliteSql, migrate } from '../src/db.js'
import { SqlProfileStore, SqlStore } from '../src/store-sql.js'
import type { GameStore } from '../src/store.js'
import { MemoryStore } from '../src/store.js'

interface Backend {
  store: GameStore
  close(): Promise<void>
  /** SQL backend only: listings/comments carry an FK to profiles. */
  seedProfile?(userId: string): Promise<void>
}

const backends: [string, () => Promise<Backend>][] = [
  ['MemoryStore', async () => ({ store: new MemoryStore(), close: async () => {} })],
  [
    'SqlStore over PGlite',
    async () => {
      const sql = await makePgliteSql('memory://')
      await migrate(sql)
      // Under the production role, not the superuser: this is what catches a
      // grant the migration forgot (the sale needs DELETE on purchases).
      await sql.exec('set role metarchy_server')
      const profiles = new SqlProfileStore(sql)
      return {
        store: new SqlStore(sql),
        close: () => sql.close(),
        seedProfile: async (userId) => {
          await profiles.getOrCreate(userId, null)
        }
      }
    }
  ]
]

const TTL = MARKET_LISTING_TTL_DAYS
const CAP = 10
const SKIN = 'skin.robot.industrial'
const OTHER = 'skin.artist.holo-graffiti'

/** A player with the item already bought, so the wallet reflects the purchase. */
async function seller(b: Backend, itemId = SKIN): Promise<string> {
  const id = randomUUID()
  if (b.seedProfile) await b.seedProfile(id)
  b.store.rememberParty({ userId: id, nickname: `p_${id.slice(0, 6)}`, avatar: null })
  await b.store.getWallet(id)
  expect(await b.store.purchase(id, itemId, 300)).toBe('ok')
  return id
}

async function buyer(b: Backend): Promise<string> {
  const id = randomUUID()
  if (b.seedProfile) await b.seedProfile(id)
  b.store.rememberParty({ userId: id, nickname: `p_${id.slice(0, 6)}`, avatar: null })
  await b.store.getWallet(id)
  return id
}

describe.each(backends)('market contract: %s', (_name, make) => {
  it('a sale moves the good AND the money, both sides', async () => {
    const b = await make()
    try {
      const alice = await seller(b)
      const bob = await buyer(b)
      const lot = await b.store.createListing(alice, SKIN, 120, TTL, CAP)
      expect(lot.ok).toBe(true)
      if (!lot.ok) return

      const result = await b.store.buyListing(bob, lot.row.id, 0)
      expect(result).toEqual({ ok: true, itemId: SKIN, price: 120 })

      const aliceWallet = await b.store.getWallet(alice)
      const bobWallet = await b.store.getWallet(bob)
      // The entitlement MOVED — a sale that copied it would mint a second one.
      expect(aliceWallet.owned).not.toContain(SKIN)
      expect(bobWallet.owned).toContain(SKIN)
      expect(aliceWallet.balance).toBe(GATO_START_BALANCE - 300 + 120)
      expect(bobWallet.balance).toBe(GATO_START_BALANCE - 120)
      // And the lot left the shelf.
      expect((await b.store.browseMarket(browse(bob))).total).toBe(0)
    } finally {
      await b.close()
    }
  })

  it('refuses a sale it cannot complete, and moves nothing when it does', async () => {
    const b = await make()
    try {
      const alice = await seller(b)
      const bob = await buyer(b)
      const dear = await b.store.createListing(alice, SKIN, GATO_START_BALANCE + 1, TTL, CAP)
      if (!dear.ok) throw new Error('setup')

      expect(await b.store.buyListing(alice, dear.row.id, 0)).toEqual({
        ok: false,
        reason: 'own'
      })
      expect(await b.store.buyListing(bob, dear.row.id, 0)).toEqual({
        ok: false,
        reason: 'insufficient'
      })
      // Nothing partial: the seller still owns it and neither wallet moved.
      expect((await b.store.getWallet(alice)).owned).toContain(SKIN)
      expect((await b.store.getWallet(bob)).balance).toBe(GATO_START_BALANCE)
      expect((await b.store.getWallet(alice)).balance).toBe(GATO_START_BALANCE - 300)

      // Already-owned is refused too — a second copy buys the player nothing.
      expect(await b.store.purchase(bob, OTHER, 300)).toBe('ok')
      const carol = await seller(b, OTHER)
      const dupe = await b.store.createListing(carol, OTHER, 10, TTL, CAP)
      if (!dupe.ok) throw new Error('setup')
      expect(await b.store.buyListing(bob, dupe.row.id, 0)).toEqual({
        ok: false,
        reason: 'owned'
      })
    } finally {
      await b.close()
    }
  })

  it('takes the fee off the seller, not the buyer', async () => {
    const b = await make()
    try {
      const alice = await seller(b)
      const bob = await buyer(b)
      const lot = await b.store.createListing(alice, SKIN, 200, TTL, CAP)
      if (!lot.ok) throw new Error('setup')
      // 10% — the constant ships at 0, but the plumbing has to be right before
      // the author turns it on, and it is NOT a burn: it leaves the seller only.
      expect((await b.store.buyListing(bob, lot.row.id, 1000)).ok).toBe(true)
      expect((await b.store.getWallet(bob)).balance).toBe(GATO_START_BALANCE - 200)
      expect((await b.store.getWallet(alice)).balance).toBe(GATO_START_BALANCE - 300 + 180)
    } finally {
      await b.close()
    }
  })

  it('locks a listed item out of the wardrobe, and cancelling gives it back', async () => {
    const b = await make()
    try {
      const alice = await seller(b)
      expect(await b.store.lockedItems(alice)).toEqual([])
      const lot = await b.store.createListing(alice, SKIN, 50, TTL, CAP)
      if (!lot.ok) throw new Error('setup')
      expect(await b.store.lockedItems(alice)).toEqual([SKIN])

      expect(await b.store.cancelListing(alice, lot.row.id)).toBe(true)
      expect(await b.store.lockedItems(alice)).toEqual([])
      // Still owned — cancelling is not selling.
      expect((await b.store.getWallet(alice)).owned).toContain(SKIN)
      // And it cannot be cancelled twice, nor bought after.
      expect(await b.store.cancelListing(alice, lot.row.id)).toBe(false)
      const bob = await buyer(b)
      expect(await b.store.buyListing(bob, lot.row.id, 0)).toEqual({
        ok: false,
        reason: 'not_found'
      })
    } finally {
      await b.close()
    }
  })

  it('refuses to list what is not yours, what is already up, and one lot too many', async () => {
    const b = await make()
    try {
      const alice = await seller(b)
      const bob = await buyer(b)
      expect(await b.store.createListing(bob, SKIN, 10, TTL, CAP)).toEqual({
        ok: false,
        reason: 'not_owned'
      })
      const first = await b.store.createListing(alice, SKIN, 10, TTL, CAP)
      expect(first.ok).toBe(true)
      expect(await b.store.createListing(alice, SKIN, 20, TTL, CAP)).toEqual({
        ok: false,
        reason: 'listed'
      })
      // The cap counts lots, not items: one more item, but no room for it.
      expect(await b.store.purchase(alice, OTHER, 300)).toBe('ok')
      expect(await b.store.createListing(alice, OTHER, 10, TTL, 1)).toEqual({
        ok: false,
        reason: 'too_many'
      })
    } finally {
      await b.close()
    }
  })

  it('expires a stale lot back to the seller instead of selling it', async () => {
    const b = await make()
    try {
      const alice = await seller(b)
      const bob = await buyer(b)
      // A lot dated into the past: expiry is swept lazily on the next read, so
      // this is exactly what a week-old lot looks like to the next visitor.
      const lot = await b.store.createListing(alice, SKIN, 10, -1, CAP)
      if (!lot.ok) throw new Error('setup')
      expect((await b.store.browseMarket(browse(bob))).total).toBe(0)
      expect(await b.store.lockedItems(alice)).toEqual([])
      expect(await b.store.buyListing(bob, lot.row.id, 0)).toEqual({
        ok: false,
        reason: 'not_found'
      })
      expect((await b.store.getWallet(alice)).owned).toContain(SKIN)
      // Expired frees the slot: the same item can go up again.
      expect((await b.store.createListing(alice, SKIN, 10, TTL, CAP)).ok).toBe(true)
    } finally {
      await b.close()
    }
  })

  it('browses by category prefix and counts the whole shelf, not the page', async () => {
    const b = await make()
    try {
      const alice = await seller(b)
      const bob = await buyer(b)
      await b.store.purchase(alice, OTHER, 300)
      await b.store.purchase(alice, 'argSkin.silver', 300)
      for (const id of [SKIN, OTHER, 'argSkin.silver'])
        expect((await b.store.createListing(alice, id, 10, TTL, CAP)).ok).toBe(true)

      expect((await b.store.browseMarket(browse(bob))).total).toBe(3)
      const skins = await b.store.browseMarket({ ...browse(bob), prefix: 'skin.' })
      expect(skins.total).toBe(2)
      expect(skins.rows.map((r) => r.itemId).sort()).toEqual([OTHER, SKIN].sort())
      const coins = await b.store.browseMarket({ ...browse(bob), prefix: 'argSkin.' })
      expect(coins.rows.map((r) => r.itemId)).toEqual(['argSkin.silver'])

      // `mine` is the seller's own shelf; a buyer's is empty.
      expect((await b.store.browseMarket({ ...browse(alice), mine: true })).total).toBe(3)
      expect((await b.store.browseMarket({ ...browse(bob), mine: true })).total).toBe(0)

      // A page is capped, the count is not — that is what the pager reads.
      const page = await b.store.browseMarket({ ...browse(bob), limit: 2 })
      expect(page.rows).toHaveLength(2)
      expect(page.total).toBe(3)
      expect(page.rows[0]?.seller.userId).toBe(alice)
    } finally {
      await b.close()
    }
  })

  it('carries comments on a live lot and refuses them once it is gone', async () => {
    const b = await make()
    try {
      const alice = await seller(b)
      const bob = await buyer(b)
      const lot = await b.store.createListing(alice, SKIN, 900, TTL, CAP)
      if (!lot.ok) throw new Error('setup')

      expect(await b.store.addComment(bob, lot.row.id, 'drop it and I will take it')).toBe(true)
      expect(await b.store.addComment(alice, lot.row.id, 'no')).toBe(true)
      const thread = await b.store.listComments(lot.row.id)
      // SQL uses a UUID tie-breaker when timestamps match; both comments must
      // survive regardless of their order within the same clock tick.
      expect(thread).toHaveLength(2)
      expect(thread.map((c) => [c.author.userId, c.body])).toEqual(
        expect.arrayContaining([
          [bob, 'drop it and I will take it'],
          [alice, 'no']
        ])
      )
      // The count rides along on the card, so the shelf shows a busy lot.
      const shelf = await b.store.browseMarket(browse(bob))
      expect(shelf.rows[0]?.comments).toBe(2)

      await b.store.cancelListing(alice, lot.row.id)
      expect(await b.store.addComment(bob, lot.row.id, 'still here?')).toBe(false)
      // The thread survives the lot — it is the record of a negotiation.
      expect(await b.store.listComments(lot.row.id)).toHaveLength(2)
    } finally {
      await b.close()
    }
  })

  it('drops a cosmetic once per (game, seat), however often the finish replays', async () => {
    const b = await make()
    try {
      const alice = await buyer(b)
      const gameId = randomUUID()
      if (b.seedProfile) await seedGame(b, gameId)

      expect(await b.store.recordDrop(gameId, 0, alice, SKIN)).toBe(true)
      expect((await b.store.getWallet(alice)).owned).toContain(SKIN)
      // A recovered server can reach `finished` again; the ledger row refuses.
      expect(await b.store.recordDrop(gameId, 0, alice, OTHER)).toBe(false)
      expect((await b.store.getWallet(alice)).owned).not.toContain(OTHER)
      // A drop is earned, not bought: the wallet is untouched.
      expect((await b.store.getWallet(alice)).balance).toBe(GATO_START_BALANCE)
      // Another seat of the same game rolls on its own.
      const bob = await buyer(b)
      expect(await b.store.recordDrop(gameId, 1, bob, OTHER)).toBe(true)
      // "Rolled and won nothing" is recorded too, and is equally final.
      const carol = await buyer(b)
      expect(await b.store.recordDrop(gameId, 2, carol, null)).toBe(true)
      expect(await b.store.recordDrop(gameId, 2, carol, SKIN)).toBe(false)
      expect((await b.store.getWallet(carol)).owned).toEqual([])
    } finally {
      await b.close()
    }
  })
})

const browse = (viewerId: string) => ({
  viewerId,
  prefix: null,
  mine: false,
  limit: 20,
  offset: 0
})

/** item_drops has an FK to games; the memory backend needs nothing. */
async function seedGame(b: Backend, gameId: string): Promise<void> {
  await b.store.createGame({
    gameId,
    mode: '1v1',
    status: 'finished',
    isPrivate: false,
    inviteCode: null,
    rulesVersion: '1.1.0',
    rngSeedHash: 'x'.repeat(64)
  })
}
