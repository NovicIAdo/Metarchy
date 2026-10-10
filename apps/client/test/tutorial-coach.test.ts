// The coached Tutorial's step derivation. coachStep is a pure function of the
// server view + local staging, so it must name exactly what the player should
// do next — the sealed-bid P2 loop above all (the taught example), the
// fullscreen phases, and the "waiting for the bot" lulls.
//
// coachWalk is the other pure half: the PREVIOUS/NEXT reader over the live card
// and the cards already shown, which must never dismiss anything on the way back.

import type { PlayerView } from '@metarchy/engine'
import { describe, expect, it } from 'vitest'
import {
  coachCardPages,
  coachHistoryHere,
  coachStep,
  coachWalk,
  type CoachCursor,
  type SeenCard
} from '../src/screens/game/TutorialCoach.js'

const noUi = { picker: false, stagedCount: 0, activeActor: null, chooserAt: null }

/** A minimal view — only the fields coachStep reads. */
function mk(phase: unknown, extra: Partial<PlayerView> = {}): PlayerView {
  return {
    seat: 0,
    turn: 1,
    waitingOn: [0],
    board: { placements: [], disabledLocations: [] },
    phase,
    ...extra
  } as unknown as PlayerView
}

describe('coachStep — P2 distribution loop', () => {
  const p2 = (committedSeats: number[] = []) =>
    mk({ kind: 'p2_distribution', committedSeats, sealed: [] })

  it('turn 1 opens with a narrative intro (…→ conflict →pick), spotlighting the dock', () => {
    const step = coachStep(p2(), { ...noUi, stagedCount: 0 })
    expect(step).toMatchObject({ key: 'p2.pick', target: '.hud-actors' })
    expect(step?.bodyKey).toBeUndefined()
    expect(step?.pages?.map((p) => p.bodyKey)).toContain('coach.intro.conflict.body')
    expect(step?.pages?.at(-1)).toMatchObject({ titleKey: 'coach.p2.pick.title' })
  })

  it('later turns skip the intro and just point at the dock', () => {
    const step = coachStep(
      mk({ kind: 'p2_distribution', committedSeats: [], sealed: [] }, { turn: 3 }),
      { ...noUi, stagedCount: 0 }
    )
    expect(step).toMatchObject({
      key: 'p2.pick',
      target: '.hud-actors',
      bodyKey: 'coach.p2.pick.body'
    })
    expect(step?.pages).toBeUndefined()
  })

  // Player feedback (14 y/o): arrows to what to click, then to where it goes.
  it('once an actor is in hand, arrows every Location it may enter', () => {
    const step = coachStep(p2(), { ...noUi, activeActor: 'politician' })
    expect(step).toMatchObject({ key: 'p2.place', target: '.hud-actors' })
    // The guide line runs from the dock (`target`) to these — pick up here, put
    // down there. Politicians take the Square or the University, nothing else.
    expect(step?.targetLocations).toEqual(['square', 'university'])
    expect(step?.whyKey).toBe('coach.p2.place.why')
  })

  it('a Location switched off this turn drops out of the arrows', () => {
    const step = coachStep(
      mk({ kind: 'p2_distribution', committedSeats: [], sealed: [] }, {
        board: { placements: [], disabledLocations: ['square'] }
      } as Partial<PlayerView>),
      { ...noUi, activeActor: 'politician' }
    )
    expect(step?.targetLocations).toEqual(['university'])
  })

  it('tapping a Location instead coaches the "who goes here?" plate', () => {
    const step = coachStep(p2(), { ...noUi, chooserAt: 'square' })
    expect(step).toMatchObject({
      key: 'p2.chooseActor',
      target: '.actor-chooser',
      bodyKey: 'coach.p2.chooseActor.body'
    })
  })

  it('with the picker open, coaches the Argument with a ring only (no scrim card)', () => {
    const step = coachStep(p2(), { ...noUi, picker: true })
    expect(step?.key).toBe('p2.arg')
    expect(step?.target).toBe('.board-picker')
    // A scrim would cancel the picker on outside pointer-down — must stay card-less.
    expect(step?.bodyKey).toBeUndefined()
  })

  it('after some (not all) placed, nudges to place the rest', () => {
    expect(coachStep(p2(), { ...noUi, stagedCount: 2 })?.key).toBe('p2.more')
  })

  it('with all four placed, points at Commit', () => {
    expect(coachStep(p2(), { ...noUi, stagedCount: 4 })).toMatchObject({
      key: 'p2.commit',
      target: '.commit-bar'
    })
  })

  it('after committing, shows the sealed/waiting banner (no target)', () => {
    const step = coachStep(p2([0]), { ...noUi, stagedCount: 4 })
    expect(step?.key).toBe('p2.sealed')
    expect(step?.target).toBeUndefined()
    expect(step?.placement).toBe('bottom')
  })
})

describe('coachStep — other phases', () => {
  it('P1 event: read-and-continue while it waits on me', () => {
    const step = coachStep(
      mk({ kind: 'p1_event', card: 'x', stage: { t: 'compare_ack', winner: null, acked: [] } }),
      noUi
    )
    expect(step).toMatchObject({
      key: 'p1.event',
      placement: 'top',
      bodyKey: 'coach.p1.event.body'
    })
  })

  const p3select = (turn: number) =>
    mk(
      {
        kind: 'p3_action',
        selectedCounts: null,
        step: { t: 'select', committedSeats: [], mySelection: null }
      },
      { turn }
    )

  it('P3 select: coaches action cards on the left panel — no turn-1 special case', () => {
    // Turn 1 has no P3 at all (rulebook §Turn Structure), so the phase never needs
    // a "you have no cards yet" card: the player first sees it on turn 2.
    for (const turn of [2, 3])
      expect(coachStep(p3select(turn), noUi)).toMatchObject({
        key: 'p3.select',
        target: '.p3-panel',
        bodyKey: 'coach.p3.select.body'
      })
  })

  it('P5 market: coaches trading on the bottom panel', () => {
    const step = coachStep(mk({ kind: 'p5_market', doneSeats: [], sealedBuys: [] }), noUi)
    expect(step).toMatchObject({ key: 'p5.market', target: '.bottom-panel' })
  })

  it('P4 conflict: only prompts while it is my move', () => {
    const p4 = (waitingOn: number[]) =>
      mk(
        {
          kind: 'p4_conflict',
          conflicts: [],
          index: 0,
          stage: { t: 'reveal_ack', acked: [] },
          resolution: null
        },
        { waitingOn: waitingOn as PlayerView['waitingOn'] }
      )
    expect(coachStep(p4([0]), noUi)?.key).toBe('p4.conflict')
    expect(coachStep(p4([1]), noUi)).toBeNull()
  })

  it('finished: the coach steps aside for the game-over screen', () => {
    expect(coachStep(mk({ kind: 'finished', winnerSeats: [0], ranking: [] }), noUi)).toBeNull()
  })
})

// The mirror-bot lessons: every draw rule, the re-fight loop and the draw bet.
describe('coachStep — tutorial draw lessons', () => {
  const conflictOf = (actorType: string) => ({
    locationId: 'square',
    actorType,
    actorIds: [`0:${actorType}`, `1:${actorType}`]
  })
  const resolutionOf = (actorType: string, outcome: string, extra: object = {}) => ({
    outcomes: { [`0:${actorType}`]: outcome, [`1:${actorType}`]: outcome },
    betResults: [],
    winBonusActorIds: [],
    active: [],
    round: 1,
    revealedRps: {},
    ...extra
  })
  const p4 = (actorType: string, stage: unknown, resolution: unknown) =>
    mk({ kind: 'p4_conflict', conflicts: [conflictOf(actorType)], index: 0, stage, resolution })

  it('the re-fight gate teaches the politician draw', () => {
    const step = coachStep(
      p4('politician', { t: 'refight_ack', acked: [] }, resolutionOf('politician', 'draw')),
      noUi
    )
    expect(step).toMatchObject({
      key: 'p4.draw.politician',
      bodyKey: 'coach.p4.draw.politician.body'
    })
  })

  it('rps round 1 asks for a fresh throw; round 2+ teaches "draw → another round"', () => {
    const rps = { t: 'rps', chosen: [], myChoice: null }
    expect(coachStep(p4('politician', rps, resolutionOf('politician', 'draw')), noUi)?.key).toBe(
      'p4.rps'
    )
    expect(
      coachStep(p4('politician', rps, resolutionOf('politician', 'draw', { round: 2 })), noUi)?.key
    ).toBe('p4.rps.again')
  })

  it('standing draws get the per-actor lesson cards', () => {
    for (const actorType of ['scientist', 'artist', 'robot']) {
      const step = coachStep(
        p4(actorType, { t: 'result_ack', acked: [] }, resolutionOf(actorType, 'draw')),
        noUi
      )
      expect(step).toMatchObject({
        key: `p4.draw.${actorType}`,
        bodyKey: `coach.p4.draw.${actorType}.body`
      })
    }
  })

  it('a successful draw bet gets its own lesson (outcomes converted, not all-draw)', () => {
    const resolution = {
      outcomes: { '0:artist': 'win', '1:artist': 'lose' },
      betResults: [{ actorId: '0:artist', seat: 0, bet: 'draw', success: true }],
      winBonusActorIds: [],
      active: [],
      round: 1,
      revealedRps: {}
    }
    const step = coachStep(p4('artist', { t: 'result_ack', acked: [] }, resolution), noUi)
    expect(step).toMatchObject({ key: 'p4.bet.draw', bodyKey: 'coach.p4.bet.draw.body' })
  })

  // From turn 2 the bot argues at random, so win/lose are the common endings —
  // each explains what it MEANS (who stays, who produces), not just "continue".
  it('a decided result teaches the win and the loss from my seat', () => {
    const decided = (mine: string, theirs: string) => ({
      outcomes: { '0:politician': mine, '1:politician': theirs },
      betResults: [],
      winBonusActorIds: [],
      active: [],
      round: 2,
      revealedRps: {}
    })
    const at = (res: unknown) =>
      coachStep(p4('politician', { t: 'result_ack', acked: [] }, res), noUi)
    expect(at(decided('win', 'lose'))).toMatchObject({
      key: 'p4.result.win',
      bodyKey: 'coach.p4.result.win.body'
    })
    expect(at(decided('lose', 'win'))).toMatchObject({
      key: 'p4.result.lose',
      bodyKey: 'coach.p4.result.lose.body'
    })
    // Defensive: a conflict without one of my actors keeps the plain banner
    // (the server only waits on the seats involved, so this stays theoretical).
    const notMine = {
      outcomes: { '1:politician': 'win', '2:politician': 'lose' },
      betResults: [],
      winBonusActorIds: [],
      active: [],
      round: 2,
      revealedRps: {}
    }
    expect(at(notMine)?.key).toBe('p4.result')
  })

  it('winning and losing bets get their own lessons', () => {
    const withBet = (bet: string, stage: unknown, outcomes: object) =>
      coachStep(
        p4('robot', stage, {
          outcomes,
          betResults: [{ actorId: '0:robot', seat: 0, bet, success: true }],
          winBonusActorIds: [],
          active: [],
          round: 1,
          revealedRps: {}
        }),
        noUi
      )
    // A win bet pays +1 on top of the reward — taught at the result.
    expect(
      withBet('win', { t: 'result_ack', acked: [] }, { '0:robot': 'win', '1:robot': 'lose' })
    ).toMatchObject({ key: 'p4.bet.win', bodyKey: 'coach.p4.bet.win.body' })
    // A lose bet buys a rematch — so it is taught at the re-fight gate, and it
    // outranks the generic "not settled" card there.
    expect(
      withBet('lose', { t: 'refight_ack', acked: [] }, { '0:robot': 'lose', '1:robot': 'win' })
    ).toMatchObject({ key: 'p4.bet.lose', bodyKey: 'coach.p4.bet.lose.body' })
  })

  it('a re-fight that is neither a politician draw nor my bet gets the plain gate card', () => {
    const step = coachStep(
      p4('robot', { t: 'refight_ack', acked: [] }, resolutionOf('robot', 'draw')),
      noUi
    )
    expect(step).toMatchObject({ key: 'p4.refight', bodyKey: 'coach.p4.refight.body' })
  })

  it('the end-of-phase recap explains what the turn produced', () => {
    const step = coachStep(p4('artist', { t: 'summary_ack', acked: [] }, null), noUi)
    expect(step).toMatchObject({ key: 'p4.summary', bodyKey: 'coach.p4.summary.body' })
  })

  it('P1: the discard brief, the standoff, and the tie-break rounds', () => {
    const p1 = (stage: unknown) => mk({ kind: 'p1_event', card: 'help_poor_countries', stage })
    expect(
      coachStep(p1({ t: 'discard_commit', committedSeats: [], myAmount: null, sealed: [] }), noUi)
    ).toMatchObject({ key: 'p1.discard', bodyKey: 'coach.p1.discard.body' })
    expect(
      coachStep(p1({ t: 'compare_standoff', participants: [0, 1], acked: [] }), noUi)?.key
    ).toBe('p1.standoff')
    const tiebreak = (round: number) => ({
      participants: [0, 1],
      round,
      chosen: [],
      myChoice: null,
      revealed: null
    })
    expect(coachStep(p1({ t: 'compare_tiebreak', tiebreak: tiebreak(1) }), noUi)?.key).toBe(
      'p1.tiebreak'
    )
    expect(
      coachStep(p1({ t: 'discard_tiebreak', revealed: {}, tiebreak: tiebreak(2) }), noUi)?.key
    ).toBe('p1.tiebreak.again')
  })
})

describe('coachStep — the opponent card demo (turn-2 mirror-bot buy)', () => {
  const ceremony = (step: unknown) => mk({ kind: 'p3_action', selectedCounts: null, step })

  it("a rival's card in the ceremony teaches that opponents play cards too", () => {
    const step = coachStep(
      ceremony({
        t: 'blocks_ack',
        blocks: [{ seat: 1, card: 'construction_work', locationId: 'square' }],
        acked: []
      }),
      noUi
    )
    expect(step).toMatchObject({ key: 'p3.opponent', bodyKey: 'coach.p3.opponent.body' })
  })

  it('own-only ceremonies keep the plain results banner', () => {
    const step = coachStep(
      ceremony({
        t: 'relocations_ack',
        moves: [{ seat: 0, actorId: '1:artist', from: 'theatre', to: 'square' }],
        acked: []
      }),
      noUi
    )
    expect(step?.key).toBe('p3.results')
  })
})

// Reading backwards (author feedback: NEXT existed, PREVIOUS did not). `index:
// null` is the live card; a number indexes the cards already shown this game.
describe('coachWalk — the PREVIOUS/NEXT reader', () => {
  const live = (page: number): CoachCursor => ({ index: null, page })

  it('sees a card only where there is body text', () => {
    expect(coachCardPages({ key: 'k', titleKey: 'a' })).toBeNull() // hint-only ⇒ chip
    expect(coachCardPages({ key: 'k', titleKey: 'a', bodyKey: 'b' })).toHaveLength(1)
    expect(
      coachCardPages({ key: 'k', titleKey: 'a', pages: [{ titleKey: '1' }, { titleKey: '2' }] })
    ).toHaveLength(2)
  })

  it('walks the live card’s pages, and NEXT off its last page means "Got it"', () => {
    expect(coachWalk(1, live(0), [], 4)).toEqual(live(1))
    expect(coachWalk(-1, live(2), [], 4)).toEqual(live(1))
    expect(coachWalk(1, live(3), [], 4)).toBeNull() // ⇒ the caller dismisses
  })

  it('PREVIOUS on the first page has nowhere to go until a card has been shown', () => {
    expect(coachWalk(-1, live(0), [], 4)).toBeNull() // no button on the very first card
    // With history, it steps into the previous card at its LAST page (re-read).
    expect(coachWalk(-1, live(0), [4, 2], 1)).toEqual({ index: 1, page: 1 })
  })

  it('re-reading walks back through the history and forward out to the live card', () => {
    const seen = [3, 1] // a 3-page intro, then a 1-page tip
    expect(coachWalk(-1, { index: 1, page: 0 }, seen, 1)).toEqual({ index: 0, page: 2 })
    expect(coachWalk(-1, { index: 0, page: 0 }, seen, 1)).toBeNull() // oldest card, first page
    expect(coachWalk(1, { index: 0, page: 2 }, seen, 1)).toEqual({ index: 1, page: 0 })
    expect(coachWalk(1, { index: 1, page: 0 }, seen, 1)).toEqual(live(0)) // back to live
  })

  // Author feedback: mid-Conflict, PREVIOUS used to walk back into Phase 2's
  // placement tips. The walk-back now sees only the phase the player is in.
  it('reaches back only through the cards shown in this turn and phase', () => {
    const seen = (key: string, turn: number, phase: number): SeenCard => ({
      card: { key, titleKey: `${key}.t`, bodyKey: `${key}.b` },
      turn,
      phase
    })
    const history = [
      seen('p2.pick', 1, 2),
      seen('p2.revealed', 1, 2),
      seen('p4.conflict', 1, 4),
      seen('p4.draw.robot', 1, 4)
    ]
    const at = { turn: 1, phase: 4 }
    // Live card = the tail: it drops out, and Phase 2's cards stay out of reach.
    expect(coachHistoryHere(history, at, 'p4.draw.robot').map((s) => s.card.key)).toEqual([
      'p4.conflict'
    ])
    // Inside a phase the trail is intact: from p2.revealed back to p2.pick.
    expect(
      coachHistoryHere(history, { turn: 1, phase: 2 }, 'p2.revealed').map((s) => s.card.key)
    ).toEqual(['p2.pick'])
    // The first card of a phase has nothing behind it — no PREVIOUS button.
    expect(coachHistoryHere([seen('p4.conflict', 1, 4)], at, 'p4.conflict')).toEqual([])
    // Same phase, later turn: last turn's cards are not this turn's trail.
    expect(coachHistoryHere(history, { turn: 2, phase: 4 }, 'p4.conflict')).toEqual([])
    // Before the recording effect flushes, the live card is not in there yet.
    expect(coachHistoryHere(history, at, 'p4.result.win').map((s) => s.card.key)).toEqual([
      'p4.conflict',
      'p4.draw.robot'
    ])
  })

  it('never dismisses out of a re-read — only the live card can end in "Got it"', () => {
    const seen = [2, 2]
    for (const cursor of [
      { index: 0, page: 0 },
      { index: 0, page: 1 },
      { index: 1, page: 0 },
      { index: 1, page: 1 }
    ])
      expect(coachWalk(1, cursor, seen, 1)).not.toBeNull()
  })
})
