// P4 view-model: reward mirror of the engine's grantReward, argument visibility
// through the reveal, stage mapping, and the rulebook sidebar (my conflicts +
// peaceful/blocked actors).

import type { PlayerView, PublicPlacement } from '@metarchy/engine'
import { describe, expect, it } from 'vitest'
import { deriveBoardProps } from '../src/board/derive.js'
import { deriveConflictUi, rewardFor } from '../src/screens/game/conflict/derive.js'

function placement(
  over: Partial<PublicPlacement> & Pick<PublicPlacement, 'actorId'>
): PublicPlacement {
  const seat = Number(over.actorId.split(':')[0]) as PublicPlacement['seat']
  const actorType = over.actorId.split(':')[1] as PublicPlacement['actorType']
  return { seat, actorType, locationId: 'square', ...over }
}

function p4View(over: {
  placements: PublicPlacement[]
  phase: Partial<Extract<PlayerView['phase'], { kind: 'p4_conflict' }>>
  disabled?: PlayerView['board']['disabledLocations']
}): PlayerView {
  return {
    gameId: 'g1',
    mode: '1v1',
    rulesVersion: '1.0.0',
    seat: 0,
    turn: 1,
    maxTurns: 5,
    isTieBreakerTurn: false,
    activeSeats: [0, 1],
    eliminated: [],
    decks: { event: 6, action: 15 },
    values: [
      { power: 0, art: 0, knowledge: 0, fame: 0 },
      { power: 0, art: 0, knowledge: 0, fame: 0 }
    ],
    me: { resources: { product: 1, electricity: 1, recycling: 1 }, hand: [] },
    allies: [],
    others: [{ seat: 1, handCount: 0, resources: null }],
    board: { placements: over.placements, disabledLocations: over.disabled ?? [] },
    phase: {
      kind: 'p4_conflict',
      conflicts: [],
      index: 0,
      stage: { t: 'reveal_ack', acked: [] },
      resolution: null,
      ...over.phase
    } as PlayerView['phase'],
    played: [],
    eventsPlayed: [],
    waitingOn: [0, 1],
    seq: 30
  } as PlayerView
}

describe('rewardFor (grantReward mirror)', () => {
  it('humans win their value, robots win 3 of the location resource', () => {
    expect(rewardFor('scientist', 'university', 'win', false)).toEqual({
      kind: 'value',
      type: 'knowledge',
      amount: 1
    })
    expect(rewardFor('robot', 'dump', 'win', false)).toEqual({
      kind: 'resource',
      type: 'recycling',
      amount: 3
    })
  })

  it('draw rewards follow the actor table; win bet adds one on any outcome', () => {
    expect(rewardFor('artist', 'theatre', 'draw', false)).toBeNull()
    expect(rewardFor('scientist', 'theatre', 'draw', false)).toEqual({
      kind: 'value',
      type: 'knowledge',
      amount: 1
    })
    expect(rewardFor('robot', 'factory', 'draw', false)).toEqual({
      kind: 'resource',
      type: 'product',
      amount: 1
    })
    expect(rewardFor('politician', 'square', 'lose', true)).toEqual({
      kind: 'value',
      type: 'power',
      amount: 1
    })
    expect(rewardFor('politician', 'square', 'lose', false)).toBeNull()
  })
})

describe('deriveConflictUi', () => {
  const conflict = {
    locationId: 'square' as const,
    actorType: 'politician' as const,
    actorIds: ['0:politician', '1:politician'] as `${0 | 1}:politician`[]
  }

  it('pre-reveal: my argument visible, opponent sealed; reveal stage tracks my ack', () => {
    const view = p4View({
      placements: [
        placement({ actorId: '0:politician', argument: 'rock', bet: 'win' }),
        placement({ actorId: '1:politician' }) // sealed for me
      ],
      phase: { conflicts: [conflict], stage: { t: 'reveal_ack', acked: [1] } }
    })
    const { arena } = deriveConflictUi(view)
    expect(arena?.involved).toBe(true)
    expect(arena?.stage).toEqual({ t: 'reveal', myAck: false, ackedSeats: [1] })
    const [mine, theirs] = arena?.participants ?? []
    expect(mine).toMatchObject({ mine: true, argument: 'rock', bet: 'win', outcome: null })
    expect(theirs).toMatchObject({ mine: false, argument: null, bet: null, done: true })
  })

  it('rps stage: round number, my turn, and per-seat chosen marks', () => {
    const view = p4View({
      placements: [
        placement({ actorId: '0:politician', argument: 'rock' }),
        placement({ actorId: '1:politician', argument: 'rock' })
      ],
      phase: {
        conflicts: [conflict],
        stage: { t: 'rps', chosen: [1], myChoice: null },
        resolution: {
          outcomes: { '0:politician': 'draw', '1:politician': 'draw' },
          betResults: [],
          winBonusActorIds: [],
          active: ['0:politician', '1:politician'],
          round: 1,
          revealedRps: {}
        }
      }
    })
    const { arena } = deriveConflictUi(view)
    expect(arena?.stage).toEqual({ t: 'rps', round: 2, myTurn: true, chosen: [1] })
    expect(arena?.participants.map((p) => p.active)).toEqual([true, true])
    expect(arena?.participants[1]?.done).toBe(true)
  })

  it('re-round pending: everyone re-picks, so cards seal again — only my fresh choice shows', () => {
    const view = p4View({
      placements: [
        placement({ actorId: '0:politician', argument: 'rock' }),
        placement({ actorId: '1:politician', argument: 'rock' })
      ],
      phase: {
        conflicts: [conflict],
        stage: { t: 'rps', chosen: [0], myChoice: 'scissors' },
        resolution: {
          outcomes: { '0:politician': 'draw', '1:politician': 'draw' },
          betResults: [],
          winBonusActorIds: [],
          active: ['0:politician', '1:politician'],
          round: 1,
          revealedRps: {}
        }
      }
    })
    const { arena } = deriveConflictUi(view)
    const [mine, theirs] = arena?.participants ?? []
    expect(mine).toMatchObject({ mine: true, argument: 'scissors', done: true })
    expect(theirs).toMatchObject({ mine: false, argument: null, done: false })
  })

  it('resolved re-rounds override the round-1 placement argument on the cards', () => {
    const view = p4View({
      placements: [
        placement({ actorId: '0:politician', argument: 'rock' }),
        placement({ actorId: '1:politician', argument: 'rock' })
      ],
      phase: {
        conflicts: [conflict],
        stage: { t: 'result_ack', acked: [] },
        resolution: {
          outcomes: { '0:politician': 'win', '1:politician': 'lose' },
          betResults: [],
          winBonusActorIds: [],
          active: [],
          round: 2,
          revealedRps: { 0: 'paper', 1: 'rock' }
        }
      }
    })
    const { arena } = deriveConflictUi(view)
    expect(arena?.participants.map((p) => p.argument)).toEqual(['paper', 'rock'])
    // The round-1 argument stays available for the result report.
    expect(arena?.participants.map((p) => p.placedArgument)).toEqual(['rock', 'rock'])
  })

  it('result stage: final outcomes with reward previews and win-bet bonus', () => {
    const view = p4View({
      placements: [
        placement({ actorId: '0:politician', argument: 'rock', bet: 'win' }),
        placement({ actorId: '1:politician', argument: 'scissors' })
      ],
      phase: {
        conflicts: [conflict],
        stage: { t: 'result_ack', acked: [] },
        resolution: {
          outcomes: { '0:politician': 'win', '1:politician': 'lose' },
          betResults: [{ actorId: '0:politician', seat: 0, bet: 'win', success: true }],
          winBonusActorIds: ['0:politician'],
          active: [],
          round: 1,
          revealedRps: {}
        }
      }
    })
    const { arena } = deriveConflictUi(view)
    expect(arena?.stage).toEqual({ t: 'result', myAck: false })
    expect(arena?.participants[0]).toMatchObject({
      outcome: 'win',
      winBet: true,
      betSuccess: true,
      reward: { kind: 'value', type: 'power', amount: 2 }
    })
    expect(arena?.participants[1]).toMatchObject({
      outcome: 'lose',
      betSuccess: null,
      reward: null
    })
  })

  it('sidebar: my conflicts by status plus peaceful and blocked actors', () => {
    const robotConflict = {
      locationId: 'factory' as const,
      actorType: 'robot' as const,
      actorIds: ['0:robot', '1:robot'] as `${0 | 1}:robot`[]
    }
    const view = p4View({
      placements: [
        placement({ actorId: '0:politician', argument: 'rock' }),
        placement({ actorId: '1:politician' }),
        placement({ actorId: '0:robot', locationId: 'factory', argument: 'dummy' }),
        placement({ actorId: '1:robot', locationId: 'factory' }),
        placement({ actorId: '0:scientist', locationId: 'university', argument: 'paper' }),
        placement({ actorId: '0:artist', locationId: 'theatre', argument: 'scissors', bet: 'win' })
      ],
      phase: { conflicts: [conflict, robotConflict], index: 1 },
      disabled: ['theatre']
    })
    const { sidebar } = deriveConflictUi(view)
    expect(sidebar).toEqual([
      expect.objectContaining({ t: 'conflict', index: 0, status: 'resolved' }),
      expect.objectContaining({ t: 'conflict', index: 1, status: 'current' }),
      expect.objectContaining({
        t: 'peaceful',
        actorType: 'scientist',
        reward: { kind: 'value', type: 'knowledge', amount: 1 }
      }),
      expect.objectContaining({ t: 'blocked', actorType: 'artist', locationId: 'theatre' })
    ])
  })

  it('board highlights the current conflict location for everyone', () => {
    const view = p4View({
      placements: [
        placement({ actorId: '0:politician', argument: 'rock' }),
        placement({ actorId: '1:politician' })
      ],
      phase: { conflicts: [conflict] }
    })
    const board = deriveBoardProps({ view, staged: {}, activeActor: null, hoverLocation: null })
    expect(board.locations.square.state).toBe('active')
    expect(board.locations.university.state).toBe('normal')
  })

  it('returns empty outside P4', () => {
    const view = p4View({ placements: [], phase: {} })
    ;(view as { phase: unknown }).phase = { kind: 'p5_market', doneSeats: [], sealedBuys: [] }
    expect(deriveConflictUi(view)).toEqual({ arena: null, sidebar: [] })
  })
})
