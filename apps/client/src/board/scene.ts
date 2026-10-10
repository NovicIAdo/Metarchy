// BoardScene: the PixiJS side of the board. Pure renderer — it receives BoardProps
// (already derived from PlayerView + staging) and reports pointer intents back
// through callbacks; it never touches stores (architecture/Client.md §2 bridge).

import type { ActorType, ArgumentType, BetType, LocationId, SeatId } from '@metarchy/engine'
import { BET_COST, LOCATIONS } from '@metarchy/engine'
import { ARG_SKIN_IDS, type Wardrobe } from '@metarchy/protocol'
import {
  Assets,
  Circle,
  ColorMatrixFilter,
  Container,
  Graphics,
  Point,
  Sprite,
  Text,
  Texture,
  type Application
} from 'pixi.js'
import { headLook, headLookKey, type HeadLook } from '../lib/actorHead.js'
import { themeAsset } from '../theme.js'
import {
  BADGE_BRONZE,
  CITY_LAYER,
  LOCATION_DRAW_ORDER,
  LOCATION_HIT_RADIUS,
  LOCATION_LABELS,
  LOCATION_LAYERS,
  SEAT_COLORS,
  STAGED_COLOR,
  TOKEN_BACKING,
  TOKEN_BACKING_ENEMY,
  WORLD,
  locationCenter
} from './layout.js'

export type LocationRenderState = 'normal' | 'hint' | 'active'

export interface LocationVisual {
  state: LocationRenderState
  disabled: boolean
}

export interface BoardToken {
  /** ActorId for committed placements, `staged:<actorType>` for local staging. */
  id: string
  actorType: ActorType
  /** null = staged ghost of the viewer's own actor. */
  seat: SeatId | null
  locationId: LocationId
  argument: ArgumentType | null
  bet: BetType | null
  staged: boolean
  /** Picked as the relocation source — highlighted and pulsing. */
  selected?: boolean
}

export interface BoardProps {
  locations: Record<LocationId, LocationVisual>
  tokens: BoardToken[]
  /** Who is looking — rings read own/ally/enemy relative to this seat. */
  viewerSeat: SeatId | null
  allySeats: SeatId[]
  /** Bought argument-coin set per seat; a missing seat plays the free coins. */
  argSkins?: Partial<Record<SeatId, string | null>>
  /** Cosmetic wardrobe per seat — token heads wear it (lib/actorHead). */
  wardrobes?: Partial<Record<SeatId, Wardrobe | null>>
}

export interface BoardCallbacks {
  onLocationTap(id: LocationId): void
  onLocationHover(id: LocationId | null): void
  onTokenTap(id: string): void
}

const LABEL_FONT = "'Avenir Next Condensed', 'Arial Narrow', system-ui, sans-serif"
const TOKEN_RADIUS = 36
const TOKEN_GRID_COLS = 4
const TOKEN_SPACING = 82

function textureKeys(): string[] {
  const keys = ['location.city']
  for (const id of LOCATIONS)
    keys.push(`location.${id}`, `location.${id}.hint`, `location.${id}.active`)
  for (const actor of ['politician', 'scientist', 'artist', 'robot'])
    keys.push(`actor.${actor}.head`)
  for (const arg of ['rock', 'paper', 'scissors', 'dummy']) {
    keys.push(`argument.${arg}`)
    // Every bought set is preloaded: a rival's coin must not pop in mid-reveal.
    for (const set of ARG_SKIN_IDS) keys.push(`argSkin.${set}.${arg}`)
  }
  for (const res of ['product', 'electricity', 'recycling']) keys.push(`resource.${res}`)
  return keys
}

let texturesPromise: Promise<Record<string, Texture>> | null = null

/** Loads (once per app run) every texture the scene needs, keyed by theme key. */
export function loadBoardTextures(): Promise<Record<string, Texture>> {
  texturesPromise ??= (async () => {
    const keys = textureKeys()
    const byUrl = await Assets.load<Texture>(keys.map((k) => themeAsset(k)))
    return Object.fromEntries(keys.map((k) => [k, byUrl[themeAsset(k)] as Texture]))
  })()
  return texturesPromise
}

// Wardrobe head textures (a skin's crop, or a layered loadout composited and
// cropped) are built lazily — preloading every skin would cost megabytes for
// looks nobody at the table wears. Module-level so a StrictMode remount keeps
// the cache; the scene never destroys these.
const HEAD_TEXTURE_SIZE = 256
const headTextureCache = new Map<string, Texture>()
const headTexturePending = new Map<string, Promise<Texture>>()

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`head crop image failed: ${url}`))
    img.src = url
  })
}

/** Composite the look's layer(s) into a canvas, cropped to the measured head window. */
async function buildHeadTexture(
  look: Extract<HeadLook, { kind: 'skin' | 'layers' }>
): Promise<Texture> {
  const keys = look.kind === 'layers' ? look.keys : [look.key]
  const images = await Promise.all(keys.map((k) => loadImage(themeAsset(k))))
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = HEAD_TEXTURE_SIZE
  const ctx = canvas.getContext('2d')
  if (ctx) {
    for (const img of images) {
      const side = look.crop.s * img.naturalHeight
      ctx.drawImage(
        img,
        look.crop.x * img.naturalWidth - side / 2,
        look.crop.y * img.naturalHeight - side / 2,
        side,
        side,
        0,
        0,
        HEAD_TEXTURE_SIZE,
        HEAD_TEXTURE_SIZE
      )
    }
  }
  return Texture.from(canvas)
}

interface LocationNode {
  base: Sprite
  hint: Sprite
  /** Additive copy of the hint art — lifts it brighter than the texture allows. */
  hintGlow: Sprite
  active: Sprite
  label: Text
  container: Container
  visual: LocationVisual
}

export class BoardScene {
  private readonly app: Application
  private readonly textures: Record<string, Texture>
  private readonly callbacks: BoardCallbacks
  private readonly root = new Container()
  /** Labels sit above every location layer so neighbours can't cover them. */
  private readonly labelLayer = new Container()
  private readonly tokenLayer = new Container()
  private readonly locations = new Map<LocationId, LocationNode>()
  private readonly disabledFilter: ColorMatrixFilter
  private pulseTargets: { sprite: Container; kind: 'hint' | 'hint-glow' | 'staged' }[] = []
  /** Tokens easing in after appearing on the board this update. */
  private appearing: { node: Container; t: number }[] = []
  private knownTokens = new Set<string>()
  private viewerSeat: SeatId | null = null
  private allySeats: SeatId[] = []
  private argSkins: Partial<Record<SeatId, string | null>> = {}
  private wardrobes: Partial<Record<SeatId, Wardrobe | null>> = {}
  /** Last token list — rebuilt when a lazy head texture lands. */
  private lastTokens: BoardToken[] = []
  private destroyed = false
  /** A fullscreen modal covers the board: draw nothing until it closes. */
  private paused = false
  private renderQueued = false
  private elapsed = 0
  private readonly tick = (ticker: { deltaMS: number }): void => this.pulse(ticker.deltaMS)
  private readonly refit = (): void => this.fit()

  constructor(app: Application, textures: Record<string, Texture>, callbacks: BoardCallbacks) {
    this.app = app
    this.textures = textures
    this.callbacks = callbacks

    this.disabledFilter = new ColorMatrixFilter()
    this.disabledFilter.desaturate()
    this.disabledFilter.brightness(0.45, true)

    const city = new Sprite(this.textures['location.city'])
    city.position.set(CITY_LAYER.x, CITY_LAYER.y)
    city.setSize(CITY_LAYER.width, CITY_LAYER.height)
    this.root.addChild(city)

    for (const id of LOCATION_DRAW_ORDER) this.root.addChild(this.buildLocation(id).container)
    this.root.addChild(this.labelLayer, this.tokenLayer)

    app.stage.addChild(this.root)
    app.renderer.on('resize', this.refit)
    app.ticker.add(this.tick)
    this.fit()
  }

  /** Only the hint flash, the staged breathing and the pop-in move. */
  private get animating(): boolean {
    return this.pulseTargets.length > 0 || this.appearing.length > 0
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.invalidate()
  }

  /**
   * The board is a still picture almost all the time, so it is drawn on
   * demand: the ticker (which renders every frame) runs only while something
   * animates; any other change queues a single frame. On software-GL machines
   * a continuously redrawn full-screen canvas starved the whole page.
   */
  private invalidate(): void {
    if (this.destroyed) return
    const ticker = this.app.ticker
    if (!this.paused && this.animating) {
      ticker.start()
      return
    }
    ticker.stop()
    if (this.paused || this.renderQueued) return
    this.renderQueued = true
    requestAnimationFrame(() => {
      this.renderQueued = false
      if (!this.destroyed && !this.paused) this.app.render()
    })
  }

  destroy(): void {
    this.destroyed = true
    this.app.renderer.off('resize', this.refit)
    this.app.ticker.remove(this.tick)
    this.root.destroy({ children: true })
  }

  private buildLocation(id: LocationId): LocationNode {
    const layer = LOCATION_LAYERS[id]
    const container = new Container()
    container.position.set(layer.x, layer.y)

    const sprite = (key: string): Sprite => {
      const s = new Sprite(this.textures[key])
      s.setSize(layer.width, layer.height)
      return s
    }
    const base = sprite(`location.${id}`)
    const hint = sprite(`location.${id}.hint`)
    // Legal-target flash (user rule: brighter AND blinking): an additive copy
    // of the hint art over it pushes the neon rim past the texture's own
    // brightness while both pulse fast in pulse().
    const hintGlow = sprite(`location.${id}.hint`)
    hintGlow.blendMode = 'add'
    const active = sprite(`location.${id}.active`)
    hint.visible = false
    hintGlow.visible = false
    active.visible = false

    const label = new Text({
      text: LOCATION_LABELS[id].toUpperCase(),
      style: {
        fontFamily: LABEL_FONT,
        fontSize: 26,
        fontWeight: '600',
        letterSpacing: 4,
        fill: 0xf0c96a,
        dropShadow: { distance: 2, blur: 4, alpha: 0.8, color: 0x000000 }
      }
    })
    label.anchor.set(0.5)
    label.position.set(
      layer.x + layer.width / 2,
      layer.y + layer.height / 2 + LOCATION_HIT_RADIUS + 26
    )
    label.alpha = 0.85
    this.labelLayer.addChild(label)

    container.addChild(base, hint, hintGlow, active)
    container.eventMode = 'static'
    container.cursor = 'pointer'
    container.hitArea = new Circle(layer.width / 2, layer.height / 2, LOCATION_HIT_RADIUS)
    container.on('pointertap', () => this.callbacks.onLocationTap(id))
    container.on('pointerover', () => this.callbacks.onLocationHover(id))
    container.on('pointerout', () => this.callbacks.onLocationHover(null))

    const node: LocationNode = {
      base,
      hint,
      hintGlow,
      active,
      label,
      container,
      visual: { state: 'normal', disabled: false }
    }
    this.locations.set(id, node)
    return node
  }

  update(props: BoardProps): void {
    this.pulseTargets = []
    this.viewerSeat = props.viewerSeat
    this.allySeats = props.allySeats
    this.argSkins = props.argSkins ?? {}
    this.wardrobes = props.wardrobes ?? {}
    for (const id of LOCATIONS) {
      const node = this.locations.get(id)
      if (!node) continue
      const visual = props.locations[id]
      node.visual = visual
      node.hint.visible = visual.state === 'hint'
      node.hint.alpha = 1
      node.hintGlow.visible = visual.state === 'hint'
      node.hintGlow.alpha = 0
      node.active.visible = visual.state === 'active'
      node.container.filters = visual.disabled ? [this.disabledFilter] : []
      node.container.cursor = visual.disabled ? 'default' : 'pointer'
      if (visual.state === 'hint') {
        this.pulseTargets.push({ sprite: node.hint, kind: 'hint' })
        this.pulseTargets.push({ sprite: node.hintGlow, kind: 'hint-glow' })
      }
    }
    this.rebuildTokens(props.tokens)
  }

  private rebuildTokens(tokens: BoardToken[]): void {
    this.lastTokens = tokens
    for (const child of this.tokenLayer.removeChildren()) child.destroy({ children: true })
    this.appearing = []

    const byLocation = new Map<LocationId, BoardToken[]>()
    for (const token of tokens) {
      const list = byLocation.get(token.locationId) ?? []
      list.push(token)
      byLocation.set(token.locationId, list)
    }
    for (const [locationId, group] of byLocation) {
      const center = locationCenter(locationId)
      const cols = Math.min(group.length, TOKEN_GRID_COLS)
      group.forEach((token, i) => {
        const col = i % TOKEN_GRID_COLS
        const row = Math.floor(i / TOKEN_GRID_COLS)
        const rowWidth = Math.min(group.length - row * TOKEN_GRID_COLS, cols)
        const node = this.buildToken(token)
        node.position.set(
          center.x + (col - (rowWidth - 1) / 2) * TOKEN_SPACING,
          center.y + 26 + row * TOKEN_SPACING
        )
        this.tokenLayer.addChild(node)
        if (token.staged || token.selected) this.pulseTargets.push({ sprite: node, kind: 'staged' })
        // Pop-in only for tokens new to the board (id first seen), not on re-renders.
        if (!this.knownTokens.has(token.id)) this.appearing.push({ node, t: 0 })
      })
    }
    this.knownTokens = new Set(tokens.map((t) => t.id))
    this.invalidate()
  }

  private buildToken(token: BoardToken): Container {
    const node = new Container()
    const own = token.seat === null || token.seat === this.viewerSeat
    const ally = !own && token.seat !== null && this.allySeats.includes(token.seat)
    // The ring IS the "whose actor" signal (author call, 2026-07-23): each seat
    // paints its color around the portrait; gold = your selection, staged =
    // uncommitted local placement. Allegiance keeps a hint via the backing tint.
    const ringColor = token.selected
      ? 0xf0c96a
      : token.seat === null
        ? STAGED_COLOR
        : SEAT_COLORS[token.seat]
    const backing = own || ally ? TOKEN_BACKING : TOKEN_BACKING_ENEMY

    const ring = new Graphics()
      .circle(0, 0, TOKEN_RADIUS)
      .fill({ color: backing, alpha: 0.92 })
      .stroke({
        width: token.selected ? 6 : 4,
        color: ringColor,
        alpha: token.staged ? 0.95 : 1
      })
    node.addChild(ring)

    const head = new Sprite(this.headTextureFor(token))
    head.anchor.set(0.5)
    head.setSize(TOKEN_RADIUS * 2 - 8, TOKEN_RADIUS * 2 - 8)
    const mask = new Graphics().circle(0, 0, TOKEN_RADIUS - 4).fill(0xffffff)
    head.mask = mask
    node.addChild(mask, head)

    if (token.argument)
      node.addChild(
        this.badge(
          this.argumentKey(token.argument, token.seat),
          TOKEN_RADIUS - 12,
          TOKEN_RADIUS - 12,
          BADGE_BRONZE
        )
      )
    if (token.bet)
      node.addChild(
        this.badge(
          `resource.${BET_COST[token.bet]}`,
          -(TOKEN_RADIUS - 12),
          TOKEN_RADIUS - 12,
          BADGE_BRONZE
        )
      )

    if (token.staged) node.alpha = 0.92

    node.eventMode = 'static'
    node.cursor = 'pointer'
    node.hitArea = new Circle(0, 0, TOKEN_RADIUS)
    node.on('pointertap', () => this.callbacks.onTokenTap(token.id))
    return node
  }

  /** The wardrobe a token's head should wear: seat null = the viewer's staged ghost. */
  private wardrobeOf(seat: SeatId | null): Wardrobe | null {
    const owner = seat ?? this.viewerSeat
    if (owner === null) return null
    return this.wardrobes[owner] ?? null
  }

  /**
   * Head texture for a token. Canonical looks use the preloaded portrait; a
   * dressed look uses its cached crop or, on first sight, the canonical
   * portrait as a placeholder while the crop builds — then tokens rebuild.
   */
  private headTextureFor(token: BoardToken): Texture {
    const look = headLook(token.actorType, this.wardrobeOf(token.seat))
    if (look.kind === 'canonical') return this.textures[look.key] ?? Texture.EMPTY
    const sig = headLookKey(look)
    const cached = headTextureCache.get(sig)
    if (cached) return cached
    if (!headTexturePending.has(sig)) {
      headTexturePending.set(sig, buildHeadTexture(look))
      void headTexturePending
        .get(sig)!
        .then((texture) => {
          headTextureCache.set(sig, texture)
          if (!this.destroyed) this.rebuildTokens(this.lastTokens)
        })
        .catch(() => {
          // A missing crop image must not take the board down — the canonical
          // placeholder simply stays.
        })
        .finally(() => headTexturePending.delete(sig))
    }
    return this.textures[`actor.${token.actorType}.head`] ?? Texture.EMPTY
  }

  /** Coin art for a token's argument: seat null = the viewer's own staged ghost. */
  private argumentKey(argument: ArgumentType, seat: SeatId | null): string {
    const owner = seat ?? this.viewerSeat
    const set = owner === null ? null : (this.argSkins[owner] ?? null)
    return set ? `argSkin.${set}.${argument}` : `argument.${argument}`
  }

  private badge(textureKey: string, x: number, y: number, ringColor: number): Container {
    const badge = new Container()
    badge.position.set(x, y)
    const bg = new Graphics()
      .circle(0, 0, 15)
      .fill({ color: 0x0b0a12, alpha: 0.95 })
      .stroke({ width: 2, color: ringColor, alpha: 0.9 })
    const icon = new Sprite(this.textures[textureKey])
    icon.anchor.set(0.5)
    icon.setSize(24, 24)
    badge.addChild(bg, icon)
    return badge
  }

  /**
   * Viewport (CSS px) center of a location — anchors DOM overlays (the on-board
   * argument/bet picker) to the board. Inverse of hitTestLocation's mapping.
   */
  locationScreenCenter(id: LocationId): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect()
    const center = locationCenter(id)
    const global = this.root.toGlobal(new Point(center.x, center.y))
    return { x: rect.left + global.x, y: rect.top + global.y }
  }

  /** Maps a DOM pointer position to the location under it (drag-drop from the dock). */
  hitTestLocation(clientX: number, clientY: number): LocationId | null {
    const rect = this.app.canvas.getBoundingClientRect()
    const world = this.root.toLocal(new Point(clientX - rect.left, clientY - rect.top))
    for (const id of LOCATIONS) {
      const center = locationCenter(id)
      const dx = world.x - center.x
      const dy = world.y - center.y
      if (dx * dx + dy * dy <= LOCATION_HIT_RADIUS * LOCATION_HIT_RADIUS) return id
    }
    return null
  }

  private fit(): void {
    const { width, height } = this.app.renderer.screen
    const scale = Math.min(width / WORLD.width, height / WORLD.height)
    this.root.scale.set(scale)
    this.root.position.set(
      (width - WORLD.width * scale) / 2 - WORLD.x * scale,
      (height - WORLD.height * scale) / 2 - WORLD.y * scale
    )
    this.invalidate()
  }

  private pulse(deltaMS: number): void {
    this.elapsed += deltaMS / 1000
    const wave = (Math.sin(this.elapsed * 4) + 1) / 2
    // Legal targets blink fast (user rule: brighter + flashing), tokens breathe slow.
    const flash = (Math.sin(this.elapsed * 8) + 1) / 2
    for (const target of this.pulseTargets) {
      if (target.sprite.destroyed) continue
      if (target.kind === 'hint') target.sprite.alpha = 0.7 + 0.3 * flash
      else if (target.kind === 'hint-glow') target.sprite.alpha = 0.55 * flash
      else target.sprite.scale.set(1 + 0.05 * wave)
    }
    if (this.appearing.length > 0) {
      const APPEAR_MS = 260
      for (const item of this.appearing) {
        if (item.node.destroyed) continue
        item.t = Math.min(1, item.t + deltaMS / APPEAR_MS)
        const eased = 1 - (1 - item.t) ** 3 // ease-out cubic
        item.node.scale.set(0.4 + 0.6 * eased)
        item.node.alpha = eased
      }
      this.appearing = this.appearing.filter((i) => i.t < 1 && !i.node.destroyed)
    }
    // Last pop-in finished and nothing pulses: settle into a still frame.
    if (!this.animating) this.invalidate()
  }
}
