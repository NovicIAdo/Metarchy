// GameState — spec/Game-Specification.md §2, plus the exact sub-state of every phase.
// Full truth: exists only on the server; clients get projectView() projections.

import type {
  ActorId,
  ActorType,
  BetType,
  LocationId,
  Mode,
  Outcome,
  Placement,
  Resources,
  Rps,
  SeatId,
  TeamId,
  ValueType,
  Values
} from './types.js'
import type { ActionCardId, EventCardId } from './constants.js'
import {
  ACTION_DECK_COMPOSITION,
  EVENT_CARDS,
  MAX_TURNS,
  RULES_VERSION,
  STARTING_RESOURCES,
  TUTORIAL_EVENT_ORDER,
  TUTORIAL_MAX_TURNS
} from './constants.js'
import { fnv1a32, shuffled } from './rng.js'

// --- Meta ----------------------------------------------------------------------

export interface SeatMeta {
  seat: SeatId
  controller: 'human' | 'bot'
}

export interface GameMeta {
  gameId: string
  mode: Mode
  rulesVersion: string
  /** RNG seed — server-only secret until game end (commit-reveal). Never in PlayerView. */
  seed: string
  seats: SeatMeta[]
  /** 2v2 only: [[0,2],[1,3]]. */
  teams?: [SeatId[], SeatId[]]
  /** Game length in turns (tie-breakers may exceed it); absent = MAX_TURNS. */
  maxTurns?: number
}

/** Fixed 2v2 team layout (spec §13). */
export const TEAMS_2V2: [SeatId[], SeatId[]] = [
  [0, 2],
  [1, 3]
]

export const SEATS_PER_MODE: Record<Mode, readonly number[]> = {
  '1v1': [2],
  ffa3: [3],
  '2v2': [4],
  vs_bots: [2, 3],
  // Coached tutorial: one human + one bot, no clock (server disables deadlines).
  tutorial: [2]
}

// --- Cards ----------------------------------------------------------------------

/** A drawn action card. Instance ids are draw ordinals — stable and deterministic. */
export interface CardInstance {
  instanceId: string
  card: ActionCardId
}

// --- Player-level tie-break (§11) -------------------------------------------------

export interface TieBreakState {
  /** Parties still in the tie-break (shrinks round by round). */
  participants: SeatId[]
  /** 1-based round counter within this tie-break. */
  round: number
  /** Sealed choices of the current round. */
  choices: Partial<Record<SeatId, Rps>>
  /**
   * Seats whose choice deadline expired this round (user rule: no pick in
   * time = chose nothing = auto-lose the round). Optional: pre-field snapshots.
   */
  missed?: SeatId[]
  /** Last settled round's throws — already public (tiebreak.choicesRevealed);
      kept on state so views can show participants the reveal, not just the
      outcome. Optional: absent on pre-field snapshots. */
  lastRevealed?: { round: number; choices: Partial<Record<SeatId, Rps>> }
}

// --- P1 Event (§5) ---------------------------------------------------------------

export type EventWinner = { kind: 'seat'; seat: SeatId } | { kind: 'team'; team: TeamId }

export type P1Stage =
  /** winner null: every qualifier was eliminated mid-event — nobody takes the reward. */
  | {
      t: 'compare_ack'
      winner: EventWinner | null
      acked: SeatId[]
      /** Final tie-break round's throws when the event went through one. */
      tiebreakChoices?: Partial<Record<SeatId, Rps>>
    }
  /**
   * Compare tie announcement (user rule): before the tie-break arena, everyone
   * sees WHY — the compared values are tied at the minimum — and confirms with
   * "Resolve the Conflict" (or the ack deadline confirms for them).
   */
  | { t: 'compare_standoff'; participants: SeatId[]; acked: SeatId[] }
  | { t: 'compare_tiebreak'; tiebreak: TieBreakState }
  | { t: 'discard_commit'; amounts: Partial<Record<SeatId, number>> }
  | { t: 'discard_tiebreak'; revealed: Partial<Record<SeatId, number>>; tiebreak: TieBreakState }
  | {
      t: 'discard_ack'
      winner: SeatId | null
      drewCard: boolean
      acked: SeatId[]
      /** Revealed discards, seat → amount. Optional: absent on pre-field snapshots. */
      revealed?: Partial<Record<SeatId, number>>
      /** Final tie-break round's throws when the event went through one. */
      tiebreakChoices?: Partial<Record<SeatId, Rps>>
    }

export interface P1State {
  kind: 'p1_event'
  card: EventCardId
  stage: P1Stage
}

// --- P2 Distribution (§6) ----------------------------------------------------------

export interface P2State {
  kind: 'p2_distribution'
  /** Sealed full placements per seat (bet resources already deducted at commit). */
  committed: Partial<Record<SeatId, Placement[]>>
  /**
   * Absent while seats are still committing. Once everyone has, the board is
   * revealed (Locations and Actor types — Arguments and Bets stay sealed until
   * Phase 4) and the phase HOLDS here until every active seat has looked.
   *
   * Author request: "я расставляю своих акторов, и потом сразу перепрыгивает на
   * конфликт, и я не вижу куда бот расставил своих акторов". Before this the
   * reveal and the next phase happened inside one intent, so on Turn 1 — which
   * has no Action Phase — the commit went straight into the conflict arena and
   * the revealed board was never on screen by itself.
   *
   * Optional so a snapshot written before this existed still loads as "everyone
   * is still committing", which is the state it was actually in.
   */
  revealed?: { acked: SeatId[] }
}

// --- P3 Action (§7) ----------------------------------------------------------------

export interface RelocationOrder {
  actorId: ActorId
  to: LocationId
}

export interface RelocationCollision {
  actorId: ActorId
  contenders: { seat: SeatId; to: LocationId }[]
  winner?: SeatId
}

/** One applied block card: who shut which location down. */
export interface BlockPlay {
  seat: SeatId
  card: ActionCardId
  locationId: LocationId
}

/** One applied relocation: which seat's order moved the actor where. */
export interface RelocationMove {
  seat: SeatId
  actorId: ActorId
  from: LocationId
  to: LocationId
}

/** One applied Change of Values: seat gave `give` to `from` and took `take`. */
export interface ExchangePlay {
  seat: SeatId
  from: SeatId
  give: ValueType
  take: ValueType
}

export type P3Step =
  | { t: 'select'; committed: Partial<Record<SeatId, string[]>> }
  /** Results ceremony (§7 UX): everyone sees what the block wave changed. */
  | { t: 'blocks_ack'; blocks: BlockPlay[]; acked: SeatId[] }
  | {
      t: 'relocate'
      orders: Partial<Record<SeatId, RelocationOrder[]>>
      /** Cards forfeited by the deadline (played, no move); optional: pre-field snapshots. */
      skipped?: Partial<Record<SeatId, number>>
    }
  | {
      t: 'relocate_tiebreak'
      orders: Partial<Record<SeatId, RelocationOrder[]>>
      collisions: RelocationCollision[]
      index: number
      tiebreak: TieBreakState
    }
  | { t: 'relocations_ack'; moves: RelocationMove[]; acked: SeatId[] }
  | {
      t: 'exchange'
      queue: { seat: SeatId; instanceId: string }[]
      index: number
      /** Executed exchanges so far; optional: absent on pre-field snapshots. */
      applied?: ExchangePlay[]
    }
  | { t: 'exchanges_ack'; exchanges: ExchangePlay[]; acked: SeatId[] }

export interface P3State {
  kind: 'p3_action'
  /** Revealed selections (fixed after step 0 consensus; empty during step 0). */
  selected: Partial<Record<SeatId, string[]>>
  /** Revealed per-seat card-kind counts (fixed at step 0 consensus; hands change later). */
  summary?: { seat: SeatId; block: number; relocation: number; exchange: number }[]
  step: P3Step
}

// --- P4 Conflict (§8) ----------------------------------------------------------------

export interface ConflictGroup {
  locationId: LocationId
  actorType: ActorType
  /** Participants in seat order. */
  actorIds: ActorId[]
}

/** What one Location produced this turn — one entry per Location+Actor group. */
export interface TurnSummaryResult {
  actorId: ActorId
  seat: SeatId
  outcome: Outcome
  /** A Win bet that fired adds its +1 to the reward; shown so the number adds up. */
  winBet: boolean
  /** What the Actor actually produced — null when it produced nothing. */
  reward: RewardGrant | null
}

export interface TurnSummaryEntry {
  locationId: LocationId
  actorType: ActorType
  /** One Actor stood alone here: no conflict happened, it simply collected. */
  peaceful: boolean
  results: TurnSummaryResult[]
}

/** A reward as granted: Values for human Actors, Location resources for Robots. */
export interface RewardGrant {
  kind: 'value' | 'resource'
  type: string
  amount: number
}

export type P4Stage =
  | { t: 'reveal_ack'; acked: SeatId[] }
  /**
   * A re-resolution round (§8.4): sealed rock/paper/scissors from owners of
   * `active` actors. `missed` — seats whose deadline expired (user rule: chose
   * nothing = their actor auto-loses the round). Optional: pre-field snapshots.
   */
  | { t: 'rps'; choices: Partial<Record<SeatId, Rps>>; missed?: SeatId[] }
  /** Politician deadlock stage 2 (§8.6): player-level tie-break, capped rounds. */
  | { t: 'deadlock_tiebreak'; tiebreak: TieBreakState }
  /**
   * Review gate before a re-fight opens: the round that forced it (throws + bet
   * verdicts) stays on screen until every involved seat presses "Resolve
   * Conflict Again" (or the ack deadline confirms), then the fresh rps opens.
   */
  | { t: 'refight_ack'; acked: SeatId[] }
  | { t: 'result_ack'; acked: SeatId[] }
  /**
   * End of Phase 4, EVERY turn (author request): the whole phase's outcome on one
   * screen — which Locations held a conflict, and what each Actor brought whom.
   * Unlike the other acks this waits on every active seat, not just the seats in
   * a conflict: it is the table's summary, and on a turn with no conflicts at all
   * it is the only thing Phase 4 has to say. Consensus or the deadline closes it.
   */
  | { t: 'summary_ack'; acked: SeatId[] }

export interface ConflictResolution {
  /** Current final outcome per original participant. */
  outcomes: Partial<Record<ActorId, Outcome>>
  /** Every revealed bet judged against its §8.2 base outcome (public since the
      reveal). Kept so views can explain WHY outcomes shifted — a fired draw bet
      converts draws, a fired lose bet forces the re-fight. Optional: absent on
      pre-field snapshots. */
  betResults?: { actorId: ActorId; seat: SeatId; bet: BetType; success: boolean }[]
  /** Successful round-1 win bets: persistent +1 reward, survives re-resolution (I-2). */
  winBonusActorIds: ActorId[]
  /** Actors still fighting (re-resolution set); empty once settled. */
  active: ActorId[]
  /** Resolution round number; 1 = the argument round. */
  round: number
  /** Re-round choices per seat, public once conflict.roundResolved revealed them. */
  revealedRps: Partial<Record<SeatId, Rps>>
  /** §8.6 stage-1 counter: unresolved politician re-fight rounds. */
  politicianRefights: number
  /** §8.6 stage-2 counter: player-level tie-break rounds consumed. */
  deadlockPlayerRounds: number
}

export interface P4State {
  kind: 'p4_conflict'
  conflicts: ConflictGroup[]
  index: number
  stage: P4Stage
  /** Resolution bookkeeping for conflicts[index]. */
  resolution?: ConflictResolution
  /**
   * Accumulated as the phase runs, so the end-of-phase summary is a fact of
   * state and not a replay of events — a player who reconnects mid-phase, and a
   * spectator who joined late, both still get the whole picture.
   */
  summary: TurnSummaryEntry[]
}

// --- P5 Market (§9) -------------------------------------------------------------------

export interface P5State {
  kind: 'p5_market'
  /** Sealed number of staged buys per seat. */
  staged: Partial<Record<SeatId, number>>
  done: SeatId[]
  /**
   * How many Action Cards each seat actually took home this market (filled as
   * the phase closes, public). The turn's recap reads it to say "P1 bought 2
   * cards, P2 none" instead of leaving the market outcome unspoken.
   */
  bought?: Partial<Record<SeatId, number>>
}

// --- Game over --------------------------------------------------------------------------

export interface RankingEntry {
  /** One seat, or a whole team in 2v2. */
  seats: SeatId[]
  vp: number
  /** Final values of the seat/team pool; optional: absent on pre-field snapshots. */
  values?: Values
}

export interface FinishedState {
  kind: 'finished'
  winnerSeats: SeatId[]
  /** Best → worst. */
  ranking: RankingEntry[]
}

export type PhaseState = P1State | P2State | P3State | P4State | P5State | FinishedState

// --- GameState ---------------------------------------------------------------------------

export interface SeatInventory {
  resources: Resources
  hand: CardInstance[]
}

export interface PlayedCard {
  seat: SeatId
  card: ActionCardId
  turn: number
}

export interface GameState {
  meta: GameMeta
  /** 1-based; exceeds MAX_TURNS only via tie-breaker turns. */
  turn: number
  isTieBreakerTurn: boolean
  phase: PhaseState
  eventDeck: EventCardId[]
  actionDeck: ActionCardId[]
  /** Action-card instances issued so far (= 15 - actionDeck.length); id source. */
  cardsDrawn: number
  board: {
    placements: Placement[]
    /** Reset at the start of every turn. */
    disabledLocations: LocationId[]
  }
  /** Index = seat. Eliminated seats keep zeroed/empty entries. */
  inventories: SeatInventory[]
  /** Index = seat, or team in 2v2 (shared pool). */
  values: Values[]
  eliminated: SeatId[]
  /** VP snapshot at elimination time — feeds the final ranking (§10, §12). */
  eliminationLog: { seat: SeatId; turn: number; vp: number }[]
  /** Every Action Card that took effect, in play order — public (rulebook §Open Information). */
  played: PlayedCard[]
  /** Resolved P1 events in play order — public. Optional: absent on pre-field snapshots. */
  eventsPlayed?: { card: EventCardId; turn: number }[]
  activeSeats: SeatId[]
  /** RNG draws consumed; with meta.seed this fully determines the next draw. */
  rngCursor: number
  /** Last emitted event seq. */
  seq: number
}

// --- Helpers --------------------------------------------------------------------------------

export function actorIdOf(seat: SeatId, actorType: ActorType): ActorId {
  return `${seat}:${actorType}`
}

export function seatOfActor(actorId: ActorId): SeatId {
  return Number(actorId.split(':')[0]) as SeatId
}

export function actorTypeOf(actorId: ActorId): ActorType {
  return actorId.split(':')[1] as ActorType
}

export function seatCount(state: GameState): number {
  return state.meta.seats.length
}

export function teamOf(state: GameState, seat: SeatId): TeamId | null {
  if (!state.meta.teams) return null
  return state.meta.teams[0].includes(seat) ? 0 : 1
}

/** Index into state.values for this seat (its team's pool in 2v2). */
export function valuesIndexFor(state: GameState, seat: SeatId): number {
  const team = teamOf(state, seat)
  return team === null ? seat : team
}

export function valuesOf(state: GameState, seat: SeatId): Values {
  return state.values[valuesIndexFor(state, seat)] as Values
}

/** Seats that share full visibility with `seat` (itself + ally in 2v2). */
export function visibilityGroup(state: GameState, seat: SeatId): SeatId[] {
  if (!state.meta.teams) return [seat]
  const team = state.meta.teams[teamOf(state, seat) as TeamId] as SeatId[]
  return [...team].sort((a, b) => a - b)
}

/** The game's turn budget: tutorial games are shortened via meta.maxTurns. */
export function maxTurnsOf(state: GameState): number {
  return state.meta.maxTurns ?? MAX_TURNS
}

/** The game ends after this turn's P4 scoring (barring ties). */
export function isLastTurn(state: GameState): boolean {
  return state.turn >= maxTurnsOf(state) || state.isTieBreakerTurn
}

// --- createGame -------------------------------------------------------------------------------

export interface GameConfig {
  gameId: string
  mode: Mode
  seed: string
  /** vs_bots only: total seat count (default 2). Other modes have fixed counts. */
  seatCount?: number
  /** Controller per seat (default all 'human'; server marks bot seats in vs_bots). */
  controllers?: ('human' | 'bot')[]
}

export function createGame(config: GameConfig): GameState {
  const allowed = SEATS_PER_MODE[config.mode]
  const count = config.seatCount ?? (allowed[0] as number)
  if (!allowed.includes(count))
    throw new Error(
      `createGame: mode ${config.mode} needs ${allowed.join(' or ')} seats, got ${count}`
    )
  if (config.controllers && config.controllers.length !== count)
    throw new Error(`createGame: controllers length ${config.controllers.length} != seats ${count}`)
  if (config.seed.length === 0) throw new Error('createGame: seed must be non-empty')

  const seats: SeatMeta[] = []
  for (let s = 0; s < count; s++)
    seats.push({ seat: s as SeatId, controller: config.controllers?.[s] ?? 'human' })

  const seedHash = fnv1a32(config.seed)
  const eventShuffle = shuffled(EVENT_CARDS, seedHash, 0)
  const actionShuffle = shuffled(ACTION_DECK_COMPOSITION, seedHash, eventShuffle.cursor)

  const valuePools = config.mode === '2v2' ? 2 : count
  const values: Values[] = []
  for (let i = 0; i < valuePools; i++) values.push({ power: 0, art: 0, knowledge: 0, fame: 0 })

  const inventories: SeatInventory[] = []
  for (let s = 0; s < count; s++)
    inventories.push({ resources: { ...STARTING_RESOURCES }, hand: [] })

  return {
    meta: {
      gameId: config.gameId,
      mode: config.mode,
      rulesVersion: RULES_VERSION,
      seed: config.seed,
      seats,
      ...(config.mode === '2v2' ? { teams: TEAMS_2V2 } : {}),
      ...(config.mode === 'tutorial' ? { maxTurns: TUTORIAL_MAX_TURNS } : {})
    },
    turn: 1,
    isTieBreakerTurn: false,
    // Turn 1 skips P1 (rulebook: Phase Flow).
    phase: { kind: 'p2_distribution', committed: {} },
    // Tutorial: a fixed teaching order instead of the shuffle (the shuffle still
    // runs so the action deck's rng cursor stays identical across modes).
    eventDeck: config.mode === 'tutorial' ? [...TUTORIAL_EVENT_ORDER] : eventShuffle.items,
    actionDeck: actionShuffle.items,
    cardsDrawn: 0,
    board: { placements: [], disabledLocations: [] },
    inventories,
    values,
    eliminated: [],
    eliminationLog: [],
    played: [],
    activeSeats: seats.map((s) => s.seat),
    rngCursor: actionShuffle.cursor,
    seq: 0
  }
}
