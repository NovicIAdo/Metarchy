// Argument coins are a per-player cosmetic: the set a player bought re-skins
// *their* coins everywhere they surface (board badges, arena reveals, ally
// panel), while everyone else keeps whatever they own. Every render site goes
// through here so that ownership rule stays in one place — a component that
// reached for `argument.<type>` directly would silently paint the viewer's set
// on someone else's argument.

import type { ArgumentType, SeatId } from '@metarchy/engine'
import type { Wardrobe } from '@metarchy/protocol'
import { useCallback } from 'react'
import { useGameStore } from '../stores/game.js'
import { useSessionStore } from '../stores/session.js'
import { argumentAssetKey, themeAsset } from '../theme.js'

/**
 * `coin(argument, seat)` → art URL. `seat` omitted/null means "mine" (pickers,
 * my own staged token); an unknown seat falls back to the free coins rather
 * than borrowing the viewer's set.
 */
export function useArgCoins(): (argument: ArgumentType | string, seat?: SeatId | null) => string {
  const players = useGameStore((s) => s.players)
  const mySeat = useGameStore((s) => s.view?.seat ?? null)
  const myWardrobe = useSessionStore((s) => s.profile?.wardrobe ?? null)
  return useCallback(
    (argument, seat) => {
      const owner = seat ?? mySeat
      const seated = owner === null ? undefined : players.find((p) => p.seat === owner)?.wardrobe
      // My own profile is the fallback only for me: outside a game (shop, profile
      // previews) there is no roster to read, and mid-game the roster may lag a
      // wardrobe change I just made.
      const wardrobe: Wardrobe | null | undefined =
        owner === null || owner === mySeat ? (seated ?? myWardrobe) : (seated ?? null)
      return themeAsset(argumentAssetKey(argument, wardrobe))
    },
    [players, mySeat, myWardrobe]
  )
}
