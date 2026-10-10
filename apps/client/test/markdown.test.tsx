// The rulebook renders through a tiny in-house Markdown component (no dep). Pin
// the subset it must handle — headings, bold, code, and one-level nested lists —
// and that text goes through React (so no raw HTML is ever injected).

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown } from '../src/components/Markdown.js'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Markdown', () => {
  it('renders headings at their level', () => {
    act(() => root.render(<Markdown source={'# One\n\n## Two\n\n### Three\n\n#### Four'} />))
    expect(host.querySelector('h1')?.textContent).toBe('One')
    expect(host.querySelector('h2')?.textContent).toBe('Two')
    expect(host.querySelector('h3')?.textContent).toBe('Three')
    expect(host.querySelector('h4')?.textContent).toBe('Four')
  })

  it('renders inline bold and code', () => {
    act(() => root.render(<Markdown source={'A **bold** and `code` word.'} />))
    expect(host.querySelector('strong')?.textContent).toBe('bold')
    expect(host.querySelector('code')?.textContent).toBe('code')
    expect(host.querySelector('p')?.textContent).toBe('A bold and code word.')
  })

  it('groups bullets into a list with one nesting level', () => {
    act(() => root.render(<Markdown source={'- a\n- b\n  - b1\n- c'} />))
    const topList = host.querySelector('ul.md-list')
    expect(topList).not.toBeNull()
    // Four leaf items total across the top list and its one sublist.
    expect(host.querySelectorAll('li').length).toBe(4)
    expect(host.querySelector('ul.md-sublist li')?.textContent).toBe('b1')
  })

  it('joins wrapped paragraph lines and breaks on blank lines', () => {
    act(() => root.render(<Markdown source={'line one\nline two\n\nsecond para'} />))
    const ps = [...host.querySelectorAll('p')]
    expect(ps.length).toBe(2)
    expect(ps[0]?.textContent).toBe('line one line two')
    expect(ps[1]?.textContent).toBe('second para')
  })

  it('does not inject raw HTML (angle brackets stay as text)', () => {
    act(() => root.render(<Markdown source={'watch <img> and <b>x</b>'} />))
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('b')).toBeNull()
    expect(host.textContent).toContain('<img>')
  })

  it('renders an asset image token from a theme key', () => {
    act(() => root.render(<Markdown source={'- ![Politician](actor.politician) **Politician**'} />))
    const img = host.querySelector('img.md-icon')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('alt')).toBe('Politician')
    expect(img?.getAttribute('src')).toBeTruthy()
    expect(host.querySelector('strong')?.textContent).toBe('Politician')
  })

  it('falls back to the alt text when the asset key is unknown', () => {
    act(() => root.render(<Markdown source={'![Nope](no.such.key)'} />))
    expect(host.querySelector('img.md-icon')).toBeNull()
    expect(host.textContent).toContain('Nope')
  })
})
