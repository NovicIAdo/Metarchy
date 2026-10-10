// One-off probe for the on-board picker UX + always-available Global Stats:
// (1) picker bet stage renders on the board (screenshot);
// (2) a tap off the plate cancels and returns the actor to the dock;
// (3) Stats button opens the window OVER the P4 conflict arena;
// (4) Stats button opens the window OVER the turn-2 P1 event modal.
// Run: SMOKE_URL=http://localhost:5173 SMOKE_BROWSER=chromium tsx scripts/ui-probe.ts

import {
  CENTERS,
  USER_A,
  canvasPoint,
  forfeitGame,
  launchBrowser,
  passP1,
  placeAllAndCommit,
  shot,
  signIn,
  tryClick,
  wirePageLogs
} from './smoke-lib.js'
import type { Page } from 'playwright'

async function checkStatsOver(page: Page, tag: string): Promise<void> {
  await page.locator('.hud-stats-btn').click()
  await page.locator('.global-stats').waitFor({ timeout: 3000 })
  await shot(page, `stats-over-${tag}`)
  await page.locator('.chat-close').click()
  if (
    await page
      .locator('.global-stats')
      .isVisible()
      .catch(() => false)
  )
    throw new Error(`stats window did not close over ${tag}`)
  console.log(`✓ Global Stats opened and closed over the ${tag}`)
}

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  wirePageLogs(page, 'browser')

  try {
    await signIn(page, USER_A)
    await page.getByRole('button', { name: /^vs bot$/i }).click()
    await page.locator('.game-stage').waitFor({ timeout: 15000 })
    await page.locator('.board-host canvas').waitFor({ timeout: 15000 })
    await page.waitForTimeout(1500)
    await passP1(page) // turn 1 opens straight in P2
    await page.locator('.dock').waitFor({ timeout: 10000 })

    // --- (1) picker bet stage on the board ---------------------------------------
    const chip = page.locator('.dock-orb').first() // politician
    await chip.click()
    await page.waitForTimeout(200)
    const square = await canvasPoint(page, CENTERS.square as { x: number; y: number })
    await page.mouse.click(square.x, square.y)
    await page.locator('.board-picker .radial-avatar').waitFor({ timeout: 5000 })
    await page.locator('.radial-coin:enabled').first().click()
    await page.locator('.radial-skip').waitFor({ timeout: 3000 })
    await shot(page, 'picker-bet-stage')

    // --- (2) tap-away cancels: actor returns to the dock -------------------------
    const orbsBefore = await page.locator('.dock-orb').count()
    await page.mouse.click(150, 780) // empty space, no location underneath
    await page.waitForTimeout(300)
    if (await page.locator('.board-picker').count()) throw new Error('picker still open')
    const orbsAfter = await page.locator('.dock-orb').count()
    if (orbsAfter !== orbsBefore + 1)
      throw new Error(`expected actor back in dock (${orbsBefore} → ${orbsAfter})`)
    await shot(page, 'picker-cancelled-back-in-dock')
    console.log('✓ tap-away cancelled the picker; actor returned to the dock')

    // --- (3)+(4) drive the turn; stats over the arena and the turn-2 event -------
    await placeAllAndCommit(page)
    let checkedArena = false
    let checkedEvent = false
    let bought = false
    const deadline = Date.now() + 8 * 60_000
    while (Date.now() < deadline && !checkedEvent) {
      const label = (await page.locator('.hud-turn').textContent()) ?? ''
      if (label.includes('Turn 2') && label.includes('Event')) {
        await page.locator('.event-modal, .arena').first().waitFor({ timeout: 10000 })
        await page.waitForTimeout(2800) // let the phase splash fade for a clean shot
        await checkStatsOver(page, 'turn2-event-modal')
        checkedEvent = true
        break
      }
      const reveal = page.getByRole('button', { name: /reveal conflict/i })
      const getIt = page.getByRole('button', { name: /get it!/i })
      const playCards = page.getByRole('button', { name: /play no cards|commit \d+ action card/i })
      const rps = page.locator('.arena-rps', { hasText: 'rock' })
      const buy = page.getByRole('button', { name: /^buy$/i })
      const skip = page.getByRole('button', { name: /^skip$/i })
      if (await reveal.isVisible().catch(() => false)) {
        if (!checkedArena) {
          await checkStatsOver(page, 'conflict-arena')
          checkedArena = true
        }
        await tryClick(reveal, 2500, 'reveal')
        continue
      }
      if (await getIt.isVisible().catch(() => false)) {
        await tryClick(getIt, 2500, 'get-it')
        continue
      }
      if (
        await rps
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        await tryClick(rps.first(), 2500, 'rps')
        continue
      }
      if (await playCards.isVisible().catch(() => false)) {
        await tryClick(playCards, 2500, 'play-cards')
        continue
      }
      if (!bought && (await buy.isEnabled().catch(() => false))) {
        bought = await tryClick(buy)
        continue
      }
      if (await skip.isVisible().catch(() => false)) {
        await tryClick(skip)
        continue
      }
      await page.waitForTimeout(400)
    }
    if (!checkedArena) console.log('⚠ no arena reached this run (no conflicts)')
    if (!checkedEvent) throw new Error('never reached the turn-2 event')

    await passP1(page) // answer the event; forfeit is reachable again in P2
    await page.locator('.dock').waitFor({ timeout: 10000 })
    await forfeitGame(page, 10000)
    await page.locator('.gameover-verdict').waitFor({ timeout: 10000 })
    console.log('✅ UI PROBE PASS')
  } catch (err) {
    await shot(page, 'PROBE-FAILURE')
    throw err
  } finally {
    await browser.close()
  }
}

await main()
