// A whole argument-coin set as one thumbnail (2×2 sheet). Sets are bought and
// equipped indivisibly, so the shop tile and the profile gallery both show all
// four coins rather than a single representative one.

import { ARGUMENT_TYPES } from '@metarchy/engine'
import type { ArgSkinId } from '@metarchy/protocol'
import { useDomain } from '../i18n/domain.js'
import { themeAsset } from '../theme.js'

export function CoinSet({ set }: { set: ArgSkinId | null }) {
  const d = useDomain()
  return (
    <span className="coin-set">
      {ARGUMENT_TYPES.map((arg) => (
        <img
          key={arg}
          src={themeAsset(set ? `argSkin.${set}.${arg}` : `argument.${arg}`)}
          alt={d.argument(arg)}
          title={d.argument(arg)}
          draggable={false}
        />
      ))}
    </span>
  )
}
