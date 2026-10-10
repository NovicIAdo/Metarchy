// Placement the other way round (player feedback): tap a Location and it asks
// who should go there. The plate lists only the Actors that Location accepts
// and that are still unplaced; picking one hands over to the argument picker,
// exactly as a drag onto the Location would. No Cancel button — a pointer-down
// off the plate closes it, leaving nothing staged.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { ActorChooser } = await import('../src/screens/game/ActorChooser.js')
const { placeableActorsAt, useUiStore } = await import('../src/stores/ui.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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

const heads = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('.chooser-head')
]

describe('actor chooser (tap a Location, pick who goes)', () => {
  it('offers the Location’s actors and opens the argument picker for the tapped one', () => {
    const actors = placeableActorsAt(useUiStore.getState().staged, 'square', [])
    act(() => root.render(<ActorChooser locationId="square" actors={actors} />))
    expect(heads()).toHaveLength(2) // Politician and Artist take the Square
    act(() => heads()[1]?.click()) // the Artist
    expect(useUiStore.getState().picker).toEqual({ actorType: 'artist', locationId: 'square' })
    expect(useUiStore.getState().actorChooser).toBeNull() // handed over
  })

  it('drops an actor that is already placed elsewhere', () => {
    useUiStore
      .getState()
      .stagePlacement('politician', { locationId: 'university', argument: 'rock' })
    const actors = placeableActorsAt(useUiStore.getState().staged, 'square', [])
    act(() => root.render(<ActorChooser locationId="square" actors={actors} />))
    expect(heads()).toHaveLength(1)
    act(() => heads()[0]?.click())
    expect(useUiStore.getState().picker?.actorType).toBe('artist')
  })

  it('a pointer-down off the plate closes it and stages nothing', () => {
    useUiStore.getState().openActorChooser('theatre')
    act(() => root.render(<ActorChooser locationId="theatre" actors={['scientist', 'artist']} />))
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(useUiStore.getState().actorChooser).toBeNull()
    expect(useUiStore.getState().staged).toEqual({})
    expect(useUiStore.getState().picker).toBeNull()
  })

  it('stays open while the tutorial coach card explaining it is dismissed', () => {
    useUiStore.getState().openActorChooser('university')
    act(() =>
      root.render(<ActorChooser locationId="university" actors={['politician', 'scientist']} />)
    )
    const scrim = document.createElement('div')
    scrim.className = 'coach-scrim'
    const gotIt = document.createElement('button')
    scrim.appendChild(gotIt)
    document.body.appendChild(scrim)
    act(() => {
      gotIt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    scrim.remove()
    expect(useUiStore.getState().actorChooser).toBe('university')
    expect(heads().map((h) => h.textContent)).toEqual(['Politician', 'Scientist'])
  })
})
