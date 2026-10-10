// Manual probe (NOT in CI): phone PORTRAIT reachability. The HUD was tuned for
// landscape (@media max-height:500px) and never for a narrow tall screen, so
// this walks the surfaces a phone player actually taps and fails when a control
// sits outside the viewport or under another layer.
// Run: pnpm --filter @metarchy/e2e exec tsx scripts/mobile-probe.ts
// Env: SMOKE_URL (default local dev server), SMOKE_BROWSER=chromium for shots.

import type { Locator, Page } from 'playwright'
import { BASE_URL, launchBrowser, passP1, shot, signIn, USER_A, wirePageLogs } from './smoke-lib.js'

/** iPhone-class portrait: the narrowest screen we promise to support. */
const VIEWPORT = { width: 390, height: 844 }

const problems: string[] = []

/** A control is usable only if it is on screen AND nothing else takes the tap. */
async function checkTappable(page: Page, locator: Locator, label: string): Promise<void> {
  if ((await locator.count()) === 0) {
    problems.push(`${label}: not rendered at all`)
    return
  }
  const box = await locator.first().boundingBox()
  if (!box) {
    problems.push(`${label}: no box (display:none or detached)`)
    return
  }
  const off: string[] = []
  if (box.x < 0) off.push(`${Math.round(-box.x)}px past the left edge`)
  if (box.x + box.width > VIEWPORT.width)
    off.push(`${Math.round(box.x + box.width - VIEWPORT.width)}px past the right edge`)
  if (box.y < 0) off.push(`${Math.round(-box.y)}px above the top`)
  if (box.y + box.height > VIEWPORT.height)
    off.push(`${Math.round(box.y + box.height - VIEWPORT.height)}px below the fold`)
  if (off.length > 0) problems.push(`${label}: ${off.join(', ')}`)

  // Who actually receives the tap at the control's centre?
  const hit = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x as number, y as number)
      return el
        ? `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)}`
        : null
    },
    [box.x + box.width / 2, box.y + box.height / 2]
  )
  const own = await locator.first().evaluate(
    (el, point) => {
      const hitEl = document.elementFromPoint(point[0] as number, point[1] as number)
      return hitEl ? el.contains(hitEl) || hitEl.contains(el) : false
    },
    [box.x + box.width / 2, box.y + box.height / 2]
  )
  if (!own) problems.push(`${label}: covered — the tap lands on ${hit}`)
  console.log(
    `${off.length === 0 && own ? '✓' : '✗'} ${label}  ` +
      `[${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}]`
  )
}

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: VIEWPORT, isMobile: true, hasTouch: true })
  wirePageLogs(page, 'mobile')
  try {
    await signIn(page, USER_A)
    await shot(page, 'mobile-home')
    await checkTappable(page, page.getByRole('button', { name: /^vs bot$/i }), 'Home · vs Bot')

    // The rulebook's ☰ opens the chapter nav — the only way to a chapter on a phone.
    await page.goto(`${BASE_URL}/rules`)
    const navToggle = page.locator('.rules-nav-toggle')
    await navToggle.waitFor({ timeout: 10_000 })
    await checkTappable(page, navToggle, 'Rules · ☰ nav toggle')
    await navToggle.click()
    const navOpen = await page
      .locator('.rules-nav.open')
      .isVisible()
      .catch(() => false)
    if (!navOpen) problems.push('Rules · ☰ nav toggle: tapped but the nav did not open')
    await shot(page, 'mobile-rules-nav')

    // In-game HUD: the top bar carries Global Stats, the deadline and the status.
    await page.goto(BASE_URL)
    await page.getByRole('button', { name: /^vs bot$/i }).click()
    await page.locator('.game-stage').waitFor({ timeout: 15_000 })
    await page.locator('.board-host canvas').waitFor({ timeout: 15_000 })
    await page.waitForTimeout(1500)
    await shot(page, 'mobile-game-p1')
    await checkTappable(page, page.locator('.hud-stats-btn'), 'Game · ☰ Stats')
    await passP1(page)
    await page.locator('.dock').waitFor({ timeout: 10_000 })
    await shot(page, 'mobile-game-p2')
    await checkTappable(page, page.locator('.hud-stats-btn'), 'Game P2 · ☰ Stats')
    await checkTappable(page, page.locator('.dock-orb').first(), 'Game P2 · actor orb')
    await checkTappable(page, page.locator('.hud-forfeit'), 'Game · forfeit/leave')

    // Global Stats is where a phone player reads everyone's standing.
    if ((await page.locator('.hud-stats-btn').count()) > 0) {
      await page
        .locator('.hud-stats-btn')
        .click({ timeout: 5000 })
        .catch(() => {})
      const opened = await page
        .locator('.global-stats')
        .isVisible()
        .catch(() => false)
      if (!opened) problems.push('Game · ☰ Stats: tapped but Global Stats did not open')
      else {
        await shot(page, 'mobile-global-stats')
        await checkTappable(page, page.locator('.chat-close'), 'Global Stats · close')
      }
    }

    if (problems.length > 0) {
      console.log(`\n❌ MOBILE PROBE: ${problems.length} unreachable control(s)`)
      for (const p of problems) console.log(`   · ${p}`)
      process.exitCode = 1
    } else console.log('\n✅ MOBILE PROBE PASS — every checked control is on screen and tappable')
  } finally {
    await browser.close()
  }
}

await main()
