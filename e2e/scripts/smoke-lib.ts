// Shared browser-smoke helpers for client-smoke (vs bots) and pvp-smoke (two
// contexts). SMOKE_BROWSER picks the engine: 'chrome' rides the installed Chrome
// (local default), 'chromium' uses Playwright's download (CI).

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Locator, type Page } from 'playwright'

export const BASE_URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:5173'
export const USER_A = {
  email: process.env.SMOKE_EMAIL ?? '',
  password: process.env.SMOKE_PASSWORD ?? ''
}
export const USER_B = {
  email: process.env.SMOKE_EMAIL_B ?? '',
  password: process.env.SMOKE_PASSWORD_B ?? ''
}

export const SHOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots')

// Must mirror board/layout.ts (world rect + location centers) to aim canvas clicks.
export const WORLD = { x: 116, y: -57, width: 1657, height: 1186 }
export const CENTERS: Record<string, { x: number; y: number }> = {
  square: { x: 515, y: 514 },
  theatre: { x: 714, y: 790 },
  university: { x: 743, y: 282 },
  factory: { x: 1182, y: 763 },
  power_plant: { x: 1139, y: 305 },
  dump: { x: 1374, y: 528 }
}

export async function launchBrowser(): Promise<Browser> {
  mkdirSync(SHOT_DIR, { recursive: true })
  const engine = process.env.SMOKE_BROWSER ?? 'chrome'
  return chromium.launch(
    engine === 'chrome' ? { channel: 'chrome', headless: true } : { headless: true }
  )
}

/** SMOKE_CPU=6 slows the page ×6 via CDP — reproduces starved-CI-runner hangs locally. */
export async function applyCpuThrottle(page: Page): Promise<void> {
  const rate = Number(process.env.SMOKE_CPU ?? '')
  if (!rate || Number.isNaN(rate)) return
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', { rate })
  console.log(`⏳ CPU throttled ×${rate}`)
}

let shotIndex = 0
export async function shot(page: Page, name: string): Promise<void> {
  shotIndex += 1
  await page.screenshot({
    path: path.join(SHOT_DIR, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  })
  console.log(`📸 ${shotIndex} ${name}`)
}

export function shotCount(): number {
  return shotIndex
}

/**
 * Click that tolerates the server racing us: bots answer instantly, so a button
 * seen by isVisible() may detach before the click lands. The state loops
 * re-evaluate every iteration, so a missed click is simply retried later.
 */
export async function tryClick(locator: Locator, timeout = 2500, tag?: string): Promise<boolean> {
  try {
    await locator.click({ timeout })
    return true
  } catch (err) {
    // With a tag, say WHY playwright refused (not stable / intercepted / detached) —
    // the difference is the whole diagnosis when CI hangs on a visible button.
    // The reason sits at the END of the call log, so never truncate the tail.
    if (tag) {
      const full = String(err instanceof Error ? err.message : err)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' | ')
      console.log(`⚠ click failed [${tag}]: ${full}`)
      // Actionability waits ride on requestAnimationFrame; under software-GL
      // (CI) frames can take seconds and honest clicks time out on a perfectly
      // fine button — even force clicks stall in scrollIntoView. Dispatch raw
      // input at the box center instead: no frame waits at all. Trade-off:
      // this can mask a genuinely covered button — acceptable in the tagged
      // hot loops only, where progression is asserted separately.
      try {
        const box = await locator.boundingBox()
        if (!box) return false
        await locator.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        console.log(`✓ raw click dispatched [${tag}]`)
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

/**
 * Forfeit is two taps now: the corner button opens a confirm and only the
 * dialog's own danger button reaches the server (ForfeitButton.tsx — a beta
 * player ended a ranked match with one stray tap). Both buttons read "Forfeit",
 * so a getByRole(/forfeit/i) in a probe would hit playwright's strict mode —
 * every probe goes through here instead.
 */
export async function forfeitGame(page: Page, timeout = 5000): Promise<boolean> {
  if (!(await tryClick(page.locator('.hud-forfeit'), timeout, 'forfeit-open'))) return false
  return tryClick(page.locator('.forfeit-confirm .btn.danger'), timeout, 'forfeit-confirm')
}

export function wirePageLogs(page: Page, tag: string): void {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[${tag}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => console.log(`[${tag} pageerror] ${err.message}`))
}

export async function signIn(page: Page, user: { email: string; password: string }): Promise<void> {
  await page.goto(BASE_URL)
  await page.locator('input[type=email]').fill(user.email)
  await page.locator('input[type=password]').fill(user.password)
  await page.getByRole('button', { name: /^enter$/i }).click()
  await page.getByRole('button', { name: /^vs bot$/i }).waitFor({ timeout: 20000 })
}

export async function canvasPoint(
  page: Page,
  world: { x: number; y: number }
): Promise<{ x: number; y: number }> {
  const box = await page.locator('.board-host canvas').boundingBox()
  if (!box) throw new Error('board canvas not found')
  const scale = Math.min(box.width / WORLD.width, box.height / WORLD.height)
  return {
    x: box.x + (box.width - WORLD.width * scale) / 2 - WORLD.x * scale + world.x * scale,
    y: box.y + (box.height - WORLD.height * scale) / 2 - WORLD.y * scale + world.y * scale
  }
}

/** Handle whatever P1 stage shows until the phase label reads Distribution. */
export async function passP1(page: Page): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if ((await page.locator('.hud-turn').textContent())?.includes('Distribution')) return
    const getIt = page.getByRole('button', { name: /get it!/i })
    // Not anchored: the button's accessible name is "✓ Confirm".
    const confirm = page.getByRole('button', { name: /confirm/i })
    const rps = page.locator('.arena-rps', { hasText: 'rock' })
    // A tied event comparison is settled by a conflict the player opens.
    const resolve = page.getByRole('button', { name: /resolve the conflict/i })
    if (await getIt.isVisible().catch(() => false)) await tryClick(getIt)
    else if (await confirm.isVisible().catch(() => false)) await tryClick(confirm)
    else if (await resolve.isVisible().catch(() => false)) await tryClick(resolve)
    else if (
      await rps
        .first()
        .isVisible()
        .catch(() => false)
    )
      await tryClick(rps.first())
    await page.waitForTimeout(500)
  }
  throw new Error('P1 never reached distribution')
}

export async function placeActor(
  page: Page,
  actor: string,
  location: string,
  useDrag: boolean,
  screenshotPickers = false
): Promise<void> {
  const chip = page.locator('.dock-orb', { hasText: new RegExp(actor, 'i') })
  const target = await canvasPoint(page, CENTERS[location] as { x: number; y: number })
  if (useDrag) {
    const box = await chip.boundingBox()
    if (!box) throw new Error(`chip ${actor} not visible`)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(
        box.x + box.width / 2 + ((target.x - box.x - box.width / 2) * step) / 8,
        box.y + box.height / 2 + ((target.y - box.y - box.height / 2) * step) / 8
      )
      await page.waitForTimeout(40)
    }
    await page.mouse.up()
  } else {
    await chip.click() // select
    await page.waitForTimeout(200)
    await page.mouse.click(target.x, target.y) // tap-to-place
  }
  // On-board picker: first available argument coin, then Skip (no bet) stages it.
  // (The .board-picker root is a 0×0 anchor — wait on a sized child instead.)
  await page.locator('.board-picker .radial-avatar').waitFor({ timeout: 5000 })
  if (screenshotPickers && shotIndex < 6) await shot(page, `picker-${actor}`)
  await page.locator('.radial-coin:enabled').first().click()
  await page.locator('.radial-skip').click()
  await page.waitForTimeout(250)
  console.log(`✓ placed ${actor} → ${location} (${useDrag ? 'drag' : 'tap'})`)
}

/** Place all four actors on their default legal spots and commit. */
export async function placeAllAndCommit(page: Page): Promise<void> {
  await placeActor(page, 'politician', 'square', false)
  await placeActor(page, 'scientist', 'university', false)
  await placeActor(page, 'artist', 'theatre', false)
  await placeActor(page, 'robot', 'factory', false)
  const commit = page.getByRole('button', { name: /commit placements/i })
  if (!(await commit.isEnabled())) throw new Error('commit disabled with 4 staged')
  await commit.click()
}
