// Board world geometry. Coordinates come from the prototype's MapContainer
// (Meta_scratch lib/modules/core/constants.ts): the city collage is built from
// 718×598 layers that only make sense at these exact offsets, so they are data,
// not style. All numbers are world units; the camera fits WORLD to the screen.

import type { ActorType, LocationId, SeatId } from '@metarchy/engine'

export interface LayerRect {
  x: number
  y: number
  width: number
  height: number
}

export const LAYER_SIZE = { width: 718, height: 598 }

export const CITY_LAYER: LayerRect = { x: 581, y: 178, ...LAYER_SIZE }

export const LOCATION_LAYERS: Record<LocationId, LayerRect> = {
  square: { x: 156, y: 215, ...LAYER_SIZE },
  theatre: { x: 355, y: 491, ...LAYER_SIZE },
  university: { x: 384, y: -17, ...LAYER_SIZE },
  factory: { x: 823, y: 464, ...LAYER_SIZE },
  power_plant: { x: 780, y: 6, ...LAYER_SIZE },
  dump: { x: 1015, y: 229, ...LAYER_SIZE }
}

/** Draw order: later entries render on top (prototype DOM order). */
export const LOCATION_DRAW_ORDER: readonly LocationId[] = [
  'square',
  'theatre',
  'university',
  'factory',
  'power_plant',
  'dump'
]

export const LOCATION_LABELS: Record<LocationId, string> = {
  square: 'The Square',
  theatre: 'The Theatre',
  university: 'University',
  factory: 'Factory',
  power_plant: 'Power Plant',
  dump: 'The Dump'
}

/** Bounding box of all layers plus margin. */
export const WORLD = { x: 116, y: -57, width: 1657, height: 1186 }

/** Pointer target around each building's core; radii chosen to never overlap. */
export const LOCATION_HIT_RADIUS = 150

export function locationCenter(id: LocationId): { x: number; y: number } {
  const layer = LOCATION_LAYERS[id]
  return { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 }
}

/** Neon per-seat accents (matches the CSS variable palette). */
export const SEAT_COLORS: Record<SeatId, number> = {
  0: 0x38b6ff,
  1: 0xff4fd8,
  2: 0xffd84d,
  3: 0x7cff4f
}

export const STAGED_COLOR = 0xd4a94b

/**
 * Token rings paint the OWNER's seat color around the portrait (author call
 * 2026-07-23 — "актор в красном колечке, актор в синем колечке"); the old
 * seat-colored pin is gone. Allegiance keeps a hint via the backing tint.
 */
export const TOKEN_BACKING = 0x0b0a12
export const TOKEN_BACKING_ENEMY = 0x2a1113
/** Argument/bet badges are bronze coins in the reference, whoever owns them. */
export const BADGE_BRONZE = 0xae8d67

export const ACTOR_ORDER: readonly ActorType[] = ['politician', 'scientist', 'artist', 'robot']
