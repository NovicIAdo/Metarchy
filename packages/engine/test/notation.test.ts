// Match-notation renderer — scripts a small deterministic game, captures the
// {seat,intent} log while playing, then asserts toNotation() reconstructs it into
// spec-well-formed lines (headers, P2 placement lines, the C0 peaceful line, a real
// conflict with a re-resolution round, and a market line). We verify well-formedness
// against the code tables — not the owner's exact example.

import { describe, expect, it } from 'vitest'
import { toNotation } from '../src/index.js'
import type { Intent, NotationConfig, SeatId } from '../src/index.js'
import {
  customPlacements,
  newGame,
  passReveal,
  passSummary,
  peacefulPlacements,
  playThroughP1,
  resolveAll,
  selectNoCards
} from './helpers.js'

/** Wrap a TestGame so every applied intent is recorded in order for replay. */
function recording(seed: string): {
  g: ReturnType<typeof newGame>
  log: { seat: SeatId; intent: Intent }[]
  config: NotationConfig
} {
  const g = newGame(seed)
  const log: { seat: SeatId; intent: Intent }[] = []
  const orig = g.apply.bind(g)
  g.apply = (seat: SeatId, intent: Intent) => {
    log.push({ seat, intent })
    return orig(seat, intent)
  }
  const config: NotationConfig = {
    gameId: 'g-test',
    mode: '1v1',
    seed,
    seatCount: 2,
    controllers: ['human', 'human']
  }
  return { g, log, config }
}

/** Turn 1: two politicians collide at the square (draw → re-fight); everyone else
 * is peaceful; seat 0 buys a market card. Turn 2: a P1 event, then a peaceful P4. */
function scriptGame(seed: string): { lines: string[] } {
  const { g, log, config } = recording(seed)

  // --- Turn 1: placements → one politician conflict, the rest peaceful ---
  g.apply(0, {
    type: 'distribution.commit',
    placements: customPlacements(0, { politician: { locationId: 'square', argument: 'rock' } })
  })
  g.apply(1, {
    type: 'distribution.commit',
    placements: customPlacements(1, { politician: { locationId: 'square', argument: 'rock' } })
  })
  passReveal(g)

  // P4: turn 1 has no P3 (rulebook §Turn Structure), so the last commit opens the
  // conflicts. Peaceful actors auto-resolve; the square politicians draw then re-fight.
  expect(g.state.phase.kind).toBe('p4_conflict')
  resolveAll(g)

  // P5 market: seat 0 buys one card, seat 1 buys nothing.
  passSummary(g)
  expect(g.state.phase.kind).toBe('p5_market')
  g.apply(0, { type: 'market.buy' })
  g.apply(0, { type: 'market.done' })
  g.apply(1, { type: 'market.done' })

  // --- Turn 2: the P1 event fires, then a fully peaceful distribution → P4 ---
  expect(g.state.phase.kind).toBe('p1_event')
  playThroughP1(g)
  expect(g.state.phase.kind).toBe('p2_distribution')
  for (const seat of [0, 1] as SeatId[])
    g.apply(seat, { type: 'distribution.commit', placements: peacefulPlacements(seat) })
  passReveal(g)
  selectNoCards(g) // turn 2 does have a P3
  // Peaceful turn 2 auto-runs P4 and lands in P5.
  passSummary(g)
  expect(g.state.phase.kind).toBe('p5_market')

  return { lines: toNotation(config, log) }
}

// --- Well-formedness: every token must come from the spec code tables ----------

const HEADER = /^T\d+p(?:[125]|3s[1-4]|4)$/
const LOC = '(?:LS|LT|LU|LF|LP|LD)'
const ACTOR = '(?:AP|AS|AA|AR)'
const ARG = '(?:ar|as|ap|ad)'
const BET = '(?:BW|BD|BL|B0)'
const OUT = '[WDL]'
const VAL = '[PKAF]'
const RES = '[per]'
const CARD = '(?:Re|Cv|Sa|St|Ch|Co|Bl|Ec)'
const EVENT = '(?:EPR|EEC|ECD|ERE|EHP|EEH|EPE)'
const REWARD = `(?:\\+\\d+(?:${VAL}|${RES}))?`

// A single participant chunk inside a P2/P4/P5 line.
const P2_PART = `P\\d-${ACTOR}-${ARG}-${BET}`
const P2_LINE = new RegExp(`^${LOC}:${P2_PART}(?:,${P2_PART})*$`)
// C0 segment: either a blocked location (LF=0) or peaceful results grouped by loc.
const C0_RESULT = `P\\d-${OUT}(?:-B[SF])?${REWARD}`
const C0_SEG = `(?:${LOC}=0|${LOC}:${C0_RESULT}(?:/${C0_RESULT})*)`
const C0_LINE = new RegExp(`^C0/${C0_SEG}(?:/${C0_SEG})*$`)
// Real conflict baseline + re-round lines.
const CN_BASE = new RegExp(
  `^C\\d+/${LOC}:P\\d-${OUT}(?:-B[SF])?${REWARD}(?:,P\\d-${OUT}(?:-B[SF])?${REWARD})*$`
)
const CN_ROUND = new RegExp(
  `^C\\d+r\\d+:P\\d-${ARG}(?:,P\\d-${ARG})*:P\\d-${OUT}${REWARD}(?:/P\\d-${OUT}${REWARD})*$`
)
// P3 sub-step lines (per seat).
const P3_SELECT = new RegExp(`^P\\d:(?:0|${CARD}(?:,${CARD})*)$`)
const P3_BLOCK = new RegExp(`^P\\d:(?:0|${CARD}:${LOC}=0(?:,${CARD}:${LOC}=0)*)$`)
const P3_RELOC = new RegExp(
  `^P\\d:(?:0|Re:${LOC}:P\\d-${ACTOR}-${LOC}(?:,Re:${LOC}:P\\d-${ACTOR}-${LOC})*)$`
)
const P3_EXCH = new RegExp(`^P\\d:(?:0|Cv:${VAL}-P\\d-${VAL}(?:,Cv:${VAL}-P\\d-${VAL})*)$`)
// P5 market line: count then one +Card per drawn card.
const P5_LINE = new RegExp(`^P\\d:\\d(?:\\+${CARD})*$`)
// P1 event: compare (metric values, optional =D re-rounds) or discard (amounts+resource).
const P1_COMPARE = new RegExp(`^${EVENT}:P\\d-\\d+${VAL}?(?:,P\\d-\\d+${VAL}?)*`)
const P1_DISCARD = new RegExp(`^${EVENT}:P\\d-\\d+${RES}(?:,P\\d-\\d+${RES})*`)

function isWellFormed(line: string): boolean {
  if (line.startsWith('G')) return true
  if (HEADER.test(line)) return true
  if (line.startsWith('C0/')) return C0_LINE.test(line)
  if (/^C\d+\//.test(line)) return CN_BASE.test(line)
  if (/^C\d+r/.test(line)) return CN_ROUND.test(line)
  if (line.startsWith('E')) return P1_COMPARE.test(line) || P1_DISCARD.test(line)
  if (line.startsWith('L')) return P2_LINE.test(line)
  if (/^P\d=0$/.test(line)) return true
  if (/^P\d:/.test(line))
    return (
      P3_SELECT.test(line) ||
      P3_BLOCK.test(line) ||
      P3_RELOC.test(line) ||
      P3_EXCH.test(line) ||
      P5_LINE.test(line)
    )
  return false
}

describe('toNotation: signature and headers', () => {
  it('opens with the G<gameId> line and only emits recognized headers', () => {
    const { lines } = scriptGame('notation-seed')
    expect(lines[0]).toBe('Gg-test')
    const headers = lines.filter((l) => HEADER.test(l))
    expect(headers).toContain('T1p2')
    expect(headers).toContain('T1p4')
    expect(headers).toContain('T2p4') // the record spans into turn 2's conflict phase
  })
})

describe('toNotation: every line is spec-well-formed', () => {
  it('produces no malformed line across a full multi-turn record', () => {
    const { lines } = scriptGame('notation-seed')
    const bad = lines.filter((l) => !isWellFormed(l))
    expect(bad).toEqual([])
  })
})

describe('toNotation: P2 distribution lines', () => {
  it('emits one location line listing every actor with its argument and bet', () => {
    const { lines } = scriptGame('notation-seed')
    const t1p2 = lines.indexOf('T1p2')
    expect(t1p2).toBeGreaterThan(0)
    const p2Lines = lines.slice(t1p2 + 1).filter((l) => /^L/.test(l))
    expect(p2Lines.length).toBeGreaterThan(0)
    // The square holds both politicians (the conflict) and seat 1's artist (peaceful).
    const square = p2Lines.find((l) => l.startsWith('LS:'))
    expect(square).toBeDefined()
    expect(P2_LINE.test(square as string)).toBe(true)
    expect((square as string).match(/AP/g)?.length).toBe(2)
    for (const l of p2Lines) expect(P2_LINE.test(l)).toBe(true)
  })
})

describe('toNotation: P3 select sub-step', () => {
  it('tags the select sub-step and lists a line per seat', () => {
    const { lines } = scriptGame('notation-seed')
    // Turn 1 has no P3 at all (rulebook §Turn Structure) — the record opens the
    // select sub-step on turn 2, the first turn anyone can hold a card.
    expect(lines).not.toContain('T1p3s1')
    expect(lines).toContain('T2p3s1')
    const idx = lines.indexOf('T2p3s1')
    const selectLines = lines.slice(idx + 1, idx + 3)
    expect(selectLines).toEqual(['P1:0', 'P2:0']) // seat 0 holds its market card, plays none
  })
})

describe('toNotation: P4 peaceful C0 line', () => {
  it('aggregates peaceful singletons grouped by location', () => {
    const { lines } = scriptGame('notation-seed')
    const c0 = lines.find((l) => l.startsWith('C0/'))
    expect(c0).toBeDefined()
    expect(C0_LINE.test(c0 as string)).toBe(true)
    // Peaceful robots produce location resources: at least one +Ne/+Np/+Nr grant.
    expect(c0 as string).toMatch(/\+\d+[per]/)
  })
})

describe('toNotation: real conflict with a re-resolution round', () => {
  it('emits a C1 baseline (draw) and a C1r1 re-fight round with the winner reward', () => {
    const { lines } = scriptGame('notation-seed')
    const base = lines.find((l) => /^C1\/L/.test(l))
    const round = lines.find((l) => /^C1r1:/.test(l))
    expect(base).toBeDefined()
    expect(round).toBeDefined()
    expect(CN_BASE.test(base as string)).toBe(true)
    expect(CN_ROUND.test(round as string)).toBe(true)
    // The politician conflict is at the square; round 1 is a draw for both.
    expect(base as string).toMatch(/^C1\/LS:P\d-D/)
    // The re-fight is decisive: exactly one W with a power reward, one L.
    expect(round as string).toMatch(/-W\+\d+P/)
    expect(round as string).toMatch(/-L(?:\/|$)/)
  })
})

describe('toNotation: P5 market line', () => {
  it('shows the buy count and each drawn card, or 0 for no buy', () => {
    const { lines } = scriptGame('notation-seed')
    expect(lines).toContain('T1p5')
    const idx = lines.indexOf('T1p5')
    const marketLines = lines.slice(idx + 1, idx + 3)
    expect(marketLines).toHaveLength(2)
    for (const l of marketLines) expect(P5_LINE.test(l)).toBe(true)
    // Seat 0 bought exactly one card (drew one), seat 1 bought none.
    expect(marketLines[0]).toMatch(new RegExp(`^P1:1\\+${CARD}$`))
    expect(marketLines[1]).toBe('P2:0')
  })
})

describe('toNotation: P1 event line on turn 2', () => {
  it('emits a well-formed event line under the T2p1 header', () => {
    const { lines } = scriptGame('notation-seed')
    expect(lines).toContain('T2p1')
    const idx = lines.indexOf('T2p1')
    const eventLine = lines[idx + 1] as string
    expect(P1_COMPARE.test(eventLine) || P1_DISCARD.test(eventLine)).toBe(true)
  })
})
