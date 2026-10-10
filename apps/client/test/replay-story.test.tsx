// Author backlog #7: a replay used to show only where Actors stood. The events,
// the Action Cards, the conflict resolutions, the purchases and draws and the
// money were all in the record but never on screen. These tests drive a REAL
// three-player game through the engine (bot intents, fixed PRNG), rebuild it the
// way the viewer does, and check that the story and the economy are actually
// there — then mount the real panels over that real game.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState, Intent, SeatId } from '@metarchy/engine'
import { applyIntent, chooseBotIntent, createGame, waitingOn } from '@metarchy/engine'
import type { PlayerSummary } from '@metarchy/protocol'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { buildReplay, groupLog } = await import('../src/screens/replay/buildReplay.js')
const { ReplayFeed, describeLogItem, itemForFrame } =
  await import('../src/screens/replay/ReplayFeed.js')
const { ReplayEconomy, ReplayScoreboard } = await import('../src/screens/replay/ReplayEconomy.js')
const { makeDomainLabels } = await import('../src/i18n/domain.js')
const { translate } = await import('../src/i18n/index.js')
const { useSettingsStore } = await import('../src/stores/settings.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** Deterministic PRNG — the bots must make the same game on every run. */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CONFIG = {
  gameId: 'g-story',
  mode: 'ffa3' as const,
  // This seed's game happens to contain everything the author asked to see:
  // both event kinds, a market purchase, a block card, a relocation, bets that
  // played and failed, a re-resolved conflict, an elimination and a finish.
  // It moved from 'probe-2' when the end-of-Phase-4 recap added an intent per
  // turn: the bots draw from the same PRNG stream, so one more draw reshapes
  // every later decision. If a rules change does that again, search for the
  // next seed whose game still contains all of the kinds asserted below.
  seed: 'probe-3',
  seatCount: 3,
  controllers: ['human', 'human', 'bot'] as ('human' | 'bot')[]
}

const PLAYERS: PlayerSummary[] = [
  { seat: 0 as SeatId, nickname: 'ann', bot: false, avatar: null },
  { seat: 1 as SeatId, nickname: 'asa', bot: false, avatar: null },
  { seat: 2 as SeatId, nickname: 'okesha', bot: true, avatar: null }
]

/** Play the whole game with bot intents and keep the ordered move log. */
function playedGame(): { seat: SeatId; intent: Intent }[] {
  const random = mulberry32(1234)
  let state: GameState = createGame(CONFIG)
  const log: { seat: SeatId; intent: Intent }[] = []
  let guard = 0
  while (state.phase.kind !== 'finished' && guard++ < 5000) {
    const pending = waitingOn(state)
    if (pending.length === 0) break
    const seat = pending[0] as SeatId
    const intent = chooseBotIntent(state, seat, random)
    if (!intent) break
    const result = applyIntent(state, seat, intent)
    if (!result.ok) throw new Error(`${intent.type} rejected: ${result.error.code}`)
    log.push({ seat, intent })
    state = result.state
  }
  if (state.phase.kind !== 'finished') throw new Error('the fixture game never finished')
  return log
}

const INTENTS = playedGame()
const BUILD = buildReplay(CONFIG, INTENTS)
const kinds = new Set(BUILD.log.map((x) => x.body.t))

const ctx = () => {
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(useSettingsStore.getState().language, key, vars)
  return {
    t,
    d: makeDomainLabels(t),
    nameOf: (seat: SeatId) => PLAYERS.find((p) => p.seat === seat)?.nickname ?? `#${seat}`
  }
}
const textOf = (id: number): string => {
  const item = BUILD.log.find((x) => x.id === id)
  if (!item) throw new Error(`no log item ${id}`)
  const line = describeLogItem(item.body, ctx())
  return [line.text, ...line.sub].join(' | ')
}
const firstOf = <T extends (typeof BUILD.log)[number]['body']['t']>(t: T) => {
  const item = BUILD.log.find((x) => x.body.t === t)
  if (!item) throw new Error(`the fixture game has no ${t} item`)
  return item
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useSettingsStore.setState({ language: 'en' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useSettingsStore.setState({ language: 'en' })
})

describe('replay story feed', () => {
  it('records everything the author asked for, from the engine event stream', () => {
    expect(BUILD.truncated).toBe(false)
    // Events, Action Cards, conflict resolutions, purchases, draws — all present.
    for (const kind of [
      'event', // which Events came up
      'discards',
      'eventCard', // which card the event winner drew
      'placements', // who stood where, with which argument and bet
      'cards', // which Action Cards each player played
      'block',
      'reloc',
      'conflict', // how each conflict resolved…
      'bets',
      'round', // …including a re-resolution round
      'result',
      'peaceful',
      'market', // who bought what
      'eliminated',
      'scoring',
      'finished'
    ])
      expect(
        [...kinds],
        `no "${kind}" line in the fixture game — if a rules change reshaped seed ` +
          `"${CONFIG.seed}", pick another seed whose game still contains one`
      ).toContain(kind)
  })

  it('keeps the story in play order and every line pointing at a real frame', () => {
    let previous = -1
    for (const item of BUILD.log) {
      expect(item.frame).toBeGreaterThanOrEqual(0)
      expect(item.frame).toBeLessThan(BUILD.frames.length)
      expect(item.frame).toBeGreaterThanOrEqual(previous)
      previous = item.frame
    }
    // Grouping is by turn+phase, and turns only ever move forward.
    const groups = groupLog(BUILD.log)
    expect(groups.length).toBeGreaterThan(10)
    const turns = groups.map((g) => g.turn)
    expect([...turns]).toEqual([...turns].sort((a, b) => a - b))
    // Every line points at a frame from its own turn — including the market,
    // which pays out in the same intent that ticks the clock to the next turn.
    for (const item of BUILD.log) expect(BUILD.frames[item.frame]?.turn).toBe(item.turn)
    const market = firstOf('market')
    expect(market.phase).toBe(5)
    expect(BUILD.frames[market.frame]?.phaseKind).toBe('p5_market')
  })

  it('tells a conflict as arguments → bets → resolution, with the reward', () => {
    const conflict = firstOf('conflict')
    if (conflict.body.t !== 'conflict') throw new Error('narrowing')
    expect(conflict.body.sides.length).toBeGreaterThanOrEqual(2)
    // Arguments AND bets are legible — the replay view hides nothing.
    expect(conflict.body.sides.some((s) => s.bet !== null)).toBe(true)
    expect(conflict.body.sides.every((s) => s.outcome !== null)).toBe(true)
    expect(textOf(conflict.id)).toContain('Conflict 1')
    expect(textOf(conflict.id)).toMatch(/bet: (Win|Draw|Lose)/)

    // A bet verdict line reads as played/failed, never as a number.
    const bets = firstOf('bets')
    expect(textOf(bets.id)).toMatch(/bet (played|failed)/)

    // A resolution line carries the outcome and the reward the engine granted.
    const result = firstOf('result')
    if (result.body.t !== 'result') throw new Error('narrowing')
    expect(result.body.results.some((r) => r.reward !== null)).toBe(true)
    expect(textOf(result.id)).toMatch(
      /\+\d (Power|Art|Knowledge|Fame|Product|Electricity|Recycling)/
    )

    // A re-resolution shows the throws that settled it.
    const round = firstOf('round')
    if (round.body.t !== 'round') throw new Error('narrowing')
    expect(round.body.picks.length).toBeGreaterThanOrEqual(2)
    expect(textOf(round.id)).toContain('Resolving again')
  })

  it('names the cards drawn and bought, and marks the bot honestly', () => {
    const market = firstOf('market')
    if (market.body.t !== 'market') throw new Error('narrowing')
    expect(market.body.cards).toHaveLength(market.body.bought)
    const text = textOf(market.id)
    expect(text).toMatch(/bought \d/)
    // Card names, not instance ids.
    expect(text).toMatch(
      /Relocation|Sabotage|Blackout|Change of Values|Charity Event|Under Construction|Student Protests|Ecological Protests/
    )

    // The event prize card is named too — "which cards each player drew".
    const drew = firstOf('eventCard')
    if (drew.body.t !== 'eventCard') throw new Error('narrowing')
    expect(drew.body.card).not.toBeNull()

    // A bot seat renders as a bot, not as a human.
    act(() =>
      root.render(
        <ReplayFeed
          log={BUILD.log}
          tieBreakerTurns={BUILD.tieBreakerTurns}
          frame={0}
          players={PLAYERS}
          onJump={() => {}}
        />
      )
    )
    expect(host.textContent).toContain('okesha 🤖')
  })

  it('mounts, follows the playhead and jumps the board when a line is tapped', () => {
    const onJump = vi.fn()
    const target = firstOf('conflict')
    act(() =>
      root.render(
        <ReplayFeed
          log={BUILD.log}
          tieBreakerTurns={BUILD.tieBreakerTurns}
          frame={target.frame}
          players={PLAYERS}
          onJump={onJump}
        />
      )
    )
    // Turn/phase headers group the feed so a viewer can follow the story.
    expect(host.textContent).toContain('Turn 1')
    expect(host.textContent).toContain('Phase 4 · Conflicts')
    // Exactly one line is marked as the current moment.
    const current = host.querySelectorAll('.replay-feed-item.current')
    expect(current).toHaveLength(1)
    expect(itemForFrame(BUILD.log, target.frame)?.frame).toBe(target.frame)

    const line = host.querySelector<HTMLButtonElement>('.replay-feed-line')
    act(() => line?.click())
    expect(onJump).toHaveBeenCalledWith(BUILD.log[0]?.frame)
  })

  it('speaks the rulebook Russian when the language switches', () => {
    useSettingsStore.setState({ language: 'ru' })
    const c = ctx()
    const conflict = firstOf('conflict')
    const line = describeLogItem(conflict.body, c)
    expect(line.text).toContain('Конфликт')
    expect([line.text, ...line.sub].join(' ')).toContain('ставка')
    // A conflict is *разрешается* — never "fought" (author rule).
    expect(describeLogItem(firstOf('result').body, c).text).toBe('Разрешение')
    const placements = describeLogItem(firstOf('placements').body, c)
    expect(placements.sub.join(' ')).toMatch(/Политик|Учёный|Артист|Робот/)
    expect(c.t('replay.turn', { n: 3 })).toBe('Ход 3')
  })
})

describe('replay economy', () => {
  it('closes a row for the opening position and for every turn played', () => {
    const lastTurn = BUILD.frames[BUILD.frames.length - 1]?.turn ?? 0
    expect(BUILD.economy[0]?.turn).toBe(0)
    expect(BUILD.economy.map((r) => r.turn)).toEqual([
      0,
      ...Array.from({ length: lastTurn }, (_, i) => i + 1)
    ])
    // Opening position is the rulebook's 1/1/1 with empty Value pools.
    const start = BUILD.economy[0]?.seats ?? []
    expect(start).toHaveLength(3)
    for (const seat of start) {
      expect(seat.resources).toEqual({ product: 1, electricity: 1, recycling: 1 })
      expect(seat.values).toEqual({ power: 0, art: 0, knowledge: 0, fame: 0 })
    }
  })

  it('deltas are exactly the change from the turn before', () => {
    for (let i = 1; i < BUILD.economy.length; i++) {
      const row = BUILD.economy[i]
      const previous = BUILD.economy[i - 1]
      for (const seat of row?.seats ?? []) {
        const was = previous?.seats.find((s) => s.seat === seat.seat)
        expect(seat.dResources.product).toBe(seat.resources.product - (was?.resources.product ?? 0))
        expect(seat.dValues.power).toBe(seat.values.power - (was?.values.power ?? 0))
        expect(seat.dValues.fame).toBe(seat.values.fame - (was?.values.fame ?? 0))
      }
    }
  })

  it('shows bets, purchases and rewards as the reason a number moved', () => {
    // The turn someone shopped: the purchase is annotated and the cards named.
    const market = firstOf('market')
    if (market.body.t !== 'market') throw new Error('narrowing')
    const row = BUILD.economy.find((r) => r.turn === market.turn)
    const buyer = row?.seats.find((s) => s.seat === (market.body as { seat: SeatId }).seat)
    expect(buyer?.bought).toBe(market.body.bought)
    expect(buyer?.drew.length).toBeGreaterThanOrEqual(market.body.bought)
    // Bets are recorded for the turn they were placed in, and rewards too.
    const withBets = BUILD.economy.find((r) => r.seats.some((s) => s.bets.length > 0))
    expect(withBets).toBeDefined()
    const withRewards = BUILD.economy.find((r) => r.seats.some((s) => s.rewards.length > 0))
    expect(withRewards).toBeDefined()
  })

  it('renders the table with signed deltas and the reasons in words', () => {
    act(() =>
      root.render(
        <ReplayEconomy
          economy={BUILD.economy}
          tieBreakerTurns={BUILD.tieBreakerTurns}
          players={PLAYERS}
        />
      )
    )
    const text = host.textContent ?? ''
    expect(text).toContain('Opening position')
    expect(text).toContain('After turn 1')
    expect(text).toContain('ann')
    // A signed change is rendered, not just a running total.
    expect(host.querySelectorAll('.eco-up').length).toBeGreaterThan(0)
    expect(text).toMatch(/bets: (Win|Lose|Draw)/)
    expect(text).toMatch(/won \+\d/)
    // The eliminated seat is stated as out instead of showing a phantom −4.
    expect(text).toContain('out of the game')
  })

  it('puts the live totals of every seat under the board', () => {
    const last = BUILD.frames[BUILD.frames.length - 1]
    if (!last) throw new Error('no frames')
    act(() => root.render(<ReplayScoreboard view={last.view} players={PLAYERS} />))
    const seats = host.querySelectorAll('.replay-score-seat')
    expect(seats).toHaveLength(3)
    // 3 resources + 4 Values per seat, straight off the omniscient replay view.
    expect(host.querySelectorAll('.replay-score-seat .hud-mini-stat')).toHaveLength(21)
    expect(host.textContent).toContain('okesha 🤖')
  })
})
