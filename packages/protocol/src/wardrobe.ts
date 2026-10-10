// Actor wardrobe: player-owned cosmetic loadouts composited from the author's
// layer packs (body / costume / hair / accessories drawn on one aligned canvas).
// The catalog below is the single source of truth for what exists — the server
// validates loadouts against it and the client derives theme asset keys from it.
// Only the politician has a layer pack so far; new actors append here once the
// author draws theirs.

import { z } from 'zod'

export interface LayerPack {
  /** Base bodies (skin tones), numbered 1..bodies. */
  bodies: number
  /** Style groups × colorways, both 1-based. */
  costumes: { groups: number; variants: number }
  hair: { groups: number; variants: number }
  /** Accessory slots (glasses, mask, …) × variants; at most one per group. */
  accessories: { groups: number; variants: number }
}

export const POLITICIAN_PACK: LayerPack = {
  bodies: 4,
  costumes: { groups: 3, variants: 6 },
  hair: { groups: 7, variants: 7 },
  accessories: { groups: 4, variants: 8 }
}

export const WARDROBE_CATALOG: Partial<Record<string, LayerPack>> = {
  politician: POLITICIAN_PACK
}

/** Actors that can be dressed today (drives UI and validation alike). */
export const WARDROBE_ACTORS = Object.keys(WARDROBE_CATALOG)

const groupVariant = (bounds: { groups: number; variants: number }) =>
  z.tuple([
    z.number().int().min(1).max(bounds.groups),
    z.number().int().min(1).max(bounds.variants)
  ])

function loadoutSchema(pack: LayerPack) {
  return z
    .strictObject({
      body: z.number().int().min(1).max(pack.bodies),
      costume: groupVariant(pack.costumes),
      /** Absent/null = bald is a legitimate look — bodies carry the face. */
      hair: groupVariant(pack.hair).nullable().optional(),
      accessories: z.array(groupVariant(pack.accessories)).max(pack.accessories.groups).optional()
    })
    .refine(
      (l) => new Set((l.accessories ?? []).map(([g]) => g)).size === (l.accessories ?? []).length,
      { message: 'one accessory per slot' }
    )
}

/** politician is the only dressable actor for now; extend the union as packs land. */
export const ActorLoadoutSchema = loadoutSchema(POLITICIAN_PACK)
export type ActorLoadout = z.infer<typeof ActorLoadoutSchema>

/**
 * Whole-figure skins: one finished image per look (author-approved art), keyed
 * per actor. Unlike the politician layer pack these aren't composed — the id
 * picks a single asset. Ids are the wire values; build-skins.mjs emits matching
 * `skin.<actor>.<id>` theme keys and a client test keeps them in lockstep.
 *
 * Sold in the Shop for GATO.
 */
const SOLD_SKINS: Record<string, readonly string[]> = {
  politician: ['ceremonial-white', 'obsidian-suit', 'revolutionary', 'matrix'],
  robot: ['industrial', 'revolutionary', 'gilded-stealth', 'matrix'],
  artist: ['holo-graffiti', 'obsidian-suit', 'revolutionary', 'matrix'],
  scientist: ['chrome-exo', 'obsidian-suit', 'revolutionary', 'matrix']
}

/**
 * Personal skins: a look designed by one beta tester, gifted to that account and
 * to nobody else. Never sold — no price, no Shop tile, no way to buy one — and
 * the fitting room hides the ones you were not given, so an exclusive is not a
 * tease. Everything else treats them as ordinary skins: same art pipeline, same
 * wire schema, same in-game rendering (the whole point is that the table sees it).
 *
 * WHO owns which is a server-side table (apps/server/src/exclusives.ts) keyed by
 * account — the client only ever learns that one of these is in its own `owned`
 * list. Add the id here the moment the art lands; the Shop and the catalog below
 * follow automatically.
 */
export const EXCLUSIVE_SKINS: Record<string, readonly string[]> = {
  // Ann (beta, wave 1) — a set across all four Actors, her own design.
  // asa and okeesha (beta, wave 2) got the same: four Actors, their own design.
  politician: ['ann', 'asa', 'okeesha'],
  scientist: ['ann', 'asa', 'okeesha'],
  artist: ['ann', 'asa', 'okeesha'],
  robot: ['ann', 'asa', 'okeesha']
}

export function isExclusiveSkin(actor: string, skin: string): boolean {
  return (EXCLUSIVE_SKINS[actor] ?? []).includes(skin)
}

/** Every skin that exists, sold or gifted — the art and wire-schema source. */
export const SKIN_CATALOG: Record<string, readonly string[]> = Object.fromEntries(
  [...new Set([...Object.keys(SOLD_SKINS), ...Object.keys(EXCLUSIVE_SKINS)])].map((actor) => [
    actor,
    [...(SOLD_SKINS[actor] ?? []), ...(EXCLUSIVE_SKINS[actor] ?? [])]
  ])
)

/** Actors with at least one whole-figure skin (drives the shop/fitting UI). */
export const SKINNABLE_ACTORS = Object.keys(SKIN_CATALOG)

/**
 * Argument-coin skins: a set re-skins all four coins at once (rock/paper/
 * scissors/dummy) — a half-reskinned hand would read as a different argument,
 * so sets are indivisible. The canonical warm-gold coins are the free default
 * every player owns; these ids are shop goods. build-arg-skins.ts emits matching
 * `argSkin.<set>.<argument>` theme keys and a client test keeps them in lockstep.
 */
export const ARG_SKIN_IDS = ['silver', 'bronze', 'matrix'] as const
export type ArgSkinId = (typeof ARG_SKIN_IDS)[number]

// Per-actor skin-id enum, nullable (null = canonical art). strictObject rejects
// unknown actors; each field rejects ids outside that actor's catalog.
const skinFields = Object.fromEntries(
  Object.entries(SKIN_CATALOG).map(([actor, ids]) => [
    actor,
    z
      .enum(ids as [string, ...string[]])
      .nullable()
      .optional()
  ])
)
export const SkinsSchema = z.strictObject(skinFields)
export type Skins = z.infer<typeof SkinsSchema>

/**
 * A player's cosmetic wardrobe. `politician` is the layered loadout; `skins`
 * maps an actor to a whole-figure skin id; `arguments` re-skins the player's own
 * coins. A skin, when set, wins over the layered look and the canonical art.
 * Sent whole; null clears an entry.
 */
export const WardrobeSchema = z.strictObject({
  politician: ActorLoadoutSchema.nullable().optional(),
  skins: SkinsSchema.optional(),
  arguments: z.enum(ARG_SKIN_IDS).nullable().optional()
})
export type Wardrobe = z.infer<typeof WardrobeSchema>

/** True when the wardrobe dresses `actorType` away from the canonical art. */
export function loadoutFor(
  wardrobe: Wardrobe | null | undefined,
  actorType: string
): ActorLoadout | null {
  if (!wardrobe || actorType !== 'politician') return null
  return wardrobe.politician ?? null
}

/** The whole-figure skin id chosen for this actor, or null for canonical art. */
export function skinFor(wardrobe: Wardrobe | null | undefined, actorType: string): string | null {
  const skins = wardrobe?.skins as Record<string, string | null | undefined> | undefined
  return skins?.[actorType] ?? null
}

/** The argument-coin set this player plays with, or null for the free coins. */
export function argSkinFor(wardrobe: Wardrobe | null | undefined): ArgSkinId | null {
  return wardrobe?.arguments ?? null
}
