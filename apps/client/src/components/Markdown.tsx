// A tiny, dependency-free Markdown renderer for the rulebook's subset: ATX
// headings (# … ####), unordered lists with one nesting level, `---` rules,
// paragraphs, inline **bold** / `code`, and inline images. Text renders through
// React (escaped by default), so there is no HTML injection surface. Images use
// standard `![alt](spec)` syntax where `spec` is a theme asset key (e.g.
// `actor.politician`) resolved through themeAsset, so the rulebook can show the
// real game art next to each Actor/Card/Resource. Tables and links are still
// intentionally unsupported.

import { isValidElement, type JSX, type ReactNode } from 'react'
import { themeAsset } from '../theme.js'

/** True for the <img> nodes produced by inline() — used to lay out card rows. */
function isImage(node: ReactNode): boolean {
  return isValidElement(node) && node.type === 'img'
}

/** A dotted asset key resolves through the theme; anything else is a literal URL. */
function assetUrl(spec: string): string | null {
  if (/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/i.test(spec)) {
    try {
      return themeAsset(spec)
    } catch {
      return null // unknown key — caller falls back to the alt text
    }
  }
  return spec
}

/** Split a line into text / **bold** / `code` / ![alt](asset) runs. */
function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|!\[([^\]]*)\]\(([^)]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      nodes.push(<strong key={`${keyBase}-b${i}`}>{m[1]}</strong>)
    } else if (m[2] !== undefined) {
      nodes.push(<code key={`${keyBase}-c${i}`}>{m[2]}</code>)
    } else {
      const alt = m[3] ?? ''
      const url = assetUrl(m[4] as string)
      if (url) nodes.push(<img key={`${keyBase}-i${i}`} className="md-icon" src={url} alt={alt} />)
      else if (alt) nodes.push(alt)
    }
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function Markdown({ source }: { source: string }): JSX.Element {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: { text: string; depth: number }[] = []
  let key = 0

  const flushPara = () => {
    if (para.length === 0) return
    blocks.push(<p key={key++}>{inline(para.join(' '), `p${key}`)}</p>)
    para = []
  }
  const flushList = () => {
    if (list.length === 0) return
    const root: ReactNode[] = []
    const subList = (subs: { text: string; depth: number }[], base: string): ReactNode => (
      <ul className="md-sublist">
        {subs.map((s, si) => (
          <li key={si}>{inline(s.text, `${base}-${si}`)}</li>
        ))}
      </ul>
    )
    let i = 0
    while (i < list.length) {
      const item = list[i] as { text: string; depth: number }
      // Gather the sub-bullets (depth > 0) that immediately follow this item.
      const subs: { text: string; depth: number }[] = []
      let j = i + 1
      while (j < list.length && (list[j] as { depth: number }).depth > 0) {
        subs.push(list[j] as { text: string; depth: number })
        j++
      }
      const nodes = inline(item.text, `l${key}-${i}`)

      if (item.depth === 0 && nodes.length > 0 && isImage(nodes[0])) {
        // Card row: the leading image sits large on the left, everything else
        // (name, description, and its sub-bullets) reads on the right.
        const [art, ...rest] = nodes
        root.push(
          <li key={i} className="md-card">
            {art}
            <div className="md-card-body">
              <div className="md-card-head">{rest}</div>
              {subs.length > 0 && subList(subs, `l${key}-${i}`)}
            </div>
          </li>
        )
        i = j
      } else if (item.depth === 0) {
        root.push(<li key={i}>{nodes}</li>)
        if (subs.length > 0) root.push(subList(subs, `l${key}-${i}`))
        i = j
      } else {
        // A stray leading sub-item with no parent — render as a plain bullet.
        root.push(<li key={i}>{nodes}</li>)
        i++
      }
    }
    blocks.push(
      <ul key={key++} className="md-list">
        {root}
      </ul>
    )
    list = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line)

    if (line.trim() === '') {
      flushPara()
      flushList()
    } else if (heading) {
      flushPara()
      flushList()
      const level = heading[1]!.length
      const Tag = `h${level}` as keyof JSX.IntrinsicElements
      blocks.push(<Tag key={key++}>{inline(heading[2]!, `h${key}`)}</Tag>)
    } else if (/^---+$/.test(line.trim())) {
      flushPara()
      flushList()
      blocks.push(<hr key={key++} />)
    } else if (bullet) {
      flushPara()
      list.push({ text: bullet[2]!, depth: bullet[1]!.length >= 2 ? 1 : 0 })
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara()
  flushList()

  return <div className="markdown">{blocks}</div>
}
