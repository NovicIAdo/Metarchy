// One-off probe: (1) legal-location glow flashes — two screenshots half a
// flash apart must differ; (2) opportunistic: if turn-2 draws a compare event
// with tied values, the standoff screen (user rule) shows amounts and the
// Resolve the Conflict button.
// Run: SMOKE_URL=http://localhost:5173 SMOKE_BROWSER=chromium tsx scripts/glow-standoff-probe.ts

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
    await passP1(page)
    await page.locator('.dock').waitFor({ timeout: 10000 })

    // --- (1) hint glow flashes ---------------------------------------------------
    await page.locator('.dock-orb').first().click() // politician → square glows
    await page.waitForTimeout(350)
    await shot(page, 'glow-a')
    await page.waitForTimeout(390) // ~half the sin(8t) period → opposite phase
    await shot(page, 'glow-b')
    await page.locator('.dock-orb').first().click() // toggle the selection off
    await page.waitForTimeout(200)
    console.log('✓ glow screenshots taken (compare brightness of the legal hexes)')

    // --- (2) drive to turn 2; catch a compare standoff if the deck offers one ----
    await placeAllAndCommit(page)
    const deadline = Date.now() + 6 * 60_000
    while (Date.now() < deadline) {
      const label = (await page.locator('.hud-turn').textContent()) ?? ''
      if (label.includes('Turn 2') && label.includes('Event')) {
        await page.waitForTimeout(2800) // splash
        const modal = page.locator('.event-modal')
        const text = (await modal.textContent().catch(() => '')) ?? ''
        if (text.includes('conflict resolution')) {
          await shot(page, 'compare-standoff')
          const btn = page.getByRole('button', { name: /resolve the conflict/i })
          if (!(await btn.isVisible())) throw new Error('standoff without the button')
          await btn.click()
          await page.waitForTimeout(1200)
          await shot(page, 'after-standoff-arena')
          console.log('✅ STANDOFF CAUGHT: amounts + Resolve the Conflict → arena')
        } else {
          console.log(
            `⚠ turn-2 event is not a tied compare (${text.slice(0, 80)}…) — unit tests cover the standoff`
          )
        }
        return
      }
      const ack = page.getByRole('button', { name: /get it!|reveal conflict/i }).first()
      const confirm = page.getByRole('button', { name: /confirm/i })
      const playCards = page.getByRole('button', { name: /play no cards|commit \d+ action card/i })
      const rps = page.locator('.arena-rps', { hasText: 'rock' })
      const skip = page.getByRole('button', { name: /^skip$/i })
      if (await ack.isVisible().catch(() => false)) {
        await tryClick(ack, 2500, 'ack')
        continue
      }
      if (await confirm.isVisible().catch(() => false)) {
        await tryClick(confirm, 2500, 'confirm')
        continue
      }
      if (await playCards.isVisible().catch(() => false)) {
        await tryClick(playCards, 2500, 'play-cards')
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
      if (await skip.isVisible().catch(() => false)) {
        await tryClick(skip)
        continue
      }
      await page.waitForTimeout(300)
    }
    throw new Error('never reached turn 2')
  } catch (err) {
    await shot(page, 'GLOW-PROBE-FAILURE')
    throw err
  } finally {
    await forfeitGame(page, 3000).catch(() => null)
    await browser.close()
  }
}

await main()
