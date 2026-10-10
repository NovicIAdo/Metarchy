// Display-name i18n keys for whole-figure skins — shared by the profile
// gallery and the shop shelves. Wire ids live in protocol SKIN_CATALOG.

/** Argument-coin set names; `default` is the free set every player owns. */
export const ARG_SET_NAME_KEYS: Record<string, string> = {
  default: 'shop.argSet.default',
  silver: 'shop.argSet.silver',
  bronze: 'shop.argSet.bronze',
  matrix: 'shop.argSet.matrix'
}

export const SKIN_NAME_KEYS: Record<string, string> = {
  'ceremonial-white': 'profile.skin.ceremonial',
  'obsidian-suit': 'profile.skin.obsidian',
  revolutionary: 'profile.skin.revolutionary',
  industrial: 'profile.skin.industrial',
  'gilded-stealth': 'profile.skin.gilded',
  'holo-graffiti': 'profile.skin.holo',
  'chrome-exo': 'profile.skin.chromeExo',
  // Personal skins carry their owner's name — nobody else ever sees the tile.
  ann: 'profile.skin.ann',
  asa: 'profile.skin.asa',
  okeesha: 'profile.skin.okeesha',
  matrix: 'profile.skin.matrix'
}
