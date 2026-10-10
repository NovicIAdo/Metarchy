// One cosmetic id → its picture and its name, for every surface that shows a
// good it did not sell itself: the Inventory, the Market shelf, a lot card.
// The Shop keeps its own layout because it renders a CATALOG entry (it knows the
// kind and the price up front); these read a bare `item_id` off the wire.

import type { ActorType } from '@metarchy/engine'
import type { ArgSkinId } from '@metarchy/protocol'
import { CoinSet } from '../components/CoinSet.js'
import type { TFunction } from '../i18n/index.js'
import type { DomainLabels } from '../i18n/domain.js'
import { ARG_SET_NAME_KEYS, SKIN_NAME_KEYS } from './cosmetics.js'
import { themeAsset } from '../theme.js'

/** The id shapes shop.ts mints. Anything else is drawn as an unknown good. */
type Parsed =
  | { kind: 'avatar'; id: string }
  | { kind: 'skin'; actor: string; skin: string }
  | { kind: 'argSkin'; set: string }
  | { kind: 'unknown' }

export function parseItemId(itemId: string): Parsed {
  const parts = itemId.split('.')
  if (parts[0] === 'avatar' && parts[1]) return { kind: 'avatar', id: parts[1] }
  if (parts[0] === 'argSkin' && parts[1]) return { kind: 'argSkin', set: parts[1] }
  if (parts[0] === 'skin' && parts[1] && parts[2])
    return { kind: 'skin', actor: parts[1], skin: parts[2] }
  return { kind: 'unknown' }
}

/** The picture. Coin sets are four coins, so they get the shared CoinSet strip. */
export function ItemArt({ itemId }: { itemId: string }) {
  const parsed = parseItemId(itemId)
  // The id came off an entitlement the server minted from the catalog, so these
  // narrowings hold by construction; unknown shapes never reach a branch.
  if (parsed.kind === 'argSkin') return <CoinSet set={parsed.set as ArgSkinId} />
  if (parsed.kind === 'avatar')
    return <img src={themeAsset(`avatar.${parsed.id}`)} alt="" draggable={false} />
  if (parsed.kind === 'skin')
    return <img src={themeAsset(`skin.${parsed.actor}.${parsed.skin}`)} alt="" draggable={false} />
  return <span className="item-unknown">?</span>
}

/**
 * The label. A skin is named by its look AND its actor ("Revolutionary ·
 * Robot"), because the same look exists for all four and a shelf of four
 * identical words would be unreadable.
 */
export function itemName(itemId: string, t: TFunction, d: DomainLabels): string {
  const parsed = parseItemId(itemId)
  if (parsed.kind === 'avatar') return t('profile.avatarLabel', { id: parsed.id })
  if (parsed.kind === 'argSkin') {
    const key = ARG_SET_NAME_KEYS[parsed.set]
    return key ? t(key) : parsed.set
  }
  if (parsed.kind === 'skin') {
    const key = SKIN_NAME_KEYS[parsed.skin]
    return `${key ? t(key) : parsed.skin} · ${d.actor(parsed.actor as ActorType)}`
  }
  return itemId
}
