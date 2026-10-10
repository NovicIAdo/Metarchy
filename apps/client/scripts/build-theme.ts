// Theme asset pipeline: prototype art (Meta_scratch) → optimized webp under
// public/themes/cyberpunk/ + a generated manifest (src/theme.cyberpunk.gen.ts).
// The mapping table below is the single source of truth for semantic asset keys;
// canonical names fix the prototype's filename typos (Polotican, Teatre, …).
// Card-art ↔ rules-id mappings mirror the prototype's lib/modules/core/constants.ts.
//
// Run: pnpm --filter @metarchy/client build:theme   (env THEME_SOURCE overrides input)

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SOURCE = process.env.THEME_SOURCE ?? '/Users/posthuman/Projects/Meta_scratch/frontend/public'
const CLIENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_ROOT = path.join(CLIENT_ROOT, 'public/themes/cyberpunk')
const URL_ROOT = '/themes/cyberpunk'

/** Author's layered wardrobe pack (see protocol WARDROBE_CATALOG for the counts). */
const WARDROBE_SOURCE =
  process.env.WARDROBE_SOURCE ??
  path.resolve(CLIENT_ROOT, '../../plan/visual-ref/Metarchy-assets/Actors/Политик ж ассеты')

interface AssetSpec {
  key: string
  src: string
  out: string
  /** Resize bound (longest relevant edge); never enlarges. */
  width?: number
  height?: number
  quality?: number
  /** Source tree this spec reads from (default: SOURCE). */
  root?: string
}

const LOCATION_SOURCES: Record<string, { base: string; hint: string; active: string }> = {
  square: { base: 'square.png', hint: 'square_hint0.png', active: 'square_active0.png' },
  theatre: { base: 'theatre.png', hint: 'Theatre_hint0.png', active: 'Theatre_active0.png' },
  university: { base: 'university.png', hint: 'uni_hint0.png', active: 'uni_active0.png' },
  factory: { base: 'factory.png', hint: 'factory_hint0.png', active: 'factory_active0.png' },
  power_plant: {
    base: 'energy_station.png',
    hint: 'energy_station_hint0.png',
    active: 'energy_station_active0.png'
  },
  dump: { base: 'dump.png', hint: 'dump_hint0.png', active: 'Dump_active0.png' }
}

const CLOSEUP_SOURCES: Record<string, string> = {
  square: 'Square.png',
  theatre: 'Teatre.png',
  university: 'University.png',
  factory: 'Factory.png',
  power_plant: 'Energy station.png',
  dump: 'Dump.png'
}

const ACTOR_SOURCES: Record<string, { full: string; head: string }> = {
  politician: { full: 'Polotican.png', head: 'Politican_head.png' },
  scientist: { full: 'Scientist.png', head: 'Scientist_head.png' },
  artist: { full: 'Artist.png', head: 'Artist_head.png' },
  robot: { full: 'Robot.png', head: 'Robot_head.png' }
}

/** Engine event card id → prototype art (prototype constants.ts EVENTS). */
const EVENT_CARD_ART: Record<string, string> = {
  political_repression: 'event_riot_control.png',
  educational_crisis: 'event_cyber_city.png',
  cultural_decline: 'event_magic_reader.jpg',
  revolution: 'event_revolution.png',
  help_poor_countries: 'event_desert_trade.png',
  earth_hour: 'event_ocean_platform.jpg',
  prevent_eco_crisis: 'event_discovery.png'
}

/** Engine action card id → prototype art (prototype constants.ts ACTION_CARDS). */
const ACTION_CARD_ART: Record<string, string> = {
  construction_work: 'Under construction.png',
  charity_event: 'Charity Event.png',
  student_protests: 'Student strikes.png',
  sabotage: 'Sabotage.png',
  cable_stolen: 'Blackout.png',
  environmental_protests: 'Ecological Protest.png',
  relocation: 'Teleportation.png',
  change_values: 'Change values.png'
}

function buildSpecs(): AssetSpec[] {
  const specs: AssetSpec[] = []

  // Board layers: 1200×1000 sources drawn at 718×598 world units — 1024 keeps hidpi crisp.
  specs.push({
    key: 'location.city',
    src: 'locations/city.png',
    out: 'locations/city.webp',
    width: 1024
  })
  for (const [id, files] of Object.entries(LOCATION_SOURCES)) {
    specs.push(
      {
        key: `location.${id}`,
        src: `locations/${files.base}`,
        out: `locations/${id}.webp`,
        width: 1024
      },
      {
        key: `location.${id}.hint`,
        src: `locations/${files.hint}`,
        out: `locations/${id}_hint.webp`,
        width: 1024
      },
      {
        key: `location.${id}.active`,
        src: `locations/${files.active}`,
        out: `locations/${id}_active.webp`,
        width: 1024
      }
    )
  }
  for (const [id, file] of Object.entries(CLOSEUP_SOURCES)) {
    specs.push({
      key: `location.${id}.closeup`,
      src: `Locations closeups/${file}`,
      out: `locations/closeups/${id}.webp`,
      // Sources are exactly 1920×1080; arenas draw them fullscreen — ship native res.
      width: 1920,
      quality: 78
    })
  }

  for (const [type, files] of Object.entries(ACTOR_SOURCES)) {
    specs.push(
      {
        key: `actor.${type}`,
        src: `actors/${files.full}`,
        out: `actors/${type}.webp`,
        // 1080×1920 sources; arenas show figures at ~400px on desktop → 1280 keeps 2× dpi crisp.
        height: 1280
      },
      {
        key: `actor.${type}.head`,
        src: `actors/${files.head}`,
        out: `actors/${type}_head.webp`,
        width: 256,
        quality: 85
      }
    )
  }

  specs.push(
    { key: 'avatar.ghost', src: 'avatars/ghost.png', out: 'avatars/ghost.webp', width: 256 },
    {
      key: 'avatar.golden',
      src: 'avatars/golden_avatar.png',
      out: 'avatars/golden.webp',
      width: 256
    },
    { key: 'avatar.viper', src: 'avatars/viper.png', out: 'avatars/viper.webp', width: 256 }
  )

  for (const [id, file] of Object.entries(EVENT_CARD_ART))
    specs.push({
      key: `card.event.${id}`,
      src: `events/${file}`,
      out: `cards/events/${id}.webp`,
      width: 512
    })
  for (const [id, file] of Object.entries(ACTION_CARD_ART))
    specs.push({
      key: `card.action.${id}`,
      src: `actions/${file}`,
      out: `cards/actions/${id}.webp`,
      width: 512
    })

  specs.push(
    {
      key: 'resource.product',
      src: 'resources/resource_product.png',
      out: 'resources/product.webp',
      width: 160,
      quality: 85
    },
    {
      key: 'resource.electricity',
      src: 'resources/resource_energy.png',
      out: 'resources/electricity.webp',
      width: 160,
      quality: 85
    },
    {
      key: 'resource.recycling',
      src: 'resources/resource_Recycle.png',
      out: 'resources/recycling.webp',
      width: 160,
      quality: 85
    },
    {
      key: 'value.power',
      src: 'intangibles/resource_power.png',
      out: 'values/power.webp',
      width: 160,
      quality: 85
    },
    {
      key: 'value.art',
      src: 'intangibles/resource_Art.png',
      out: 'values/art.webp',
      width: 160,
      quality: 85
    },
    {
      key: 'value.knowledge',
      src: 'intangibles/resource_knowledge.png',
      out: 'values/knowledge.webp',
      width: 160,
      quality: 85
    },
    {
      key: 'value.fame',
      src: 'intangibles/resource_Fame.png',
      out: 'values/fame.webp',
      width: 160,
      quality: 85
    },
    {
      key: 'value.vp',
      src: 'intangibles/resource_VP.png',
      out: 'values/vp.webp',
      width: 160,
      quality: 85
    },
    {
      key: 'argument.rock',
      src: 'tokens/rsp_rock.png',
      out: 'arguments/rock.webp',
      width: 160,
      quality: 85
    },
    {
      key: 'argument.paper',
      src: 'tokens/rsp_paper.png',
      out: 'arguments/paper.webp',
      width: 160,
      quality: 85
    },
    {
      key: 'argument.scissors',
      src: 'tokens/rsp_scissors.png',
      out: 'arguments/scissors.webp',
      width: 160,
      quality: 85
    },
    {
      key: 'argument.dummy',
      src: 'tokens/rsp_dummy.png',
      out: 'arguments/dummy.webp',
      width: 160,
      quality: 85
    },
    { key: 'deck.event', src: 'decks/event_deck_v2.png', out: 'decks/event.webp', width: 320 },
    { key: 'deck.action', src: 'decks/action_deck_v2.png', out: 'decks/action.webp', width: 320 },
    { key: 'logo.text', src: 'metarchy_text_logo.png', out: 'logo_text.webp', width: 512 }
  )

  return specs
}

/**
 * Politician wardrobe layers — all sources share one aligned 1200×1920 canvas,
 * so every layer gets the SAME height bound as actor fulls and composites
 * pixel-perfectly as stacked <img>s. Counts mirror protocol WARDROBE_CATALOG;
 * the client tests assert the manifest and the catalog stay in lockstep.
 */
function wardrobeSpecs(): AssetSpec[] {
  const specs: AssetSpec[] = []
  const H = 1280
  for (let b = 1; b <= 4; b++)
    specs.push({
      key: `wardrobe.politician.body.${b}`,
      src: `Тело/${b}.png`,
      out: `wardrobe/politician/body_${b}.webp`,
      height: H
    })
  for (let g = 1; g <= 3; g++)
    for (let v = 1; v <= 6; v++)
      specs.push({
        key: `wardrobe.politician.costume.${g}.${v}`,
        src: `Костюмы/${g}/${v}.png`,
        out: `wardrobe/politician/costume_${g}_${v}.webp`,
        height: H
      })
  for (let g = 1; g <= 7; g++)
    for (let v = 1; v <= 7; v++)
      specs.push({
        key: `wardrobe.politician.hair.${g}.${v}`,
        src: `Прическа/${g}/${g}${v}.png`,
        out: `wardrobe/politician/hair_${g}_${v}.webp`,
        height: H
      })
  for (let g = 1; g <= 4; g++)
    for (let v = 1; v <= 8; v++)
      specs.push({
        key: `wardrobe.politician.accessory.${g}.${v}`,
        src: `Аксессуары/${g}/${v}.png`,
        out: `wardrobe/politician/accessory_${g}_${v}.webp`,
        height: H
      })
  return specs
}

/** Hand-copied in 3.1, sources ambiguous in Meta_scratch — kept as committed. */
const STATIC_ASSETS: Record<string, string> = {
  logo: `${URL_ROOT}/logo.png`,
  'backdrop.space': `${URL_ROOT}/space.jpg`,
  'backdrop.landing': `${URL_ROOT}/landing.jpg`
}

async function main(): Promise<void> {
  const specs = [...buildSpecs(), ...wardrobeSpecs().map((s) => ({ ...s, root: WARDROBE_SOURCE }))]
  const manifest: Record<string, string> = { ...STATIC_ASSETS }
  let total = 0

  for (const spec of specs) {
    const srcPath = path.join(spec.root ?? SOURCE, spec.src)
    const outPath = path.join(OUT_ROOT, spec.out)
    await mkdir(path.dirname(outPath), { recursive: true })
    const resize = spec.width
      ? { width: spec.width, withoutEnlargement: true }
      : { height: spec.height, withoutEnlargement: true }
    const info = await sharp(srcPath)
      .resize(resize)
      .webp({ quality: spec.quality ?? 80 })
      .toFile(outPath)
    total += info.size
    manifest[spec.key] = `${URL_ROOT}/${spec.out}`
    console.log(`${spec.key.padEnd(36)} ${(info.size / 1024).toFixed(0).padStart(5)}K  ${spec.out}`)
  }

  const entries = Object.keys(manifest)
    .sort()
    // Prettier-clean output: quote keys only when they aren't valid identifiers.
    .map((k) => `  ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: '${manifest[k]}'`)
    .join(',\n')
  const gen = `// GENERATED by scripts/build-theme.ts — do not edit by hand.\n// Regenerate: pnpm --filter @metarchy/client build:theme\n\nexport const cyberpunkAssets: Record<string, string> = {\n${entries}\n}\n`
  await writeFile(path.join(CLIENT_ROOT, 'src/theme.cyberpunk.gen.ts'), gen)

  console.log(`\n${specs.length} assets, ${(total / 1024 / 1024).toFixed(1)}MB total`)
}

await main()
