// The rulebook splits into GitBook-style parts + nav items (labels for ## groups,
// pages for ## content and ### leaves) for the sidebar. Pin the parser shape, plus
// that the real synced rulebook produces a sane tree in both languages.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { flattenPages, parseRulebook } from '../src/lib/rulebook.js'

const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8')

describe('parseRulebook', () => {
  it('makes ## and ### into pages; a childful body-less ## becomes a label', () => {
    const parts = parseRulebook(
      '# Part A\n\nintro\n\n## Goal\n\nbody\n\n## Components\n\n### Actors\n\nactor text\n\n### Cards\n\ncard text\n\n# Part B\n\n## Flow\n\nflow'
    )
    expect(parts.map((p) => p.title)).toEqual(['Part A', 'Part B'])
    const a = parts[0]!.items
    // Overview (intro) + Goal are pages; Components is a label; Actors/Cards are sub pages.
    expect(a.map((i) => `${i.kind}:${i.title}`)).toEqual([
      'page:Overview',
      'page:Goal',
      'label:Components',
      'page:Actors',
      'page:Cards'
    ])
    expect(a.filter((i) => i.kind === 'page' && i.sub).map((i) => i.title)).toEqual([
      'Actors',
      'Cards'
    ])
  })

  it('strips leading emoji and numbering from titles', () => {
    const parts = parseRulebook('# Book\n\n## 🎯 Goal of the Game\n\nx\n\n### 7. Action Cards\n\ny')
    const titles = parts[0]!.items.map((i) => i.title)
    expect(titles).toContain('Goal of the Game')
    expect(titles).toContain('Action Cards')
  })

  it('flatten yields only pages, in order', () => {
    const parts = parseRulebook('# P\n\n## A\n\na\n\n## G\n\n### B\n\nb')
    expect(flattenPages(parts).map((p) => p.title)).toEqual(['A', 'B'])
  })

  it.each([
    ['en', 'src/content/rulebook.en.md'],
    ['ru', 'src/content/rulebook.ru.md']
  ])('produces a rich, non-empty tree for the real %s rulebook', (_lang, file) => {
    const parts = parseRulebook(read(file))
    expect(parts.length).toBeGreaterThanOrEqual(2)
    const pages = flattenPages(parts)
    // Actors/Arguments/Values/Cards each get their own page now — expect many.
    expect(pages.length).toBeGreaterThanOrEqual(15)
    expect(pages.every((p) => p.title.length > 0 && p.body.length > 0)).toBe(true)
  })
})
