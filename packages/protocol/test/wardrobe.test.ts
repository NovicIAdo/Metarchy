// Wardrobe loadouts ride profile.update and PlayerSummary; the catalog schema
// is the only server-side validation gate, so its bounds are what these pin.

import { describe, expect, it } from 'vitest'
import {
  ActorLoadoutSchema,
  EXCLUSIVE_SKINS,
  isExclusiveSkin,
  loadoutFor,
  parseClientMessage,
  SHOP_CATALOG,
  skinFor,
  SKIN_CATALOG,
  skinItemId,
  SkinsSchema,
  WardrobeSchema
} from '../src/index.js'

const full = {
  body: 2,
  costume: [3, 6] as [number, number],
  hair: [7, 7] as [number, number],
  accessories: [
    [1, 8],
    [3, 2]
  ] as [number, number][]
}

describe('wardrobe schemas', () => {
  it('accepts the minimal and the maximal loadout', () => {
    expect(ActorLoadoutSchema.safeParse({ body: 1, costume: [1, 1] }).success).toBe(true)
    expect(ActorLoadoutSchema.safeParse(full).success).toBe(true)
  })

  it('rejects out-of-catalog groups and variants', () => {
    expect(ActorLoadoutSchema.safeParse({ body: 5, costume: [1, 1] }).success).toBe(false)
    expect(ActorLoadoutSchema.safeParse({ body: 1, costume: [4, 1] }).success).toBe(false)
    expect(ActorLoadoutSchema.safeParse({ body: 1, costume: [1, 7] }).success).toBe(false)
    expect(ActorLoadoutSchema.safeParse({ body: 1, costume: [1, 1], hair: [1, 8] }).success).toBe(
      false
    )
    expect(
      ActorLoadoutSchema.safeParse({ body: 1, costume: [1, 1], accessories: [[5, 1]] }).success
    ).toBe(false)
  })

  it('rejects two accessories in one slot', () => {
    const dup = {
      body: 1,
      costume: [1, 1],
      accessories: [
        [1, 1],
        [1, 2]
      ]
    }
    expect(ActorLoadoutSchema.safeParse(dup).success).toBe(false)
  })

  it('only dressable actors pass the wardrobe object', () => {
    expect(WardrobeSchema.safeParse({ politician: null }).success).toBe(true)
    expect(WardrobeSchema.safeParse({ robot: { body: 1, costume: [1, 1] } }).success).toBe(false)
  })

  it('profile.update carries a wardrobe patch through the wire parser', () => {
    const set = parseClientMessage(
      JSON.stringify({ t: 'profile.update', p: { wardrobe: { politician: full } } })
    )
    expect(set.ok).toBe(true)
    const clear = parseClientMessage(
      JSON.stringify({ t: 'profile.update', p: { wardrobe: { politician: null } } })
    )
    expect(clear.ok).toBe(true)
    const junk = parseClientMessage(
      JSON.stringify({ t: 'profile.update', p: { wardrobe: { politician: { body: 99 } } } })
    )
    expect(junk.ok).toBe(false)
  })

  it('loadoutFor reads an actor entry and defaults to null', () => {
    expect(loadoutFor({ politician: full }, 'politician')).toEqual(full)
    expect(loadoutFor({ politician: full }, 'robot')).toBeNull()
    expect(loadoutFor(null, 'politician')).toBeNull()
  })
})

describe('whole-figure skins', () => {
  it('accepts catalog ids per actor and null; rejects cross-actor and unknown ids', () => {
    expect(SkinsSchema.safeParse({ robot: 'gilded-stealth' }).success).toBe(true)
    expect(SkinsSchema.safeParse({ artist: 'holo-graffiti', scientist: null }).success).toBe(true)
    // 'chrome-exo' is a scientist skin, not a robot skin
    expect(SkinsSchema.safeParse({ robot: 'chrome-exo' }).success).toBe(false)
    expect(SkinsSchema.safeParse({ artist: 'nope' }).success).toBe(false)
    expect(SkinsSchema.safeParse({ dragon: 'x' }).success).toBe(false)
  })

  it('a full wardrobe with both layered politician and skins passes the wire', () => {
    const msg = parseClientMessage(
      JSON.stringify({
        t: 'profile.update',
        p: {
          wardrobe: { politician: full, skins: { robot: 'industrial', artist: 'obsidian-suit' } }
        }
      })
    )
    expect(msg.ok).toBe(true)
  })

  it('skinFor reads the chosen id and defaults to null', () => {
    const w = { skins: { robot: 'industrial', politician: 'revolutionary' } }
    expect(skinFor(w, 'robot')).toBe('industrial')
    expect(skinFor(w, 'scientist')).toBeNull()
    expect(skinFor(null, 'robot')).toBeNull()
    expect(skinFor({ politician: full }, 'politician')).toBeNull()
  })
})

// A personal skin is a gift to one account: it exists everywhere a skin exists
// (art, wire schema, in-game rendering) and nowhere a purchase does.
describe('personal (exclusive) skins', () => {
  it('are part of the catalog, so the art pipeline and the wire schema carry them', () => {
    for (const [actor, ids] of Object.entries(EXCLUSIVE_SKINS))
      for (const id of ids) {
        expect(SKIN_CATALOG[actor], `${actor} in the catalog`).toContain(id)
        expect(isExclusiveSkin(actor, id)).toBe(true)
        expect(SkinsSchema.safeParse({ [actor]: id }).success, `${actor}/${id} on the wire`).toBe(
          true
        )
      }
  })

  it('are never sold — no Shop tile, so no price and no way to buy one', () => {
    const sold = new Set(SHOP_CATALOG.map((i) => i.id))
    for (const [actor, ids] of Object.entries(EXCLUSIVE_SKINS))
      for (const id of ids) expect(sold.has(skinItemId(actor, id)), `${actor}/${id}`).toBe(false)
    // And the ordinary ones still are, or the Shop just lost its stock.
    expect(sold.has(skinItemId('robot', 'industrial'))).toBe(true)
  })

  it('leaves every other skin sellable', () => {
    for (const [actor, ids] of Object.entries(SKIN_CATALOG))
      for (const id of ids)
        if (!isExclusiveSkin(actor, id))
          expect(
            SHOP_CATALOG.some((i) => i.id === skinItemId(actor, id)),
            `${actor}/${id}`
          ).toBe(true)
  })
})
