// Achievements (author's list, 2026-07-27). The catalog is protocol, not server
// state: the client renders EVERY badge — earned or not — because an unearned
// achievement is a goal, so both sides need the same list, the same thresholds
// and the same i18n keys.
//
// IDS ARE FOREVER. Each id is a primary-key value in the `achievements` table
// from the moment one player earns it. Renaming or renumbering an id silently
// orphans every row that already carries it, so ids may only be ADDED. The
// human-readable text lives entirely behind the i18n keys — rename the string,
// never the id.
//
// Two families, evaluated in two different places (see apps/server/src/achievements.ts):
//  - `play.*`  COUNTERS over the player's whole archive, from an aggregate query.
//  - `feat.*`  FEATS decided once, from the final engine state + that seat's verdict.
//
// No GATO is paid for any of these yet — see the note above grantAchievements in
// apps/server/src/achievements.ts.

import type { Mode } from '@metarchy/engine'
import { z } from 'zod'

// --- Play categories -------------------------------------------------------------------
//
// The author asked for six separate families of "play N games":
//
//   Сыграть 10 (100, 1000) игр против ботов
//   Сыграть 10 (100, 1000) приватных игр 1 на 1
//   Сыграть 10 (100, 1000) приватных игр 3 Игрока
//   Сыграть 10 (100, 1000) приватных игр 2 на 2
//   Сыграть 10 (100, 1000) рэйтинговых игр 1 на 1
//   Сыграть 10 (100, 1000) рэйтинговых игр 3 Игрока
//
// (their list writes "приватных игр 1 на 1" twice — a slip, so it is one family).
//
// This is FINER than `recordCategoryOf` in apps/server/src/store.ts, which folds
// every private game into a single `private` bucket for the profile's win-rate
// table. Do not reuse that mapping here: it cannot tell private 1v1 from private
// 2v2, which is exactly the distinction the author is counting.

/** Display order = the author's order. */
export const PLAY_CATEGORIES = [
  'bots',
  'private.1v1',
  'private.ffa3',
  'private.2v2',
  'ranked.1v1',
  'ranked.ffa3'
] as const
export type PlayCategory = (typeof PLAY_CATEGORIES)[number]

/** The author's three tiers, ascending — the order the UI shows them in. */
export const PLAY_TIERS = [10, 100, 1000] as const

/**
 * Which counter a finished game feeds (null = it feeds none). The order of the
 * tests IS the contract, and SqlStore's CASE mirrors it — change one, change both:
 *  1. `tutorial` counts nowhere. It is a lesson, not a match (same reason as
 *     recordCategoryOf), and its own badge is feat.tutorial.complete.
 *  2. vs_bots → `bots` BEFORE the privacy test: you played a machine, and that
 *     stays true whatever the invite flag says.
 *  3. private → `private.<mode>`: the invite flag decides, not the mode.
 *  4. what is left is public matchmaking: 1v1/ffa3 are the rated modes.
 * A bot filling a public ranked seat does NOT move the game to `bots` — the
 * player queued for ranked, and that is how the record table and the reward
 * ladder count it too.
 *
 * Public 2v2 is deliberately null: it is unrated and cannot be matchmade today
 * (2v2 is invite-only), so no game reaches this branch. If public 2v2 ever
 * ships it counts toward no badge until the author asks for one, rather than
 * being quietly folded into the private 2v2 count and inflating it.
 */
export function playCategoryOf(mode: Mode, isPrivate: boolean): PlayCategory | null {
  if (mode === 'tutorial') return null
  if (mode === 'vs_bots') return 'bots'
  if (isPrivate) return `private.${mode}` as PlayCategory
  return mode === '2v2' ? null : (`ranked.${mode}` as PlayCategory)
}

export interface PlayCount {
  /** Games with a verdict for this seat — the same "played" the record table counts. */
  played: number
  wins: number
}

export type PlayCounts = Record<PlayCategory, PlayCount>

export function emptyPlayCounts(): PlayCounts {
  return Object.fromEntries(PLAY_CATEGORIES.map((c) => [c, { played: 0, wins: 0 }])) as PlayCounts
}

// --- Catalog -----------------------------------------------------------------------------

/** Display grouping only — the UI renders one section per group, in this order. */
export const ACHIEVEMENT_GROUPS = ['learning', 'play', 'victory', 'tactics'] as const
export type AchievementGroup = (typeof ACHIEVEMENT_GROUPS)[number]

export interface Achievement {
  /** Persisted forever. See the file header. */
  id: string
  group: AchievementGroup
  /** i18n key of the badge's name. */
  nameKey: string
  /** i18n key of "how you earn it". Counter hints substitute {n} and {cat}. */
  hintKey: string
  /** Counters only: which archive category, and how many games it takes. */
  category?: PlayCategory
  threshold?: number
}

const counters: Achievement[] = PLAY_CATEGORIES.flatMap((category) =>
  PLAY_TIERS.map((threshold): Achievement => ({
    id: `play.${category}.${threshold}`,
    group: 'play',
    // The name is composed by the client as "<category> · <tier>" so six
    // categories × three tiers cost nine strings instead of eighteen.
    nameKey: `achv.cat.${category}`,
    hintKey: 'achv.play.hint',
    category,
    threshold
  }))
)

const feats: Achievement[] = [
  // --- Закрытая бета ------------------------------------------------------------
  // Granted once, by hand, to the closed-beta accounts (author's email list) — it
  // is never earned in play, so everyone else sees it forever locked, by design.
  {
    id: 'feat.betaTester',
    group: 'learning',
    nameKey: 'achv.feat.betaTester',
    hintKey: 'achv.feat.betaTester.hint'
  },

  // --- Пройти Туториал ---------------------------------------------------------
  {
    id: 'feat.tutorial.complete',
    group: 'learning',
    nameKey: 'achv.feat.tutorial.complete',
    hintKey: 'achv.feat.tutorial.complete.hint'
  },

  // --- Победить за 5 / 6 / 7 / 8 ходов -----------------------------------------
  // MAX_TURNS is 5, so 6/7/8 are only reachable through tie-breaker turns: a
  // draw on victory points at the end adds another turn (state.isTieBreakerTurn),
  // and the author wants the long grind recognised.
  {
    id: 'feat.win.turn5',
    group: 'victory',
    nameKey: 'achv.feat.win.turn5',
    hintKey: 'achv.feat.win.turn5.hint'
  },
  {
    id: 'feat.win.turn6',
    group: 'victory',
    nameKey: 'achv.feat.win.turn6',
    hintKey: 'achv.feat.win.turn6.hint'
  },
  {
    id: 'feat.win.turn7',
    group: 'victory',
    nameKey: 'achv.feat.win.turn7',
    hintKey: 'achv.feat.win.turn7.hint'
  },
  {
    id: 'feat.win.turn8',
    group: 'victory',
    nameKey: 'achv.feat.win.turn8',
    hintKey: 'achv.feat.win.turn8.hint'
  },

  // --- 3 of a kind of Action Card in one turn ----------------------------------
  // "Сыграть 3 Релокации за ход" / "Сыграть 3 Смены ценности за ход" /
  // "Отключить 3 локации за ход" (the block cards are the ones that disable a
  // Location — BLOCK_CARD_LOCATION).
  {
    id: 'feat.turn.relocation3',
    group: 'tactics',
    nameKey: 'achv.feat.turn.relocation3',
    hintKey: 'achv.feat.turn.relocation3.hint'
  },
  {
    id: 'feat.turn.exchange3',
    group: 'tactics',
    nameKey: 'achv.feat.turn.exchange3',
    hintKey: 'achv.feat.turn.exchange3.hint'
  },
  {
    id: 'feat.turn.block3',
    group: 'tactics',
    nameKey: 'achv.feat.turn.block3',
    hintKey: 'achv.feat.turn.block3.hint'
  },

  // --- Proposed additions ("Подумай ещё какие могут быть ачивки") ---------------
  // All four are decidable from the same final state as the author's own feats,
  // and all four are about how a game went rather than about how many were
  // played. See the report in apps/server/src/achievements.ts for what had to be
  // rejected for want of data.
  {
    id: 'feat.win.first',
    group: 'victory',
    nameKey: 'achv.feat.win.first',
    hintKey: 'achv.feat.win.first.hint'
  },
  {
    id: 'feat.win.tiebreak',
    group: 'victory',
    nameKey: 'achv.feat.win.tiebreak',
    hintKey: 'achv.feat.win.tiebreak.hint'
  },
  {
    id: 'feat.win.landslide',
    group: 'victory',
    nameKey: 'achv.feat.win.landslide',
    hintKey: 'achv.feat.win.landslide.hint'
  },
  {
    id: 'feat.win.noCards',
    group: 'victory',
    nameKey: 'achv.feat.win.noCards',
    hintKey: 'achv.feat.win.noCards.hint'
  },
  {
    id: 'feat.win.vsHardBot',
    group: 'victory',
    nameKey: 'achv.feat.win.vsHardBot',
    hintKey: 'achv.feat.win.vsHardBot.hint'
  },
  {
    id: 'feat.turn.allKinds',
    group: 'tactics',
    nameKey: 'achv.feat.turn.allKinds',
    hintKey: 'achv.feat.turn.allKinds.hint'
  }
]

/**
 * A win in every one of the author's six categories — the one proposed addition
 * that is a counter rather than a feat, because it is a fact about the archive
 * and not about a single game. It lives in the `play` group next to the families
 * it sums up.
 */
export const EVERY_CATEGORY_WIN_ID = 'play.everyCategory.win'

export const ACHIEVEMENTS: readonly Achievement[] = [
  ...feats,
  ...counters,
  {
    id: EVERY_CATEGORY_WIN_ID,
    group: 'play',
    nameKey: 'achv.play.everyCategory',
    hintKey: 'achv.play.everyCategory.hint'
  }
]

export const ACHIEVEMENTS_BY_ID: ReadonlyMap<string, Achievement> = new Map(
  ACHIEVEMENTS.map((a) => [a.id, a])
)

export const ACHIEVEMENT_IDS: readonly string[] = ACHIEVEMENTS.map((a) => a.id)

/**
 * Every counter id the archive already satisfies. Pure, and re-derived from
 * scratch on every finish: an id that is already in the table costs one ignored
 * INSERT (the primary key absorbs it), which is far cheaper than trying to keep
 * a "next threshold" pointer honest across backfills and reset betas.
 */
export function countAchievements(counts: PlayCounts): string[] {
  const earned: string[] = []
  for (const category of PLAY_CATEGORIES) {
    const played = counts[category].played
    for (const threshold of PLAY_TIERS) {
      if (played >= threshold) earned.push(`play.${category}.${threshold}`)
    }
  }
  if (PLAY_CATEGORIES.every((c) => counts[c].wins > 0)) earned.push(EVERY_CATEGORY_WIN_ID)
  return earned
}

// --- Wire ---------------------------------------------------------------------------------

export const EarnedAchievementSchema = z.object({
  id: z.string(),
  /** ISO timestamp of the first time it was granted (the row never moves). */
  earnedAt: z.string()
})
export type EarnedAchievement = z.infer<typeof EarnedAchievementSchema>

/** Exhaustive by construction: z.record over an enum key demands every key. */
export const PlayCountsSchema = z.record(
  z.enum(PLAY_CATEGORIES),
  z.object({
    played: z.number().int().min(0),
    wins: z.number().int().min(0)
  })
)

/**
 * What a profile screen needs to draw the whole board: which badges are earned,
 * and how far along the unearned counters are ("37 / 100" on a locked tier).
 * The catalog itself is static and already on the client.
 */
export const AchievementStateSchema = z.object({
  earned: z.array(EarnedAchievementSchema),
  counts: PlayCountsSchema
})
export type AchievementState = z.infer<typeof AchievementStateSchema>
