import { describe, expect, it } from 'vitest'
import { legalIntents, projectView, valuesOf, waitingOn } from '../src/index.js'
import {
  ackActionResults,
  compareEventCount,
  customPlacements,
  findSeed,
  newGame,
  passReveal,
  passSummary,
  peacefulPlacements,
  playPeacefulTurn,
  playThroughP1,
  resolveAll,
  selectNoCards,
  TestGame
} from './helpers.js'

describe('P2 distribution: sealed commit semantics (spec §6)', () => {
  it('keeps placements sealed until the last seat commits, then reveals without arguments', () => {
    const g = newGame()
    const events0 = g.apply(0, { type: 'distribution.commit', placements: peacefulPlacements(0) })
    passReveal(g)

    expect(events0.map((e) => e.type)).toEqual(['distribution.committed', 'distribution.staged'])
    expect(events0[0]?.visibility).toBe('public')
    expect(events0[1]?.visibility).toEqual([0]) // sealed content: committer only (no ally in 1v1)
    expect(g.state.board.placements).toHaveLength(0) // nothing on the board yet

    const opponentView = projectView(g.state, 1)
    expect(opponentView.phase.kind).toBe('p2_distribution')
    if (opponentView.phase.kind === 'p2_distribution') {
      expect(opponentView.phase.committedSeats).toEqual([0])
      expect(opponentView.phase.sealed).toEqual([]) // opponent sees the fact, not the content
    }
    expect(opponentView.waitingOn).toEqual([1])

    const ownView = projectView(g.state, 0)
    if (ownView.phase.kind === 'p2_distribution') {
      expect(ownView.phase.sealed).toHaveLength(1)
      expect(ownView.phase.sealed[0]?.placements).toHaveLength(4)
    }

    const events1 = g.apply(1, { type: 'distribution.commit', placements: peacefulPlacements(1) })
    passReveal(g)
    const revealed = events1.find((e) => e.type === 'distribution.revealed')
    expect(revealed).toBeDefined()
    expect(revealed?.visibility).toBe('public')
    const payload = revealed?.payload as { placements: Record<string, unknown>[] }
    expect(payload.placements).toHaveLength(8)
    for (const p of payload.placements) {
      expect(p).not.toHaveProperty('argument')
      expect(p).not.toHaveProperty('bet')
    }
    // Turn 1 has no P3 (rulebook §Turn Structure): the reveal hands straight to P4,
    // which a peaceful board resolves with no input — the turn lands in the Market.
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
  })

  it('accepts partial commits: staged actors stand, the rest sit out', () => {
    const g = newGame()
    const base = peacefulPlacements(0)
    g.apply(0, { type: 'distribution.commit', placements: base.slice(0, 2) })
    const events = g.apply(1, { type: 'distribution.commit', placements: peacefulPlacements(1) })
    passReveal(g)
    // Read the reveal, not the board: turn 1 runs P4 inside this same intent and
    // P4 sends the actors home on its way out.
    const revealed = events.find((e) => e.type === 'distribution.revealed')
    const placements = (revealed?.payload as { placements: { seat: number }[] }).placements
    // 2 of seat 0's actors + all 4 of seat 1's
    expect(placements.filter((p) => p.seat === 0)).toHaveLength(2)
    expect(placements.filter((p) => p.seat === 1)).toHaveLength(4)
  })

  it('rejects malformed commits', () => {
    const g = newGame()
    const base = peacefulPlacements(0)

    g.expectReject(
      0,
      { type: 'distribution.commit', placements: [...base, base[0]] as typeof base },
      'invalid_payload'
    )
    g.expectReject(
      0,
      {
        type: 'distribution.commit',
        placements: [base[0], base[0], base[2], base[3]] as typeof base
      },
      'invalid_payload'
    )
    const dupArgs = base.map((p) => ({ ...p, argument: 'rock' as const }))
    g.expectReject(0, { type: 'distribution.commit', placements: dupArgs }, 'invalid_payload')
    const badLocation = base.map((p) =>
      p.actorType === 'robot' ? { ...p, locationId: 'square' as const } : p
    )
    g.expectReject(0, { type: 'distribution.commit', placements: badLocation }, 'invalid_location')

    g.apply(0, { type: 'distribution.commit', placements: base })
    passReveal(g)
    g.expectReject(0, { type: 'distribution.commit', placements: base }, 'already_committed')
  })

  it('deducts bet resources at commit; they are never returned (rulebook)', () => {
    const g = newGame()
    const placements = peacefulPlacements(0).map((p) =>
      p.actorType === 'politician'
        ? { ...p, bet: 'win' as const }
        : p.actorType === 'artist'
          ? { ...p, bet: 'lose' as const }
          : p
    )
    g.apply(0, { type: 'distribution.commit', placements })
    passReveal(g)
    const resources = g.state.inventories[0]?.resources
    expect(resources).toEqual({ product: 0, electricity: 0, recycling: 1 })
  })

  it('rejects unaffordable bets (two win bets on one starting product)', () => {
    const g = newGame()
    const placements = peacefulPlacements(0).map((p) =>
      p.actorType === 'politician' || p.actorType === 'scientist'
        ? { ...p, bet: 'win' as const }
        : p
    )
    g.expectReject(0, { type: 'distribution.commit', placements }, 'insufficient_resources')
  })
})

describe('turn 1 full flow: P2 → P4 (peaceful) → P5 → turn 2 (spec §3)', () => {
  it('grants peaceful rewards, advances the turn and opens P1', () => {
    const g = newGame()
    g.apply(0, { type: 'distribution.commit', placements: peacefulPlacements(0) })
    // The last commit only reveals the board now — the turn holds there until
    // everyone has looked (author request), so Phase 4 opens on the ack, not here.
    const revealEvents = g.apply(1, {
      type: 'distribution.commit',
      placements: peacefulPlacements(1)
    })
    expect(revealEvents.some((e) => e.type === 'distribution.revealed')).toBe(true)
    expect(revealEvents.some((e) => e.type === 'conflict.detected')).toBe(false)

    g.apply(0, { type: 'distribution.reveal.ack' })
    const p2Events = g.apply(1, { type: 'distribution.reveal.ack' })

    // Empty conflict list and 8 peaceful rewards, with no P3 in between: turn 1
    // skips it (rulebook §Turn Structure).
    expect(p2Events.some((e) => e.type === 'action.selectionsRevealed')).toBe(false)
    const detected = p2Events.find((e) => e.type === 'conflict.detected')
    expect((detected?.payload as { conflicts: unknown[] }).conflicts).toEqual([])
    expect(p2Events.filter((e) => e.type === 'conflict.rewards')).toHaveLength(8)

    expect(valuesOf(g.state, 0)).toEqual({ power: 1, art: 1, knowledge: 1, fame: 0 })
    expect(valuesOf(g.state, 1)).toEqual({ power: 1, art: 1, knowledge: 1, fame: 0 })
    expect(g.state.inventories[0]?.resources.product).toBe(4) // robot @ factory: +3
    expect(g.state.inventories[1]?.resources.electricity).toBe(4) // robot @ power plant: +3

    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
    g.apply(0, { type: 'market.done' })
    const advance = g.apply(1, { type: 'market.done' })
    expect(advance.some((e) => e.type === 'turn.advanced')).toBe(true)
    expect(advance.some((e) => e.type === 'event.drawn')).toBe(true)
    expect(g.state.turn).toBe(2)
    expect(g.state.phase.kind).toBe('p1_event')
  })

  it('peaceful win bet pays +1 of the same unit; peaceful lose bet burns silently', () => {
    const g = newGame()
    const placements0 = peacefulPlacements(0).map((p) =>
      p.actorType === 'politician'
        ? { ...p, bet: 'win' as const }
        : p.actorType === 'scientist'
          ? { ...p, bet: 'lose' as const }
          : p
    )
    g.apply(0, { type: 'distribution.commit', placements: placements0 })
    g.apply(1, { type: 'distribution.commit', placements: peacefulPlacements(1) })
    passReveal(g)

    // win bet on peaceful politician: 1 base + 1 bonus; lose bet on scientist: no effect
    expect(valuesOf(g.state, 0)).toEqual({ power: 2, art: 1, knowledge: 1, fame: 0 })
    expect(g.state.inventories[0]?.resources.electricity).toBe(0) // lose-bet cost burned
  })
})

describe('turn 1 skips P3 (rulebook §Turn Structure)', () => {
  // Nobody can hold an Action Card on turn 1, so P3 would only ask everyone to
  // press "Play No Cards": P2 hands straight to P4. From turn 2 on, P3 is back.
  it('turn 1 goes P2 → P4; turn 2 goes P2 → P3 → P4', () => {
    const g = newGame()
    const clash = (seat: 0 | 1) =>
      customPlacements(seat, { politician: { locationId: 'square', argument: 'rock' } })

    // --- turn 1: the last commit opens the conflicts itself ---
    g.apply(0, { type: 'distribution.commit', placements: clash(0) })
    const events = g.apply(1, { type: 'distribution.commit', placements: clash(1) })
    passReveal(g)
    expect(events.some((e) => e.type === 'distribution.revealed')).toBe(true)
    expect(events.some((e) => e.type === 'action.selectionsRevealed')).toBe(false)
    expect(g.state.phase.kind).toBe('p4_conflict')
    // No affordance for the skipped phase, and the intent itself is out of phase.
    expect(legalIntents(g.state, 0)).toEqual([{ type: 'conflict.reveal.ack' }])
    g.expectReject(0, { type: 'action.selectCards', cardInstanceIds: [] }, 'wrong_phase')

    resolveAll(g)
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')
    for (const seat of [0, 1] as const) g.apply(seat, { type: 'market.done' })

    // --- turn 2: P3 is back, between the same P2 and P4 ---
    expect(g.state.turn).toBe(2)
    playThroughP1(g)
    for (const seat of [0, 1] as const)
      g.apply(seat, { type: 'distribution.commit', placements: clash(seat) })
    passReveal(g)
    const p3 = g.state.phase
    if (p3.kind !== 'p3_action') throw new Error(`expected p3_action, got ${p3.kind}`)
    expect(p3.step.t).toBe('select')
    selectNoCards(g)
    expect(g.state.phase.kind).toBe('p4_conflict')
  })
})

describe('P1 events (spec §5)', () => {
  it('compare event with equal values goes to a tie-break; winner takes fame after acks', () => {
    const seed = findSeed((s) => compareEventCount(s, 1) === 1)
    const g = new TestGame(newGame(seed).state)
    playPeacefulTurn(g) // turn 1; values now symmetric
    expect(g.state.phase.kind).toBe('p1_event')
    const phase = g.state.phase
    if (phase.kind !== 'p1_event') return
    // Both sides equal → the standoff announces the tie first (user rule):
    // everyone confirms "Resolve the Conflict" before the tie-break arena.
    expect(phase.stage.t).toBe('compare_standoff')
    if (phase.stage.t === 'compare_standoff') expect(phase.stage.participants).toEqual([0, 1])
    expect(legalIntents(g.state, 0)).toEqual([{ type: 'event.ack' }])
    g.apply(0, { type: 'event.ack' })
    const oneAck = g.state.phase
    if (oneAck.kind !== 'p1_event') throw new Error('expected P1')
    expect(oneAck.stage.t).toBe('compare_standoff') // one confirm is not enough
    g.apply(1, { type: 'event.ack' })
    const bothAcked = g.state.phase
    if (bothAcked.kind !== 'p1_event') throw new Error('expected P1')
    expect(bothAcked.stage.t).toBe('compare_tiebreak')

    expect(legalIntents(g.state, 0)).toEqual([
      { type: 'tiebreak.rps', choices: ['rock', 'paper', 'scissors'] }
    ])
    g.apply(0, { type: 'tiebreak.rps', choice: 'rock' })
    // choices sealed: opponent sees who chose, not what
    const view1 = projectView(g.state, 1)
    if (view1.phase.kind === 'p1_event' && view1.phase.stage.t === 'compare_tiebreak') {
      expect(view1.phase.stage.tiebreak.chosen).toEqual([0])
      expect(view1.phase.stage.tiebreak.myChoice).toBeNull()
    }
    const resolved = g.apply(1, { type: 'tiebreak.rps', choice: 'scissors' })
    expect(resolved.some((e) => e.type === 'tiebreak.choicesRevealed')).toBe(true)
    expect(resolved.some((e) => e.type === 'tiebreak.resolved')).toBe(true)

    // The final throws ride into the ack stage so participants see the
    // reveal, not just the outcome (they were already public as events).
    const ackView = projectView(g.state, 1)
    if (ackView.phase.kind === 'p1_event' && ackView.phase.stage.t === 'compare_ack') {
      expect(ackView.phase.stage.tiebreakChoices).toEqual({ 0: 'rock', 1: 'scissors' })
    } else {
      throw new Error('expected compare_ack after the tie-break')
    }

    // fame lands only after both acks (spec §5)
    expect(valuesOf(g.state, 0).fame).toBe(0)
    g.apply(0, { type: 'event.ack' })
    const finished = g.apply(1, { type: 'event.ack' })
    expect(finished.some((e) => e.type === 'event.resolved')).toBe(true)
    expect(valuesOf(g.state, 0).fame).toBe(1)
    expect(g.state.phase.kind).toBe('p2_distribution')
  })

  it('a 3-player compare standoff waits only on the tied pair, not the leader', () => {
    // Regression: two players tied at the minimum, a third leading. The tied pair
    // clicking "Resolve the Conflict" must open the tie-break — the leader is a
    // spectator and must not stall it until the ack deadline fires.
    const g = newGame('ffa3-standoff', 'ffa3')
    g.state.turn = 5
    g.state.phase = {
      kind: 'p1_event',
      card: 'political_repression',
      stage: { t: 'compare_standoff', participants: [0, 1], acked: [] }
    }

    // The leader (seat 2) is not on the hook; only the tied pair is.
    expect(waitingOn(g.state)).toEqual([0, 1])
    expect(projectView(g.state, 2).waitingOn).toEqual([0, 1])

    g.apply(0, { type: 'event.ack' })
    expect(g.state.phase.kind === 'p1_event' && g.state.phase.stage.t).toBe('compare_standoff')
    g.apply(1, { type: 'event.ack' })
    // Both tied players confirmed → tie-break opens without waiting on seat 2.
    expect(g.state.phase.kind === 'p1_event' && g.state.phase.stage.t).toBe('compare_tiebreak')
  })

  it('tied rps choices replay the round', () => {
    const seed = findSeed((s) => compareEventCount(s, 1) === 1)
    const g = new TestGame(newGame(seed).state)
    playPeacefulTurn(g)
    g.apply(0, { type: 'event.ack' }) // standoff → tie-break
    g.apply(1, { type: 'event.ack' })
    g.apply(0, { type: 'tiebreak.rps', choice: 'rock' })
    const events = g.apply(1, { type: 'tiebreak.rps', choice: 'rock' })
    expect(events.some((e) => e.type === 'tiebreak.roundStarted')).toBe(true)
    const phase = g.state.phase
    if (phase.kind === 'p1_event' && phase.stage.t === 'compare_tiebreak') {
      expect(phase.stage.tiebreak.round).toBe(2)
      expect(phase.stage.tiebreak.participants).toEqual([0, 1])
    } else {
      throw new Error('expected the tie-break to continue')
    }
    // The settled round's throws surface in the view for the next round.
    const view0 = projectView(g.state, 0)
    if (view0.phase.kind === 'p1_event' && view0.phase.stage.t === 'compare_tiebreak') {
      expect(view0.phase.stage.tiebreak.revealed).toEqual({
        round: 1,
        choices: { 0: 'rock', 1: 'rock' }
      })
    }
  })

  it('discard event: sealed amounts, reveal deducts resources, unique max wins a card', () => {
    const seed = findSeed((s) => compareEventCount(s, 1) === 0)
    const g = new TestGame(newGame(seed).state)
    playPeacefulTurn(g)
    const phase = g.state.phase
    if (phase.kind !== 'p1_event') throw new Error('expected P1')
    expect(phase.stage.t).toBe('discard_commit')

    const spec = legalIntents(g.state, 0)[0]
    expect(spec?.type).toBe('event.discard')
    const resource = spec && spec.type === 'event.discard' ? spec.resource : 'product'
    const before0 = g.state.inventories[0]?.resources[resource] ?? 0
    expect(spec && spec.type === 'event.discard' ? spec.max : -1).toBe(before0)

    g.apply(0, { type: 'event.discard', amount: 1 })
    expect(g.state.inventories[0]?.resources[resource]).toBe(before0) // not deducted yet
    const reveal = g.apply(1, { type: 'event.discard', amount: 0 })
    expect(reveal.some((e) => e.type === 'event.discardsRevealed')).toBe(true)
    expect(g.state.inventories[0]?.resources[resource]).toBe(before0 - 1)

    const awarded = reveal.find((e) => e.type === 'event.cardAwarded')
    expect(awarded?.visibility).toEqual([0])
    expect(g.state.inventories[0]?.hand).toHaveLength(1)
    expect(g.state.actionDeck).toHaveLength(14)

    // The ack stage carries the revealed amounts so clients can show who discarded what.
    const acked = g.state.phase
    if (acked.kind !== 'p1_event' || acked.stage.t !== 'discard_ack')
      throw new Error('expected discard_ack')
    expect(acked.stage.revealed).toEqual({ 0: 1, 1: 0 })
    // Resolved events land in the public play log (global stats).
    expect(g.state.eventsPlayed).toEqual([{ card: acked.card, turn: g.state.turn }])

    g.apply(0, { type: 'event.ack' })
    g.apply(1, { type: 'event.ack' })
    expect(g.state.phase.kind).toBe('p2_distribution')
  })

  it('all-zero discards: everyone qualifies, tie-break decides the card (rulebook)', () => {
    const seed = findSeed((s) => compareEventCount(s, 1) === 0)
    const g = new TestGame(newGame(seed).state)
    playPeacefulTurn(g)
    g.apply(0, { type: 'event.discard', amount: 0 })
    g.apply(1, { type: 'event.discard', amount: 0 })
    const phase = g.state.phase
    if (phase.kind !== 'p1_event') throw new Error('expected P1')
    expect(phase.stage.t).toBe('discard_tiebreak')
    g.apply(0, { type: 'tiebreak.rps', choice: 'paper' })
    g.apply(1, { type: 'tiebreak.rps', choice: 'rock' })
    // seat 0 wins the tie → counts as having discarded the most → takes the card
    expect(g.state.inventories[0]?.hand).toHaveLength(1)
    expect(g.state.inventories[1]?.hand).toHaveLength(0)
    // Revealed amounts survive the tie-break into the ack stage.
    const acked = g.state.phase
    if (acked.kind !== 'p1_event' || acked.stage.t !== 'discard_ack')
      throw new Error('expected discard_ack')
    expect(acked.stage.revealed).toEqual({ 0: 0, 1: 0 })
  })
})

describe('P3 block cards (spec §7 step 1)', () => {
  it('a selected block card disables its mapped location: no production there', () => {
    // Get a block card into seat 0's hand deterministically: first event is a discard
    // event and the first action card is a factory block (sabotage).
    const seed = findSeed((s) => compareEventCount(s, 1) === 0 && s.actionDeck[0] === 'sabotage')
    const g = new TestGame(newGame(seed).state)
    playPeacefulTurn(g) // turn 1
    g.apply(0, { type: 'event.discard', amount: 1 })
    g.apply(1, { type: 'event.discard', amount: 0 })
    g.apply(0, { type: 'event.ack' })
    g.apply(1, { type: 'event.ack' })

    const hand = g.state.inventories[0]?.hand ?? []
    expect(hand[0]?.card).toBe('sabotage')
    const instanceId = hand[0]?.instanceId as string

    g.apply(0, { type: 'distribution.commit', placements: peacefulPlacements(0) })
    g.apply(1, { type: 'distribution.commit', placements: peacefulPlacements(1) })
    passReveal(g)
    const before = g.state.inventories[0]?.resources.product ?? 0

    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [instanceId] })
    const events = g.apply(1, { type: 'action.selectCards', cardInstanceIds: [] })

    const blocked = events.find((e) => e.type === 'action.locationBlocked')
    expect((blocked?.payload as { locationId: string }).locationId).toBe('factory')
    // Block wave results screen: everyone acks what just got shut down.
    const ackPhase = g.state.phase
    if (ackPhase.kind !== 'p3_action' || ackPhase.step.t !== 'blocks_ack')
      throw new Error('expected blocks_ack')
    expect(ackPhase.step.blocks).toEqual([{ seat: 0, card: 'sabotage', locationId: 'factory' }])
    ackActionResults(g)
    // seat 0's own robot stood at the factory: no production even for peaceful actors
    expect(g.state.inventories[0]?.resources.product).toBe(before)
    expect(g.state.inventories[0]?.hand).toHaveLength(0) // card consumed
    expect(g.state.played).toEqual([{ seat: 0, card: 'sabotage', turn: g.state.turn }])
    // other seven actors still produced
    expect(valuesOf(g.state, 0).power).toBe(2) // turn 1 + turn 2
  })
})

describe('timeouts (server-injected defaults)', () => {
  it('P2 timeout places nothing — unplaced actors sit the turn out (user rule)', () => {
    const g = newGame()
    const events = g.apply(0, { type: 'system.timeout', seat: 0 })
    expect(events.some((e) => e.type === 'distribution.committed')).toBe(true)
    const phase = g.state.phase
    if (phase.kind !== 'p2_distribution') throw new Error('still P2')
    expect(phase.committed[0]).toHaveLength(0) // never a random spread

    // The other seat plays normally: only ITS actors reach the board. Read the
    // reveal — turn 1 runs P4 in this same intent and it clears the board after.
    const events1 = g.apply(1, { type: 'distribution.commit', placements: peacefulPlacements(1) })
    passReveal(g)
    const revealed = events1.find((e) => e.type === 'distribution.revealed')
    const placements = (revealed?.payload as { placements: { seat: number }[] }).placements
    expect(placements).toHaveLength(4)
    expect(placements.every((p) => p.seat === 1)).toBe(true)
  })

  it('tie-break deadline: the chooser wins, the misser auto-loses (user rule); market timeout finishes shopping', () => {
    const seed = findSeed((s) => compareEventCount(s, 1) === 1)
    const g = new TestGame(newGame(seed).state)
    playPeacefulTurn(g)
    // Two timeouts confirm the standoff → the tie-break opens.
    g.apply(0, { type: 'system.timeout', seat: 0 })
    g.apply(1, { type: 'system.timeout', seat: 1 })
    g.apply(0, { type: 'tiebreak.rps', choice: 'rock' })
    const events = g.apply(1, { type: 'system.timeout', seat: 1 }) // missed → auto-lose
    expect(events.some((e) => e.type === 'tiebreak.choiceMissed')).toBe(true)
    expect(events.some((e) => e.type === 'tiebreak.resolved')).toBe(true)
    const phase = g.state.phase
    if (phase.kind !== 'p1_event' || phase.stage.t !== 'compare_ack')
      throw new Error('expected compare_ack after the walkover')
    expect(phase.stage.winner).toEqual({ kind: 'seat', seat: 0 })
    g.apply(0, { type: 'event.ack' })
    g.apply(1, { type: 'event.ack' })
    expect(valuesOf(g.state, 0).fame).toBe(1)
    expect(valuesOf(g.state, 1).fame).toBe(0)

    const g2 = newGame()
    g2.apply(0, { type: 'distribution.commit', placements: peacefulPlacements(0) })
    g2.apply(1, { type: 'distribution.commit', placements: peacefulPlacements(1) })
    passReveal(g2)
    g2.apply(0, { type: 'system.timeout', seat: 0 })
    g2.apply(1, { type: 'system.timeout', seat: 1 })
    // Phase 4 now ends with its recap, so the market timeout is not the last
    // gate any more — the recap has a deadline of its own to run out.
    g2.apply(0, { type: 'system.timeout', seat: 0 })
    g2.apply(1, { type: 'system.timeout', seat: 1 })
    expect(g2.state.turn).toBe(2)
  })

  it('everyone misses the tie-break deadline → all lose, nobody takes the reward (user rule)', () => {
    const seed = findSeed((s) => compareEventCount(s, 1) === 1)
    const g = new TestGame(newGame(seed).state)
    playPeacefulTurn(g)
    g.apply(0, { type: 'system.timeout', seat: 0 }) // standoff acks
    g.apply(1, { type: 'system.timeout', seat: 1 })
    g.apply(0, { type: 'system.timeout', seat: 0 }) // both miss the throw
    // A missed seat leaves waitingOn — the room's deadline loop walks this
    // list and must move on to the next seat, never re-timeout the misser.
    expect(waitingOn(g.state)).toEqual([1])
    g.apply(1, { type: 'system.timeout', seat: 1 })
    const phase = g.state.phase
    if (phase.kind !== 'p1_event' || phase.stage.t !== 'compare_ack')
      throw new Error('expected compare_ack after the double miss')
    expect(phase.stage.winner).toBeNull()
    g.apply(0, { type: 'event.ack' })
    g.apply(1, { type: 'event.ack' })
    expect(valuesOf(g.state, 0).fame).toBe(0)
    expect(valuesOf(g.state, 1).fame).toBe(0)
    expect(g.state.phase.kind).toBe('p2_distribution')
  })

  it('timeout with nothing pending is rejected', () => {
    const g = newGame()
    g.apply(0, { type: 'distribution.commit', placements: peacefulPlacements(0) })
    passReveal(g)
    g.expectReject(0, { type: 'system.timeout', seat: 0 }, 'nothing_pending')
  })
})

describe('P5 market (spec §9)', () => {
  it('sealed buys apply on full consensus in seat order', () => {
    const g = newGame()
    playPeacefulTurn(g) // ends turn 1; seat 0 now has product 4, electricity 1, recycling 1
    playThroughP1(g)
    g.apply(0, { type: 'distribution.commit', placements: peacefulPlacements(0) })
    g.apply(1, { type: 'distribution.commit', placements: peacefulPlacements(1) })
    passReveal(g)
    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [] })
    g.apply(1, { type: 'action.selectCards', cardInstanceIds: [] })
    passSummary(g)
    expect(g.state.phase.kind).toBe('p5_market')

    const deckBefore = g.state.actionDeck.length
    const handBefore = g.state.inventories[0]?.hand.length ?? 0
    const buyEvents = g.apply(0, { type: 'market.buy' })
    expect(buyEvents[0]?.type).toBe('market.buyStaged')
    expect(buyEvents[0]?.visibility).toEqual([0]) // sealed until consensus
    expect(g.state.actionDeck).toHaveLength(deckBefore) // nothing drawn yet
    expect(g.state.inventories[0]?.resources.recycling).toBe(1) // not deducted yet

    g.apply(0, { type: 'market.done' })
    const applied = g.apply(1, { type: 'market.done' })
    const bought = applied.find((e) => e.type === 'market.bought')
    expect(bought?.visibility).toBe('public')
    expect(bought?.payload).toEqual({ seat: 0, requested: 1, bought: 1 })
    const cardDrawn = applied.find((e) => e.type === 'market.cardDrawn')
    expect(cardDrawn?.visibility).toEqual([0])
    expect(g.state.inventories[0]?.hand).toHaveLength(handBefore + 1)
    expect(g.state.inventories[0]?.resources.recycling).toBe(0)
    expect(g.state.actionDeck).toHaveLength(deckBefore - 1)
    expect(g.state.turn).toBe(3)
  })

  it('rejects buys beyond the affordable count', () => {
    const g = newGame()
    playPeacefulTurn(g)
    playThroughP1(g)
    g.apply(0, { type: 'distribution.commit', placements: peacefulPlacements(0) })
    g.apply(1, { type: 'distribution.commit', placements: peacefulPlacements(1) })
    passReveal(g)
    g.apply(0, { type: 'action.selectCards', cardInstanceIds: [] })
    g.apply(1, { type: 'action.selectCards', cardInstanceIds: [] })
    passSummary(g) // Phase 4 stops for its recap even with nothing contested
    g.apply(0, { type: 'market.buy' }) // affordable: min(4+, 1, 1) = 1
    g.expectReject(0, { type: 'market.buy' }, 'insufficient_resources')
  })
})

describe('elimination (spec §12)', () => {
  it('forfeit in 1v1 ends the game immediately in favor of the other side', () => {
    const g = newGame()
    g.apply(0, { type: 'distribution.commit', placements: peacefulPlacements(0) })
    passReveal(g)
    const events = g.apply(1, { type: 'system.eliminate', seat: 1, reason: 'forfeit' })
    expect(events.some((e) => e.type === 'player.eliminated')).toBe(true)
    expect(events.some((e) => e.type === 'game.finished')).toBe(true)
    const phase = g.state.phase
    if (phase.kind !== 'finished') throw new Error('expected finished')
    expect(phase.winnerSeats).toEqual([0])
    expect(g.state.eliminated).toEqual([1])
    expect(g.state.inventories[1]?.resources).toEqual({ product: 0, electricity: 0, recycling: 0 })
  })

  it('an eliminated seat cannot act; intents on a finished game are rejected', () => {
    const g = newGame()
    g.apply(1, { type: 'system.eliminate', seat: 1, reason: 'disconnect' })
    passReveal(g)
    g.expectReject(
      0,
      { type: 'distribution.commit', placements: peacefulPlacements(0) },
      'game_finished'
    )
  })
})

describe('full game: 5 turns, scoring, winner (spec §3, §10)', () => {
  it('a value lead from fame decides the game at turn 5 without P5', () => {
    // Seat 0 wins every event tie-break. The three non-revolution compare events tie
    // (symmetric values) → 3 fame to seat 0 → a full extra VP set. Revolution compares
    // totals and could instead reward seat 1 once seat 0 holds fame, so require all
    // three "safe" compares within turns 2–5.
    const safeCompares = ['political_repression', 'educational_crisis', 'cultural_decline']
    const seed = findSeed((s) => {
      const first4 = s.eventDeck.slice(0, 4) as string[]
      return safeCompares.every((c) => first4.includes(c))
    })
    const g = new TestGame(newGame(seed).state)
    for (let turn = 1; turn <= 4; turn++) playPeacefulTurn(g)
    expect(g.state.turn).toBe(5)
    playPeacefulTurn(g) // turn 5: no P5 — scoring fires inside the last P3 intent

    const phase = g.state.phase
    if (phase.kind !== 'finished') throw new Error(`expected finished, got ${phase.kind}`)
    expect(phase.winnerSeats).toEqual([0])
    expect(phase.ranking[0]?.seats).toEqual([0])
    expect(phase.ranking[0]?.vp).toBeGreaterThanOrEqual(6)
    expect(phase.ranking[1]?.vp).toBe(5)
    expect(g.eventsOfType('scoring.result')).toHaveLength(1)
    expect(g.eventsOfType('game.finished')).toHaveLength(1)
    expect(g.state.turn).toBe(5)
    expect(g.state.isTieBreakerTurn).toBe(false)
  })

  it('a VP tie at turn 5 runs P5 and an extra tie-breaker turn', () => {
    // ≤2 compare events in turns 2–5 → seat 0 has ≤2 fame → VP still 5:5 → tie.
    const seed = findSeed((s) => compareEventCount(s, 4) <= 2)
    const g = new TestGame(newGame(seed).state)
    for (let turn = 1; turn <= 4; turn++) playPeacefulTurn(g)
    playPeacefulTurn(g) // turn 5 — tie → P5 runs, then the tie-breaker turn opens

    expect(g.eventsOfType('scoring.result')).toHaveLength(1)
    const scoring = g.eventsOfType('scoring.result')[0]?.payload as {
      sides: { seats: number[]; vp: number }[]
    }
    expect(scoring.sides.every((s) => s.vp === scoring.sides[0]?.vp)).toBe(true)

    expect(g.state.turn).toBe(6)
    expect(g.state.isTieBreakerTurn).toBe(true)
    expect(g.state.eliminated).toEqual([]) // both were leaders — nobody eliminated
    expect(g.state.phase.kind).toBe('p1_event') // 3 event cards remain for turn 6

    // settle it: seat 1 gives up during the tie-breaker turn
    playThroughP1(g)
    g.apply(1, { type: 'system.eliminate', seat: 1, reason: 'forfeit' })
    passReveal(g)
    const phase = g.state.phase
    if (phase.kind !== 'finished') throw new Error('expected finished')
    expect(phase.winnerSeats).toEqual([0])
  })
})

describe('legalIntents mirrors the current stage', () => {
  it('offers exactly the pending action per seat', () => {
    const g = newGame()
    expect(legalIntents(g.state, 0)).toEqual([{ type: 'distribution.commit' }])
    g.apply(0, { type: 'distribution.commit', placements: peacefulPlacements(0) })
    expect(legalIntents(g.state, 0)).toEqual([])
    expect(legalIntents(g.state, 1)).toEqual([{ type: 'distribution.commit' }])
    g.apply(1, { type: 'distribution.commit', placements: peacefulPlacements(1) })
    passReveal(g)
    // No action.selectCards on offer: turn 1 has no P3 (rulebook §Turn Structure).
    // Phase 4 opens straight away and, with nothing contested, its only business
    // is the end-of-turn recap — offered to every seat, not just to fighters.
    expect(legalIntents(g.state, 0)).toEqual([{ type: 'conflict.summary.ack' }])
    expect(legalIntents(g.state, 1)).toEqual([{ type: 'conflict.summary.ack' }])
    passSummary(g)
    // P5: no cards affordable? starting resources allow exactly one buy
    expect(legalIntents(g.state, 0)).toEqual([{ type: 'market.buy' }, { type: 'market.done' }])
    g.apply(0, { type: 'market.done' })
    expect(legalIntents(g.state, 0)).toEqual([])
  })
})
