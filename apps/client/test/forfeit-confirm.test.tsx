// Beta incident, ranked ffa3 game e8dd7afb: six seconds in, seat 1 sent
// game.forfeit and spent the next thirteen minutes watching. `game.forfeit` is
// reachable from exactly one place in the client — this corner button — and it
// had no confirmation, so a single stray tap ended a rated 3-player match with
// no way back. These tests pin the gate: the first tap must never reach the
// server, and the server must hear about it once and only after a deliberate
// second tap.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mode } from '@metarchy/engine'

vi.mock('../src/config.js', () => ({
  config: { supabaseUrl: 'http://sb.test', supabaseAnonKey: 'anon', wsUrl: 'ws://game.test/ws' }
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

const { ForfeitButton } = await import('../src/screens/game/ForfeitButton.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function mount(mode: Mode, onForfeit: () => void): void {
  act(() => {
    root.render(<ForfeitButton mode={mode} onForfeit={onForfeit} />)
  })
}

/** The confirm dialog portals to <body>, so look for it there, not under host. */
const dialog = (): HTMLElement | null => document.body.querySelector('.forfeit-confirm')
const buttonNamed = (label: RegExp): HTMLButtonElement => {
  const found = [...document.body.querySelectorAll('button')].find((b) =>
    label.test(b.textContent ?? '')
  )
  if (!found) throw new Error(`no button matching ${label}`)
  return found as HTMLButtonElement
}
const click = (el: HTMLElement): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('forfeit confirmation', () => {
  it('does not forfeit on the first tap — it asks', () => {
    const onForfeit = vi.fn()
    mount('ffa3', onForfeit)

    expect(dialog()).toBeNull()
    click(host.querySelector('.hud-forfeit') as HTMLElement)

    expect(onForfeit).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
    // Lifted above the conflict arena overlay, or a re-mounted arena eats the tap.
    expect(dialog()?.closest('.modal-overlay')?.classList.contains('forfeit-over')).toBe(true)
  })

  it('sends the forfeit once the player confirms', () => {
    const onForfeit = vi.fn()
    mount('ffa3', onForfeit)

    click(host.querySelector('.hud-forfeit') as HTMLElement)
    // The dialog's own danger button is the confirmation.
    click(dialog()?.querySelector('.btn.danger') as HTMLElement)

    expect(onForfeit).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
  })

  it('keeps the player in the game on cancel and on Escape', () => {
    const onForfeit = vi.fn()
    mount('ffa3', onForfeit)

    click(host.querySelector('.hud-forfeit') as HTMLElement)
    click(buttonNamed(/keep playing/i))
    expect(onForfeit).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()

    click(host.querySelector('.hud-forfeit') as HTMLElement)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onForfeit).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
  })

  it('warns about the record only where the match counts', () => {
    mount('ffa3', vi.fn())
    click(host.querySelector('.hud-forfeit') as HTMLElement)
    expect(dialog()?.querySelector('.warn-text')).not.toBeNull()
    click(buttonNamed(/keep playing/i))

    // vs_bots and tutorial cost nothing — no rating line, no scare.
    for (const mode of ['vs_bots', 'tutorial'] as Mode[]) {
      mount(mode, vi.fn())
      click(host.querySelector('.hud-forfeit') as HTMLElement)
      expect(dialog(), mode).not.toBeNull()
      expect(dialog()?.querySelector('.warn-text'), mode).toBeNull()
      click(buttonNamed(/keep playing/i))
    }
  })
})
