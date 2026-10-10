// The GATO shop over real sockets: wallet grant, buying an avatar, and the
// cosmetic entitlement gate in profile.update (paid cosmetics require the
// purchase; free launch faces and the default argument coins never did).

import { randomUUID } from 'node:crypto'
import { ARG_SKIN_PRICE, AVATAR_PRICE, GATO_START_BALANCE, argSkinItemId } from '@metarchy/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import type { TestServer } from './helpers.js'
import { connectAs, startTestServer } from './helpers.js'

const servers: TestServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((ts) => ts.server.close()))
})

describe('GATO shop', () => {
  it('gates paid cosmetics until bought, then equips them', async () => {
    const ts = await startTestServer()
    servers.push(ts)
    const user = await connectAs(ts, randomUUID())

    // Fresh wallet carries the start grant and no entitlements.
    user.client.send({ t: 'wallet.get', seq: 1 })
    const fresh = await user.client.expect('wallet')
    expect(fresh.p).toEqual({ balance: GATO_START_BALANCE, owned: [] })

    // A paid avatar cannot be equipped before buying it.
    user.client.send({ t: 'profile.update', seq: 2, p: { avatar: 'politician' } })
    const denied = await user.client.expect('error')
    expect(denied.p.code).toBe('rule_violation')

    // Free faces were never gated.
    user.client.send({ t: 'profile.update', seq: 3, p: { avatar: 'golden' } })
    const freeOk = await user.client.expect('profile.updated')
    expect(freeOk.p.profile.avatar).toBe('golden')

    // Buy → wallet updates atomically; equipping now succeeds.
    user.client.send({ t: 'shop.buy', seq: 4, p: { itemId: 'avatar.politician' } })
    const bought = await user.client.expect('wallet')
    expect(bought.p.balance).toBe(GATO_START_BALANCE - AVATAR_PRICE)
    expect(bought.p.owned).toEqual(['avatar.politician'])
    user.client.send({ t: 'profile.update', seq: 5, p: { avatar: 'politician' } })
    const equipped = await user.client.expect('profile.updated')
    expect(equipped.p.profile.avatar).toBe('politician')

    // Double-buy refuses without a second debit; unknown items 404.
    user.client.send({ t: 'shop.buy', seq: 6, p: { itemId: 'avatar.politician' } })
    const dup = await user.client.expect('error')
    expect(dup.p.code).toBe('conflict')
    user.client.send({ t: 'shop.buy', seq: 7, p: { itemId: 'avatar.unknown' } })
    const missing = await user.client.expect('error')
    expect(missing.p.code).toBe('not_found')

    // An unowned skin is gated the same way.
    user.client.send({
      t: 'profile.update',
      seq: 8,
      p: { wardrobe: { skins: { robot: 'industrial' } } }
    })
    const skinDenied = await user.client.expect('error')
    expect(skinDenied.p.code).toBe('rule_violation')
    user.client.send({ t: 'shop.buy', seq: 9, p: { itemId: 'skin.robot.industrial' } })
    await user.client.expect('wallet')
    user.client.send({
      t: 'profile.update',
      seq: 10,
      p: { wardrobe: { skins: { robot: 'industrial' } } }
    })
    const skinOk = await user.client.expect('profile.updated')
    expect(skinOk.p.profile.wardrobe?.skins?.robot).toBe('industrial')
  })

  it('ships the default coins free and gates only the alloys', async () => {
    const ts = await startTestServer()
    servers.push(ts)
    const user = await connectAs(ts, randomUUID())

    // The free set is `arguments: null` — always equippable, never a purchase.
    user.client.send({ t: 'profile.update', seq: 1, p: { wardrobe: { arguments: null } } })
    const free = await user.client.expect('profile.updated')
    expect(free.p.profile.wardrobe?.arguments ?? null).toBe(null)

    // An alloy is refused until bought…
    user.client.send({ t: 'profile.update', seq: 2, p: { wardrobe: { arguments: 'matrix' } } })
    const denied = await user.client.expect('error')
    expect(denied.p.code).toBe('rule_violation')

    // …and buying one does not unlock its siblings.
    user.client.send({ t: 'shop.buy', seq: 3, p: { itemId: argSkinItemId('matrix') } })
    const wallet = await user.client.expect('wallet')
    expect(wallet.p.balance).toBe(GATO_START_BALANCE - ARG_SKIN_PRICE)
    user.client.send({ t: 'profile.update', seq: 4, p: { wardrobe: { arguments: 'silver' } } })
    const stillDenied = await user.client.expect('error')
    expect(stillDenied.p.code).toBe('rule_violation')

    user.client.send({ t: 'profile.update', seq: 5, p: { wardrobe: { arguments: 'matrix' } } })
    const equipped = await user.client.expect('profile.updated')
    expect(equipped.p.profile.wardrobe?.arguments).toBe('matrix')

    // Equipping a coin set leaves the actor wardrobe alone (top-level merge).
    user.client.send({
      t: 'profile.update',
      seq: 6,
      p: { wardrobe: { politician: { body: 1, costume: [1, 1] } } }
    })
    const dressed = await user.client.expect('profile.updated')
    expect(dressed.p.profile.wardrobe?.arguments).toBe('matrix')
    expect(dressed.p.profile.wardrobe?.politician?.body).toBe(1)
  })
})
