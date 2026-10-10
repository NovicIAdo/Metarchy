// The on-board argument/bet picker (prototype flow): pick an argument coin,
// then a bet coin or Skip — the placement stages immediately, no Confirm.
// Arguments already used by other staged actors never show; unaffordable
// bets are disabled. There is no Cancel button: a pointer-down anywhere off
// the plate cancels and drops the actor's staged placement (back to hand).

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView } from '@metarchy/engine'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { ArgBetPicker } = await import('../src/screens/game/ArgBetPicker.js')
const { useUiStore } = await import('../src/stores/ui.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function p2View(resources: {
  product: number
  electricity: number
  recycling: number
}): PlayerView {
  return {
    gameId: '66666666-6666-4666-8666-666666666666',
    mode: '1v1',
    rulesVersion: '1.0.0',
    seat: 0,
    turn: 1,
    isTieBreakerTurn: false,
    activeSeats: [0, 1],
    eliminated: [],
    decks: { event: 7, action: 15 },
    values: [
      { power: 0, art: 0, knowledge: 0, fame: 0 },
      { power: 0, art: 0, knowledge: 0, fame: 0 }
    ],
    me: { resources, hand: [] },
    allies: [],
    others: [{ seat: 1, handCount: 0, resources: null }],
    board: { placements: [], disabledLocations: [] },
    phase: { kind: 'p2_distribution', committedSeats: [], sealed: [] },
    played: [],
    eventsPlayed: [],
    waitingOn: [0, 1],
    seq: 3
  } as unknown as PlayerView
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useUiStore.getState().reset()
  useUiStore.getState().ensureStagedKey('g:1')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const coins = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('.radial-coin')
]

describe('radial argument/bet picker', () => {
  it('argument coin → Skip stages the placement without a bet', () => {
    const view = p2View({ product: 1, electricity: 1, recycling: 1 })
    act(() =>
      root.render(
        <ArgBetPicker target={{ actorType: 'politician', locationId: 'square' }} view={view} />
      )
    )
    expect(coins()).toHaveLength(4) // all arguments free
    act(() => coins()[0]?.click()) // rock
    expect(document.querySelector('.radial-skip')).toBeTruthy()
    act(() => (document.querySelector('.radial-skip') as HTMLButtonElement).click())
    expect(useUiStore.getState().staged.politician).toEqual({
      locationId: 'square',
      argument: 'rock'
    })
    expect(useUiStore.getState().picker).toBeNull() // staged closes the picker
  })

  it('argument coin → bet coin stages with the bet; unaffordable bets are disabled', () => {
    // recycling 0 → the Draw bet (costs recycling) must be disabled.
    const view = p2View({ product: 1, electricity: 1, recycling: 0 })
    act(() =>
      root.render(
        <ArgBetPicker target={{ actorType: 'artist', locationId: 'theatre' }} view={view} />
      )
    )
    act(() => coins()[1]?.click()) // paper
    const bets = coins() // win / lose / draw
    expect(bets).toHaveLength(3)
    expect(bets[2]?.disabled).toBe(true) // draw — no recycling
    act(() => bets[0]?.click()) // win bet
    expect(useUiStore.getState().staged.artist).toEqual({
      locationId: 'theatre',
      argument: 'paper',
      bet: 'win'
    })
  })

  it('arguments used by other staged actors are not offered', () => {
    useUiStore.getState().stagePlacement('politician', { locationId: 'square', argument: 'rock' })
    const view = p2View({ product: 1, electricity: 1, recycling: 1 })
    act(() =>
      root.render(
        <ArgBetPicker target={{ actorType: 'robot', locationId: 'factory' }} view={view} />
      )
    )
    const alts = coins().map((c) => c.querySelector('img')?.alt)
    expect(alts).toHaveLength(3)
    expect(alts).not.toContain('Rock')
  })

  it('with no affordable bet the argument alone stages — no Skip-only bet fan', () => {
    // Zero resources: every bet is unaffordable, so picking the argument must
    // stage the placement immediately (user rule: never show a Skip-only step).
    const view = p2View({ product: 0, electricity: 0, recycling: 0 })
    act(() =>
      root.render(
        <ArgBetPicker target={{ actorType: 'scientist', locationId: 'university' }} view={view} />
      )
    )
    act(() => coins()[0]?.click()) // rock
    expect(useUiStore.getState().staged.scientist).toEqual({
      locationId: 'university',
      argument: 'rock'
    })
    expect(useUiStore.getState().picker).toBeNull()
  })

  it('pointer-down off the plate cancels and returns the actor to the hand', () => {
    // Editing an existing staged placement (tap on the staged token)…
    useUiStore.getState().stagePlacement('politician', { locationId: 'square', argument: 'rock' })
    useUiStore.getState().openPicker({ actorType: 'politician', locationId: 'square' })
    const view = p2View({ product: 1, electricity: 1, recycling: 1 })
    act(() =>
      root.render(
        <ArgBetPicker target={{ actorType: 'politician', locationId: 'square' }} view={view} />
      )
    )
    // …a tap inside the plate (a coin) must NOT cancel…
    act(() => {
      coins()[0]?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(useUiStore.getState().picker).not.toBeNull()
    // …but a tap on the board/elsewhere cancels and un-stages the actor.
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(useUiStore.getState().picker).toBeNull()
    expect(useUiStore.getState().staged.politician).toBeUndefined()
  })
})
