// GATO (GameToken) soft-currency economy: the single source of truth for what
// the shop sells and for how much. The server validates purchases and cosmetic
// equips against this catalog; the client renders it. Prices are balance knobs,
// not rules canon — tune freely.

import { categoryOfItem } from './market.js'
import { AVATAR_IDS, type AvatarId } from './messages.js'
import { ARG_SKIN_IDS, type ArgSkinId, isExclusiveSkin, SKIN_CATALOG } from './wardrobe.js'

/** Granted once when a wallet is first touched — enough for a few goods. */
export const GATO_START_BALANCE = 1000

export const AVATAR_PRICE = 150
export const SKIN_PRICE = 300
/** The matrix set is the premium whole-figure look — priced well above the rest. */
export const MATRIX_SKIN_PRICE = 1000
/** A set re-skins all four coins, so it is priced like a whole-figure skin. */
export const ARG_SKIN_PRICE = 300

/** The three launch faces stay free; everything after them is a shop good. */
export const FREE_AVATAR_IDS: readonly AvatarId[] = AVATAR_IDS.slice(0, 3)

export type ShopItemKind = 'avatar' | 'skin' | 'argSkin'

export interface ShopItem {
  /** Wire id, also the purchases row key: `avatar.<id>` / `skin.<actor>.<id>` / `argSkin.<id>`. */
  id: string
  kind: ShopItemKind
  price: number
  /** kind=avatar: the AvatarId this item unlocks. */
  avatar?: AvatarId
  /** kind=skin: the actor + skin id this item unlocks. */
  actor?: string
  skin?: string
  /** kind=argSkin: the argument-coin set this item unlocks. */
  argSkin?: ArgSkinId
}

export const avatarItemId = (id: AvatarId): string => `avatar.${id}`
export const skinItemId = (actor: string, skin: string): string => `skin.${actor}.${skin}`
export const argSkinItemId = (id: ArgSkinId): string => `argSkin.${id}`

export const SHOP_CATALOG: readonly ShopItem[] = [
  ...AVATAR_IDS.filter((id) => !FREE_AVATAR_IDS.includes(id)).map((id): ShopItem => ({
    id: avatarItemId(id),
    kind: 'avatar',
    price: AVATAR_PRICE,
    avatar: id
  })),
  // Personal skins are gifts, not goods: they never get a tile or a price.
  ...Object.entries(SKIN_CATALOG).flatMap(([actor, ids]) =>
    ids
      .filter((skin) => !isExclusiveSkin(actor, skin))
      .map((skin): ShopItem => ({
        id: skinItemId(actor, skin),
        kind: 'skin',
        // The matrix set is the premium look; every other skin keeps the base price.
        price: skin === 'matrix' ? MATRIX_SKIN_PRICE : SKIN_PRICE,
        actor,
        skin
      }))
  ),
  ...ARG_SKIN_IDS.map((id): ShopItem => ({
    id: argSkinItemId(id),
    kind: 'argSkin',
    price: ARG_SKIN_PRICE,
    argSkin: id
  }))
]

export const SHOP_ITEMS: ReadonlyMap<string, ShopItem> = new Map(SHOP_CATALOG.map((i) => [i.id, i]))

export function isFreeAvatar(id: AvatarId): boolean {
  return FREE_AVATAR_IDS.includes(id)
}

/**
 * What the market may list at all. Being a SHOP_CATALOG good is the whole test,
 * and it excludes exactly the two things the author ruled out without a second
 * list to keep in sync:
 *
 *  - **personal skins** are gifts to one account and never goods, so the catalog
 *    above already filters them out (`isExclusiveSkin`);
 *  - the **free default set** (the three launch faces, canonical actors, classic
 *    coins) is not in the catalog either — everybody owns it, nobody sells it.
 *
 * Lives here rather than in market.ts because market.ts must import nothing from
 * this module: messages.ts reads its union entries, and this module reads
 * messages.ts, so the edge would close a cycle.
 */
export function isTradable(itemId: string): boolean {
  return SHOP_ITEMS.has(itemId) && categoryOfItem(itemId) !== null
}
