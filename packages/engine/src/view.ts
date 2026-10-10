// projectView — architecture/Engine.md §2–§3. What one seat is allowed to see:
// hidden information is removed, never merely flagged. In 2v2 allies share full
// visibility (rulebook), so filtering is by visibility group, not by single seat.

import type { EventCardId } from './constants.js'
import { BET_COST, MAX_TURNS } from './constants.js'
import { deepClone } from './serialize.js'
import type {
  BlockPlay,
  CardInstance,
  ConflictGroup,
  ExchangePlay,
  FinishedState,
  GameState,
  PlayedCard,
  RelocationCollision,
  RelocationMove,
  TieBreakState,
  TurnSummaryEntry
} from './state.js'
import { visibilityGroup } from './state.js'
import type {
  ActorId,
  ActorType,
  ArgumentType,
  BetType,
  LocationId,
  Mode,
  Placement,
  Resources,
  Rps,
  SeatId,
  Values
} from './types.js'

export interface PublicPlacement {
  actorId: ActorId
  seat: SeatId
  actorType: ActorType
  locationId: LocationId
  /** Present only when visible to the viewer (own/ally, or revealed in P4). */
  argument?: ArgumentType
  bet?: BetType
}

export type TieBreakView = {
  participants: SeatId[]
  round: number
  /** Who already chose this round (choices themselves stay sealed). */
  chosen: SeatId[]
  myChoice: Rps | null
  /** Previous settled round's throws — public since tiebreak.choicesRevealed. */
  revealed: { round: number; choices: Partial<Record<SeatId, Rps>> } | null
}

export type PhaseView =
  | {
      kind: 'p1_event'
      card: EventCardId
      stage:
        | {
            t: 'compare_ack'
            winner: unknown
            acked: SeatId[]
            tiebreakChoices?: Partial<Record<SeatId, Rps>>
          }
        | { t: 'compare_standoff'; participants: SeatId[]; acked: SeatId[] }
        | { t: 'compare_tiebreak'; tiebreak: TieBreakView }
        | {
            t: 'discard_commit'
            committedSeats: SeatId[]
            myAmount: number | null
            /** Committed amounts of the viewer's visibility group (2v2 ally). */
            sealed: { seat: SeatId; amount: number }[]
          }
        | {
            t: 'discard_tiebreak'
            revealed: Partial<Record<SeatId, number>>
            tiebreak: TieBreakView
          }
        | {
            t: 'discard_ack'
            winner: SeatId | null
            drewCard: boolean
            acked: SeatId[]
            /** Revealed discards, seat → amount (public after the reveal). */
            revealed?: Partial<Record<SeatId, number>>
            tiebreakChoices?: Partial<Record<SeatId, Rps>>
          }
    }
  | {
      kind: 'p2_distribution'
      committedSeats: SeatId[]
      /** Set once the board is revealed — the beat before the turn moves on. */
      revealed?: { acked: SeatId[] }
      /** Sealed commits of the viewer's visibility group. */
      sealed: { seat: SeatId; placements: Placement[] }[]
    }
  | {
      kind: 'p3_action'
      /** Per-seat selected card kinds; null until step 0 consensus. */
      selectedCounts: { seat: SeatId; block: number; relocation: number; exchange: number }[] | null
      step:
        | { t: 'select'; committedSeats: SeatId[]; mySelection: string[] | null }
        | { t: 'blocks_ack'; blocks: BlockPlay[]; acked: SeatId[] }
        | { t: 'relocate'; committedSeats: SeatId[]; myOrders: unknown[] | null }
        | {
            t: 'relocate_tiebreak'
            collisions: RelocationCollision[]
            index: number
            tiebreak: TieBreakView
          }
        | { t: 'relocations_ack'; moves: RelocationMove[]; acked: SeatId[] }
        | { t: 'exchange'; queue: { seat: SeatId; instanceId: string }[]; index: number }
        | { t: 'exchanges_ack'; exchanges: ExchangePlay[]; acked: SeatId[] }
    }
  | {
      kind: 'p4_conflict'
      conflicts: ConflictGroup[]
      index: number
      /**
       * What Phase 4 has produced so far this turn — the end-of-phase recap
       * (author request). Public by construction: every reward in it was already
       * emitted as a public conflict.rewards event as it happened.
       */
      summary: TurnSummaryEntry[]
      stage:
        | { t: 'reveal_ack'; acked: SeatId[] }
        | { t: 'rps'; chosen: SeatId[]; myChoice: Rps | null }
        | { t: 'deadlock_tiebreak'; tiebreak: TieBreakView }
        | { t: 'refight_ack'; acked: SeatId[] }
        | { t: 'result_ack'; acked: SeatId[] }
        | { t: 'summary_ack'; acked: SeatId[] }
      resolution: {
        outcomes: Partial<Record<ActorId, 'win' | 'lose' | 'draw'>>
        /** Revealed bets judged against the round-1 base outcome — public. */
        betResults: { actorId: ActorId; seat: SeatId; bet: BetType; success: boolean }[]
        winBonusActorIds: ActorId[]
        active: ActorId[]
        round: number
        /** Choices from resolved re-rounds — public, the whole table saw them land. */
        revealedRps: Partial<Record<SeatId, Rps>>
      } | null
    }
  | {
      kind: 'p5_market'
      doneSeats: SeatId[]
      /** Staged buy counts of the viewer's visibility group (others stay sealed). */
      sealedBuys: { seat: SeatId; count: number }[]
      /** Cards each seat took home — public once the market closes. */
      bought: { seat: SeatId; count: number }[]
    }
  | FinishedState

export interface PlayerView {
  gameId: string
  mode: Mode
  rulesVersion: string
  seat: SeatId
  /** True only for a non-seated spectator view: read-only, public info only. */
  spectator?: boolean
  teams?: [SeatId[], SeatId[]]
  turn: number
  /** The game's turn budget (tutorial = 3) — the HUD renders "Turn n/max". */
  maxTurns: number
  isTieBreakerTurn: boolean
  activeSeats: SeatId[]
  eliminated: SeatId[]
  decks: { event: number; action: number }
  /** Value pools are public information (compare events, exchange targeting). */
  values: Values[]
  me: { resources: Resources; hand: CardInstance[] }
  /** Other seats in the viewer's visibility group (2v2 ally). */
  allies: SeatId[]
  /** Resources are public (rulebook §Open Information); null only for a gone inventory. */
  others: {
    seat: SeatId
    handCount: number
    resources: Resources | null
    /** Actual cards — present only for the viewer's visibility group (2v2 ally). */
    hand?: CardInstance[]
  }[]
  /** Every Action Card that took effect this game, in play order — public. */
  played: PlayedCard[]
  /** Resolved P1 events in play order — public. */
  eventsPlayed: { card: EventCardId; turn: number }[]
  board: { placements: PublicPlacement[]; disabledLocations: LocationId[] }
  phase: PhaseView
  /** Seats whose input the game is currently waiting for. */
  waitingOn: SeatId[]
  seq: number
}

/**
 * Resources a seat has spent on bets this turn that are not yet public. Bets are
 * paid at P2 commit (handlers.ts) but only revealed in P4, so before then an
 * opponent's resource drop would leak that they placed a bet — during P2 (the
 * sealed phase) and during P3 (where it would sway how Action Cards are played).
 * We add the spend back for viewers outside the seat's visibility group, so
 * every resource change surfaces to everyone at P4, never earlier. Resource
 * GAINS (peaceful/robot rewards) also land at P4, so this hides all pre-P4
 * resource movement of a hidden bettor.
 */
function unrevealedBetSpend(state: GameState, seat: SeatId): Resources {
  const placements: readonly Placement[] =
    state.phase.kind === 'p2_distribution'
      ? (state.phase.committed[seat] ?? [])
      : state.phase.kind === 'p3_action'
        ? state.board.placements.filter((p) => p.seat === seat)
        : []
  const spend: Resources = { product: 0, electricity: 0, recycling: 0 }
  for (const p of placements) if (p.bet) spend[BET_COST[p.bet]] += 1
  return spend
}

/** A seat's public resources with its unrevealed bet spend added back (null if gone). */
function maskedResources(state: GameState, seat: SeatId): Resources | null {
  const real = state.inventories[seat]?.resources
  if (!real) return null
  const spend = unrevealedBetSpend(state, seat)
  return {
    product: real.product + spend.product,
    electricity: real.electricity + spend.electricity,
    recycling: real.recycling + spend.recycling
  }
}

export function projectView(state: GameState, seat: SeatId): PlayerView {
  if (!state.meta.seats.some((m) => m.seat === seat))
    throw new Error(`projectView: unknown seat ${seat}`)
  const group = visibilityGroup(state, seat)
  const inGroup = (other: SeatId): boolean => group.includes(other)

  const revealedActors = revealedActorIds(state)
  const placements: PublicPlacement[] = state.board.placements.map((p) => {
    const visible = inGroup(p.seat) || revealedActors.has(p.actorId)
    const pub: PublicPlacement = {
      actorId: p.actorId,
      seat: p.seat,
      actorType: p.actorType,
      locationId: p.locationId
    }
    if (visible) {
      pub.argument = p.argument
      if (p.bet) pub.bet = p.bet
    }
    return pub
  })

  const me = state.inventories[seat] as GameState['inventories'][number]
  const view: PlayerView = {
    gameId: state.meta.gameId,
    mode: state.meta.mode,
    rulesVersion: state.meta.rulesVersion,
    seat,
    ...(state.meta.teams ? { teams: state.meta.teams } : {}),
    turn: state.turn,
    maxTurns: state.meta.maxTurns ?? MAX_TURNS,
    isTieBreakerTurn: state.isTieBreakerTurn,
    activeSeats: [...state.activeSeats],
    eliminated: [...state.eliminated],
    decks: { event: state.eventDeck.length, action: state.actionDeck.length },
    values: state.values,
    me: { resources: me.resources, hand: me.hand },
    allies: group.filter((x) => x !== seat),
    others: state.meta.seats
      .filter((m) => m.seat !== seat)
      .map((m) => ({
        seat: m.seat,
        handCount: state.inventories[m.seat]?.hand.length ?? 0,
        // Allies share full visibility (real count); opponents have their
        // pre-P4 bet spend masked so a resource drop can't leak a sealed bet.
        resources: inGroup(m.seat)
          ? (state.inventories[m.seat]?.resources ?? null)
          : maskedResources(state, m.seat),
        // 2v2 ally: full visibility includes the actual cards, not just the count.
        ...(inGroup(m.seat) ? { hand: state.inventories[m.seat]?.hand ?? [] } : {})
      })),
    played: [...(state.played ?? [])],
    eventsPlayed: [...(state.eventsPlayed ?? [])],
    board: { placements, disabledLocations: state.board.disabledLocations },
    phase: phaseView(state, seat, group),
    waitingOn: waitingOn(state),
    seq: state.seq
  }
  return deepClone(view)
}

const EMPTY_RESOURCES: Resources = { product: 0, electricity: 0, recycling: 0 }
/**
 * Sentinel seat for a spectator — it matches no real seat, so every "is this
 * mine?" check (waitingOn and the phase view's own-only fields) resolves to
 * empty. That is the whole trick: a spectator is a viewer with an empty
 * visibility group, which the fog logic already turns into a strictly-public
 * projection (arguments and bets appear only once a conflict reveals them).
 */
const SPECTATOR_SEAT = -1 as SeatId

/**
 * The view an external watcher of a ranked game receives. No hand, no seat, and
 * no hidden information about anyone: placements carry an argument/bet only once
 * that conflict has revealed (same instant the table sees it), so a spectator
 * can never leak a sealed move to a player. Resources and hand counts are public
 * (rulebook §Open Information) and so are shown for every seat.
 */
export function projectSpectatorView(state: GameState): PlayerView {
  const revealedActors = revealedActorIds(state)
  const placements: PublicPlacement[] = state.board.placements.map((p) => {
    const pub: PublicPlacement = {
      actorId: p.actorId,
      seat: p.seat,
      actorType: p.actorType,
      locationId: p.locationId
    }
    if (revealedActors.has(p.actorId)) {
      pub.argument = p.argument
      if (p.bet) pub.bet = p.bet
    }
    return pub
  })

  const view: PlayerView = {
    gameId: state.meta.gameId,
    mode: state.meta.mode,
    rulesVersion: state.meta.rulesVersion,
    seat: SPECTATOR_SEAT,
    spectator: true,
    ...(state.meta.teams ? { teams: state.meta.teams } : {}),
    turn: state.turn,
    maxTurns: state.meta.maxTurns ?? MAX_TURNS,
    isTieBreakerTurn: state.isTieBreakerTurn,
    activeSeats: [...state.activeSeats],
    eliminated: [...state.eliminated],
    decks: { event: state.eventDeck.length, action: state.actionDeck.length },
    values: state.values,
    me: { resources: { ...EMPTY_RESOURCES }, hand: [] },
    allies: [],
    others: state.meta.seats.map((m) => ({
      seat: m.seat,
      handCount: state.inventories[m.seat]?.hand.length ?? 0,
      // A watcher is "everyone": bet spend is masked until P4, like for players.
      resources: maskedResources(state, m.seat)
    })),
    played: [...(state.played ?? [])],
    eventsPlayed: [...(state.eventsPlayed ?? [])],
    board: { placements, disabledLocations: state.board.disabledLocations },
    phase: phaseView(state, SPECTATOR_SEAT, []),
    waitingOn: waitingOn(state),
    seq: state.seq
  }
  return deepClone(view)
}

/**
 * The omniscient view for replaying a FINISHED game: the spectator view with
 * nothing hidden — every placement carries its argument and bet, because the
 * game is over and the whole point of a replay is to show what each player did.
 * Used client-side against a locally reconstructed state; never sent live.
 */
export function projectReplayView(state: GameState): PlayerView {
  const view = projectSpectatorView(state)
  // Omniscient: undo the live bet-spend masking — a finished-game replay shows
  // the true resource counts (and every argument/bet below).
  view.others = view.others.map((o) => {
    const real = state.inventories[o.seat]?.resources
    return { ...o, resources: real ? { ...real } : null }
  })
  const full = new Map(state.board.placements.map((p) => [p.actorId, p]))
  view.board.placements = view.board.placements.map((p) => {
    const src = full.get(p.actorId)
    if (!src) return p
    return { ...p, argument: src.argument, ...(src.bet ? { bet: src.bet } : {}) }
  })
  return view
}

/** Actor ids whose argument/bet became public via P4 conflict reveals this turn. */
function revealedActorIds(state: GameState): Set<ActorId> {
  const revealed = new Set<ActorId>()
  if (state.phase.kind !== 'p4_conflict') return revealed
  // Arguments go public when the conflict's reveal fires — i.e. after its reveal_ack
  // consensus. Earlier conflicts are fully public; the current one only past that stage.
  const last = state.phase.stage.t === 'reveal_ack' ? state.phase.index - 1 : state.phase.index
  for (let i = 0; i <= last && i < state.phase.conflicts.length; i++) {
    for (const id of (state.phase.conflicts[i] as ConflictGroup).actorIds) revealed.add(id)
  }
  return revealed
}

function tiebreakView(
  tiebreak: {
    participants: SeatId[]
    round: number
    choices: Partial<Record<SeatId, Rps>>
    lastRevealed?: { round: number; choices: Partial<Record<SeatId, Rps>> }
  },
  seat: SeatId
): TieBreakView {
  return {
    participants: tiebreak.participants,
    round: tiebreak.round,
    chosen: tiebreak.participants.filter((p) => tiebreak.choices[p] !== undefined),
    myChoice: tiebreak.choices[seat] ?? null,
    revealed: tiebreak.lastRevealed ?? null
  }
}

function seatsOf(record: Partial<Record<SeatId, unknown>>): SeatId[] {
  return Object.keys(record).map((k) => Number(k) as SeatId)
}

function phaseView(state: GameState, seat: SeatId, group: SeatId[]): PhaseView {
  const phase = state.phase
  switch (phase.kind) {
    case 'p1_event': {
      const stage = phase.stage
      switch (stage.t) {
        case 'compare_ack':
          return { kind: 'p1_event', card: phase.card, stage }
        case 'compare_standoff':
          return { kind: 'p1_event', card: phase.card, stage }
        case 'compare_tiebreak':
          return {
            kind: 'p1_event',
            card: phase.card,
            stage: { t: 'compare_tiebreak', tiebreak: tiebreakView(stage.tiebreak, seat) }
          }
        case 'discard_commit':
          return {
            kind: 'p1_event',
            card: phase.card,
            stage: {
              t: 'discard_commit',
              committedSeats: seatsOf(stage.amounts),
              myAmount: stage.amounts[seat] ?? null,
              // Ally full visibility (2v2): the group sees each other's sealed
              // amounts pre-reveal; everyone else waits for the reveal.
              sealed: group
                .filter((g) => g !== seat && stage.amounts[g] !== undefined)
                .map((g) => ({ seat: g, amount: stage.amounts[g] as number }))
            }
          }
        case 'discard_tiebreak':
          return {
            kind: 'p1_event',
            card: phase.card,
            stage: {
              t: 'discard_tiebreak',
              revealed: stage.revealed,
              tiebreak: tiebreakView(stage.tiebreak, seat)
            }
          }
        case 'discard_ack':
          return { kind: 'p1_event', card: phase.card, stage }
      }
      break
    }
    case 'p2_distribution':
      return {
        kind: 'p2_distribution',
        committedSeats: seatsOf(phase.committed),
        // Present only once the board is revealed: everyone's Locations and Actor
        // types are public from that moment (Arguments and Bets are not), and the
        // phase waits here until the table has looked.
        ...(phase.revealed ? { revealed: { acked: [...phase.revealed.acked] } } : {}),
        sealed: group
          .filter((g) => phase.committed[g])
          .map((g) => ({ seat: g, placements: phase.committed[g] as Placement[] }))
      }
    case 'p3_action': {
      const selectedCounts = phase.summary ?? null
      const step = phase.step
      if (step.t === 'select')
        return {
          kind: 'p3_action',
          selectedCounts,
          step: {
            t: 'select',
            committedSeats: seatsOf(step.committed),
            mySelection: step.committed[seat] ?? null
          }
        }
      if (step.t === 'relocate')
        return {
          kind: 'p3_action',
          selectedCounts,
          step: {
            t: 'relocate',
            committedSeats: seatsOf(step.orders),
            myOrders: (step.orders[seat] ?? null) as unknown[] | null
          }
        }
      if (step.t === 'relocate_tiebreak')
        return {
          kind: 'p3_action',
          selectedCounts,
          step: {
            t: 'relocate_tiebreak',
            collisions: step.collisions,
            index: step.index,
            tiebreak: tiebreakView(step.tiebreak, seat)
          }
        }
      // Results ceremonies are fully public — the whole point is the reveal.
      if (step.t === 'blocks_ack')
        return {
          kind: 'p3_action',
          selectedCounts,
          step: { t: 'blocks_ack', blocks: step.blocks, acked: step.acked }
        }
      if (step.t === 'relocations_ack')
        return {
          kind: 'p3_action',
          selectedCounts,
          step: { t: 'relocations_ack', moves: step.moves, acked: step.acked }
        }
      if (step.t === 'exchanges_ack')
        return {
          kind: 'p3_action',
          selectedCounts,
          step: { t: 'exchanges_ack', exchanges: step.exchanges, acked: step.acked }
        }
      return {
        kind: 'p3_action',
        selectedCounts,
        step: { t: 'exchange', queue: step.queue, index: step.index }
      }
    }
    case 'p4_conflict': {
      const stage = phase.stage
      const stageView: Extract<PhaseView, { kind: 'p4_conflict' }>['stage'] =
        stage.t === 'rps'
          ? {
              t: 'rps',
              chosen: seatsOf(stage.choices),
              myChoice: stage.choices[seat] ?? null
            }
          : stage.t === 'deadlock_tiebreak'
            ? { t: 'deadlock_tiebreak', tiebreak: tiebreakView(stage.tiebreak, seat) }
            : stage
      return {
        kind: 'p4_conflict',
        conflicts: phase.conflicts,
        index: phase.index,
        summary: phase.summary,
        stage: stageView,
        resolution: phase.resolution
          ? {
              outcomes: phase.resolution.outcomes,
              betResults: phase.resolution.betResults ?? [],
              winBonusActorIds: phase.resolution.winBonusActorIds,
              active: phase.resolution.active,
              round: phase.resolution.round,
              revealedRps: phase.resolution.revealedRps ?? {}
            }
          : null
      }
    }
    case 'p5_market':
      return {
        kind: 'p5_market',
        doneSeats: [...phase.done],
        sealedBuys: group
          .filter((g) => (phase.staged[g] ?? 0) > 0)
          .map((g) => ({ seat: g, count: phase.staged[g] as number })),
        bought: Object.entries(phase.bought ?? {}).map(([seat, count]) => ({
          seat: Number(seat) as SeatId,
          count: count as number
        }))
      }
    case 'finished':
      return phase
  }
  throw new Error('phaseView: unreachable')
}

/**
 * Tie-break seats still owed a choice: no pick yet AND the deadline has not
 * marked them missed (a missed seat is settled — it auto-loses the round; the
 * room's deadline loop must not keep waiting on it).
 */
function pendingTiebreakSeats(tiebreak: TieBreakState): SeatId[] {
  const missed = tiebreak.missed ?? []
  return tiebreak.participants.filter(
    (p) => tiebreak.choices[p] === undefined && !missed.includes(p)
  )
}

/** Public: which seats the game is waiting for right now. */
export function waitingOn(state: GameState): SeatId[] {
  const phase = state.phase
  const missingFrom = (present: Iterable<SeatId>): SeatId[] => {
    const set = new Set(present)
    return state.activeSeats.filter((s) => !set.has(s))
  }
  switch (phase.kind) {
    case 'p1_event': {
      const stage = phase.stage
      if (stage.t === 'compare_ack' || stage.t === 'discard_ack') return missingFrom(stage.acked)
      // Standoff waits only on the tied participants, not on spectating leaders.
      if (stage.t === 'compare_standoff')
        return stage.participants.filter(
          (seat) => state.activeSeats.includes(seat) && !stage.acked.includes(seat)
        )
      if (stage.t === 'discard_commit') return missingFrom(seatsOf(stage.amounts))
      return pendingTiebreakSeats(stage.tiebreak)
    }
    case 'p2_distribution':
      if (phase.revealed) return missingFrom(phase.revealed.acked)
      return missingFrom(seatsOf(phase.committed))
    case 'p3_action': {
      const step = phase.step
      if (step.t === 'blocks_ack' || step.t === 'relocations_ack' || step.t === 'exchanges_ack')
        return missingFrom(step.acked)
      if (step.t === 'select') return missingFrom(seatsOf(step.committed))
      if (step.t === 'relocate_tiebreak') return pendingTiebreakSeats(step.tiebreak)
      if (step.t === 'relocate') {
        const quotas = phase.summary ?? []
        return state.activeSeats.filter((seat) => {
          const quota = quotas.find((x) => x.seat === seat)?.relocation ?? 0
          return (step.orders[seat]?.length ?? 0) + (step.skipped?.[seat] ?? 0) < quota
        })
      }
      const slot = step.queue[step.index]
      return slot ? [slot.seat] : []
    }
    case 'p4_conflict': {
      const stage = phase.stage
      const conflict = phase.conflicts[phase.index]
      const involvedSeats = conflict
        ? state.activeSeats.filter((s) => conflict.actorIds.some((id) => id.startsWith(`${s}:`)))
        : []
      if (stage.t === 'reveal_ack' || stage.t === 'result_ack' || stage.t === 'refight_ack')
        return involvedSeats.filter((s) => !stage.acked.includes(s))
      // The recap is the whole table's, so it waits on everyone still playing.
      if (stage.t === 'summary_ack')
        return state.activeSeats.filter((s) => !stage.acked.includes(s))
      if (stage.t === 'rps') {
        const activeSeats = new Set(
          (phase.resolution?.active ?? []).map((id) => Number(id.split(':')[0]) as SeatId)
        )
        const missed = stage.missed ?? []
        return [...activeSeats].filter((s) => stage.choices[s] === undefined && !missed.includes(s))
      }
      return pendingTiebreakSeats(stage.tiebreak)
    }
    case 'p5_market':
      return state.activeSeats.filter((s) => !phase.done.includes(s))
    case 'finished':
      return []
  }
}
