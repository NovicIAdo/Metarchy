// Theme layer: every art asset is addressed through a semantic key, never a raw
// path. This is the author's post-MVP hook — player-selectable themes, later
// NFT-bound themes after the blockchain stage — kept cheap by never letting a
// component know where a texture lives.

import type { ActorLoadout, Wardrobe } from '@metarchy/protocol'
import { argSkinFor } from '@metarchy/protocol'
import { argSkinAssets } from './theme.argskins.gen.js'
import { avatarAssets } from './theme.avatars.gen.js'
import { cyberpunkAssets } from './theme.cyberpunk.gen.js'
import { skinAssets } from './theme.skins.gen.js'

export interface ThemeManifest {
  id: string
  name: string
  assets: Record<string, string>
}

export const cyberpunkTheme: ThemeManifest = {
  id: 'cyberpunk',
  name: 'Space Cyberpunk — Futurism',
  // Whole-figure skins, argument-coin sets and extra avatars are cyberpunk-theme
  // assets too.
  assets: { ...cyberpunkAssets, ...skinAssets, ...avatarAssets, ...argSkinAssets }
}

/**
 * Every installed art style, in display order. Futurism ships first (author
 * decision); later styles append here once their asset packs are generated
 * by scripts/build-theme.ts against a new source set.
 */
export const themes: ThemeManifest[] = [cyberpunkTheme]

let activeTheme: ThemeManifest = cyberpunkTheme

export function themeAsset(key: string): string {
  // Partial future themes fall back to the default style per asset, so a new
  // pack can ship location art first and inherit the rest until it's complete.
  const url = activeTheme.assets[key] ?? cyberpunkTheme.assets[key]
  if (!url) throw new Error(`theme '${activeTheme.id}' has no asset '${key}'`)
  return url
}

export function setTheme(theme: ThemeManifest): void {
  activeTheme = theme
}

/** Resolve a persisted theme id; unknown/absent ids mean the default style. */
export function themeById(id: string | undefined): ThemeManifest {
  return themes.find((t) => t.id === id) ?? cyberpunkTheme
}

/**
 * The coin art for one argument, honouring the owner's bought set. Always pass
 * the wardrobe of whoever *played* the coin — rendering my set on a rival's
 * argument would misreport who is wearing what.
 */
export function argumentAssetKey(argument: string, wardrobe?: Wardrobe | null): string {
  const set = argSkinFor(wardrobe)
  return set ? `argSkin.${set}.${argument}` : `argument.${argument}`
}

/**
 * Bottom-to-top layer keys for a dressed politician (body → costume → hair →
 * accessories). Key shape mirrors build-theme.ts wardrobeSpecs; a test keeps
 * the protocol catalog and the generated manifest in lockstep.
 */
export function politicianLayerKeys(loadout: ActorLoadout): string[] {
  const keys = [
    `wardrobe.politician.body.${loadout.body}`,
    `wardrobe.politician.costume.${loadout.costume[0]}.${loadout.costume[1]}`
  ]
  if (loadout.hair) keys.push(`wardrobe.politician.hair.${loadout.hair[0]}.${loadout.hair[1]}`)
  for (const [g, v] of loadout.accessories ?? [])
    keys.push(`wardrobe.politician.accessory.${g}.${v}`)
  return keys
}
