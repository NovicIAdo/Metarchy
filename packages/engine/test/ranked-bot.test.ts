// The ranked bot (author backlog §11): the opponent a rated queue seats when no
// human turns up. These tests pin the author's rules one at a time against
// hand-built states, plus the one property that matters more than any of them —
// it must never hand the engine an intent the engine would refuse, and never
// wedge a phase it is being waited on.

import { describe, expect, it } from 'vitest'
import {
  ALLOWED_LOCATIONS,
  BLOCK_CARD_LOCATION,
  applyIntent,
  chooseRankedBotIntent,
  createGame,
  legalIntents
} from '../src/index.js'
import type {
  CardInstance,
  GameState,
  Intent,
  PlacementInput,
  Resources,
  SeatId,
  SeatInventory,
  Values
} from '../src/index.js'
import { valuesIndexFor } from '../src/index.js'
import { TestGame } from './helpers.js'

const BOT: SeatId = 1
const PLAYER: SeatId = 0
/** Deterministic "random": always the first option, so a rule is visible. */
const first = (): number => 0
/** Mid-range, to exercise the shuffles without being the degenerate 0. */
const mid = (): number => 0.5

function newGame(mode: '1v1' | 'ffa3' = '1v1'): TestGame {
  return new TestGame(createGame({ gameId: 'rb', mode, seed: 'ranked-bot' }))
}

/** Seat the table by hand — inventories and value pools are seat-indexed arrays. */
function setResources(g: TestGame, seat: SeatId, resources: Resources): void {
  ;(g.state.inventories[seat] as SeatInventory).resources = resources
}

function setHand(g: TestGame, seat: SeatId, hand: CardInstance[]): void {
  ;(g.state.inventories[seat] as SeatInventory).hand = hand
}

function setValues(g: TestGame, seat: SeatId, values: Values): void {
  g.state.values[valuesIndexFor(g.state, seat)] = values
}

/** The commit the bot would make right now. */
function botCommit(state: GameState, random = mid): PlacementInput[] {
  const intent = chooseRankedBotIntent(state, BOT, random)
  if (intent?.type !== 'distribution.commit')
    throw new Error(`expected a commit, got ${intent?.type}`)
  return intent.placements
}

const placementOf = (ps: PlacementInput[], actorType: string): PlacementInput => {
  const found = ps.find((p) => p.actorType === actorType)
  if (!found) throw new Error(`no ${actorType} in the commit`)
  return found
}

describe('ranked bot — Phase 2', () => {
  it('sends the Robot where the opponent has no resources', () => {
    const g = newGame()
    // The opponent holds product only: Power Plant or Dump, never the Factory.
    setResources(g, PLAYER, { product: 3, electricity: 0, recycling: 0 })
    for (let i = 0; i < 12; i++) {
      const robot = placementOf(
        botCommit(g.state, () => i / 12),
        'robot'
      )
      expect(['power_plant', 'dump']).toContain(robot.locationId)
    }
  })

  it('spreads the Robot over all three when the opponent lacks nothing', () => {
    const g = newGame()
    setResources(g, PLAYER, { product: 2, electricity: 2, recycling: 2 })
    const seen = new Set<string>()
    for (let i = 0; i < 12; i++)
      seen.add(
        placementOf(
          botCommit(g.state, () => i / 12),
          'robot'
        ).locationId as string
      )
    expect([...seen].sort()).toEqual(['dump', 'factory', 'power_plant'])
  })

  it('keeps its Actors out of a Location it holds a shutdown card for', () => {
    const g = newGame()
    // student_protests shuts the University — the Scientist's other option is the Theatre.
    setHand(g, BOT, [{ instanceId: 'c1', card: 'student_protests' }])
    expect(BLOCK_CARD_LOCATION.student_protests).toBe('university')
    for (let i = 0; i < 12; i++) {
      const ps = botCommit(g.state, () => i / 12)
      expect(placementOf(ps, 'scientist').locationId).toBe('theatre')
      expect(placementOf(ps, 'politician').locationId).toBe('square')
    }
  })

  it('gives the Dummy to the Actor whose Value it already has most of', () => {
    const g = newGame()
    // Plenty of art, so the Artist is the one carrying the Dummy.
    setValues(g, BOT, { power: 0, art: 4, knowledge: 0, fame: 0 })
    for (let i = 0; i < 12; i++) {
      const ps = botCommit(g.state, () => i / 12)
      expect(placementOf(ps, 'artist').argument).toBe('dummy')
    }
  })

  it('backs the Dummy with a Lose bet and never bets Win or Draw on the Robot', () => {
    const g = newGame()
    setValues(g, BOT, { power: 0, art: 4, knowledge: 0, fame: 0 })
    setResources(g, BOT, { product: 2, electricity: 2, recycling: 2 })
    for (let i = 0; i < 12; i++) {
      const ps = botCommit(g.state, () => i / 12)
      expect(placementOf(ps, 'artist').bet).toBe('lose')
      const robotBet = placementOf(ps, 'robot').bet
      expect(robotBet === 'win' || robotBet === 'draw').toBe(false)
    }
  })

  it('never spends its whole stock on bets — a bet is a gamble, the market is not', () => {
    const g = newGame()
    setResources(g, BOT, { product: 5, electricity: 5, recycling: 5 })
    for (let i = 0; i < 12; i++) {
      const bets = botCommit(g.state, () => i / 12).filter((p) => p.bet !== undefined)
      expect(bets.length).toBeLessThanOrEqual(2)
    }
  })

  it('prefers a Draw bet on the Artist over the Scientist over the Politician', () => {
    const g = newGame()
    // Knowledge is abundant, so the Scientist takes the Dummy and the Artist is
    // the best remaining draw-bet target.
    setValues(g, BOT, { power: 0, art: 0, knowledge: 5, fame: 0 })
    setResources(g, BOT, { product: 0, electricity: 0, recycling: 2 })
    for (let i = 0; i < 12; i++) {
      const ps = botCommit(g.state, () => i / 12)
      expect(placementOf(ps, 'artist').bet).toBe('draw')
    }
  })
})

describe('ranked bot — discard events', () => {
  /** Drive to a discard event and read the amount the bot would discard. */
  function discardAmountWith(mine: number, theirs: number): number {
    const g = newGame()
    const state = g.state
    // Build the stage by hand: the ladder only reads resources and the spec max.
    setResources(g, BOT, { product: mine, electricity: 0, recycling: 0 })
    setResources(g, PLAYER, { product: theirs, electricity: 0, recycling: 0 })
    state.phase = {
      kind: 'p1_event',
      card: 'help_poor_countries',
      stage: { t: 'discard_commit', amounts: {} }
    } as GameState['phase']
    const intent = chooseRankedBotIntent(state, BOT, mid)
    if (intent?.type !== 'event.discard') throw new Error(`expected a discard, got ${intent?.type}`)
    return intent.amount
  }

  it('discards exactly 1 when the opponent has none', () => {
    expect(discardAmountWith(3, 0)).toBe(1)
  })

  it('discards one more than the opponent can', () => {
    expect(discardAmountWith(4, 2)).toBe(3)
  })

  it('matches the opponent when it cannot outbid them', () => {
    expect(discardAmountWith(2, 2)).toBe(2)
  })

  it('discards nothing when it holds fewer than the opponent', () => {
    expect(discardAmountWith(1, 3)).toBe(0)
  })
})

describe('ranked bot — Phase 3', () => {
  it('plays the shutdown card on a Location the opponent is standing in', () => {
    const g = newGame()
    setHand(g, BOT, [
      { instanceId: 'block-sq', card: 'construction_work' }, // square
      { instanceId: 'block-uni', card: 'student_protests' } // university
    ])
    g.state.board.placements = [
      {
        actorId: `${PLAYER}:politician`,
        seat: PLAYER,
        actorType: 'politician',
        locationId: 'university',
        argument: 'rock'
      }
    ]
    g.state.phase = {
      kind: 'p3_action',
      selected: {},
      step: { t: 'select', committed: {} }
    } as GameState['phase']
    const intent = chooseRankedBotIntent(g.state, BOT, mid)
    if (intent?.type !== 'action.selectCards') throw new Error(`expected selectCards`)
    // The University is where they stand, so that is the card that goes down.
    expect(intent.cardInstanceIds).toContain('block-uni')
    expect(intent.cardInstanceIds).not.toContain('block-sq')
  })

  it('plays Relocation alongside a shutdown card', () => {
    const g = newGame()
    setHand(g, BOT, [
      { instanceId: 'block-uni', card: 'student_protests' },
      { instanceId: 'reloc', card: 'relocation' }
    ])
    g.state.board.placements = [
      {
        actorId: `${PLAYER}:politician`,
        seat: PLAYER,
        actorType: 'politician',
        locationId: 'university',
        argument: 'rock'
      }
    ]
    g.state.phase = {
      kind: 'p3_action',
      selected: {},
      step: { t: 'select', committed: {} }
    } as GameState['phase']
    const intent = chooseRankedBotIntent(g.state, BOT, mid)
    if (intent?.type !== 'action.selectCards') throw new Error(`expected selectCards`)
    expect(intent.cardInstanceIds).toEqual(expect.arrayContaining(['block-uni', 'reloc']))
  })

  it('drags an opponent Actor into the shut Location', () => {
    const g = newGame()
    g.state.board.disabledLocations = ['university']
    g.state.board.placements = [
      {
        actorId: `${PLAYER}:politician`,
        seat: PLAYER,
        actorType: 'politician',
        locationId: 'square',
        argument: 'rock'
      },
      {
        actorId: `${BOT}:artist`,
        seat: BOT,
        actorType: 'artist',
        locationId: 'theatre',
        argument: 'paper'
      }
    ]
    g.state.phase = {
      kind: 'p3_action',
      selected: {},
      // The quota comes from the revealed summary — one Relocation played.
      summary: [{ seat: BOT, block: 0, relocation: 1, exchange: 0 }],
      step: { t: 'relocate', orders: {}, skipped: {} }
    } as GameState['phase']
    const intent = chooseRankedBotIntent(g.state, BOT, mid)
    // A politician may legally stand in the University, so in it goes.
    expect(intent).toEqual({
      type: 'action.relocate',
      actorId: `${PLAYER}:politician`,
      to: 'university'
    })
  })

  it('rescues its own Actor out of the shut Location when no victim fits', () => {
    const g = newGame()
    g.state.board.disabledLocations = ['factory']
    g.state.board.placements = [
      // Only a Robot may stand in the Factory, and the opponent has none on board.
      {
        actorId: `${BOT}:robot`,
        seat: BOT,
        actorType: 'robot',
        locationId: 'factory',
        argument: 'rock'
      }
    ]
    g.state.phase = {
      kind: 'p3_action',
      selected: {},
      // The quota comes from the revealed summary — one Relocation played.
      summary: [{ seat: BOT, block: 0, relocation: 1, exchange: 0 }],
      step: { t: 'relocate', orders: {}, skipped: {} }
    } as GameState['phase']
    const intent = chooseRankedBotIntent(g.state, BOT, first)
    if (intent?.type !== 'action.relocate')
      throw new Error(`expected a relocate, got ${intent?.type}`)
    expect(intent.actorId).toBe(`${BOT}:robot`)
    expect(intent.to).not.toBe('factory')
    expect(ALLOWED_LOCATIONS.robot).toContain(intent.to)
  })

  it('exchanges away its most abundant Value for the one it lacks', () => {
    const g = newGame()
    setValues(g, BOT, { power: 5, art: 0, knowledge: 1, fame: 0 })
    setValues(g, PLAYER, { power: 0, art: 3, knowledge: 2, fame: 0 })
    g.state.phase = {
      kind: 'p3_action',
      selected: {},
      step: { t: 'exchange', queue: [{ seat: BOT, instanceId: 'x' }], index: 0 }
    } as GameState['phase']
    const intent = chooseRankedBotIntent(g.state, BOT, mid)
    expect(intent).toEqual({ type: 'action.exchange', give: 'power', from: PLAYER, take: 'art' })
  })
})

describe('ranked bot — the property that matters', () => {
  /**
   * A full ranked game, bot in every seat, played to the end: every intent the
   * bot produces must be one the engine accepts, and the game must actually
   * finish. This is what catches a rule that looks clever and wedges a phase.
   */
  it('plays complete games without ever offering an illegal intent', () => {
    for (const [mode, seats] of [
      ['1v1', 2],
      ['ffa3', 3]
    ] as const) {
      let state = createGame({ gameId: `rb-${mode}`, mode, seed: `seed-${mode}` })
      let cursor = 0
      // A cheap deterministic stream — a fixed seed keeps a failure reproducible.
      const random = (): number => {
        cursor += 1
        return ((cursor * 2654435761) % 4294967296) / 4294967296
      }
      let guard = 0
      while (state.phase.kind !== 'finished') {
        if (++guard > 4000) throw new Error(`${mode}: game never finished (${state.phase.kind})`)
        let moved = false
        for (let seat = 0 as SeatId; seat < seats; seat++) {
          if (legalIntents(state, seat).length === 0) continue
          const intent = chooseRankedBotIntent(state, seat, random) as Intent
          expect(intent, `${mode}: bot had legal specs but produced nothing`).not.toBeNull()
          const result = applyIntent(state, seat, intent)
          if (!result.ok)
            throw new Error(
              `${mode}: engine refused ${intent.type} from seat ${seat}: ${result.error.code} — ${result.error.message}`
            )
          state = result.state
          moved = true
          if (state.phase.kind === 'finished') break
        }
        if (!moved) throw new Error(`${mode}: nobody could move in ${state.phase.kind}`)
      }
      expect(state.phase.kind).toBe('finished')
    }
  })
})
