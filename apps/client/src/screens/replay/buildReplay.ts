// Replay reconstruction — one pass over the move log that produces everything
// the viewer shows: board frames, the per-turn story feed, and the economy table.
//
// The server only stores seed + intents (protocol `replay.data`), so we re-apply
// them through the engine locally. Nothing here needs a protocol change: the
// engine hands back the same EngineEvent stream the live table saw, and a
// finished game has no secrets left — `projectReplayView` is omniscient by
// design, so arguments, bets, draws and hands are all legible.
//
// Author backlog #7: a replay used to show only where Actors stood. The events,
// the Action Cards, how each conflict resolved, who bought or drew what, and how
// resources/Values moved were all recorded (`toNotation` prints them in code
// form) but never surfaced. This module turns that same event stream into
// structured, translatable items instead of coded text.

import type {
  ActionCardId,
  ActorId,
  ActorType,
  ArgumentType,
  BetType,
  EventCardId,
  GameState,
  Intent,
  LocationId,
  Mode,
  Outcome,
  PlayerView,
  ResourceType,
  Resources,
  Rps,
  SeatId,
  ValueType,
  Values
} from '@metarchy/engine'
import {
  COMPARE_EVENT_METRIC,
  DISCARD_EVENT_RESOURCE,
  actorTypeOf,
  applyIntent,
  createGame,
  projectReplayView,
  valuesOf
} from '@metarchy/engine'

// --- Public shapes ---------------------------------------------------------------

export interface ReplayFrame {
  view: PlayerView
  turn: number
  phaseKind: string
  seq: number
}

/** A reward exactly as the engine granted it (grantReward): +2 Power, +3 recycling… */
export interface ReplayReward {
  kind: 'value' | 'resource'
  type: ValueType | ResourceType
  amount: number
}

export type EliminationReason = 'disconnect' | 'forfeit' | 'scoring'

export type ReplayLogBody =
  /** P1 draw, with the public standings that decided it. */
  | {
      t: 'event'
      card: EventCardId
      metric: ValueType | 'total' | null
      resource: ResourceType | null
      standings: { seat: SeatId; amount: number }[] | null
    }
  | { t: 'discards'; resource: ResourceType; amounts: { seat: SeatId; amount: number }[] }
  | { t: 'eventWinner'; seats: SeatId[]; fame: number }
  | { t: 'eventDraw' }
  /** The Action Card the discard winner drew (null = the deck was empty). */
  | { t: 'eventCard'; seat: SeatId; card: ActionCardId | null }
  | { t: 'tiebreak'; round: number; picks: { seat: SeatId; rps: Rps }[] }
  | { t: 'tiebreakWon'; seats: SeatId[] }
  | {
      t: 'placements'
      seat: SeatId
      rows: {
        actorType: ActorType
        locationId: LocationId
        argument: ArgumentType
        bet: BetType | null
      }[]
    }
  | { t: 'cards'; seat: SeatId; cards: ActionCardId[] }
  | { t: 'block'; seat: SeatId; card: ActionCardId; locationId: LocationId }
  | {
      t: 'reloc'
      seat: SeatId
      ownerSeat: SeatId
      actorType: ActorType
      from: LocationId
      to: LocationId
    }
  | { t: 'relocNone' }
  | { t: 'collision'; actorType: ActorType; winner: SeatId | null }
  | { t: 'exchange'; seat: SeatId; give: ValueType; take: ValueType; from: SeatId }
  | {
      t: 'conflict'
      n: number
      locationId: LocationId
      actorType: ActorType
      sides: {
        seat: SeatId
        argument: ArgumentType
        bet: BetType | null
        outcome: Outcome | null
      }[]
    }
  | {
      t: 'round'
      n: number
      round: number
      picks: { seat: SeatId; rps: Rps }[]
      outcomes: { seat: SeatId; actorType: ActorType; outcome: Outcome }[]
    }
  | { t: 'bets'; n: number; bets: { seat: SeatId; bet: BetType; success: boolean }[] }
  | { t: 'deadlock'; n: number }
  | {
      t: 'result'
      n: number
      locationId: LocationId
      results: {
        seat: SeatId
        actorType: ActorType
        outcome: Outcome
        reward: ReplayReward | null
      }[]
    }
  | {
      t: 'peaceful'
      results: {
        seat: SeatId
        actorType: ActorType
        locationId: LocationId
        reward: ReplayReward | null
      }[]
    }
  | { t: 'closed'; locationId: LocationId; actors: { seat: SeatId; actorType: ActorType }[] }
  | { t: 'market'; seat: SeatId; requested: number; bought: number; cards: ActionCardId[] }
  | { t: 'eliminated'; seat: SeatId; reason: EliminationReason; vp: number | null }
  | { t: 'scoring'; sides: { seats: SeatId[]; vp: number }[] }
  | { t: 'finished'; winnerSeats: SeatId[] }

export interface ReplayLogItem {
  /** Stable index in the whole feed. */
  id: number
  turn: number
  /** 1–5 = game phase, 0 = outside a phase (elimination, scoring, game over). */
  phase: 0 | 1 | 2 | 3 | 4 | 5
  /** Board frame that shows the state right after this happened. */
  frame: number
  body: ReplayLogBody
}

/** Why a seat's numbers moved this turn — the annotations beside the deltas. */
export interface ReplayEconomyWhy {
  bets: BetType[]
  bought: number
  drew: ActionCardId[]
  discarded: { resource: ResourceType; amount: number } | null
  rewards: ReplayReward[]
}

export interface ReplayEconomySeat extends ReplayEconomyWhy {
  seat: SeatId
  resources: Resources
  values: Values
  dResources: Resources
  dValues: Values
  eliminated: boolean
}

export interface ReplayEconomyRow {
  /** 0 = the opening position, otherwise the numbers at the end of that turn. */
  turn: number
  seats: ReplayEconomySeat[]
}

export interface ReplayBuild {
  frames: ReplayFrame[]
  log: ReplayLogItem[]
  economy: ReplayEconomyRow[]
  /** Turns played past MAX_TURNS to break a VP tie. */
  tieBreakerTurns: number[]
  /** True when an intent was rejected mid-log — the replay stops there. */
  truncated: boolean
}

export interface ReplayBuildConfig {
  gameId: string
  mode: Mode
  seed: string
  seatCount: number
  controllers: ('human' | 'bot')[]
}

// --- Frame boundaries ------------------------------------------------------------

/** A new frame whenever the turn, phase, P3 sub-step, or conflict index changes. */
export function boundaryKey(s: GameState): string {
  const p = s.phase
  const sub =
    p.kind === 'p3_action'
      ? `:${p.step.t}`
      : p.kind === 'p4_conflict'
        ? `:${p.index}:${p.stage.t}`
        : ''
  return `${s.turn}:${p.kind}${sub}`
}

const PHASE_OF: Record<string, 0 | 1 | 2 | 3 | 4 | 5> = {
  p1_event: 1,
  p2_distribution: 2,
  p3_action: 3,
  p4_conflict: 4,
  p5_market: 5,
  finished: 0
}

/** "T3p4" — the header the raw notation record uses, for cross-highlighting. */
export function notationHeader(turn: number, phaseKind: string): string {
  return `T${turn}p${PHASE_OF[phaseKind] ?? 0}`
}

// --- Small helpers ---------------------------------------------------------------

const ZERO_RES: Resources = { product: 0, electricity: 0, recycling: 0 }

function resourcesOf(state: GameState, seat: SeatId): Resources {
  return { ...(state.inventories[seat]?.resources ?? ZERO_RES) }
}

function diffRes(now: Resources, before: Resources): Resources {
  return {
    product: now.product - before.product,
    electricity: now.electricity - before.electricity,
    recycling: now.recycling - before.recycling
  }
}

function diffVal(now: Values, before: Values): Values {
  return {
    power: now.power - before.power,
    art: now.art - before.art,
    knowledge: now.knowledge - before.knowledge,
    fame: now.fame - before.fame
  }
}

function emptyWhy(): ReplayEconomyWhy {
  return { bets: [], bought: 0, drew: [], discarded: null, rewards: [] }
}

function asReward(reward: unknown): ReplayReward | null {
  if (!reward || typeof reward !== 'object') return null
  const r = reward as ReplayReward
  if (r.kind !== 'value' && r.kind !== 'resource') return null
  return { kind: r.kind, type: r.type, amount: r.amount }
}

function seatsOf(record: Partial<Record<SeatId, unknown>>): SeatId[] {
  return Object.keys(record)
    .map((k) => Number(k) as SeatId)
    .sort((a, b) => a - b)
}

/** {kind:'seat'|'team'} → the seats that won (a 2v2 team wins as a pair). */
function winnerSeats(state: GameState, winner: unknown): SeatId[] {
  if (winner === null || winner === undefined) return []
  if (typeof winner === 'number') return [winner as SeatId]
  if (typeof winner !== 'object') return []
  const w = winner as { kind: string; seat?: SeatId; team?: number }
  if (w.kind === 'seat' && w.seat !== undefined) return [w.seat]
  if (w.kind === 'team' && w.team !== undefined)
    return [...((state.meta.teams?.[w.team === 0 ? 0 : 1] ?? []) as SeatId[])]
  return []
}

// --- Builder ---------------------------------------------------------------------

/**
 * Replay a finished game into frames + story + economy. Pure and deterministic:
 * the same seed and log always produce the same output (the guarantee
 * `toNotation` and the server's recovery path already rely on).
 */
export function buildReplay(
  config: ReplayBuildConfig,
  intents: { seat: SeatId; intent: Intent }[]
): ReplayBuild {
  let state = createGame({
    gameId: config.gameId,
    mode: config.mode,
    seed: config.seed,
    seatCount: config.seatCount,
    controllers: config.controllers
  })

  const frames: ReplayFrame[] = []
  const log: ReplayLogItem[] = []
  const economy: ReplayEconomyRow[] = []
  const tieTurns = new Set<number>()
  let truncated = false

  const pushFrame = (s: GameState): void => {
    if (s.isTieBreakerTurn) tieTurns.add(s.turn)
    frames.push({ view: projectReplayView(s), turn: s.turn, phaseKind: s.phase.kind, seq: s.seq })
  }
  pushFrame(state)
  let key = boundaryKey(state)

  // Items of the current intent wait for its frame: they describe what just
  // happened, so they point at the state that shows the consequence. The turn is
  // captured per item — the market of turn 3 fires in the same intent that
  // advances the clock to turn 4.
  let pending: { turn: number; phase: 0 | 1 | 2 | 3 | 4 | 5; body: ReplayLogBody }[] = []
  let turn = state.turn
  const add = (phase: 0 | 1 | 2 | 3 | 4 | 5, body: ReplayLogBody): void => {
    // Peaceful results are collected across a burst of events and collapse into
    // one line; flushing here keeps that line in its true place in the story.
    if (body.t !== 'peaceful' && peaceful.length > 0) flushPeaceful()
    pending.push({ turn, phase, body })
  }

  // Per-turn scratch.
  let selected = new Map<SeatId, ActionCardId[]>()
  let conflicts = new Map<number, { n: number; item: Extract<ReplayLogBody, { t: 'conflict' }> }>()
  let conflictCount = 0
  let peaceful: Extract<ReplayLogBody, { t: 'peaceful' }>['results'] = []
  let tieContext: string | null = null
  let relocsDone = false
  const flushPeaceful = (): void => {
    const results = peaceful
    peaceful = []
    if (results.length > 0) add(4, { t: 'peaceful', results })
  }
  let why = new Map<SeatId, ReplayEconomyWhy>()
  const whyOf = (seat: SeatId): ReplayEconomyWhy => {
    const existing = why.get(seat)
    if (existing) return existing
    const fresh = emptyWhy()
    why.set(seat, fresh)
    return fresh
  }
  const resetTurn = (): void => {
    selected = new Map()
    conflicts = new Map()
    conflictCount = 0
    peaceful = []
    tieContext = null
    relocsDone = false
    why = new Map()
  }

  const snapshot = (s: GameState, rowTurn: number): void => {
    const previous = economy[economy.length - 1]
    const seats: ReplayEconomySeat[] = s.meta.seats.map((m) => {
      const resources = resourcesOf(s, m.seat)
      const values = { ...valuesOf(s, m.seat) }
      const was = previous?.seats.find((x) => x.seat === m.seat)
      return {
        seat: m.seat,
        resources,
        values,
        dResources: diffRes(resources, was?.resources ?? resources),
        dValues: diffVal(values, was?.values ?? values),
        eliminated: s.eliminated.includes(m.seat),
        ...(why.get(m.seat) ?? emptyWhy())
      }
    })
    economy.push({ turn: rowTurn, seats })
  }
  snapshot(state, 0)

  for (const { seat, intent } of intents) {
    const before = state
    // Card identities must be read off the hand BEFORE the intent: selected
    // cards are consumed from it within the same intent (same trick as notation).
    if (intent.type === 'action.selectCards') {
      const hand = before.inventories[seat]?.hand ?? []
      const ids = (intent as { cardInstanceIds: string[] }).cardInstanceIds
      const cards = ids
        .map((id) => hand.find((c) => c.instanceId === id)?.card)
        .filter((c): c is ActionCardId => c !== undefined)
      if (cards.length > 0) selected.set(seat, cards)
    }

    const result = applyIntent(before, seat, intent)
    if (!result.ok) {
      truncated = true
      break
    }
    state = result.state
    let endedTurn: number | null = null

    for (const e of result.events) {
      const p = (e.payload ?? {}) as Record<string, unknown>
      switch (e.type) {
        // --- turn boundary ---
        case 'turn.advanced': {
          endedTurn = turn
          turn = p.turn as number
          break
        }

        // --- P1 event ---
        case 'event.drawn': {
          const card = p.card as EventCardId
          const metric = (
            COMPARE_EVENT_METRIC as Partial<Record<EventCardId, ValueType | 'total'>>
          )[card]
          const resource = (DISCARD_EVENT_RESOURCE as Partial<Record<EventCardId, ResourceType>>)[
            card
          ]
          const standings = metric
            ? state.activeSeats.map((s) => {
                const v = valuesOf(state, s)
                const amount =
                  metric === 'total'
                    ? v.power + v.art + v.knowledge + v.fame
                    : v[metric as ValueType]
                return { seat: s, amount }
              })
            : null
          add(1, {
            t: 'event',
            card,
            metric: metric ?? null,
            resource: resource ?? null,
            standings
          })
          break
        }
        case 'event.discardsRevealed': {
          const amounts = p.amounts as Partial<Record<SeatId, number>>
          const card = state.phase.kind === 'p1_event' ? state.phase.card : null
          const resource =
            (card
              ? (DISCARD_EVENT_RESOURCE as Partial<Record<EventCardId, ResourceType>>)[card]
              : null) ?? 'product'
          const rows = seatsOf(amounts).map((s) => ({ seat: s, amount: amounts[s] ?? 0 }))
          for (const row of rows)
            if (row.amount > 0) whyOf(row.seat).discarded = { resource, amount: row.amount }
          add(1, { t: 'discards', resource, amounts: rows })
          break
        }
        case 'event.cardAwarded': {
          const won = p.seat as SeatId
          const card = p.card as ActionCardId
          whyOf(won).drew.push(card)
          add(1, { t: 'eventCard', seat: won, card })
          break
        }
        case 'event.resolved': {
          const seats = winnerSeats(state, p.winner)
          if (seats.length === 0) {
            add(1, { t: 'eventDraw' })
            break
          }
          if (p.kind === 'compare') {
            add(1, { t: 'eventWinner', seats, fame: (p.fame as number) ?? 1 })
            break
          }
          // Discard event: the card award already told the story; this only adds
          // the "won but the deck was empty" case.
          if (!p.drewCard) add(1, { t: 'eventCard', seat: seats[0] as SeatId, card: null })
          break
        }

        // --- tie-break ceremony (event / relocation / conflict deadlock) ---
        case 'tiebreak.roundStarted': {
          if (typeof p.context === 'string') tieContext = p.context
          break
        }
        case 'tiebreak.choicesRevealed': {
          const choices = p.choices as Partial<Record<SeatId, Rps>>
          add(tieContext === 'event' ? 1 : tieContext === 'relocation' ? 3 : 4, {
            t: 'tiebreak',
            round: p.round as number,
            picks: seatsOf(choices).map((s) => ({ seat: s, rps: choices[s] as Rps }))
          })
          break
        }
        case 'tiebreak.resolved': {
          const seats = winnerSeats(state, p.winner)
          if (seats.length > 0)
            add(tieContext === 'event' ? 1 : tieContext === 'relocation' ? 3 : 4, {
              t: 'tiebreakWon',
              seats
            })
          break
        }

        // --- P2 distribution ---
        case 'distribution.revealed': {
          // The event itself keeps arguments and bets sealed (they open in P4);
          // the omniscient replay reads them straight off the revealed board.
          for (const m of state.meta.seats) {
            const mine = state.board.placements.filter((pl) => pl.seat === m.seat)
            if (mine.length === 0) continue
            for (const pl of mine) if (pl.bet) whyOf(m.seat).bets.push(pl.bet)
            add(2, {
              t: 'placements',
              seat: m.seat,
              rows: mine.map((pl) => ({
                actorType: pl.actorType,
                locationId: pl.locationId,
                argument: pl.argument,
                bet: pl.bet ?? null
              }))
            })
          }
          break
        }

        // --- P3 action cards ---
        case 'action.selectionsRevealed': {
          for (const s of state.activeSeats) {
            const cards = selected.get(s)
            if (cards && cards.length > 0) add(3, { t: 'cards', seat: s, cards })
          }
          break
        }
        case 'action.locationBlocked': {
          add(3, {
            t: 'block',
            seat: p.seat as SeatId,
            card: p.card as ActionCardId,
            locationId: p.locationId as LocationId
          })
          break
        }
        case 'action.relocationCollision': {
          add(3, {
            t: 'collision',
            actorType: actorTypeOf(p.actorId as ActorId),
            winner: (p.winner as SeatId | null) ?? null
          })
          break
        }
        case 'action.exchanged': {
          add(3, {
            t: 'exchange',
            seat: p.seat as SeatId,
            give: p.give as ValueType,
            take: p.take as ValueType,
            from: p.from as SeatId
          })
          break
        }

        // --- P4 conflicts ---
        case 'conflict.detected': {
          peaceful = []
          for (const loc of state.board.disabledLocations) {
            const stuck = state.board.placements.filter((pl) => pl.locationId === loc)
            if (stuck.length === 0) continue
            add(4, {
              t: 'closed',
              locationId: loc,
              actors: stuck.map((pl) => ({ seat: pl.seat, actorType: pl.actorType }))
            })
          }
          break
        }
        case 'conflict.revealed': {
          const index = p.index as number
          conflictCount += 1
          const participants = p.participants as {
            actorId: ActorId
            seat: SeatId
            argument: ArgumentType
            bet?: BetType
          }[]
          const item: Extract<ReplayLogBody, { t: 'conflict' }> = {
            t: 'conflict',
            n: conflictCount,
            locationId: p.locationId as LocationId,
            actorType: p.actorType as ActorType,
            sides: participants.map((x) => ({
              seat: x.seat,
              argument: x.argument,
              bet: x.bet ?? null,
              outcome: null
            }))
          }
          conflicts.set(index, { n: conflictCount, item })
          add(4, item)
          break
        }
        case 'conflict.roundResolved': {
          const index = p.index as number
          const known = conflicts.get(index)
          const outcomes = p.outcomes as Partial<Record<ActorId, Outcome>>
          const round = p.round as number
          const bySeat = (s: SeatId): Outcome | null => {
            const hit = Object.entries(outcomes).find(([id]) => Number(id.split(':')[0]) === s)
            return (hit?.[1] as Outcome | undefined) ?? null
          }
          if (round === 1) {
            // Round 1 rides along on the conflict line — one line, whole story.
            if (known)
              known.item.sides = known.item.sides.map((side) => ({
                ...side,
                outcome: bySeat(side.seat)
              }))
            break
          }
          const choices = (p.choices ?? {}) as Partial<Record<SeatId, Rps>>
          add(4, {
            t: 'round',
            n: known?.n ?? index + 1,
            round,
            picks: seatsOf(choices).map((s) => ({ seat: s, rps: choices[s] as Rps })),
            outcomes: Object.entries(outcomes).map(([id, outcome]) => ({
              seat: Number(id.split(':')[0]) as SeatId,
              actorType: actorTypeOf(id as ActorId),
              outcome: outcome as Outcome
            }))
          })
          break
        }
        case 'conflict.betsApplied': {
          const bets = p.bets as { seat: SeatId; bet: BetType; success: boolean }[]
          if (bets.length === 0) break
          add(4, {
            t: 'bets',
            n: conflicts.get(p.index as number)?.n ?? (p.index as number) + 1,
            bets: bets.map((b) => ({ seat: b.seat, bet: b.bet, success: b.success }))
          })
          break
        }
        case 'conflict.deadlock': {
          add(4, { t: 'deadlock', n: conflicts.get(p.index as number)?.n ?? 1 })
          break
        }
        case 'conflict.rewards': {
          const raw = p.results as {
            actorId: ActorId
            seat: SeatId
            outcome: Outcome
            reward?: unknown
          }[]
          const results = raw.map((r) => ({
            seat: r.seat,
            actorType: actorTypeOf(r.actorId),
            outcome: r.outcome,
            reward: asReward(r.reward)
          }))
          for (const r of results) if (r.reward) whyOf(r.seat).rewards.push(r.reward)
          if (p.peaceful) {
            peaceful.push(
              ...results.map((r) => ({
                seat: r.seat,
                actorType: r.actorType,
                locationId: p.locationId as LocationId,
                reward: r.reward
              }))
            )
            break
          }
          add(4, {
            t: 'result',
            n: conflicts.get(p.index as number)?.n ?? 0,
            locationId: p.locationId as LocationId,
            results
          })
          break
        }

        // --- P5 market ---
        case 'market.cardDrawn': {
          whyOf(p.seat as SeatId).drew.push(p.card as ActionCardId)
          break
        }
        case 'market.bought': {
          const buyer = p.seat as SeatId
          const bought = p.bought as number
          const requested = p.requested as number
          if (bought === 0 && requested === 0) break
          const w = whyOf(buyer)
          w.bought += bought
          // The cards this seat drew at this market are the tail of its draws.
          add(5, { t: 'market', seat: buyer, requested, bought, cards: w.drew.slice(-bought) })
          break
        }

        // --- end of the road ---
        case 'player.eliminated': {
          const gone = p.seat as SeatId
          const record = [...(state.eliminationLog ?? [])].reverse().find((x) => x.seat === gone)
          add(0, {
            t: 'eliminated',
            seat: gone,
            reason: (p.reason as EliminationReason) ?? 'scoring',
            vp: record?.vp ?? null
          })
          break
        }
        case 'scoring.result': {
          add(0, { t: 'scoring', sides: p.sides as { seats: SeatId[]; vp: number }[] })
          break
        }
        case 'game.finished': {
          add(0, { t: 'finished', winnerSeats: (p.winnerSeats as SeatId[]) ?? [] })
          break
        }
      }
    }

    // Relocations carry their mover on the ack step, not on the event — read the
    // wave off the step once it lands (an empty wave is a story too: every order
    // cancelled out).
    if (
      state.phase.kind === 'p3_action' &&
      state.phase.step.t === 'relocations_ack' &&
      !relocsDone
    ) {
      const moves = state.phase.step.moves
      if (moves.length === 0) add(3, { t: 'relocNone' })
      for (const m of moves)
        add(3, {
          t: 'reloc',
          seat: m.seat,
          ownerSeat: Number(m.actorId.split(':')[0]) as SeatId,
          actorType: actorTypeOf(m.actorId),
          from: m.from,
          to: m.to
        })
      relocsDone = true
    }

    flushPeaceful()

    const nextKey = boundaryKey(state)
    if (nextKey !== key) {
      pushFrame(state)
      key = nextKey
    }
    const frame = frames.length - 1
    for (const item of pending) {
      // One intent can close a turn and open the next (the market pays out and
      // the clock ticks together). Such an item belongs to the turn it happened
      // in, so point it at the last frame of THAT turn, not at the new one.
      let at = frame
      while (at > 0 && frames[at]?.turn !== item.turn) at -= 1
      if (frames[at]?.turn !== item.turn) at = frame
      log.push({ id: log.length, turn: item.turn, phase: item.phase, frame: at, body: item.body })
    }
    pending = []

    if (endedTurn !== null) {
      snapshot(state, endedTurn)
      resetTurn()
    }
  }

  if (frames[frames.length - 1]?.seq !== state.seq) pushFrame(state)
  // The final turn never fires turn.advanced — close its economy row here.
  if (economy[economy.length - 1]?.turn !== turn) snapshot(state, turn)

  return { frames, log, economy, tieBreakerTurns: [...tieTurns].sort((a, b) => a - b), truncated }
}

/** Items grouped for the feed: turn → phase → items, in play order. */
export interface ReplayLogGroup {
  turn: number
  phase: 0 | 1 | 2 | 3 | 4 | 5
  items: ReplayLogItem[]
}

export function groupLog(log: ReplayLogItem[]): ReplayLogGroup[] {
  const groups: ReplayLogGroup[] = []
  for (const item of log) {
    const last = groups[groups.length - 1]
    if (last && last.turn === item.turn && last.phase === item.phase) last.items.push(item)
    else groups.push({ turn: item.turn, phase: item.phase, items: [item] })
  }
  return groups
}
