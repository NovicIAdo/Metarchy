// ActorArt is the single gate between wardrobe data and pixels: undressed actors
// must keep the exact canonical <img> (arena CSS targets it), dressed politicians
// must stack layers in catalog order with the base layer in normal flow.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActorArt } from '../src/components/ActorArt.js'

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

describe('ActorArt', () => {
  it('renders the canonical img for undressed actors and non-politicians', () => {
    act(() => root.render(<ActorArt type="robot" wardrobe={null} />))
    const img = host.querySelector('img')
    expect(img?.getAttribute('src')).toContain('actors/robot')
    expect(host.querySelector('.layered-actor')).toBeNull()

    act(() => root.render(<ActorArt type="politician" wardrobe={null} />))
    expect(host.querySelector('img')?.getAttribute('src')).toContain('actors/politician')
  })

  it('stacks wardrobe layers with only the base in normal flow', () => {
    act(() =>
      root.render(
        <ActorArt
          type="politician"
          wardrobe={{
            politician: { body: 2, costume: [1, 3], hair: [4, 1], accessories: [[3, 5]] }
          }}
        />
      )
    )
    const wrap = host.querySelector('.layered-actor')
    expect(wrap).not.toBeNull()
    const imgs = [...(wrap?.querySelectorAll('img') ?? [])]
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
      expect.stringContaining('body_2'),
      expect.stringContaining('costume_1_3'),
      expect.stringContaining('hair_4_1'),
      expect.stringContaining('accessory_3_5')
    ])
    expect(imgs[0]?.classList.contains('layer-over')).toBe(false)
    expect(imgs.slice(1).every((i) => i.classList.contains('layer-over'))).toBe(true)
  })

  it('a robot owned by a dressed-politician player keeps canonical art', () => {
    act(() =>
      root.render(<ActorArt type="robot" wardrobe={{ politician: { body: 1, costume: [1, 1] } }} />)
    )
    expect(host.querySelector('.layered-actor')).toBeNull()
    expect(host.querySelector('img')?.getAttribute('src')).toContain('actors/robot')
  })

  it('renders a whole-figure skin as a single img', () => {
    act(() => root.render(<ActorArt type="robot" wardrobe={{ skins: { robot: 'industrial' } }} />))
    expect(host.querySelector('.layered-actor')).toBeNull()
    expect(host.querySelector('img')?.getAttribute('src')).toContain('skins/robot/industrial')
  })

  it('a skin wins over the layered politician loadout', () => {
    act(() =>
      root.render(
        <ActorArt
          type="politician"
          wardrobe={{
            politician: { body: 2, costume: [1, 1] },
            skins: { politician: 'revolutionary' }
          }}
        />
      )
    )
    expect(host.querySelector('.layered-actor')).toBeNull()
    expect(host.querySelector('img')?.getAttribute('src')).toContain(
      'skins/politician/revolutionary'
    )
  })
})
