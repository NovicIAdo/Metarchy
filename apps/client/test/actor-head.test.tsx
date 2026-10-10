// Wardrobe-aware head icons: headLook() precedence mirrors ActorArt (skin >
// layered loadout > canonical portrait), the generated crop windows cover every
// skin and wardrobe pack, and ActorHead renders canonical looks as the exact
// <img> call sites have always had (their CSS targets it).

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SKIN_CATALOG, WARDROBE_ACTORS, type Wardrobe } from '@metarchy/protocol'
import { deriveBoardProps } from '../src/board/derive.js'
import { ActorHead } from '../src/components/ActorHead.js'
import { headLook, headLookKey } from '../src/lib/actorHead.js'
import { headCrops } from '../src/theme.headcrops.gen.js'
import { skinAssets } from '../src/theme.skins.gen.js'

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

const DRESSED_POLITICIAN: Wardrobe = {
  politician: { body: 2, costume: [1, 3], hair: [4, 1], accessories: [[1, 1]] }
}

describe('headLook', () => {
  it('keeps the canonical portrait without a wardrobe', () => {
    expect(headLook('robot', null)).toEqual({ kind: 'canonical', key: 'actor.robot.head' })
    expect(headLook('politician', undefined)).toEqual({
      kind: 'canonical',
      key: 'actor.politician.head'
    })
  })

  it('a whole-figure skin wins over everything, on any actor', () => {
    const look = headLook('robot', { skins: { robot: 'matrix' } })
    expect(look.kind).toBe('skin')
    if (look.kind === 'skin') expect(look.key).toBe('skin.robot.matrix')
    // A skin beats even a layered loadout on the politician.
    const both: Wardrobe = { ...DRESSED_POLITICIAN, skins: { politician: 'ann' } }
    const won = headLook('politician', both)
    expect(won.kind).toBe('skin')
  })

  it('a layered loadout dresses the politician when no skin is chosen', () => {
    const look = headLook('politician', DRESSED_POLITICIAN)
    expect(look.kind).toBe('layers')
    if (look.kind === 'layers') {
      expect(look.keys[0]).toBe('wardrobe.politician.body.2')
      expect(look.keys).toContain('wardrobe.politician.hair.4.1')
    }
    // Non-pack actors ignore loadouts.
    expect(headLook('robot', DRESSED_POLITICIAN).kind).toBe('canonical')
  })

  it('cache keys distinguish looks', () => {
    const a = headLookKey(headLook('politician', DRESSED_POLITICIAN))
    const b = headLookKey(
      headLook('politician', { politician: { body: 2, costume: [1, 3], accessories: [] } })
    )
    expect(a).not.toBe(b)
  })
})

describe('headCrops (generated)', () => {
  it('covers every skin in the manifest and every wardrobe pack', () => {
    for (const key of Object.keys(skinAssets)) expect(headCrops[key], key).toBeDefined()
    for (const actor of WARDROBE_ACTORS) expect(headCrops[`wardrobe.${actor}`]).toBeDefined()
    // And nothing stale: no crop entries for skins that no longer exist.
    for (const key of Object.keys(headCrops))
      if (key.startsWith('skin.')) expect(skinAssets[key], key).toBeDefined()
  })

  it('every window is a sane fraction of its image', () => {
    for (const [key, crop] of Object.entries(headCrops)) {
      expect(crop.x, key).toBeGreaterThan(0)
      expect(crop.x, key).toBeLessThan(1)
      expect(crop.y, key).toBeGreaterThan(0)
      expect(crop.y, key).toBeLessThan(0.6) // heads live at the top
      expect(crop.s, key).toBeGreaterThanOrEqual(0.05)
      expect(crop.s, key).toBeLessThanOrEqual(0.5)
      expect(crop.aspect, key).toBeGreaterThan(0)
    }
    // The catalog and the manifest agree on what exists.
    for (const [actor, ids] of Object.entries(SKIN_CATALOG))
      for (const id of ids) expect(headCrops[`skin.${actor}.${id}`]).toBeDefined()
  })
})

describe('deriveBoardProps', () => {
  it('passes the per-seat wardrobes through to the board scene', () => {
    const wardrobe: Wardrobe = { skins: { robot: 'matrix' } }
    const props = deriveBoardProps({
      view: null,
      staged: {},
      activeActor: null,
      hoverLocation: null,
      wardrobes: { 1: wardrobe }
    })
    expect(props.wardrobes?.[1]).toBe(wardrobe)
  })
})

describe('ActorHead', () => {
  it('renders the exact canonical img for undressed actors', () => {
    act(() => root.render(<ActorHead type="robot" wardrobe={null} className="dock-test" />))
    const img = host.querySelector('img.actor-head')
    expect(img?.getAttribute('src')).toContain('actors/robot_head')
    expect(img?.classList.contains('dock-test')).toBe(true)
    expect(host.querySelector('.actor-head-crop')).toBeNull()
  })

  it('renders a skin as a positioned crop window', () => {
    act(() => root.render(<ActorHead type="robot" wardrobe={{ skins: { robot: 'matrix' } }} />))
    const span = host.querySelector('.actor-head-crop')
    expect(span).not.toBeNull()
    const img = span!.querySelector('img')!
    expect(img.getAttribute('src')).toContain('skins/robot/matrix')
    const crop = headCrops['skin.robot.matrix']!
    // The window math: image height fills 1/s of the box, offset centers (x, y).
    expect(img.style.height).toBe(`${100 / crop.s}%`)
    expect(img.style.left).toBe(`${50 - (crop.x * crop.aspect * 100) / crop.s}%`)
    expect(img.style.top).toBe(`${50 - (crop.y * 100) / crop.s}%`)
  })

  it('renders a layered loadout as stacked crop windows', () => {
    act(() => root.render(<ActorHead type="politician" wardrobe={DRESSED_POLITICIAN} />))
    const imgs = host.querySelectorAll('.actor-head-crop img')
    expect(imgs.length).toBe(4) // body + costume + hair + one accessory
    expect(imgs[0]!.getAttribute('src')).toContain('wardrobe/politician/body_2')
  })
})
