// Split a rulebook markdown document into a GitBook-style navigation tree.
// `#` headings are parts (sidebar group labels). Both `##` and `###` headings
// are navigable pages, so real categories (Actors, Action Cards, …) each get
// their own sidebar entry instead of being buried in one giant page. A `##` that
// only introduces `###` children (no body of its own) renders as a non-clickable
// sub-label; `###` pages sit indented under it. `####` and below stay in the body,
// rendered by <Markdown>. Intro text under a `#` before its first heading becomes
// an "Overview" page so nothing is dropped.

export interface RulebookPage {
  kind: 'page'
  id: string
  title: string
  body: string
  /** A `###` page shown indented under its `##` label. */
  sub: boolean
}
export interface RulebookLabel {
  kind: 'label'
  title: string
}
export type RulebookItem = RulebookPage | RulebookLabel
export interface RulebookPart {
  title: string
  items: RulebookItem[]
}

/** Strip a leading emoji + numbering so sidebar titles read cleanly. */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}️‍]+\s*/u, '')
    .replace(/^\d+\.\s*/, '')
    .trim()
}

interface Heading {
  level: 2 | 3
  title: string
  body: string[]
}

interface RawPart {
  title: string
  headings: Heading[]
}

export function parseRulebook(md: string, overviewTitle = 'Overview'): RulebookPart[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const parts: RawPart[] = []
  let part: RawPart | null = null
  let heading: Heading | null = null
  let idc = 0

  const pushHeading = (level: 2 | 3, title: string) => {
    heading = { level, title: cleanTitle(title), body: [] }
    part!.headings.push(heading)
  }

  for (const line of lines) {
    const h1 = /^#\s+(.*)$/.exec(line)
    const h2 = /^##\s+(.*)$/.exec(line)
    const h3 = /^###\s+(.*)$/.exec(line)
    if (h1) {
      part = { title: cleanTitle(h1[1]!), headings: [] }
      parts.push(part)
      heading = null
    } else if (h3 && part) {
      pushHeading(3, h3[1]!)
    } else if (h2 && part) {
      pushHeading(2, h2[1]!)
    } else if (part) {
      if (!heading) {
        if (line.trim() === '') continue
        pushHeading(2, overviewTitle)
      }
      heading!.body.push(line)
    }
  }

  // Build nav items: a level-2 heading with no body but a following level-3 is a
  // label; everything else with content is a page.
  return parts.map((p) => {
    const items: RulebookItem[] = []
    p.headings.forEach((h, i) => {
      const body = h.body.join('\n').trim()
      const next = p.headings[i + 1]
      if (h.level === 2 && body.length === 0 && next?.level === 3) {
        items.push({ kind: 'label', title: h.title })
      } else if (body.length > 0 || h.level === 3) {
        items.push({ kind: 'page', id: `p${idc++}`, title: h.title, body, sub: h.level === 3 })
      }
    })
    return { title: p.title, items }
  })
}

/** Flatten to page order for prev/next navigation. */
export function flattenPages(parts: RulebookPart[]): RulebookPage[] {
  return parts.flatMap((p) => p.items.filter((i): i is RulebookPage => i.kind === 'page'))
}
