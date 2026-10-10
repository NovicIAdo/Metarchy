// Author backlog #8: opening Global Stats while WATCHING someone else's match
// threw. A watcher's view is seatless — `view.seat` is the sentinel -1 — so any
// personal read (SEAT_COLORS[-1], my resources, my hand) either crashes or
// invents an "own" row that does not exist. These tests drive the real engine to
// a mid-game state, project the real spectator view and mount the real panel.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Intent, PlacementInput, PlayerView, SeatId } from '@metarchy/engine'
import { applyIntent, createGame, projectSpectatorView, projectView } from '@metarchy/engine'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { GlobalStats } = await import('../src/screens/game/GlobalStats.js')
const { TopBar } = await import('../src/screens/game/HudPanels.js')
const { useGameStore } = await import('../src/stores/game.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** Conflict-free layout: every Actor alone at its Location, so turn 1 resolves. */
const PEACEFUL: Record<number, PlacementInput[]> = {
  0: [
    { actorType: 'politician', locationId: 'square', argument: 'rock' },
    { actorType: 'scientist', locationId: 'university', argument: 'paper' },
    { actorType: 'artist', locationId: 'theatre', argument: 'scissors' },
    { actorType: 'robot', locationId: 'factory', argument: 'dummy' }
  ],
  1: [
    { actorType: 'politician', locationId: 'university', argument: 'rock' },
    { actorType: 'scientist', locationId: 'theatre', argument: 'paper' },
    { actorType: 'artist', locationId: 'square', argument: 'scissors' },
    { actorType: 'robot', locationId: 'power_plant', argument: 'dummy' }
  ]
}

/** Turn 1 played out peacefully; seat 0 leaves the market with a bought card. */
function midGame(): { spectator: PlayerView; player: PlayerView } {
  let state = createGame({ gameId: 'g-watch', mode: '1v1', seed: 'watch-seed' })
  const step = (seat: SeatId, intent: Intent): void => {
    const result = applyIntent(state, seat, intent)
    if (!result.ok) throw new Error(`${intent.type} from seat ${seat}: ${result.error.code}`)
    state = result.state
  }
  for (const seat of [0, 1] as SeatId[])
    step(seat, { type: 'distribution.commit', placements: PEACEFUL[seat] as PlacementInput[] })
  // The last commit reveals the board and the phase holds there until both have
  // looked; then turn 1 goes straight into Phase 4 (no Action Phase), which
  // always ends on its recap, peaceful board or not.
  for (const seat of [0, 1] as SeatId[]) step(seat, { type: 'distribution.reveal.ack' })
  for (const seat of [0, 1] as SeatId[]) step(seat, { type: 'conflict.summary.ack' })
  step(0, { type: 'market.buy' })
  for (const seat of [0, 1] as SeatId[]) step(seat, { type: 'market.done' })
  return {
    spectator: projectSpectatorView(state),
    player: projectView(state, 0 as SeatId)
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useGameStore.setState({
    players: [
      { seat: 0, nickname: 'alice', bot: false, avatar: null },
      { seat: 1, nickname: 'bob', bot: false, avatar: null }
    ],
    presence: {}
  } as never)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const panel = (): HTMLElement | null => document.querySelector('.global-stats')
const rows = (): HTMLElement[] => [...document.querySelectorAll('.hud-player')] as HTMLElement[]

describe('Global Stats while watching another match', () => {
  it('opens for a watcher and lists every player with their public stats', () => {
    const { spectator, player } = midGame()
    expect(spectator.spectator).toBe(true)
    expect(spectator.seat).toBe(-1)

    act(() => root.render(<GlobalStats view={spectator} onClose={() => {}} />))

    expect(panel()).not.toBeNull()
    // One row per seat that is actually in the game — and no phantom row for -1.
    const names = rows().map((r) => r.querySelector('.hud-player-name')?.textContent)
    expect(names).toEqual(['alice', 'bob'])
    // The public numbers a watcher is entitled to: resources + Values + hand size.
    const seat0 = rows()[0] as HTMLElement
    const stats = [...seat0.querySelectorAll('.hud-mini-stat')].map((n) => n.textContent?.trim())
    expect(stats).toHaveLength(8) // 3 resources + hand count + 4 Values
    // Seat 0 bought a card in the market: 1 card in hand, same as a player sees.
    expect(stats[3]).toBe(String(player.me.hand.length))
    // Values really came from the engine's turn-1 payout, not from zeroes.
    expect(spectator.values[0]).toEqual(player.values[0])
  })

  it('never shows a watcher a fake "own" row or a personal hand', () => {
    const { spectator } = midGame()
    act(() => root.render(<GlobalStats view={spectator} onClose={() => {}} />))

    const text = panel()?.textContent ?? ''
    expect(text).not.toContain('(you)') // game.stats.you — a watcher has no seat
    expect(text).not.toContain('Your hand')
    expect(panel()?.querySelector('.cards-hand')).toBeNull()
    // Public tables are still there: decks and the play log.
    expect(text).toContain('Decks')
    expect(text).toContain('Events played')
    expect(text).toContain('Action Cards played')
  })

  it('still marks the own row for a seated player', () => {
    const { player } = midGame()
    act(() => root.render(<GlobalStats view={player} onClose={() => {}} />))
    const names = rows().map((r) => r.querySelector('.hud-player-name')?.textContent)
    expect(names).toEqual(['alice (you)', 'bob'])
    expect(panel()?.textContent).toContain('Your hand')
  })

  it('offers the opener to a watcher, with only public counts beside it', () => {
    const { spectator } = midGame()
    const onStats = vi.fn()
    act(() => root.render(<TopBar view={spectator} onStats={onStats} />))

    const button = document.body.querySelector<HTMLButtonElement>('.hud-stats-btn')
    expect(button).not.toBeNull()
    act(() => button?.click())
    expect(onStats).toHaveBeenCalledOnce()
    // The personal half of the strip would be a row of fake zeroes for a
    // seatless watcher; only the two public deck counters remain.
    const strip = [...document.body.querySelectorAll('.hud-strip-stat')].map((s) => s.textContent)
    expect(strip).toEqual([String(spectator.decks.event), String(spectator.decks.action)])
  })
})
