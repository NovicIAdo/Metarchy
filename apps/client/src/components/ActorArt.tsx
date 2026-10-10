// Full-height actor art that honors the owner's wardrobe. Precedence: a chosen
// whole-figure skin wins, then the layered politician loadout, then canonical
// art. A skin and the layered look each resolve to a single flow <img>, so any
// `img` height rule of the surrounding surface keeps working unchanged.

import type { Wardrobe } from '@metarchy/protocol'
import { loadoutFor, skinFor } from '@metarchy/protocol'
import { politicianLayerKeys, themeAsset } from '../theme.js'

export function ActorArt({ type, wardrobe }: { type: string; wardrobe?: Wardrobe | null }) {
  const skin = skinFor(wardrobe, type)
  if (skin) return <img src={themeAsset(`skin.${type}.${skin}`)} alt="" draggable={false} />

  const loadout = loadoutFor(wardrobe, type)
  if (!loadout) return <img src={themeAsset(`actor.${type}`)} alt="" draggable={false} />
  return (
    <span className="layered-actor">
      {politicianLayerKeys(loadout).map((key, i) => (
        <img
          key={key}
          className={i === 0 ? undefined : 'layer-over'}
          src={themeAsset(key)}
          alt=""
          draggable={false}
        />
      ))}
    </span>
  )
}
