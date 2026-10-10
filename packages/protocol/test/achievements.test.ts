// The achievement catalog is a persisted contract: every id is a primary-key
// value in the `achievements` table from the moment one player earns it, so an
// id may only be ADDED — never renamed, never renumbered. These tests are the
// guard rail on that, plus the invariants the client renders against.

import { describe, expect, it } from 'vitest'
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  ACHIEVEMENT_GROUPS,
  EVERY_CATEGORY_WIN_ID,
  PLAY_CATEGORIES,
  PLAY_TIERS,
  countAchievements,
  emptyPlayCounts,
  playCategoryOf
} from '../src/achievements.js'

describe('achievement catalog', () => {
  it('has unique ids and a known group for each', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ACHIEVEMENTS_BY_ID.size).toBe(ids.length)
    for (const a of ACHIEVEMENTS) expect(ACHIEVEMENT_GROUPS).toContain(a.group)
  })

  it('carries every counter family the author listed, at all three tiers', () => {
    // Six families × 10/100/1000. The author's list writes "приватных игр 1 на 1"
    // twice; that is one family, not two, so this is 18 counters and no duplicate.
    for (const category of PLAY_CATEGORIES)
      for (const threshold of PLAY_TIERS)
        expect(ACHIEVEMENTS_BY_ID.has(`play.${category}.${threshold}`)).toBe(true)
    expect(ACHIEVEMENTS.filter((a) => a.threshold !== undefined)).toHaveLength(18)
  })

  it('names an i18n key for every badge, and a threshold only for counters', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.nameKey.startsWith('achv.')).toBe(true)
      expect(a.hintKey.startsWith('achv.')).toBe(true)
      // Both or neither: a counter without a category could not be evaluated.
      expect(a.threshold === undefined).toBe(a.category === undefined)
    }
  })

  it('spells out the ids the server writes, so a rename cannot pass unnoticed', () => {
    // Hard-coded on purpose. If this list has to change, rows in the live table
    // are about to be orphaned — add an id instead.
    expect(
      ACHIEVEMENTS.filter((a) => a.threshold === undefined)
        .map((a) => a.id)
        .sort()
    ).toEqual([
      'feat.betaTester',
      'feat.turn.allKinds',
      'feat.turn.block3',
      'feat.turn.exchange3',
      'feat.turn.relocation3',
      'feat.tutorial.complete',
      'feat.win.first',
      'feat.win.landslide',
      'feat.win.noCards',
      'feat.win.tiebreak',
      'feat.win.turn5',
      'feat.win.turn6',
      'feat.win.turn7',
      'feat.win.turn8',
      'feat.win.vsHardBot',
      EVERY_CATEGORY_WIN_ID
    ])
  })
})

describe('playCategoryOf', () => {
  it('splits private from ranked per mode, and bots before privacy', () => {
    expect(playCategoryOf('1v1', true)).toBe('private.1v1')
    expect(playCategoryOf('ffa3', true)).toBe('private.ffa3')
    expect(playCategoryOf('2v2', true)).toBe('private.2v2')
    expect(playCategoryOf('1v1', false)).toBe('ranked.1v1')
    expect(playCategoryOf('ffa3', false)).toBe('ranked.ffa3')
    // A machine is a machine whatever the invite flag says.
    expect(playCategoryOf('vs_bots', false)).toBe('bots')
    expect(playCategoryOf('vs_bots', true)).toBe('bots')
  })

  it('counts a tutorial and a public 2v2 nowhere', () => {
    // The tutorial is a lesson (its own badge). Public 2v2 is unrated and cannot
    // be matchmade today, so no game reaches it — and it must not inflate the
    // private 2v2 count if it ever ships.
    expect(playCategoryOf('tutorial', false)).toBeNull()
    expect(playCategoryOf('2v2', false)).toBeNull()
  })

  it('every non-null category is one the catalog has badges for', () => {
    const counts = emptyPlayCounts()
    for (const category of PLAY_CATEGORIES) expect(counts[category]).toEqual({ played: 0, wins: 0 })
    expect(countAchievements(counts)).toEqual([])
  })
})
