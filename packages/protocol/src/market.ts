// Player↔player market: cosmetics changing hands for GATO, with public
// comments on a lot so the price can be haggled in the open ("drop it and I'll
// take it"). Design and the numbers behind it: plan/Market-Plan.md.
//
// Author's tokenomics (2026-08-01): **GATO is never burned.** A player earns it,
// and can sell it or stake it — staked GATO carries voting power over rule
// changes and a proportional share of whatever revenue enters the game (ads,
// sponsors, the GATO/USD pool). The market fee therefore has a destination
// rather than a furnace: it accrues to that revenue pool. It is 0 during the
// test, because GATO has no price yet and the point right now is to watch the
// market work, not to tune it.

// Imports nothing but zod on purpose: messages.ts pulls the union entries from
// here, and shop.ts pulls AVATAR_IDS from messages.ts, so a `market → shop` edge
// would close a cycle and leave the schemas half-initialised at import time.
// `isTradable` therefore lives in shop.ts, next to the catalog it reads.
import { z } from 'zod'

/**
 * Seller's cut, in basis points, taken off the sale price. **Not burned** — see
 * the header: it belongs to the stakers' revenue pool. Zero for the test; the
 * trade ledger records the fee on every sale, so switching this on is one
 * constant and no migration.
 */
export const MARKET_FEE_BPS = 0
/** A lot nobody buys expires and gives the item back. */
export const MARKET_LISTING_TTL_DAYS = 7
/** How many lots one account may keep up at once. */
export const MARKET_MAX_ACTIVE = 10
/** Lots per page of the browse list. */
export const MARKET_PAGE_SIZE = 20
/** One comment, one bid. Long enough to haggle in, short enough not to be a post. */
export const MARKET_COMMENT_MAX = 280
/** Ceiling on a lot price — a typo, not a strategy, is what puts 12 digits in. */
export const MARKET_PRICE_MAX = 1_000_000

export const feeOf = (price: number): number => Math.floor((price * MARKET_FEE_BPS) / 10_000)

/** The author's filter chips, in display order. */
export const MARKET_CATEGORIES = ['actorSkin', 'argumentSkin', 'actorItem', 'avatar'] as const
export const MarketCategorySchema = z.enum(MARKET_CATEGORIES)
export type MarketCategory = z.infer<typeof MarketCategorySchema>

/**
 * The item-id prefix each chip filters on — shop.ts already mints ids in these
 * shapes (`skin.<actor>.<id>` / `argSkin.<id>` / `avatar.<id>` / `item.<slot>.<id>`).
 * Order matters for the lookup below: `skin.` is a prefix of nothing else, but
 * `argSkin.` must be tested before it would ever be confused with one.
 */
export const MARKET_CATEGORY_PREFIX: Record<MarketCategory, string> = {
  actorSkin: 'skin.',
  argumentSkin: 'argSkin.',
  actorItem: 'item.',
  avatar: 'avatar.'
}

/** Which chip a good sits under. Unknown shapes return null and are not tradable. */
export function categoryOfItem(itemId: string): MarketCategory | null {
  for (const category of MARKET_CATEGORIES)
    if (itemId.startsWith(MARKET_CATEGORY_PREFIX[category])) return category
  return null
}

/** Mirrors the private `seq` in messages.ts — direct replies echo it. */
const seq = z.number().int().nonnegative().optional()

/** Who is selling / who commented. Same shape the chat uses for an author. */
export const MarketPartySchema = z.object({
  userId: z.uuid(),
  nickname: z.string(),
  /** AvatarId or null — the client renders an <img> only when it is set. */
  avatar: z.string().nullable()
})
export type MarketParty = z.infer<typeof MarketPartySchema>

/** One lot on the shelf. `mine` saves the client from comparing ids itself. */
export const MarketListingSchema = z.object({
  id: z.uuid(),
  itemId: z.string(),
  category: MarketCategorySchema,
  price: z.number().int().nonnegative(),
  seller: MarketPartySchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  /** Comment count for the card; the thread itself is fetched on open. */
  comments: z.number().int().nonnegative(),
  mine: z.boolean(),
  /** True when the viewer already owns one — a second copy is worthless to them. */
  owned: z.boolean()
})
export type MarketListing = z.infer<typeof MarketListingSchema>

export const MarketCommentSchema = z.object({
  id: z.uuid(),
  author: MarketPartySchema,
  body: z.string(),
  createdAt: z.string()
})
export type MarketComment = z.infer<typeof MarketCommentSchema>

// --- client → server -------------------------------------------------------

/** The shelf. `mine` swaps it for the caller's own lots. */
export const MarketBrowseMessageSchema = z.strictObject({
  t: z.literal('market.browse'),
  seq,
  p: z
    .strictObject({
      category: MarketCategorySchema.nullable().optional(),
      mine: z.boolean().optional(),
      offset: z.number().int().nonnegative().optional()
    })
    .optional()
})

/** Put an owned item up. The item is locked for the life of the lot. */
export const MarketListMessageSchema = z.strictObject({
  t: z.literal('market.list'),
  seq,
  p: z.strictObject({
    itemId: z.string().min(1).max(80),
    price: z.number().int().min(1).max(MARKET_PRICE_MAX)
  })
})

/** Pull your own lot back; the item unlocks. */
export const MarketCancelMessageSchema = z.strictObject({
  t: z.literal('market.cancel'),
  seq,
  p: z.strictObject({ listingId: z.uuid() })
})

export const MarketBuyMessageSchema = z.strictObject({
  t: z.literal('market.buy'),
  seq,
  p: z.strictObject({ listingId: z.uuid() })
})

export const MarketCommentPostMessageSchema = z.strictObject({
  t: z.literal('market.comment'),
  seq,
  p: z.strictObject({
    listingId: z.uuid(),
    body: z.string().min(1).max(MARKET_COMMENT_MAX)
  })
})

export const MarketCommentsGetMessageSchema = z.strictObject({
  t: z.literal('market.comments'),
  seq,
  p: z.strictObject({ listingId: z.uuid() })
})

// --- server → client -------------------------------------------------------

export const MarketListingsMessageSchema = z.object({
  t: z.literal('market.listings'),
  seq: z.number().int().nonnegative().optional(),
  p: z.object({
    rows: z.array(MarketListingSchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative()
  })
})

/** After list/cancel: the new state of that one lot, or null once it is gone. */
export const MarketListingMessageSchema = z.object({
  t: z.literal('market.listing'),
  seq: z.number().int().nonnegative().optional(),
  p: z.object({
    listingId: z.uuid(),
    listing: MarketListingSchema.nullable()
  })
})

/** A sale went through: the lot is closed and the buyer's wallet moved. */
export const MarketBoughtMessageSchema = z.object({
  t: z.literal('market.bought'),
  seq: z.number().int().nonnegative().optional(),
  p: z.object({
    listingId: z.uuid(),
    itemId: z.string(),
    price: z.number().int().nonnegative(),
    balance: z.number().int().nonnegative(),
    owned: z.array(z.string())
  })
})

export const MarketCommentsMessageSchema = z.object({
  t: z.literal('market.comments'),
  seq: z.number().int().nonnegative().optional(),
  p: z.object({ listingId: z.uuid(), rows: z.array(MarketCommentSchema) })
})

/**
 * A cosmetic fell out of a finished ranked game. Sent to the seat it landed on,
 * alongside `gato.reward`. Drops are what give the market something the Shop
 * cannot sell you on demand — see plan/Market-Plan.md §"у маркета нечем торговать".
 */
export const LootDropMessageSchema = z.object({
  t: z.literal('loot.drop'),
  seq: z.number().int().nonnegative().optional(),
  p: z.object({ gameId: z.uuid(), itemId: z.string() })
})
