// One-off probe for the always-visible hand strip + top-bar deck counters
// (author backlog: table transparency). Drives a bot game through turn 1,
// buys a market card so the hand is non-empty, waits out the turn-2 splash
// and screenshots the persistent HUD. Honors SMOKE_VIEWPORT (WxH).
// Run: SMOKE_URL=http://localhost:5173 SMOKE_BROWSER=chromium tsx scripts/hand-strip-probe.ts

import {
  USER_A,
  forfeitGame,
  launchBrowser,
  passP1,
  placeAllAndCommit,
  shot,
  signIn,
  tryClick,
  wirePageLogs
} from './smoke-lib.js'

const viewport = /^(\d+)x(\d+)$/.exec(process.env.SMOKE_VIEWPORT ?? '')
const WIDTH = viewport ? Number(viewport[1]) : 1440
const HEIGHT = viewport ? Number(viewport[2]) : 900
const TAG = `${WIDTH}x${HEIGHT}`

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
  wirePageLogs(page, 'browser')

  try {
    await signIn(page, USER_A)
    // A previous crashed run may have left USER_A mid-game — bail out first.
    const resume = page.getByRole('button', { name: /return to the board/i })
    if (await resume.isVisible().catch(() => false)) {
      await resume.click()
      await forfeitGame(page, 10000)
      await page.getByRole('button', { name: /back to home/i }).click({ timeout: 10000 })
      await page.getByRole('button', { name: /^vs bot$/i }).waitFor({ timeout: 10000 })
      console.log('✓ forfeited a stale game')
    }
    await page.getByRole('button', { name: /^vs bot$/i }).click()
    await page.locator('.game-stage').waitFor({ timeout: 15000 })
    await page.locator('.board-host canvas').waitFor({ timeout: 15000 })
    await page.waitForTimeout(1500)
    await passP1(page)
    await placeAllAndCommit(page)

    // Ride P3/P4/P5 with client-smoke's priority ladder until a card lands in
    // hand (the market buy) and the strip shows up.
    const deadline = Date.now() + 120000
    let bought = false
    while (Date.now() < deadline) {
      if (
        await page
          .locator('.hud-hand')
          .isVisible()
          .catch(() => false)
      )
        break
      const playCards = page.getByRole('button', { name: /play no cards|commit \d+ action card/i })
      const reveal = page.getByRole('button', { name: /reveal conflict/i })
      const getIt = page.getByRole('button', { name: /get it!/i })
      const arenaRock = page.locator('.arena-rps', { hasText: 'rock' })
      const buy = page.getByRole('button', { name: /^buy$/i })
      const skip = page.getByRole('button', { name: /^skip$/i })

      if (await tryClick(reveal, 800)) continue
      if (await tryClick(getIt, 800)) continue
      if (
        await arenaRock
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        await tryClick(arenaRock.first(), 800)
        continue
      }
      if (await tryClick(playCards, 800)) continue
      if (!bought && (await buy.isEnabled().catch(() => false))) {
        bought = await tryClick(buy)
        if (bought) console.log('✓ bought a market card')
        continue
      }
      // Don't skip the market while a buy is still possible next tick.
      if (bought && (await tryClick(skip, 800))) continue
      await page.waitForTimeout(400)
    }

    // Shot immediately — the 30s market deadline is racing us into turn 2.
    await page.locator('.hud-hand').waitFor({ timeout: 20000 })
    await shot(page, `hand-strip-${TAG}`)

    const cards = await page.locator('.hud-hand-card').count()
    console.log(`✓ hand strip visible with ${cards} card(s) at ${TAG}`)

    // Deck counters live in the top strip: two titled stats.
    for (const title of ['Events left in deck', 'Action Cards left in deck']) {
      const text = await page.locator(`.hud-strip-stat[title="${title}"]`).innerText()
      if (!/\d/.test(text)) throw new Error(`deck counter "${title}" shows no number`)
      console.log(`✓ ${title}: ${text.trim()}`)
    }

    // Tap opens Global Stats. If the market deadline already flipped us into
    // turn 2, answer whatever modal covers the strip and tap in a calm window.
    const tapDeadline = Date.now() + 60000
    let tapped = false
    while (!tapped && Date.now() < tapDeadline) {
      const covered = await page
        .locator('.modal-overlay')
        .first()
        .isVisible()
        .catch(() => false)
      if (
        !covered &&
        (await page
          .locator('.hud-hand')
          .isVisible()
          .catch(() => false))
      ) {
        try {
          await shot(page, `hand-strip-calm-${TAG}`)
          await page.locator('.hud-hand').click({ timeout: 2000 })
          await page.locator('.global-stats').waitFor({ timeout: 2000 })
          tapped = true
          break
        } catch {
          /* window closed under us — ride on */
        }
      }
      for (const name of [/confirm/i, /get it!/i, /reveal conflict/i, /play no cards/i]) {
        if (await tryClick(page.getByRole('button', { name }), 500)) break
      }
      await page.waitForTimeout(400)
    }
    if (!tapped) throw new Error('never found a calm window to tap the hand strip')
    await shot(page, `hand-strip-stats-${TAG}`)
    console.log('✓ tap on the hand opened Global Stats')
    console.log(`✅ HAND-STRIP PROBE PASS at ${TAG}`)
  } finally {
    // Leave no stale game behind for the next probe/smoke run.
    await tryClick(page.locator('.chat-close'), 800)
    await forfeitGame(page, 2000)
    await page.waitForTimeout(800)
    await browser.close()
  }
}

await main()
