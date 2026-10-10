// Head-crop windows for wardrobe-aware head icons (plan/Wardrobe-Layers-Backlog.md
// §1: "провести гардероб в голову-иконку"). Board tokens, the dock and every
// other head-sized surface crop the top of the full art instead of repainting
// portraits — this script measures WHERE the head sits in each skin and in the
// layered wardrobe canvas, and bakes the windows into src/theme.headcrops.gen.ts.
//
// Why measured, not hardcoded: skins are tight-cropped per image (widths drift),
// and the head is never the topmost pixel — these poses raise a fist or a prop
// above the head. The detector finds the head as the first WIDE opaque band in
// the top of the figure, then frames a square window on it.
//
// Reads the committed webp outputs (no source pack needed).
// Run: pnpm --filter @metarchy/client build:headcrops
// Debug: HEAD_CROPS_DEBUG=/tmp/headcrops pnpm --filter @metarchy/client build:headcrops
//        renders the crops it chose, for eyeballing.

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const CLIENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const THEME = path.join(CLIENT_ROOT, 'public/themes/cyberpunk')
const OUT = path.join(CLIENT_ROOT, 'src/theme.headcrops.gen.ts')
const DEBUG_DIR = process.env.HEAD_CROPS_DEBUG ?? null

/** Square window: center (x of image width, y of image height), side s of image height. */
interface Crop {
  x: number
  y: number
  s: number
  /** width / height — the DOM side needs it to place the image. */
  aspect: number
}

// Hand-tuned head windows on the CANONICAL figures (720×1280). Every skin of an
// actor shares the actor's pose — only the horizontal trim differs — so a skin's
// window is the actor anchor shifted by the bbox-left difference. A skin drawn
// from a NEW pose needs its own anchor line here.
const ACTOR_ANCHORS: Record<string, { cx: number; cy: number; s: number }> = {
  politician: { cx: 0.47, cy: 0.19, s: 0.15 },
  robot: { cx: 0.53, cy: 0.19, s: 0.15 },
  artist: { cx: 0.52, cy: 0.19, s: 0.15 },
  scientist: { cx: 0.48, cy: 0.19, s: 0.15 },
  // Layered pack canvas (800×1280, bald body — window inflated to fit hair).
  'wardrobe.politician': { cx: 0.4, cy: 0.11, s: 0.17 }
}

// Per-skin nudges where the look breaks the pose's head-line (checked on the
// debug contact sheet).
const SKIN_OVERRIDES: Record<string, { dx?: number; dy?: number; ds?: number }> = {
  // Asa's politician wears a top hat — the canonical anchor frames hat, not face.
  'skin.politician.asa': { dy: 0.035 }
}

const round = (n: number): number => Math.round(n * 1000) / 1000

/** Opaque bounding box of an image (alpha > 24). */
async function bbox(file: string): Promise<{ left: number; right: number; W: number; H: number }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const C = info.channels
  let left = W
  let right = 0
  for (let y = 0; y < H; y += 4)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * C + C - 1] > 24) {
        if (x < left) left = x
        if (x > right) right = x
      }
  if (right <= left) throw new Error(`no opaque pixels in ${file}`)
  return { left, right, W, H }
}

/**
 * A skin's head window from its actor's anchor: heights match (1280), so only
 * the horizontal anchor shifts — by the skin's bbox-left relative to the
 * canonical figure's bbox-left.
 */
function skinCrop(
  anchor: { cx: number; cy: number; s: number },
  canon: { left: number; W: number },
  skin: { left: number; W: number; H: number }
): Crop {
  const relX = anchor.cx * canon.W - canon.left // head x relative to the figure bbox
  return {
    x: round((skin.left + relX) / skin.W),
    y: anchor.cy,
    s: anchor.s,
    aspect: round(skin.W / skin.H)
  }
}

/** Render the chosen window to a debug file (128px) for visual tuning. */
async function debugCrop(
  file: string,
  crop: Crop,
  name: string,
  composite?: string[]
): Promise<void> {
  if (!DEBUG_DIR) return
  // Two passes: sharp applies extract BEFORE composite regardless of call
  // order, so a single pipeline would try to composite onto the cropped region.
  const merged = composite
    ? await sharp(file)
        .composite(composite.map((input) => ({ input })))
        .png()
        .toBuffer()
    : file
  const img = sharp(merged)
  const meta = await img.metadata()
  const H = meta.height ?? 0
  const W = meta.width ?? 0
  const side = Math.round(crop.s * H)
  const left = Math.max(0, Math.round(crop.x * W - side / 2))
  const top = Math.max(0, Math.round(crop.y * H - side / 2))
  await mkdir(DEBUG_DIR, { recursive: true })
  await img
    .extract({ left, top, width: Math.min(side, W - left), height: Math.min(side, H - top) })
    .resize(128, 128)
    .webp()
    .toFile(path.join(DEBUG_DIR, `${name}.webp`))
}

async function main(): Promise<void> {
  const entries: Record<string, Crop> = {}

  const skinsRoot = path.join(THEME, 'skins')
  for (const actor of (await readdir(skinsRoot)).sort()) {
    const anchor = ACTOR_ANCHORS[actor]
    if (!anchor) throw new Error(`no head anchor for actor '${actor}' — add one to ACTOR_ANCHORS`)
    const canonFile = path.join(THEME, 'actors', `${actor}.webp`)
    const canon = await bbox(canonFile)
    const dir = path.join(skinsRoot, actor)
    for (const file of (await readdir(dir)).sort()) {
      if (!file.endsWith('.webp')) continue
      const id = file.slice(0, -'.webp'.length)
      const skin = await bbox(path.join(dir, file))
      const crop = skinCrop(anchor, canon, skin)
      const nudge = SKIN_OVERRIDES[`skin.${actor}.${id}`]
      if (nudge) {
        crop.x = round(crop.x + (nudge.dx ?? 0))
        crop.y = round(crop.y + (nudge.dy ?? 0))
        crop.s = round(crop.s + (nudge.ds ?? 0))
      }
      entries[`skin.${actor}.${id}`] = crop
      await debugCrop(path.join(dir, file), crop, `skin.${actor}.${id}`)
    }
  }

  // Layered wardrobe packs: one window per actor — every layer shares the pack
  // canvas. The anchor lives on the pack canvas directly.
  const wardrobeRoot = path.join(THEME, 'wardrobe')
  for (const actor of (await readdir(wardrobeRoot)).sort()) {
    const anchor = ACTOR_ANCHORS[`wardrobe.${actor}`]
    if (!anchor) throw new Error(`no head anchor for wardrobe pack '${actor}'`)
    const dir = path.join(wardrobeRoot, actor)
    const body = path.join(dir, 'body_1.webp')
    const { W, H } = await bbox(body)
    const crop: Crop = { x: anchor.cx, y: anchor.cy, s: anchor.s, aspect: round(W / H) }
    entries[`wardrobe.${actor}`] = crop
    // Debug: composite a dressed figure so the window can be checked against hair.
    await debugCrop(body, crop, `wardrobe.${actor}`, [
      path.join(dir, 'costume_1_1.webp'),
      path.join(dir, 'hair_1_1.webp')
    ])
  }

  const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)))
  const ts = `// GENERATED by scripts/build-head-crops.ts — do not edit by hand.
// Head-crop windows for wardrobe art (skins and layered packs), measured from
// the committed webp. Canonical heads stay the author\u2019s hand-drawn portraits.
export interface HeadCrop {
  /** Window center x, fraction of image width. */
  x: number
  /** Window center y, fraction of image height. */
  y: number
  /** Window side, fraction of image height. */
  s: number
  /** Image width / height. */
  aspect: number
}

export const headCrops: Record<string, HeadCrop> = ${JSON.stringify(sorted, null, 2)}
`
  await writeFile(OUT, ts)
  console.log(
    `\u2713 ${Object.keys(sorted).length} head crops \u2192 ${path.relative(CLIENT_ROOT, OUT)}`
  )
  if (DEBUG_DIR) {
    // Contact sheet: every chosen crop in one grid (sorted key order), so the
    // whole set can be eyeballed in one glance instead of 29 open tabs.
    const names = Object.keys(sorted)
    const tile = 128
    const cols = 6
    const rowsN = Math.ceil(names.length / cols)
    const tiles = await Promise.all(
      names.map((name, i) =>
        sharp(path.join(DEBUG_DIR, `${name}.webp`))
          .resize(tile, tile)
          .png()
          .toBuffer()
          .then((input) => ({ input, left: (i % cols) * tile, top: Math.floor(i / cols) * tile }))
      )
    )
    await sharp({
      create: {
        width: cols * tile,
        height: rowsN * tile,
        channels: 4,
        background: { r: 24, g: 24, b: 32, alpha: 1 }
      }
    })
      .composite(tiles)
      .png()
      .toFile(path.join(DEBUG_DIR, '_contact-sheet.png'))
    console.log(`  contact sheet: ${path.join(DEBUG_DIR, '_contact-sheet.png')} (sorted key order)`)
  }
}

await main()
