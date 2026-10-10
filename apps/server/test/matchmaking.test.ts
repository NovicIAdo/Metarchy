import { describe, expect, it } from 'vitest'
import type { MatchmakingConfig, Waiting } from '../src/matchmaking.js'
import {
  botFallbackCandidates,
  DEFAULT_MATCHMAKING,
  findMatch,
  windowFor
} from '../src/matchmaking.js'

const config: MatchmakingConfig = {
  ...DEFAULT_MATCHMAKING,
  baseWindow: 100,
  widenPerStep: 50,
  stepMs: 5_000,
  openWaitMs: 60_000,
  botFallbackMs: 45_000
}

const NOW = 1_000_000
const waiting = (userId: string, rating: number, waitedMs = 0): Waiting => ({
  userId,
  rating,
  joinedAtMs: NOW - waitedMs
})

describe('windowFor', () => {
  it('starts at the base window and widens one step at a time', () => {
    expect(windowFor(0, config)).toBe(100)
    expect(windowFor(4_999, config)).toBe(100)
    expect(windowFor(5_000, config)).toBe(150)
    expect(windowFor(12_000, config)).toBe(200)
  })

  it('opens up completely once the player has waited long enough', () => {
    expect(windowFor(59_999, config)).toBeLessThan(Infinity)
    expect(windowFor(60_000, config)).toBe(Infinity)
  })
})

describe('findMatch (1v1)', () => {
  it('needs enough players', () => {
    expect(findMatch([waiting('a', 1500)], 2, NOW, config)).toBeNull()
  })

  it('pairs two players inside the base window', () => {
    const match = findMatch([waiting('a', 1500), waiting('b', 1560)], 2, NOW, config)
    expect(match?.map((e) => e.userId).sort()).toEqual(['a', 'b'])
  })

  it('refuses a spread nobody has waited long enough to accept', () => {
    expect(findMatch([waiting('a', 1500), waiting('b', 1700)], 2, NOW, config)).toBeNull()
  })

  it('the newest player’s patience binds the match, not the oldest one’s', () => {
    // `veteran` would accept anyone; `rookie` just arrived and would not.
    const entries = [waiting('veteran', 1500, 60_000), waiting('rookie', 1900, 0)]
    expect(findMatch(entries, 2, NOW, config)).toBeNull()
  })

  it('a long wait eventually widens the window enough to pair', () => {
    const entries = [waiting('a', 1500, 20_000), waiting('b', 1680, 20_000)]
    expect(windowFor(20_000, config)).toBe(300)
    expect(
      findMatch(entries, 2, NOW, config)
        ?.map((e) => e.userId)
        .sort()
    ).toEqual(['a', 'b'])
  })

  it('serves the longest-waiting player first when several pairs are possible', () => {
    const entries = [
      waiting('fresh1', 1500, 0),
      waiting('fresh2', 1510, 0),
      waiting('stale', 1600, 30_000),
      waiting('fresh3', 1620, 0)
    ]
    const match = findMatch(entries, 2, NOW, config)
    expect(match?.map((e) => e.userId)).toContain('stale')
  })

  it('pairs by rating proximity, not arrival order', () => {
    const entries = [waiting('low', 1200), waiting('high', 1900), waiting('high2', 1950)]
    expect(
      findMatch(entries, 2, NOW, config)
        ?.map((e) => e.userId)
        .sort()
    ).toEqual(['high', 'high2'])
  })
})

describe('findMatch (ffa3)', () => {
  it('groups three players whose whole spread fits the tightest window', () => {
    const entries = [waiting('a', 1500), waiting('b', 1550), waiting('c', 1590)]
    expect(findMatch(entries, 3, NOW, config)).toHaveLength(3)
  })

  it('rejects a trio whose extremes are too far apart even though neighbours are close', () => {
    const entries = [waiting('a', 1500), waiting('b', 1560), waiting('c', 1640)]
    expect(findMatch(entries, 3, NOW, config)).toBeNull()
  })

  it('picks the trio containing the longest-waiting player', () => {
    const entries = [
      waiting('a', 1500),
      waiting('b', 1520),
      waiting('c', 1540),
      waiting('stale', 1560, 25_000)
    ]
    const match = findMatch(entries, 3, NOW, config)
    expect(match?.map((e) => e.userId)).toContain('stale')
  })
})

describe('botFallbackCandidates', () => {
  it('offers bots only after the fallback delay', () => {
    const entries = [waiting('fresh', 1500, 44_000), waiting('bored', 1500, 45_000)]
    expect(botFallbackCandidates(entries, NOW, config).map((e) => e.userId)).toEqual(['bored'])
  })

  it('is disabled when the delay is zero', () => {
    const entries = [waiting('bored', 1500, 999_999)]
    expect(botFallbackCandidates(entries, NOW, { ...config, botFallbackMs: 0 })).toEqual([])
  })
})

describe('humans-before-bots invariant (default config)', () => {
  it('offers a bot only after the window has fully opened for human matches', () => {
    // If bots came first, two humans who could still pair would be split into
    // separate bot games — the small-pool "it matched me with a bot" report.
    expect(DEFAULT_MATCHMAKING.botFallbackMs).toBeGreaterThan(DEFAULT_MATCHMAKING.openWaitMs)
  })

  it('two far-apart humans pair by openWaitMs, before either is offered a bot', () => {
    const d = DEFAULT_MATCHMAKING
    // A 900-point gulf never fits the base window, but at openWaitMs both windows
    // are Infinite, so they match — and that moment precedes the bot fallback.
    const wait = d.openWaitMs
    const entries = [waiting('a', 1200, wait), waiting('b', 2100, wait)]
    expect(findMatch(entries, 2, NOW, d)?.length).toBe(2)
    expect(botFallbackCandidates(entries, NOW, d)).toEqual([])
  })
})
