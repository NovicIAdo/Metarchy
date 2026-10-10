// Multi-card P3 flows (user rule): with two or more Change of Values cards
// the modal names which card is being resolved ("the first/second …") and
// its button reads Done; with two or more Relocation cards the move stays
// staged until Done — the player may change their mind first. Single cards
// keep the original UI.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView } from '@metarchy/engine'
import type { ClientIntent } from '@metarchy/protocol'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { ActionPhasePanel } = await import('../src/screens/game/ActionPhasePanel.js')
const { useGameStore } = await import('../src/stores/game.js')
const { useUiStore } = await import('../src/stores/ui.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function baseView(): PlayerView {
  return {
    gameId: '88888888-8888-4888-8888-888888888888',
    mode: '1v1',
    rulesVersion: '1.0.0',
    seat: 0,
    turn: 2,
    isTieBreakerTurn: false,
    activeSeats: [0, 1],
    eliminated: [],
    decks: { event: 6, action: 10 },
    values: [
      { power: 2, art: 2, knowledge: 1, fame: 0 },
      { power: 1, art: 1, knowledge: 2, fame: 1 }
    ],
    me: { resources: { product: 1, electricity: 1, recycling: 1 }, hand: [] },
    allies: [],
    others: [{ seat: 1, handCount: 0, resources: { product: 0, electricity: 0, recycling: 0 } }],
    board: {
      placements: [
        {
          actorId: '1:scientist',
          seat: 1,
          actorType: 'scientist',
          locationId: 'theatre'
        }
      ],
      disabledLocations: []
    },
    played: [],
    eventsPlayed: [],
    waitingOn: [0],
    seq: 20
  } as unknown as PlayerView
}

function exchangeView(queue: { seat: number; instanceId: string }[], index: number): PlayerView {
  return {
    ...baseView(),
    phase: {
      kind: 'p3_action',
      selectedCounts: null,
      step: { t: 'exchange', queue, index }
    }
  } as PlayerView
}

function selectView(hand: { instanceId: string; card: string }[]): PlayerView {
  const view = baseView()
  return {
    ...view,
    me: { ...view.me, hand },
    phase: {
      kind: 'p3_action',
      selectedCounts: null,
      step: { t: 'select', committedSeats: [], mySelection: null }
    }
  } as unknown as PlayerView
}

function relocateView(quota: number, used: number): PlayerView {
  return {
    ...baseView(),
    phase: {
      kind: 'p3_action',
      selectedCounts: [
        { seat: 0, block: 0, relocation: quota, exchange: 0 },
        { seat: 1, block: 0, relocation: 0, exchange: 0 }
      ],
      step: {
        t: 'relocate',
        committedSeats: [],
        myOrders: Array.from({ length: used }, (_, i) => ({ actorId: `x${i}`, to: 'square' }))
      }
    }
  } as unknown as PlayerView
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useGameStore.getState().resetGame()
  useGameStore.getState().setPlayers([
    { seat: 0, nickname: 'me', bot: false, avatar: null },
    { seat: 1, nickname: 'rival', bot: true, avatar: null }
  ])
  useUiStore.getState().setRelocateSource(null)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('multiple Change of Values cards', () => {
  it('names the first card and uses a Done button when I play two', () => {
    const view = exchangeView(
      [
        { seat: 0, instanceId: 'a' },
        { seat: 0, instanceId: 'b' }
      ],
      0
    )
    act(() => root.render(<ActionPhasePanel view={view} send={() => {}} />))

    const text = document.body.textContent ?? ''
    expect(text).toContain('What is the effect of the first Change of Values card?')
    expect(
      [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Done'))
    ).toBe(true)
  })

  it('advances to the second card wording', () => {
    const view = exchangeView(
      [
        { seat: 0, instanceId: 'a' },
        { seat: 0, instanceId: 'b' }
      ],
      1
    )
    act(() => root.render(<ActionPhasePanel view={view} send={() => {}} />))
    expect(document.body.textContent).toContain(
      'What is the effect of the second Change of Values card?'
    )
  })

  it('keeps the original UI for a single card', () => {
    const view = exchangeView([{ seat: 0, instanceId: 'a' }], 0)
    act(() => root.render(<ActionPhasePanel view={view} send={() => {}} />))

    const text = document.body.textContent ?? ''
    expect(text).not.toContain('What is the effect')
    expect(
      [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Change Values'))
    ).toBe(true)
  })
})

describe('multiple Relocation cards', () => {
  it('stages the move and only sends on Done; ordinal names the card', () => {
    const sent: ClientIntent[] = []
    const view = relocateView(2, 0)
    act(() => {
      useUiStore.getState().setRelocateSource('1:scientist' as never)
      useUiStore.getState().setRelocateStaged({ actorId: '1:scientist', to: 'university' } as never)
    })
    act(() => root.render(<ActionPhasePanel view={view} send={(i) => sent.push(i)} />))

    const text = document.body.textContent ?? ''
    expect(text).toContain('Move an Actor with the first Relocation card (1/2)')
    expect(text).toContain('Tap elsewhere to change your mind')
    expect(sent).toEqual([]) // nothing sent while staged

    const done = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Done')
    )
    act(() => done?.click())
    expect(sent).toEqual([{ type: 'action.relocate', actorId: '1:scientist', to: 'university' }])
  })

  it('names the second card after the first order landed', () => {
    act(() => root.render(<ActionPhasePanel view={relocateView(2, 1)} send={() => {}} />))
    expect(document.body.textContent).toContain(
      'Move an Actor with the second Relocation card (2/2)'
    )
  })

  it('keeps the original wording for a single relocation card', () => {
    act(() => root.render(<ActionPhasePanel view={relocateView(1, 0)} send={() => {}} />))
    const text = document.body.textContent ?? ''
    expect(text).toContain('Relocation · 1 of 1 left')
    expect(text).not.toContain('Move an Actor with the')
  })

  it('a single card also stages until Done — the player may change their mind', () => {
    const sent: ClientIntent[] = []
    act(() => {
      useUiStore.getState().setRelocateSource('1:scientist' as never)
      useUiStore.getState().setRelocateStaged({ actorId: '1:scientist', to: 'university' } as never)
    })
    act(() =>
      root.render(<ActionPhasePanel view={relocateView(1, 0)} send={(i) => sent.push(i)} />)
    )

    expect(document.body.textContent).toContain('Tap elsewhere to change your mind')
    expect(sent).toEqual([]) // staged, not sent

    // Changing the source (re-picking another actor) discards the staged move.
    act(() => useUiStore.getState().setRelocateSource('0:robot' as never))
    expect(useUiStore.getState().relocateStaged).toBeNull()
  })
})

describe('card selection grid (P3 select)', () => {
  const byText = (t: string): HTMLButtonElement | undefined =>
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(t))

  it('shows the whole hand; tapped cards commit, untapped are skipped automatically', () => {
    const sent: ClientIntent[] = []
    const view = selectView([
      { instanceId: 'c1', card: 'sabotage' },
      { instanceId: 'c2', card: 'relocation' },
      { instanceId: 'c3', card: 'change_values' }
    ])
    act(() => root.render(<ActionPhasePanel view={view} send={(i) => sent.push(i)} />))

    // The whole hand is visible at once — no browsing.
    const text = document.body.textContent ?? ''
    expect(text).toContain('Sabotage')
    expect(text).toContain('Relocation')
    expect(text).toContain('Change of Values')

    act(() => byText('Sabotage')?.click())
    act(() => byText('Change of Values')?.click())
    act(() => byText('Commit 2 Action Cards')?.click())
    expect(sent).toEqual([{ type: 'action.selectCards', cardInstanceIds: ['c1', 'c3'] }])
  })

  it('tapping a chosen card untoggles it — commit falls back to Play No Cards', () => {
    const sent: ClientIntent[] = []
    const view = selectView([{ instanceId: 'c1', card: 'sabotage' }])
    act(() => root.render(<ActionPhasePanel view={view} send={(i) => sent.push(i)} />))

    act(() => byText('Sabotage')?.click())
    expect(byText('Commit 1 Action Card')).toBeTruthy()
    act(() => byText('Sabotage')?.click())
    act(() => byText('Play No Cards')?.click())
    expect(sent).toEqual([{ type: 'action.selectCards', cardInstanceIds: [] }])
  })
})
