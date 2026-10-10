// The tutorial "mirror bot" (author spec). Turn 1 is the scripted lesson: it
// waits for the player, mirrors their placements (same locations + arguments, no
// bets) so every conflict opens as a draw, repeats the player's first live throw
// (one more draw = the lesson) and then throws to lose. From turn 2 the draws
// have been taught, so it keeps mirroring the LOCATIONS but argues at random —
// and a tie at the end must not add tie-breaker turns to a 3-turn tutorial.
// Throughout: discards 0 on discard events, passive in P3/P5, plus the fixed
// teaching order of the tutorial event deck.

import { describe, expect, it } from 'vitest'
import {
  chooseTutorialBotIntent,
  createGame,
  projectView,
  TUTORIAL_EVENT_ORDER
} from '../src/index.js'
import type { PlacementInput, SeatId } from '../src/index.js'
import { passReveal, TestGame } from './helpers.js'

const rnd = (): number => 0.5
const BOT: SeatId = 1

function newTutorial(): TestGame {
  return new TestGame(createGame({ gameId: 't', mode: 'tutorial', seed: 'tut' }))
}

function applyBot(g: TestGame): boolean {
  const intent = chooseTutorialBotIntent(g.state, BOT, rnd)
  if (!intent) return false
  g.apply(BOT, intent)
  return true
}

/** Pump the bot until it has nothing to do (each apply may open its next cue). */
function pumpBot(g: TestGame): void {
  let guard = 0
  while (applyBot(g)) if (++guard > 50) throw new Error('bot pump ran away')
}

const FULL_COMMIT: PlacementInput[] = [
  { actorType: 'politician', locationId: 'square', argument: 'rock' },
  { actorType: 'scientist', locationId: 'university', argument: 'paper' },
  { actorType: 'artist', locationId: 'theatre', argument: 'scissors' },
  { actorType: 'robot', locationId: 'factory', argument: 'dummy' }
]

/** Drive a whole turn: scripted player defaults + the mirror bot, until `done`. */
function driveUntil(g: TestGame, done: () => boolean): void {
  let guard = 0
  while (!done()) {
    if (++guard > 500) throw new Error(`driver stuck in ${g.state.phase.kind}`)
    if (applyBot(g)) continue
    const ph = g.state.phase
    if (ph.kind === 'p1_event') {
      const st = ph.stage
      if (
        (st.t === 'compare_ack' || st.t === 'compare_standoff' || st.t === 'discard_ack') &&
        !st.acked.includes(0)
      ) {
        g.apply(0, { type: 'event.ack' })
        continue
      }
      if (st.t === 'discard_commit' && st.amounts[0] === undefined) {
        g.apply(0, { type: 'event.discard', amount: 1 })
        continue
      }
      if (
        (st.t === 'compare_tiebreak' || st.t === 'discard_tiebreak') &&
        st.tiebreak.participants.includes(0) &&
        st.tiebreak.choices[0] === undefined
      ) {
        g.apply(0, { type: 'tiebreak.rps', choice: 'rock' })
        continue
      }
    }
    if (ph.kind === 'p2_distribution' && !ph.committed[0]) {
      g.apply(0, { type: 'distribution.commit', placements: FULL_COMMIT })
      continue
    }
    if (ph.kind === 'p2_distribution' && ph.revealed && !ph.revealed.acked.includes(0)) {
      g.apply(0, { type: 'distribution.reveal.ack' })
      continue
    }
    if (ph.kind === 'p3_action' && ph.step.t === 'select' && !ph.step.committed[0]) {
      g.apply(0, { type: 'action.selectCards', cardInstanceIds: [] })
      continue
    }
    if (
      ph.kind === 'p3_action' &&
      (ph.step.t === 'blocks_ack' ||
        ph.step.t === 'relocations_ack' ||
        ph.step.t === 'exchanges_ack') &&
      !ph.step.acked.includes(0)
    ) {
      g.apply(0, { type: 'action.ack' })
      continue
    }
    if (ph.kind === 'p4_conflict') {
      const st = ph.stage
      if (st.t === 'reveal_ack' && !st.acked.includes(0)) {
        g.apply(0, { type: 'conflict.reveal.ack' })
        continue
      }
      if (st.t === 'refight_ack' && !st.acked.includes(0)) {
        g.apply(0, { type: 'conflict.refight.ack' })
        continue
      }
      if (st.t === 'result_ack' && !st.acked.includes(0)) {
        g.apply(0, { type: 'conflict.result.ack' })
        continue
      }
      if (st.t === 'rps' && st.choices[0] === undefined) {
        g.apply(0, { type: 'conflict.rps', choice: 'rock' })
        continue
      }
      // The end-of-phase recap waits on the player too, not just the bot.
      if (st.t === 'summary_ack' && !st.acked.includes(0)) {
        g.apply(0, { type: 'conflict.summary.ack' })
        continue
      }
    }
    if (ph.kind === 'p5_market' && !ph.done.includes(0)) {
      g.apply(0, { type: 'market.done' })
      continue
    }
    throw new Error(`driver has no move in ${ph.kind}`)
  }
}

describe('tutorial mirror bot', () => {
  it('waits for the player, then mirrors locations and arguments without bets', () => {
    const g = newTutorial()
    expect(chooseTutorialBotIntent(g.state, BOT, rnd)).toBeNull() // nothing to mirror yet
    g.apply(0, {
      type: 'distribution.commit',
      placements: [
        { actorType: 'politician', locationId: 'square', argument: 'rock', bet: 'draw' },
        { actorType: 'scientist', locationId: 'university', argument: 'paper' }
      ]
    })
    expect(chooseTutorialBotIntent(g.state, BOT, rnd)).toEqual({
      type: 'distribution.commit',
      placements: [
        { actorType: 'politician', locationId: 'square', argument: 'rock' },
        { actorType: 'scientist', locationId: 'university', argument: 'paper' }
      ]
    })
  })

  it('re-fights: repeats the first throw (draw lesson), then throws to lose', () => {
    const g = newTutorial()
    g.apply(0, {
      type: 'distribution.commit',
      placements: [{ actorType: 'politician', locationId: 'square', argument: 'rock' }]
    })
    // Turn 1 has no P3 (rulebook §Turn Structure): the mirror commit reveals the
    // board, the pump acks the bot's half of that, and the player acks their own.
    pumpBot(g)
    passReveal(g)
    expect(g.state.phase.kind).toBe('p4_conflict')
    g.apply(0, { type: 'conflict.reveal.ack' })
    pumpBot(g) // rock vs rock → draw → politician re-fight gate
    let phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('refight_ack')
    g.apply(0, { type: 'conflict.refight.ack' })
    pumpBot(g)
    phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('rps')

    // Round 1: the bot waits for the player's throw, then repeats it — a draw.
    expect(chooseTutorialBotIntent(g.state, BOT, rnd)).toBeNull()
    g.apply(0, { type: 'conflict.rps', choice: 'rock' })
    expect(chooseTutorialBotIntent(g.state, BOT, rnd)).toEqual({
      type: 'conflict.rps',
      choice: 'rock'
    })
    pumpBot(g) // draw again → refight gate (bot acks its side)
    phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('refight_ack')
    g.apply(0, { type: 'conflict.refight.ack' })
    pumpBot(g)

    // Round 2: the bot deliberately loses (paper is beaten by nothing the
    // player threw — it picks the throw the player's choice BEATS).
    g.apply(0, { type: 'conflict.rps', choice: 'paper' })
    expect(chooseTutorialBotIntent(g.state, BOT, rnd)).toEqual({
      type: 'conflict.rps',
      choice: 'rock'
    })
    pumpBot(g) // player wins the conflict
    phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    expect(phase.stage.t).toBe('result_ack')
    expect(phase.resolution?.outcomes['0:politician']).toBe('win')
    expect(phase.resolution?.outcomes['1:politician']).toBe('lose')
  })

  it("a player's draw bet succeeds against the mirror: draw → win, the bot loses", () => {
    const g = newTutorial()
    g.apply(0, {
      type: 'distribution.commit',
      placements: [{ actorType: 'politician', locationId: 'square', argument: 'rock', bet: 'draw' }]
    })
    pumpBot(g) // mirror commit → board revealed
    passReveal(g) // → straight to P4 (turn 1 has no P3)
    g.apply(0, { type: 'conflict.reveal.ack' })
    pumpBot(g)
    const phase = g.state.phase
    if (phase.kind !== 'p4_conflict') throw new Error('expected p4')
    // The converted draw settles instantly — no re-fight for the bet winner.
    expect(phase.stage.t).toBe('result_ack')
    expect(phase.resolution?.betResults).toEqual([
      { actorId: '0:politician', seat: 0, bet: 'draw', success: true }
    ])
    expect(phase.resolution?.outcomes['0:politician']).toBe('win')
    expect(phase.resolution?.outcomes['1:politician']).toBe('lose')
  })

  // One turn of guaranteed draws teaches the rule; three would just be tedious
  // (author feedback), so from turn 2 the bot argues for itself.
  it('from turn 2 it keeps mirroring the Locations but rolls its own Arguments', () => {
    const g = newTutorial()
    driveUntil(g, () => g.state.turn === 2 && g.state.phase.kind === 'p2_distribution')
    g.apply(0, { type: 'distribution.commit', placements: FULL_COMMIT })

    const intent = chooseTutorialBotIntent(g.state, BOT, rnd)
    if (intent?.type !== 'distribution.commit') throw new Error('expected a commit')
    // Locations still mirrored — that is what guarantees the conflicts happen.
    expect(intent.placements.map((p) => p.locationId)).toEqual(FULL_COMMIT.map((p) => p.locationId))
    expect(intent.placements.map((p) => p.actorType)).toEqual(FULL_COMMIT.map((p) => p.actorType))
    // Arguments are its own, still legal (a seat's must all differ), still no bets.
    const args = intent.placements.map((p) => p.argument)
    expect(new Set(args).size).toBe(args.length)
    expect(args).not.toEqual(FULL_COMMIT.map((p) => p.argument))
    expect(intent.placements.some((p) => p.bet !== undefined)).toBe(false)

    // And they actually vary with the seed — not a second script in disguise.
    const rolls = [0.1, 0.4, 0.9].map((v) => {
      const other = chooseTutorialBotIntent(g.state, BOT, () => v)
      return other?.type === 'distribution.commit'
        ? other.placements.map((p) => p.argument).join()
        : ''
    })
    expect(new Set(rolls).size).toBeGreaterThan(1)
  })

  it('from turn 2 it throws its own RPS instead of waiting to copy the player', () => {
    const g = newTutorial()
    driveUntil(
      g,
      () =>
        g.state.turn === 2 &&
        g.state.phase.kind === 'p1_event' &&
        g.state.phase.stage.t === 'discard_commit'
    )
    // Both discard 0 → a tie the players resolve themselves.
    pumpBot(g)
    g.apply(0, { type: 'event.discard', amount: 0 })
    const phase = g.state.phase
    if (phase.kind !== 'p1_event' || phase.stage.t !== 'discard_tiebreak')
      throw new Error(`expected the discard tie-break, got ${phase.kind}`)
    expect(phase.stage.tiebreak.choices[0]).toBeUndefined() // the player has not thrown
    // Turn 1 would return null here (it mirrors the player's throw); now it moves.
    expect(chooseTutorialBotIntent(g.state, BOT, rnd)).toMatchObject({ type: 'tiebreak.rps' })
  })

  it('deck order is the teaching sequence; the bot discards 0 so the player wins', () => {
    const g = newTutorial()
    expect(g.state.eventDeck).toEqual(TUTORIAL_EVENT_ORDER)

    driveUntil(g, () => g.state.phase.kind === 'p1_event')
    let phase = g.state.phase
    if (phase.kind !== 'p1_event') throw new Error('expected p1')
    expect(phase.card).toBe('help_poor_countries') // turn 2: the discard lesson
    expect(g.state.turn).toBe(2)
    // Turn-1 draws confirmed on the way: mirrored scientists shared Knowledge.
    expect(g.state.values[0]?.knowledge).toBe(1)
    expect(g.state.values[1]?.knowledge).toBe(1)
    // The politician re-fight ended with the player's win (bot lost round 2).
    expect(g.state.values[0]?.power).toBe(1)
    expect(g.state.values[1]?.power).toBe(0)

    expect(chooseTutorialBotIntent(g.state, BOT, rnd)).toEqual({
      type: 'event.discard',
      amount: 0
    })
    g.apply(0, { type: 'event.discard', amount: 1 })
    pumpBot(g) // bot discards 0 → reveal
    phase = g.state.phase
    if (phase.kind !== 'p1_event' || phase.stage.t !== 'discard_ack')
      throw new Error('expected the discard reveal')
    expect(phase.stage.winner).toBe(0)
  })
})

describe('three-turn tutorial with the card demo', () => {
  it('runs exactly 3 turns; the bot buys one card on turn 1 and plays it', () => {
    const g = newTutorial()
    expect(projectView(g.state, 0).maxTurns).toBe(3)

    driveUntil(g, () => g.state.phase.kind === 'finished')
    expect(g.state.turn).toBe(3)
    const phase = g.state.phase
    if (phase.kind !== 'finished') throw new Error('expected finished')
    expect(phase.ranking.length).toBeGreaterThan(0)

    // The one exception to passivity: exactly one demo card, played by the bot.
    const botPlays = (g.state.played ?? []).filter((p) => p.seat === 1)
    expect(botPlays).toHaveLength(1)
    // And it was spent: the bought card is gone from the bot's hand.
    expect(g.state.inventories[1]?.hand ?? []).toHaveLength(0)
  })

  // Three short turns rarely make a Victory Point at all, and the bot's random
  // arguments make an equal score common — a real game would add tie-breaker
  // turns here, which would break the "Turn n/3" the tutorial HUD promises.
  it('ends at turn 3 even on a tie, with the tied sides sharing the win', () => {
    const g = newTutorial()
    driveUntil(g, () => g.state.phase.kind === 'finished')
    const phase = g.state.phase
    if (phase.kind !== 'finished') throw new Error('expected finished')
    expect(g.state.turn).toBeLessThanOrEqual(3)
    expect(g.state.isTieBreakerTurn).toBe(false)
    // Every side on the top score is a winner; each still gets its own row.
    const top = Math.max(...phase.ranking.map((r) => r.vp))
    expect([...phase.winnerSeats].sort()).toEqual(
      phase.ranking
        .filter((r) => r.vp === top)
        .flatMap((r) => r.seats)
        .sort()
    )
    expect(phase.ranking).toHaveLength(2)
  })

  it('non-tutorial games keep the 5-turn budget', () => {
    const plain = createGame({ gameId: 'g', mode: '1v1', seed: 's' })
    expect(plain.meta.maxTurns).toBeUndefined()
    expect(projectView(plain, 0).maxTurns).toBe(5)
  })
})
