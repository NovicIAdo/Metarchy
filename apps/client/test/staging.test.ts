// P2 staging rules: the client-side mirror of the engine's distribution.commit
// validation, plus the view→BoardProps derivation the scene renders from.

import type { PlayerView, Resources } from '@metarchy/engine'
import { describe, expect, it } from 'vitest'
import { deriveBoardProps, stagedTokenId } from '../src/board/derive.js'
import {
  betAffordable,
  canCommit,
  isLegalPlacement,
  placeableActorsAt,
  stagedBetSpend,
  toPlacementInputs,
  usedArguments,
  useUiStore,
  type StagedMap
} from '../src/stores/ui.js'

const RESOURCES: Resources = { product: 1, electricity: 1, recycling: 1 }

const FULL_STAGED: StagedMap = {
  politician: { locationId: 'square', argument: 'rock' },
  scientist: { locationId: 'university', argument: 'paper' },
  artist: { locationId: 'theatre', argument: 'scissors' },
  robot: { locationId: 'factory', argument: 'dummy' }
}

function p2View(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    gameId: 'g1',
    mode: 'vs_bots',
    rulesVersion: '1.0.0',
    seat: 0,
    turn: 1,
    isTieBreakerTurn: false,
    activeSeats: [0, 1],
    eliminated: [],
    decks: { event: 6, action: 15 },
    values: [
      { power: 0, art: 0, knowledge: 0, fame: 0 },
      { power: 0, art: 0, knowledge: 0, fame: 0 }
    ],
    me: { resources: { ...RESOURCES }, hand: [] },
    allies: [],
    others: [{ seat: 1, handCount: 0, resources: null }],
    board: { placements: [], disabledLocations: [] },
    phase: { kind: 'p2_distribution', committedSeats: [], sealed: [] },
    waitingOn: [0, 1],
    seq: 10,
    ...overrides
  } as PlayerView
}

describe('staging rules', () => {
  it('legal placements follow ALLOWED_LOCATIONS and disabled list', () => {
    expect(isLegalPlacement('politician', 'square', [])).toBe(true)
    expect(isLegalPlacement('politician', 'factory', [])).toBe(false)
    expect(isLegalPlacement('robot', 'dump', [])).toBe(true)
    expect(isLegalPlacement('robot', 'dump', ['dump'])).toBe(false)
  })

  // Placement the other way round (player feedback): tap a Location, then pick
  // from whoever may still go there — worked example straight from the report.
  it('answers "who can go here?" with the unplaced actors this Location accepts', () => {
    expect(placeableActorsAt({}, 'square', [])).toEqual(['politician', 'artist'])
    // "Но если Политик уже расположен в Университете, то вылезет тока Артист"
    const politicianAway: StagedMap = { politician: { locationId: 'university', argument: 'rock' } }
    expect(placeableActorsAt(politicianAway, 'square', [])).toEqual(['artist'])
    // "А если Артист уже в Театре, то вылезет тока Политики"
    const artistAway: StagedMap = { artist: { locationId: 'theatre', argument: 'rock' } }
    expect(placeableActorsAt(artistAway, 'square', [])).toEqual(['politician'])
    // Robot Locations are the Robot's alone, and a blocked Location takes nobody.
    expect(placeableActorsAt({}, 'factory', [])).toEqual(['robot'])
    expect(placeableActorsAt({}, 'square', ['square'])).toEqual([])
  })

  it('tracks used arguments with an exemption for the edited actor', () => {
    const staged: StagedMap = {
      politician: { locationId: 'square', argument: 'rock' },
      artist: { locationId: 'theatre', argument: 'dummy' }
    }
    expect([...usedArguments(staged)].sort()).toEqual(['dummy', 'rock'])
    expect(usedArguments(staged, 'politician').has('rock')).toBe(false)
  })

  it('bet budget counts staged bets against resources', () => {
    const staged: StagedMap = {
      politician: { locationId: 'square', argument: 'rock', bet: 'win' }
    }
    expect(stagedBetSpend(staged).product).toBe(1)
    // Only 1 product total: a second win bet is unaffordable…
    expect(betAffordable('win', staged, RESOURCES)).toBe(false)
    // …unless we are re-editing the actor that already holds it.
    expect(betAffordable('win', staged, RESOURCES, 'politician')).toBe(true)
    expect(betAffordable('lose', staged, RESOURCES)).toBe(true)
  })

  it('canCommit requires 4 placements with 4 distinct arguments within budget', () => {
    expect(canCommit(FULL_STAGED, RESOURCES)).toBe(true)
    const three: StagedMap = { ...FULL_STAGED }
    delete three.robot
    expect(canCommit(three, RESOURCES)).toBe(false)
    expect(
      canCommit({ ...FULL_STAGED, robot: { locationId: 'factory', argument: 'rock' } }, RESOURCES)
    ).toBe(false)
    const betted: StagedMap = {
      ...FULL_STAGED,
      politician: { locationId: 'square', argument: 'rock', bet: 'win' },
      scientist: { locationId: 'university', argument: 'paper', bet: 'win' }
    }
    expect(canCommit(betted, RESOURCES)).toBe(false) // two win bets, one product
  })

  it('toPlacementInputs emits engine-shaped inputs, omitting absent bets', () => {
    const inputs = toPlacementInputs({
      politician: { locationId: 'square', argument: 'rock', bet: 'draw' },
      robot: { locationId: 'dump', argument: 'dummy' }
    })
    expect(inputs).toContainEqual({
      actorType: 'politician',
      locationId: 'square',
      argument: 'rock',
      bet: 'draw'
    })
    expect(inputs).toContainEqual({ actorType: 'robot', locationId: 'dump', argument: 'dummy' })
    expect(inputs.find((p) => p.actorType === 'robot')).not.toHaveProperty('bet')
  })

  it('ensureStagedKey drops drafts when the turn changes', () => {
    const ui = useUiStore.getState()
    ui.ensureStagedKey('g1:1')
    ui.stagePlacement('politician', { locationId: 'square', argument: 'rock' })
    useUiStore.getState().ensureStagedKey('g1:1')
    expect(Object.keys(useUiStore.getState().staged)).toHaveLength(1)
    useUiStore.getState().ensureStagedKey('g1:2')
    expect(useUiStore.getState().staged).toEqual({})
  })
})

describe('deriveBoardProps', () => {
  it('never doubles an actor the board and the sealed copy both carry', () => {
    // Regression (#4): after the distribution reveal the server view briefly
    // holds the same actor in BOTH board.placements (the public reveal) and
    // phase.sealed (the group's sealed commit). Rendering both doubled every own
    // actor for human players — spectators were fine because their sealed list
    // is empty. The derivation must keep one token per actorId.
    const placement = {
      actorId: '0:politician',
      seat: 0,
      actorType: 'politician',
      locationId: 'square',
      argument: 'rock'
    }
    const view = p2View({
      board: { placements: [placement], disabledLocations: [] },
      phase: {
        kind: 'p2_distribution',
        committedSeats: [0],
        revealed: { acked: [] },
        sealed: [{ seat: 0, placements: [placement] }]
      }
    } as Partial<PlayerView>)
    const props = deriveBoardProps({ view, staged: {}, activeActor: null, hoverLocation: null })
    const ids = props.tokens.map((tok) => tok.id)
    expect(ids).toEqual(['0:politician'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('renders staged ghosts only before my commit', () => {
    const staged: StagedMap = { politician: { locationId: 'square', argument: 'rock' } }
    const before = deriveBoardProps({
      view: p2View(),
      staged,
      activeActor: null,
      hoverLocation: null
    })
    expect(before.tokens).toEqual([
      expect.objectContaining({ id: stagedTokenId('politician'), staged: true, seat: null })
    ])

    const after = deriveBoardProps({
      view: p2View({
        phase: {
          kind: 'p2_distribution',
          committedSeats: [0],
          sealed: [
            {
              seat: 0,
              placements: [
                {
                  actorId: '0:politician',
                  seat: 0,
                  actorType: 'politician',
                  locationId: 'square',
                  argument: 'rock'
                }
              ]
            }
          ]
        }
      } as Partial<PlayerView>),
      staged,
      activeActor: null,
      hoverLocation: null
    })
    expect(after.tokens).toEqual([
      expect.objectContaining({ id: '0:politician', staged: false, seat: 0, argument: 'rock' })
    ])
  })

  it('draws a staged relocation at its destination, pulsing, without touching the view', () => {
    const view = p2View({
      phase: {
        kind: 'p3_action',
        selectedCounts: null,
        step: { t: 'relocate', committedSeats: [], myOrders: [] }
      },
      board: {
        placements: [
          { actorId: '1:robot', seat: 1, actorType: 'robot', locationId: 'dump' },
          { actorId: '0:artist', seat: 0, actorType: 'artist', locationId: 'theatre' }
        ],
        disabledLocations: []
      }
    } as Partial<PlayerView>)
    const props = deriveBoardProps({
      view,
      staged: {},
      activeActor: null,
      hoverLocation: null,
      relocateSource: '1:robot',
      relocateStaged: { actorId: '1:robot', to: 'factory' }
    })
    expect(props.tokens).toEqual([
      expect.objectContaining({ id: '1:robot', locationId: 'factory', selected: true }),
      expect.objectContaining({ id: '0:artist', locationId: 'theatre', selected: false })
    ])
    // Dropping the staged move (re-picking) snaps the token back home.
    const reverted = deriveBoardProps({
      view,
      staged: {},
      activeActor: null,
      hoverLocation: null,
      relocateSource: null,
      relocateStaged: null
    })
    expect(reverted.tokens[0]).toMatchObject({ id: '1:robot', locationId: 'dump' })

    // After Done the move rides sentMoves: the token holds its destination
    // (not pulsing, not staged) until the server view catches up.
    const sent = deriveBoardProps({
      view,
      staged: {},
      activeActor: null,
      hoverLocation: null,
      relocateSource: null,
      relocateStaged: null,
      sentMoves: [{ actorId: '1:robot', to: 'factory' }]
    })
    expect(sent.tokens[0]).toMatchObject({
      id: '1:robot',
      locationId: 'factory',
      selected: false
    })
  })

  it('marks legal locations as hint and the hovered one as active while dragging', () => {
    const props = deriveBoardProps({
      view: p2View(),
      staged: {},
      activeActor: 'politician',
      hoverLocation: 'square'
    })
    expect(props.locations.square.state).toBe('active')
    expect(props.locations.university.state).toBe('hint')
    expect(props.locations.factory.state).toBe('normal')
  })

  it('disabled locations never glow and carry the disabled flag', () => {
    const view = p2View({
      board: { placements: [], disabledLocations: ['square'] }
    } as Partial<PlayerView>)
    const props = deriveBoardProps({
      view,
      staged: {},
      activeActor: 'politician',
      hoverLocation: 'square'
    })
    expect(props.locations.square).toEqual({ state: 'normal', disabled: true })
    expect(props.locations.university.state).toBe('hint')
  })

  it('renders committed board placements with per-seat visibility intact', () => {
    const view = p2View({
      phase: {
        kind: 'p3_action',
        selectedCounts: null,
        step: { t: 'select', committedSeats: [], mySelection: null }
      },
      board: {
        placements: [
          {
            actorId: '1:robot',
            seat: 1,
            actorType: 'robot',
            locationId: 'dump'
            // argument hidden: not my visibility group
          }
        ],
        disabledLocations: []
      }
    } as Partial<PlayerView>)
    const props = deriveBoardProps({ view, staged: {}, activeActor: null, hoverLocation: null })
    expect(props.tokens).toEqual([
      expect.objectContaining({ id: '1:robot', seat: 1, argument: null, staged: false })
    ])
    // The scene reads allegiance (own/ally/enemy rings) off these.
    expect(props.viewerSeat).toBe(0)
    expect(props.allySeats).toEqual([])
  })
})

describe('2v2 ally staging ghosts (team.staging relay → board tokens)', () => {
  const allyView = (): PlayerView =>
    p2View({
      mode: '2v2',
      teams: [
        [0, 2],
        [1, 3]
      ],
      activeSeats: [0, 1, 2, 3],
      allies: [2],
      others: [
        { seat: 1, handCount: 0, resources: null },
        { seat: 2, handCount: 0, resources: null },
        { seat: 3, handCount: 0, resources: null }
      ]
    } as Partial<PlayerView>)

  const staging = {
    fromSeat: 2 as const,
    staging: {
      kind: 'p2' as const,
      turn: 1,
      placements: [
        {
          actorType: 'politician' as const,
          locationId: 'square' as const,
          argument: 'rock' as const,
          bet: 'win' as const
        }
      ]
    }
  }

  it('renders the ally draft as ghost tokens with argument and bet', () => {
    const props = deriveBoardProps({
      view: allyView(),
      staged: {},
      activeActor: null,
      hoverLocation: null,
      allyStaging: staging
    })
    const ghost = props.tokens.find((t) => t.id === 'allystaged:2:politician')
    expect(ghost).toMatchObject({
      seat: 2,
      locationId: 'square',
      argument: 'rock',
      bet: 'win',
      staged: true
    })
  })

  it('drops the ghosts once the ally committed or the turn moved on', () => {
    const committed = allyView()
    if (committed.phase.kind === 'p2_distribution') committed.phase.committedSeats = [2]
    const afterCommit = deriveBoardProps({
      view: committed,
      staged: {},
      activeActor: null,
      hoverLocation: null,
      allyStaging: staging
    })
    expect(afterCommit.tokens.some((t) => t.id.startsWith('allystaged:'))).toBe(false)

    const stale = deriveBoardProps({
      view: allyView(),
      staged: {},
      activeActor: null,
      hoverLocation: null,
      allyStaging: { ...staging, staging: { ...staging.staging, turn: 2 } }
    })
    expect(stale.tokens.some((t) => t.id.startsWith('allystaged:'))).toBe(false)
  })

  it('ignores drafts from non-ally seats', () => {
    const enemy = deriveBoardProps({
      view: allyView(),
      staged: {},
      activeActor: null,
      hoverLocation: null,
      allyStaging: { ...staging, fromSeat: 1 }
    })
    expect(enemy.tokens.some((t) => t.id.startsWith('allystaged:'))).toBe(false)
  })
})
