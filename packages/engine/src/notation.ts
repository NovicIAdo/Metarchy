// Match-notation renderer — a pure, deterministic reconstruction of a finished
// game into the project owner's compact chess-style record. It replays the ordered
// intent log through createGame()+applyIntent(), captures the events each intent
// emits, and turns the whole match into one array of lines (one string per line).
//
// The renderer never touches Date/Math.random and is integer-only: it derives
// everything from committed facts on the post-intent state plus the per-round
// ceremony data carried on events (RPS throws are overwritten on state, so they
// are read off the event stream as they fire — see flow.ts emit sites).

import { applyIntent } from './engine.js'
import { COMPARE_EVENT_METRIC, DISCARD_EVENT_RESOURCE, LOCATIONS } from './constants.js'
import type { ActionCardId, EventCardId } from './constants.js'
import type { EngineEvent } from './events.js'
import type { Intent } from './intents.js'
import { actorTypeOf, createGame, seatOfActor, valuesOf } from './state.js'
import type { BlockPlay, ExchangePlay, GameState, RelocationMove } from './state.js'
import type {
  ActorId,
  ActorType,
  ArgumentType,
  BetType,
  LocationId,
  Mode,
  Outcome,
  Placement,
  ResourceType,
  Rps,
  SeatId,
  ValueType
} from './types.js'

// --- Public API ----------------------------------------------------------------

export interface NotationConfig {
  gameId: string
  mode: Mode
  seed: string
  seatCount: number
  controllers: ('human' | 'bot')[]
}

/**
 * Reconstruct a finished game and emit its match-notation record. Feeds every
 * `{seat, intent}` through the engine in order, so the config + log fully
 * determine the output (same guarantee as the server's recoverGame path).
 */
export function toNotation(
  config: NotationConfig,
  intents: { seat: SeatId; intent: Intent }[]
): string[] {
  const builder = new NotationBuilder(config.gameId)
  let state: GameState = createGame({
    gameId: config.gameId,
    mode: config.mode,
    seed: config.seed,
    seatCount: config.seatCount,
    controllers: config.controllers
  })
  for (const { seat, intent } of intents) {
    const before = state
    const result = applyIntent(before, seat, intent)
    if (!result.ok)
      throw new Error(
        `toNotation: intent ${intent.type} from seat ${seat} rejected (${result.error.code}: ${result.error.message})`
      )
    builder.feed(before, seat, intent, result.events, result.state)
    state = result.state
  }
  return builder.finish()
}

// --- Code tables (spec §"Code tables" — use EXACTLY these) ----------------------

const ACTOR_CODE: Record<ActorType, string> = {
  politician: 'AP',
  scientist: 'AS',
  artist: 'AA',
  robot: 'AR'
}
const ARG_CODE: Record<ArgumentType, string> = {
  rock: 'ar',
  scissors: 'as',
  paper: 'ap',
  dummy: 'ad'
}
const RPS_CODE: Record<Rps, string> = { rock: 'ar', scissors: 'as', paper: 'ap' }
const BET_CODE: Record<BetType, string> = { win: 'BW', draw: 'BD', lose: 'BL' }
const OUTCOME_CODE: Record<Outcome, string> = { win: 'W', draw: 'D', lose: 'L' }
const LOC_CODE: Record<LocationId, string> = {
  square: 'LS',
  theatre: 'LT',
  university: 'LU',
  factory: 'LF',
  power_plant: 'LP',
  dump: 'LD'
}
const VALUE_CODE: Record<ValueType, string> = {
  power: 'P',
  knowledge: 'K',
  art: 'A',
  fame: 'F'
}
const RESOURCE_CODE: Record<ResourceType, string> = {
  product: 'p',
  electricity: 'e',
  recycling: 'r'
}
const ACTION_CARD_CODE: Record<ActionCardId, string> = {
  relocation: 'Re',
  change_values: 'Cv',
  sabotage: 'Sa',
  student_protests: 'St',
  charity_event: 'Ch',
  construction_work: 'Co',
  cable_stolen: 'Bl',
  environmental_protests: 'Ec'
}
const EVENT_CARD_CODE: Record<EventCardId, string> = {
  political_repression: 'EPR',
  educational_crisis: 'EEC',
  cultural_decline: 'ECD',
  revolution: 'ERE',
  help_poor_countries: 'EHP',
  earth_hour: 'EEH',
  prevent_eco_crisis: 'EPE'
}

const P = (seat: SeatId | number): string => `P${seat + 1}`

/** A reward grant off a conflict.rewards result: value → +2P, resource → +3e. */
function fmtReward(reward: unknown): string {
  if (!reward || typeof reward !== 'object') return ''
  const r = reward as { kind: string; type: string; amount: number }
  if (r.kind === 'value') return `+${r.amount}${VALUE_CODE[r.type as ValueType]}`
  if (r.kind === 'resource') return `+${r.amount}${RESOURCE_CODE[r.type as ResourceType]}`
  return ''
}

// --- Per-conflict scratch (populated across a conflict's events) ----------------

interface ConflictScratch {
  n: number
  locationId: LocationId
  participants: { actorId: ActorId; seat: SeatId; argument?: ArgumentType; bet?: BetType }[]
  round1: Partial<Record<ActorId, Outcome>>
  bets: { actorId: ActorId; seat: SeatId; bet: BetType; success: boolean }[]
  rounds: {
    round: number
    choices: Partial<Record<SeatId, Rps>>
    outcomes: Partial<Record<ActorId, Outcome>>
  }[]
}

interface TieRound {
  round: number
  choices: Partial<Record<SeatId, Rps>>
}

// --- Builder --------------------------------------------------------------------

class NotationBuilder {
  private readonly lines: string[] = []
  private lastHeader: string | null = null
  private currentTurn = 1

  // P1 event scratch (per turn)
  private p1Card: EventCardId | null = null
  private p1Metric: { letter: string; perSeat: [SeatId, number][] } | null = null
  private p1DiscardAmounts: Partial<Record<SeatId, number>> = {}
  private p1AwardCard: string | null = null
  private p1TieRounds: TieRound[] = []

  // P2 scratch (per turn): bets keyed by actorId survive relocation; placements
  // snapshot lets C0 find actors at disabled locations after board.placements clears.
  private turnBets = new Map<ActorId, BetType>()
  private turnPlacements: Placement[] = []
  // Sealed commits as they land (distribution.staged is omniscient here). The P2
  // lines are built from these, not from the post-intent board: on turn 1 the
  // reveal, all of P4 and the board's clearing happen inside ONE intent (turn 1
  // has no P3 — rulebook §Turn Structure), so `after.board` is already empty.
  private stagedPlacements = new Map<SeatId, Placement[]>()

  // P3 scratch (per turn)
  private selectCodes = new Map<SeatId, string[]>()
  private emittedSteps = new Set<string>() // 's1'..'s4'
  private tiebreakContext: string | null = null
  private relocCollisions: {
    actorId: ActorId
    contenders: { seat: SeatId; to: LocationId }[]
    winner: SeatId | null
  }[] = []
  private relocTieRounds: TieRound[] = []

  // P4 scratch (per turn)
  private p4Started = false
  private peacefulGroups: { locationId: LocationId; results: PeacefulResult[] }[] = []
  private conflictCounter = 0
  private conflicts = new Map<number, ConflictScratch>()

  // P5 scratch (per turn)
  private marketDraws = new Map<SeatId, string[]>()
  private marketBought = new Map<SeatId, { requested: number; bought: number }>()

  constructor(gameId: string) {
    this.lines.push(`G${gameId}`)
  }

  finish(): string[] {
    return this.lines
  }

  // --- line/header helpers ---
  private push(line: string): void {
    this.lines.push(line)
  }
  private header(h: string): void {
    if (this.lastHeader !== h) {
      this.lines.push(h)
      this.lastHeader = h
    }
  }

  feed(
    before: GameState,
    seat: SeatId,
    intent: Intent,
    events: EngineEvent[],
    after: GameState
  ): void {
    // Card selections must be resolved to codes from the hand BEFORE the reveal —
    // block cards are consumed from the hand within this same intent.
    if (intent.type === 'action.selectCards') {
      const hand = before.inventories[seat]?.hand ?? []
      this.selectCodes.set(
        seat,
        intent.cardInstanceIds.map((id) => {
          const inst = hand.find((c) => c.instanceId === id)
          return inst ? ACTION_CARD_CODE[inst.card] : id
        })
      )
    }
    for (const e of events) this.handleEvent(e, after)
    this.postIntent(after)
  }

  private handleEvent(e: EngineEvent, after: GameState): void {
    switch (e.type) {
      case 'turn.advanced': {
        this.flushMarket(after)
        this.currentTurn = (e.payload as { turn: number }).turn
        this.resetTurnScratch()
        return
      }
      // --- P1 ---
      case 'event.drawn': {
        const card = (e.payload as { card: EventCardId }).card
        this.p1Card = card
        this.p1TieRounds = []
        this.p1AwardCard = null
        this.p1DiscardAmounts = {}
        const metric = COMPARE_EVENT_METRIC[card as keyof typeof COMPARE_EVENT_METRIC]
        if (metric) {
          const perSeat: [SeatId, number][] = after.activeSeats.map((s) => {
            const v = valuesOf(after, s)
            const val = metric === 'total' ? v.power + v.art + v.knowledge + v.fame : v[metric]
            return [s, val]
          })
          this.p1Metric = { letter: metric === 'total' ? '' : VALUE_CODE[metric], perSeat }
        } else {
          this.p1Metric = null
        }
        return
      }
      case 'event.discardsRevealed': {
        this.p1DiscardAmounts = (e.payload as { amounts: Partial<Record<SeatId, number>> }).amounts
        return
      }
      case 'event.cardAwarded': {
        this.p1AwardCard = ACTION_CARD_CODE[(e.payload as { card: ActionCardId }).card]
        return
      }
      case 'event.resolved': {
        this.emitP1Line(e.payload)
        this.tiebreakContext = null
        return
      }
      // --- tie-break ceremony (routed by the context of its first round) ---
      case 'tiebreak.roundStarted': {
        const ctx = (e.payload as { context?: string }).context
        if (ctx) this.tiebreakContext = ctx
        return
      }
      case 'tiebreak.choicesRevealed': {
        const p = e.payload as { round: number; choices: Partial<Record<SeatId, Rps>> }
        const round = { round: p.round, choices: p.choices }
        if (this.tiebreakContext === 'event') this.p1TieRounds.push(round)
        else if (this.tiebreakContext === 'relocation') this.relocTieRounds.push(round)
        return
      }
      case 'tiebreak.resolved': {
        if (this.tiebreakContext !== 'event') this.tiebreakContext = null
        return
      }
      // --- P2 ---
      case 'distribution.staged': {
        const p = e.payload as { seat: SeatId; placements: Placement[] }
        this.stagedPlacements.set(
          p.seat,
          p.placements.map((pl) => ({ ...pl }))
        )
        return
      }
      case 'distribution.revealed': {
        this.emitP2Lines(after)
        return
      }
      // --- P3 ---
      case 'action.selectionsRevealed': {
        this.emitSelectLines(after)
        return
      }
      case 'action.relocationCollision': {
        const p = e.payload as {
          actorId: ActorId
          contenders: { seat: SeatId; to: LocationId }[]
          winner: SeatId | null
        }
        this.relocCollisions.push(p)
        return
      }
      // --- P4 ---
      case 'conflict.detected': {
        this.p4Started = true
        this.peacefulGroups = []
        return
      }
      case 'conflict.opened': {
        const p = e.payload as { index: number; locationId: LocationId }
        this.conflictCounter += 1
        this.conflicts.set(p.index, {
          n: this.conflictCounter,
          locationId: p.locationId,
          participants: [],
          round1: {},
          bets: [],
          rounds: []
        })
        return
      }
      case 'conflict.revealed': {
        const p = e.payload as {
          index: number
          participants: { actorId: ActorId; seat: SeatId; argument?: ArgumentType; bet?: BetType }[]
        }
        const c = this.conflicts.get(p.index)
        if (c) c.participants = p.participants
        return
      }
      case 'conflict.betsApplied': {
        const p = e.payload as {
          index: number
          bets: { actorId: ActorId; seat: SeatId; bet: BetType; success: boolean }[]
        }
        const c = this.conflicts.get(p.index)
        if (c) c.bets = p.bets
        return
      }
      case 'conflict.roundResolved': {
        const p = e.payload as {
          index: number
          round: number
          choices?: Partial<Record<SeatId, Rps>>
          outcomes: Partial<Record<ActorId, Outcome>>
        }
        const c = this.conflicts.get(p.index)
        if (!c) return
        if (p.round === 1) c.round1 = p.outcomes
        else c.rounds.push({ round: p.round, choices: p.choices ?? {}, outcomes: p.outcomes })
        return
      }
      case 'conflict.rewards': {
        const p = e.payload as {
          index?: number
          locationId: LocationId
          peaceful?: boolean
          results: PeacefulResult[]
        }
        if (p.peaceful) this.peacefulGroups.push({ locationId: p.locationId, results: p.results })
        else if (p.index !== undefined) this.emitConflictBlock(p.index, p.results)
        return
      }
      // --- P5 ---
      case 'market.cardDrawn': {
        const p = e.payload as { seat: SeatId; card: ActionCardId }
        const list = this.marketDraws.get(p.seat) ?? []
        list.push(ACTION_CARD_CODE[p.card])
        this.marketDraws.set(p.seat, list)
        return
      }
      case 'market.bought': {
        const p = e.payload as { seat: SeatId; requested: number; bought: number }
        this.marketBought.set(p.seat, { requested: p.requested, bought: p.bought })
        return
      }
      // --- elimination ---
      case 'player.eliminated': {
        this.push(`${P((e.payload as { seat: SeatId }).seat)}=0`)
        return
      }
    }
  }

  /** After an intent's events: emit any P3 sub-step that just landed, then flush C0. */
  private postIntent(after: GameState): void {
    if (after.phase.kind === 'p3_action') {
      const step = after.phase.step
      if (step.t === 'blocks_ack' && !this.emittedSteps.has('s2'))
        this.emitBlocks(after, step.blocks)
      if (step.t === 'relocations_ack' && !this.emittedSteps.has('s3'))
        this.emitRelocate(after, step.moves)
      if (step.t === 'exchanges_ack' && !this.emittedSteps.has('s4'))
        this.emitExchange(after, step.exchanges)
    }
    if (this.p4Started) {
      this.emitC0(after)
      this.p4Started = false
    }
  }

  private resetTurnScratch(): void {
    this.p1Card = null
    this.p1Metric = null
    this.p1DiscardAmounts = {}
    this.p1AwardCard = null
    this.p1TieRounds = []
    this.turnBets = new Map()
    this.turnPlacements = []
    this.stagedPlacements = new Map()
    this.selectCodes = new Map()
    this.emittedSteps = new Set()
    this.tiebreakContext = null
    this.relocCollisions = []
    this.relocTieRounds = []
    this.p4Started = false
    this.peacefulGroups = []
    this.conflictCounter = 0
    this.conflicts = new Map()
    this.marketDraws = new Map()
    this.marketBought = new Map()
  }

  // --- P1 rendering ---

  private emitP1Line(payload: unknown): void {
    const p = payload as {
      card: EventCardId
      kind: 'compare' | 'discard'
      winner: unknown
      fame?: number
      drewCard?: boolean
    }
    this.header(`T${this.currentTurn}p1`)
    if (p.kind === 'compare') {
      const metric = this.p1Metric ?? { letter: '', perSeat: [] as [SeatId, number][] }
      const base = metric.perSeat.map(([s, v]) => `${P(s)}-${v}${metric.letter}`).join(',')
      let line = `${EVENT_CARD_CODE[p.card]}:${base}`
      const fame = p.fame ?? 1
      const finalResult = (): string => {
        const ws = winnerSeat(p.winner)
        return ws === null ? 'D' : `${P(ws)}+${fame}F`
      }
      if (this.p1TieRounds.length === 0) {
        const ws = winnerSeat(p.winner)
        if (ws !== null) line += `:${P(ws)}+${fame}F`
      } else {
        line += `=D${this.renderTieRounds(this.p1TieRounds, finalResult)}`
      }
      this.push(line)
      return
    }
    // discard
    const card = p.card
    const resource = DISCARD_EVENT_RESOURCE[card as keyof typeof DISCARD_EVENT_RESOURCE]
    const resLetter = resource ? RESOURCE_CODE[resource] : ''
    const seats = Object.keys(this.p1DiscardAmounts)
      .map((k) => Number(k) as SeatId)
      .sort((a, b) => a - b)
    const base = seats.map((s) => `${P(s)}-${this.p1DiscardAmounts[s] ?? 0}${resLetter}`).join(',')
    let line = `${EVENT_CARD_CODE[card]}:${base}`
    const w = p.winner as SeatId | null
    const winStr = (): string => {
      if (w === null || w === undefined) return 'D'
      return `${P(w)}${p.drewCard && this.p1AwardCard ? `+${this.p1AwardCard}` : ''}`
    }
    if (this.p1TieRounds.length === 0) {
      if (w !== null && w !== undefined) line += `:${winStr()}`
    } else {
      line += `=D${this.renderTieRounds(this.p1TieRounds, winStr)}`
    }
    this.push(line)
  }

  private renderTieRounds(rounds: TieRound[], finalResult: () => string): string {
    let out = ''
    rounds.forEach((rd, i) => {
      const isFinal = i === rounds.length - 1
      const seats = Object.keys(rd.choices)
        .map((k) => Number(k) as SeatId)
        .sort((a, b) => a - b)
      const args = seats.map((s) => `${P(s)}-${RPS_CODE[rd.choices[s] as Rps]}`).join(',')
      out += `/Cr${i + 1}:${args}=${isFinal ? finalResult() : 'D'}`
    })
    return out
  }

  // --- P2 rendering ---

  private emitP2Lines(after: GameState): void {
    // Same order the engine puts on the board: active seats, then actor order.
    // Eliminated seats drop out — their sealed commit never reaches the board.
    const revealed = after.activeSeats.flatMap((s) => this.stagedPlacements.get(s) ?? [])
    this.turnPlacements = revealed.map((p) => ({ ...p }))
    this.turnBets = new Map()
    for (const pl of revealed) if (pl.bet) this.turnBets.set(pl.actorId, pl.bet)
    this.header(`T${this.currentTurn}p2`)
    for (const loc of LOCATIONS) {
      const here = revealed.filter((pl) => pl.locationId === loc)
      if (here.length === 0) continue
      const parts = here.map(
        (pl) =>
          `${P(pl.seat)}-${ACTOR_CODE[pl.actorType]}-${ARG_CODE[pl.argument]}-${pl.bet ? BET_CODE[pl.bet] : 'B0'}`
      )
      this.push(`${LOC_CODE[loc]}:${parts.join(',')}`)
    }
  }

  // --- P3 rendering ---

  private emitSelectLines(after: GameState): void {
    this.header(`T${this.currentTurn}p3s1`)
    for (const s of after.activeSeats) {
      const codes = this.selectCodes.get(s) ?? []
      this.push(`${P(s)}:${codes.length ? codes.join(',') : '0'}`)
    }
    this.emittedSteps.add('s1')
  }

  private emitBlocks(after: GameState, blocks: BlockPlay[]): void {
    this.header(`T${this.currentTurn}p3s2`)
    for (const s of after.activeSeats) {
      const mine = blocks.filter((b) => b.seat === s)
      const body = mine.length
        ? mine.map((b) => `${ACTION_CARD_CODE[b.card]}:${LOC_CODE[b.locationId]}=0`).join(',')
        : '0'
      this.push(`${P(s)}:${body}`)
    }
    this.emittedSteps.add('s2')
  }

  private emitRelocate(after: GameState, moves: RelocationMove[]): void {
    this.header(`T${this.currentTurn}p3s3`)
    for (const s of after.activeSeats) {
      const mine = moves.filter((m) => m.seat === s)
      const body = mine.length
        ? mine
            .map(
              (m) =>
                `Re:${LOC_CODE[m.from]}:${P(seatOfActor(m.actorId))}-${ACTOR_CODE[actorTypeOf(m.actorId)]}-${LOC_CODE[m.to]}`
            )
            .join(',')
        : '0'
      this.push(`${P(s)}:${body}`)
    }
    // Player-vs-player collisions on the same actor: the RPS rounds, then the win.
    if (this.relocCollisions.length > 0 && this.relocTieRounds.length > 0) {
      const winner = this.relocCollisions[0]?.winner ?? null
      const won = winner !== null ? moves.find((m) => m.seat === winner) : undefined
      this.relocTieRounds.forEach((rd, i) => {
        const isFinal = i === this.relocTieRounds.length - 1
        const seats = Object.keys(rd.choices)
          .map((k) => Number(k) as SeatId)
          .sort((a, b) => a - b)
        const args = seats.map((s) => `${P(s)}-${RPS_CODE[rd.choices[s] as Rps]}`).join(',')
        if (!isFinal) {
          this.push(`Cr${i + 1}:${args}=${seats.map((s) => `${P(s)}-D`).join(',')}`)
          return
        }
        const res = seats.map((s) => `${P(s)}-${s === winner ? 'W' : 'L'}`).join(',')
        const tail = won
          ? `:Re:${LOC_CODE[won.from]}:${P(seatOfActor(won.actorId))}-${ACTOR_CODE[actorTypeOf(won.actorId)]}-${LOC_CODE[won.to]}`
          : ''
        this.push(`Cr${i + 1}:${args}=${res}${tail}`)
      })
    }
    this.emittedSteps.add('s3')
  }

  private emitExchange(after: GameState, exchanges: ExchangePlay[]): void {
    this.header(`T${this.currentTurn}p3s4`)
    for (const s of after.activeSeats) {
      const mine = exchanges.filter((x) => x.seat === s)
      const body = mine.length
        ? mine.map((x) => `Cv:${VALUE_CODE[x.give]}-${P(x.from)}-${VALUE_CODE[x.take]}`).join(',')
        : '0'
      this.push(`${P(s)}:${body}`)
    }
    this.emittedSteps.add('s4')
  }

  // --- P4 rendering ---

  /** One aggregate C0 line: peaceful singletons (grouped by location) + blocked locations. */
  private emitC0(after: GameState): void {
    const placements = after.board.placements.length ? after.board.placements : this.turnPlacements
    const blocked = new Set(
      LOCATIONS.filter(
        (loc) =>
          after.board.disabledLocations.includes(loc) &&
          placements.some((pl) => pl.locationId === loc)
      )
    )
    const segments: string[] = []
    for (const loc of LOCATIONS) {
      if (blocked.has(loc)) {
        segments.push(`${LOC_CODE[loc]}=0`)
        continue
      }
      const groups = this.peacefulGroups.filter((g) => g.locationId === loc)
      if (groups.length === 0) continue
      const results = groups.flatMap((g) => g.results).map((r) => this.fmtPeaceful(r))
      segments.push(`${LOC_CODE[loc]}:${results.join('/')}`)
    }
    if (segments.length === 0) return
    this.header(`T${this.currentTurn}p4`)
    this.push(`C0/${segments.join('/')}`)
  }

  private fmtPeaceful(r: PeacefulResult): string {
    const bet = this.turnBets.get(r.actorId)
    // Peaceful actors auto-win: a win bet succeeds (BS), a draw/lose bet fails (BF).
    const betStr = bet === 'win' ? '-BS' : bet === 'lose' || bet === 'draw' ? '-BF' : ''
    return `${P(r.seat)}-${OUTCOME_CODE[r.outcome]}${betStr}${fmtReward(r.reward)}`
  }

  /** Emit a whole real-conflict block once its finalize rewards fire. */
  private emitConflictBlock(index: number, results: PeacefulResult[]): void {
    const c = this.conflicts.get(index)
    if (!c) return
    this.header(`T${this.currentTurn}p4`)
    const loc = LOC_CODE[c.locationId]
    const rewardBy = new Map<ActorId, PeacefulResult>()
    for (const r of results) rewardBy.set(r.actorId, r)
    const betStr = (actorId: ActorId): string => {
      const b = c.bets.find((x) => x.actorId === actorId)
      return b ? (b.success ? '-BS' : '-BF') : ''
    }
    const hasReRounds = c.rounds.length > 0

    if (!hasReRounds) {
      const parts = c.participants.map((pt) => {
        const r = rewardBy.get(pt.actorId)
        const outcome = r ? r.outcome : (c.round1[pt.actorId] ?? 'lose')
        return `${P(pt.seat)}-${OUTCOME_CODE[outcome]}${betStr(pt.actorId)}${fmtReward(r?.reward)}`
      })
      this.push(`C${c.n}/${loc}:${parts.join(',')}`)
      return
    }

    // Baseline = round-1 base outcomes + bet result (no reward yet).
    const baseline = c.participants.map(
      (pt) => `${P(pt.seat)}-${OUTCOME_CODE[c.round1[pt.actorId] ?? 'lose']}${betStr(pt.actorId)}`
    )
    this.push(`C${c.n}/${loc}:${baseline.join(',')}`)
    c.rounds.forEach((rd, i) => {
      const k = i + 1
      const isFinal = i === c.rounds.length - 1
      const argParts = c.participants
        .filter((pt) => rd.choices[pt.seat] !== undefined)
        .map((pt) => `${P(pt.seat)}-${RPS_CODE[rd.choices[pt.seat] as Rps]}`)
      const resParts = c.participants.map((pt) => {
        if (isFinal) {
          const r = rewardBy.get(pt.actorId)
          const outcome = r ? r.outcome : (rd.outcomes[pt.actorId] ?? 'lose')
          return `${P(pt.seat)}-${OUTCOME_CODE[outcome]}${fmtReward(r?.reward)}`
        }
        return `${P(pt.seat)}-${OUTCOME_CODE[rd.outcomes[pt.actorId] ?? 'lose']}`
      })
      this.push(`C${c.n}r${k}:${argParts.join(',')}:${resParts.join('/')}`)
    })
  }

  // --- P5 rendering ---

  /** Flush the just-ended turn's market: one line per active seat (0 = no buy). */
  private flushMarket(after: GameState): void {
    const seats = [...after.activeSeats].sort((a, b) => a - b)
    if (seats.length === 0) return
    this.header(`T${this.currentTurn}p5`)
    for (const s of seats) {
      const bought = this.marketBought.get(s)?.bought ?? 0
      const draws = this.marketDraws.get(s) ?? []
      this.push(`${P(s)}:${bought}${draws.map((c) => `+${c}`).join('')}`)
    }
  }
}

interface PeacefulResult {
  actorId: ActorId
  seat: SeatId
  outcome: Outcome
  winBet?: boolean
  reward?: unknown
}

/** EventWinner {kind:'seat'|'team'} → a representative seat (first of the team in 2v2). */
function winnerSeat(winner: unknown): SeatId | null {
  if (!winner || typeof winner !== 'object') return null
  const w = winner as { kind: string; seat?: SeatId; team?: number }
  if (w.kind === 'seat' && w.seat !== undefined) return w.seat
  if (w.kind === 'team' && w.team !== undefined) return (w.team === 0 ? 0 : 1) as SeatId
  return null
}
