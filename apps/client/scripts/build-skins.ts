// Whole-figure actor skins pipeline: author-approved AI art (solid-white bg) →
// transparent, single-figure, normalized webp under public/themes/cyberpunk/skins/
// + a generated manifest (src/theme.skins.gen.ts). Skin ids mirror protocol
// SKIN_CATALOG; a client test keeps the manifest and the catalog in lockstep.
//
// Source pack lives with the author (gitignored); the webp outputs are committed.
// Run: pnpm --filter @metarchy/client build:skins

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const CLIENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.env.SKINS_SOURCE ?? path.resolve(CLIENT_ROOT, '../../plan/visual-ref/ai-skins')
const OUT_ROOT = path.join(CLIENT_ROOT, 'public/themes/cyberpunk/skins')
const URL_ROOT = '/themes/cyberpunk/skins'

/** actor → [{ id, file }]; id is the wire value (protocol SKIN_CATALOG). */
const SKINS = {
  politician: [
    { id: 'ceremonial-white', file: 'politician2.png' },
    { id: 'obsidian-suit', file: 'politician3.png' },
    { id: 'revolutionary', file: 'politician4.png' },
    // Personal skins (protocol EXCLUSIVE_SKINS): a tester's own character, not
    // a re-dressed canon actor. Same pipeline as everything else.
    { id: 'ann', file: 'Politician-Ann.png' },
    { id: 'asa', file: 'politician-asa.png' },
    { id: 'okeesha', file: 'Politician-okeesha.png' },
    { id: 'matrix', file: 'politician-matrix.png' }
  ],
  robot: [
    { id: 'industrial', file: 'bot2.png' },
    // Mapping is by CONTENT, not sequence: bot3/bot4 arrived swapped once, so the
    // revolutionary robot (with the scrubbed armband) is bot4. Verify visually if
    // these sources are re-dropped.
    { id: 'gilded-stealth', file: 'bot3.png' },
    { id: 'revolutionary', file: 'bot4.png' },
    { id: 'ann', file: 'Robot-Ann.png' },
    { id: 'asa', file: 'Robot-asa.png' },
    { id: 'okeesha', file: 'Robot-okeesha.png' },
    { id: 'matrix', file: 'Robot-matrix.png' }
  ],
  artist: [
    { id: 'holo-graffiti', file: 'artist2.png' },
    { id: 'obsidian-suit', file: 'artist3.png' },
    { id: 'revolutionary', file: 'artist4.png' },
    { id: 'ann', file: 'Artist-Ann.png' },
    { id: 'asa', file: 'artist-asa.png' },
    { id: 'okeesha', file: 'artist-okeesha.png' },
    { id: 'matrix', file: 'Artist-matrix.png' }
  ],
  scientist: [
    { id: 'chrome-exo', file: 'scientist2.png' },
    { id: 'obsidian-suit', file: 'scientist3.png' },
    { id: 'revolutionary', file: 'scientist4.png' },
    { id: 'ann', file: 'Scientist-Ann.png' },
    { id: 'asa', file: 'scientist-asa.png' },
    { id: 'okeesha', file: 'scientist-okeesha.png' },
    { id: 'matrix', file: 'Scientist-matrix.png' }
  ]
}

/**
 * Author canon: no real-world political symbols. The revolutionary skins carry a
 * red armband stamped with a symbol (hammer-and-sickle on the robot, cog-and-star
 * on the artist/scientist). Flat-fill each band interior with its own red
 * (feathered, faint vertical shading), leaving the fabric edges. Boxes are for
 * the 768×1376 sources; `sample` is a clean red patch of the same band.
 */
const SCRUB = {
  'robot/revolutionary': {
    box: { x0: 536, x1: 616, y0: 481, y1: 542 },
    sample: { x0: 518, x1: 540, y0: 500, y1: 530 }
  },
  'artist/revolutionary': {
    box: { x0: 499, x1: 555, y0: 459, y1: 513 },
    sample: { x0: 486, x1: 499, y0: 478, y1: 505 }
  },
  'scientist/revolutionary': {
    box: { x0: 511, x1: 571, y0: 435, y1: 499 },
    sample: { x0: 506, x1: 518, y0: 455, y1: 490 }
  }
}

/**
 * Floating props the AI bridged onto the figure so the connected-component pass
 * can't drop them (e.g. the artist's gold theatre mask, joined at the sleeve).
 * Erase to transparent after cutout; boxes sit clear of the figure (768×1376).
 */
const ERASE = {
  'artist/revolutionary': [{ x0: 555, x1: 672, y0: 562, y1: 732 }]
}

/**
 * Flood-fill the solid-white background to transparent from the border only, so
 * white outfits keep their interior whites (a plain white→alpha would gut them).
 * Dark ink outlines stop the fill; foreground is eroded 1px to shave the halo,
 * then reduced to its largest connected component to drop floating props/specks.
 */
async function cutout(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  const T = 236
  const isWhite = (i) => data[i] >= T && data[i + 1] >= T && data[i + 2] >= T
  const bg = new Uint8Array(W * H)
  let stack = []
  const push = (x, y) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return
    const p = y * W + x
    if (!bg[p] && isWhite(p * C)) {
      bg[p] = 1
      stack.push(p)
    }
  }
  for (let x = 0; x < W; x++) {
    push(x, 0)
    push(x, H - 1)
  }
  for (let y = 0; y < H; y++) {
    push(0, y)
    push(W - 1, y)
  }
  while (stack.length) {
    const p = stack.pop()
    const x = p % W
    const y = (p / W) | 0
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
  // erode fg by 1px (kills the anti-alias white rim)
  const bg2 = new Uint8Array(bg)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (bg[p]) continue
      if (
        (x > 0 && bg[p - 1]) ||
        (x < W - 1 && bg[p + 1]) ||
        (y > 0 && bg[p - W]) ||
        (y < H - 1 && bg[p + W])
      )
        bg2[p] = 1
    }
  // keep only the largest connected foreground component
  const label = new Int32Array(W * H).fill(-1)
  let best = -1
  let bestSize = 0
  for (let s = 0; s < W * H; s++) {
    if (bg2[s] || label[s] >= 0) continue
    let size = 0
    label[s] = s
    stack = [s]
    while (stack.length) {
      const p = stack.pop()
      size++
      const x = p % W
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * H) continue
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue
        if (!bg2[q] && label[q] < 0) {
          label[q] = s
          stack.push(q)
        }
      }
    }
    if (size > bestSize) {
      bestSize = size
      best = s
    }
  }
  for (let p = 0; p < W * H; p++) if (bg2[p] || label[p] !== best) data[p * C + 3] = 0
  return sharp(data, { raw: { width: W, height: H, channels: C } })
    .png()
    .toBuffer()
}

/**
 * Flat-fill a red armband's interior with its own sampled red (feathered, faint
 * vertical shading), wiping whatever symbol was stamped on it while leaving the
 * fabric edges. The box sits inside the band; `sample` is a clean red patch of
 * the same band. Coordinates are for the 768×1376 sources.
 */
async function scrubArmband(buf, cfg) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== 768) return buf
  const { width: W, channels: C } = info
  let rs = 0
  let gs = 0
  let bs = 0
  let n = 0
  for (let y = cfg.sample.y0; y <= cfg.sample.y1; y++)
    for (let x = cfg.sample.x0; x <= cfg.sample.x1; x++) {
      const i = (y * W + x) * C
      if (data[i] > 100 && data[i] - data[i + 1] > 30) {
        rs += data[i]
        gs += data[i + 1]
        bs += data[i + 2]
        n++
      }
    }
  const R = Math.round(rs / n)
  const G = Math.round(gs / n)
  const B = Math.round(bs / n)
  const { x0, x1, y0, y1 } = cfg.box
  const m = 4
  for (let y = y0 - m; y <= y1 + m; y++)
    for (let x = x0 - m; x <= x1 + m; x++) {
      const i = (y * W + x) * C
      const d = Math.max(x0 - x, 0, x - x1, y0 - y, 0, y - y1)
      const w = d <= 0 ? 1 : Math.max(0, 1 - d / m)
      if (w <= 0) continue
      const sh = 1 - 0.12 * (((y - y0) / (y1 - y0) - 0.5) * 2)
      data[i] = Math.round(data[i] * (1 - w) + Math.min(255, R * sh) * w)
      data[i + 1] = Math.round(data[i + 1] * (1 - w) + G * sh * w)
      data[i + 2] = Math.round(data[i + 2] * (1 - w) + B * sh * w)
    }
  return sharp(data, { raw: { width: W, height: info.height, channels: C } })
    .png()
    .toBuffer()
}

/** Zero the alpha inside each box (768×1376 space), removing bridged props. */
async function eraseRegions(buf, boxes) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== 768) return buf
  const { width: W, channels: C } = info
  for (const b of boxes)
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) data[(y * W + x) * C + 3] = 0
  return sharp(data, { raw: { width: W, height: info.height, channels: C } })
    .png()
    .toBuffer()
}

/**
 * Vertical alpha bounds of the canonical actor art. Skins must match: surfaces
 * size actor art by a fixed CSS height, so a tight-cropped skin renders a
 * third BIGGER than the canon (whose figure fills only ~70-77% of the canvas).
 * Every skin is fitted to the canon's figure height and baseline instead.
 */
async function canonBounds(actor) {
  const file = path.join(CLIENT_ROOT, 'public/themes/cyberpunk/actors', `${actor}.webp`)
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  let top = H
  let bottom = -1
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * C + 3] > 8) {
        if (y < top) top = y
        if (y > bottom) bottom = y
        break
      }
  return { canvas: H, top, bottom }
}

async function main() {
  const manifest = {}
  let total = 0
  for (const [actor, skins] of Object.entries(SKINS)) {
    await mkdir(path.join(OUT_ROOT, actor), { recursive: true })
    const canon = await canonBounds(actor)
    const figureH = canon.bottom - canon.top + 1
    for (const { id, file } of skins) {
      let src = await sharp(path.join(SRC, file)).png().toBuffer()
      const scrub = SCRUB[`${actor}/${id}`]
      if (scrub) src = await scrubArmband(src, scrub)
      let cut = await cutout(src)
      const erase = ERASE[`${actor}/${id}`]
      if (erase) cut = await eraseRegions(cut, erase)
      const out = path.join(OUT_ROOT, actor, `${id}.webp`)
      // Fit the trimmed figure to the canon's height, then pad the canvas back
      // to the canon's margins — same figure size, feet on the same baseline.
      const figure = await sharp(cut).trim({ threshold: 1 }).resize({ height: figureH }).toBuffer()
      const info = await sharp(figure)
        .extend({
          top: canon.top,
          bottom: canon.canvas - 1 - canon.bottom,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .webp({ quality: 82 })
        .toFile(out)
      total += info.size
      manifest[`skin.${actor}.${id}`] = `${URL_ROOT}/${actor}/${id}.webp`
      console.log(`skin.${actor}.${id}`.padEnd(34), `${(info.size / 1024).toFixed(0).padStart(4)}K`)
    }
  }
  const entries = Object.keys(manifest)
    .sort()
    .map((k) => `  '${k}': '${manifest[k]}'`)
    .join(',\n')
  const gen = `// GENERATED by scripts/build-skins.ts — do not edit by hand.\n// Regenerate: pnpm --filter @metarchy/client build:skins\n\nexport const skinAssets: Record<string, string> = {\n${entries}\n}\n`
  await writeFile(path.join(CLIENT_ROOT, 'src/theme.skins.gen.ts'), gen)
  console.log(`\n${Object.keys(manifest).length} skins, ${(total / 1024 / 1024).toFixed(1)}MB`)
}

await main()
