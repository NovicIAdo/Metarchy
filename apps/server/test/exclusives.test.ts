// Personal skins: a look one beta tester designed, granted to that account and
// to nobody else. The grant is a code-level table keyed by the email on the
// verified JWT, and it reaches the rest of the server as ownership — so the
// fitting-room locks and the equip gate need no special case.

import { describe, expect, it } from 'vitest'
import { isExclusiveSkin, skinItemId } from '@metarchy/protocol'
import {
  EXCLUSIVE_GRANTS,
  emailKey,
  exclusiveGrantsFor,
  walletWithGrants,
  type GrantTable
} from '../src/exclusives.js'

const GIFT = skinItemId('artist', 'anna')
const TABLE: GrantTable = { [emailKey('anna@example.test')]: [GIFT] }

/** Minimal wallet source — the real store satisfies the same shape. */
const store = (owned: string[]) => ({
  getWallet: async () => ({ balance: 500, owned: [...owned] })
})

describe('personal-skin grants', () => {
  it('finds a grant by email, case- and whitespace-insensitively', () => {
    expect(exclusiveGrantsFor('anna@example.test', TABLE)).toEqual([GIFT])
    expect(exclusiveGrantsFor('  ANNA@Example.Test ', TABLE)).toEqual([GIFT])
  })

  it('gives nothing to anyone else, or to a token without an address', () => {
    expect(exclusiveGrantsFor('someone@example.test', TABLE)).toEqual([])
    expect(exclusiveGrantsFor(null, TABLE)).toEqual([])
    expect(exclusiveGrantsFor('', TABLE)).toEqual([])
  })

  it('the wallet the player sees is what they bought plus what they were given', async () => {
    const bought = skinItemId('robot', 'industrial')
    const mine = await walletWithGrants(store([bought]), 'u1', 'anna@example.test', TABLE)
    expect(mine.owned).toEqual([bought, GIFT])
    expect(mine.balance).toBe(500) // a gift costs nothing
    const theirs = await walletWithGrants(store([bought]), 'u2', 'bob@example.test', TABLE)
    expect(theirs.owned).toEqual([bought])
  })

  it('never doubles an id that is already owned', async () => {
    const mine = await walletWithGrants(store([GIFT]), 'u1', 'anna@example.test', TABLE)
    expect(mine.owned).toEqual([GIFT])
  })

  it('the shipped table is well-formed: email hashes, never addresses; skin item ids', () => {
    for (const [key, items] of Object.entries(EXCLUSIVE_GRANTS)) {
      expect(key, 'keys are emailKey() hashes').toMatch(/^[0-9a-f]{64}$/)
      for (const id of items) expect(id, `${key} → ${id}`).toMatch(/^skin\.[a-z]+\.[a-z0-9-]+$/)
    }
  })

  // Catches both halves of a silent mistake: a typo'd id that grants nothing,
  // and a skin that stopped being exclusive (i.e. went on sale) while somebody
  // was still being handed it for free.
  it('every shipped grant names a real personal skin', () => {
    for (const [key, items] of Object.entries(EXCLUSIVE_GRANTS))
      for (const id of items) {
        const [, actor, skin] = id.split('.')
        expect(isExclusiveSkin(actor ?? '', skin ?? ''), `${key} → ${id}`).toBe(true)
      }
  })

  // Ann (wave 1), asa and okeesha (wave 2) each designed a four-Actor set.
  it('each beta designer holds exactly their own four-Actor set', () => {
    const sets = Object.values(EXCLUSIVE_GRANTS).map((items) => [...items].sort())
    for (const who of ['ann', 'asa', 'okeesha'])
      expect(sets).toContainEqual(
        ['artist', 'politician', 'robot', 'scientist'].map((a) => skinItemId(a, who)).sort()
      )
    expect(sets).toHaveLength(3)
  })
})
