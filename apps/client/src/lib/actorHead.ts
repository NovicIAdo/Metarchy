// Wardrobe-aware head icons (plan/Wardrobe-Layers-Backlog.md §1): until now every
// head-sized surface — board tokens, the dock, pickers, summaries — drew the
// canonical `actor.<type>.head` portrait, so a bought skin or a dressed
// politician was invisible at the table. headLook() resolves what a head icon
// should show for a given wardrobe, with the same precedence as ActorArt:
// whole-figure skin wins, then the layered loadout, then the canonical portrait.
// Skins and layers render as a measured crop of the full art (theme.headcrops.gen),
// canonical heads stay the author's hand-drawn portraits.

import type { SeatId } from '@metarchy/engine'
import type { Wardrobe } from '@metarchy/protocol'
import { loadoutFor, skinFor } from '@metarchy/protocol'
import { politicianLayerKeys } from '../theme.js'
import { headCrops, type HeadCrop } from '../theme.headcrops.gen.js'
import { useGameStore } from '../stores/game.js'
import { useSessionStore } from '../stores/session.js'

export type HeadLook =
  | { kind: 'canonical'; key: string }
  | { kind: 'skin'; key: string; crop: HeadCrop }
  | { kind: 'layers'; keys: string[]; crop: HeadCrop }

/** What a head icon for `actorType` should show under `wardrobe`. */
export function headLook(actorType: string, wardrobe: Wardrobe | null | undefined): HeadLook {
  const skin = skinFor(wardrobe, actorType)
  if (skin) {
    const key = `skin.${actorType}.${skin}`
    const crop = headCrops[key]
    if (crop) return { kind: 'skin', key, crop }
  }
  const loadout = loadoutFor(wardrobe, actorType)
  if (loadout) {
    const crop = headCrops[`wardrobe.${actorType}`]
    if (crop) return { kind: 'layers', keys: politicianLayerKeys(loadout), crop }
  }
  return { kind: 'canonical', key: `actor.${actorType}.head` }
}

/** Stable identity for a look — texture caches key on it. */
export function headLookKey(look: HeadLook): string {
  return look.kind === 'layers' ? look.keys.join('|') : look.key
}

/**
 * The wardrobe a head icon should wear for `seat`, with the same ownership rule
 * as useArgCoins: seat omitted/null means "mine" (dock, pickers, my staged
 * token); an unknown seat falls back to canonical art rather than borrowing the
 * viewer's wardrobe.
 */
export function useActorWardrobe(seat?: SeatId | null): Wardrobe | null {
  const players = useGameStore((s) => s.players)
  const mySeat = useGameStore((s) => s.view?.seat ?? null)
  const myWardrobe = useSessionStore((s) => s.profile?.wardrobe ?? null)
  const owner = seat ?? mySeat
  if (owner === null) return myWardrobe
  if (owner === mySeat) return players.find((p) => p.seat === owner)?.wardrobe ?? myWardrobe
  return players.find((p) => p.seat === owner)?.wardrobe ?? null
}
