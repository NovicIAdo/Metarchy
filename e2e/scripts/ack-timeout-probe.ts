// Live check of the 10s ack rule: drive a vs_bots game to the first
// acknowledgement (Get It! / Reveal Conflict), then DON'T click it — assert
// the top-bar deadline shows ≤10s and the game advances by itself.
// Run: SMOKE_URL=... SMOKE_BROWSER=chromium tsx scripts/ack-timeout-probe.ts

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
    await placeAllAndCommit(page)

    let lastLabel = ''
    const deadline = Date.now() + 6 * 60_000
    while (Date.now() < deadline) {
      const label = (await page.locator('.hud-turn').textContent()) ?? ''
      if (label !== lastLabel) {
        lastLabel = label
        console.log(`· ${label.trim()}`)
      }
      const ack = page.getByRole('button', { name: /get it!|reveal conflict/i }).first()
      if (await ack.isVisible().catch(() => false)) {
        // The check: never click — the server must move on within ~10s.
        await page.waitForTimeout(400) // let the deadline event land
        const timerText = (await page.locator('.hud-deadline').textContent()) ?? ''
        const remaining = Number(/(\d+)s/.exec(timerText)?.[1] ?? NaN)
        console.log(`ack on screen; top-bar deadline reads "${timerText.trim()}"`)
        if (!(remaining <= 10)) throw new Error(`expected ≤10s ack deadline, saw "${timerText}"`)
        await shot(page, 'ack-waiting-10s')
        const t0 = Date.now()
        await ack.waitFor({ state: 'hidden', timeout: 13_000 })
        const waited = Math.round((Date.now() - t0) / 1000)
        console.log(`✓ game advanced by itself after ~${waited}s without clicking`)
        await shot(page, 'ack-auto-advanced')
        console.log('✅ ACK TIMEOUT PROBE PASS')
        return
      }
      const playCards = page.getByRole('button', { name: /play no cards|commit \d+ action card/i })
      const confirm = page.getByRole('button', { name: /confirm/i })
      const commitP2 = page.getByRole('button', { name: /commit placements/i })
      const rps = page.locator('.arena-rps', { hasText: 'rock' })
      const buy = page.getByRole('button', { name: /^buy$/i })
      const skip = page.getByRole('button', { name: /^skip$/i })
      // A discard event's Confirm (0 is fine) leads straight to its Get It.
      if (await confirm.isVisible().catch(() => false)) {
        await tryClick(confirm, 2500, 'confirm')
        continue
      }
      // Later turns open in P2 again — place and commit to keep pace.
      if (await commitP2.isVisible().catch(() => false)) {
        await placeAllAndCommit(page).catch(() => null)
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
      if (await buy.isEnabled().catch(() => false)) {
        await tryClick(buy)
        continue
      }
      if (await skip.isVisible().catch(() => false)) {
        await tryClick(skip)
        continue
      }
      await page.waitForTimeout(300)
    }
    throw new Error('no ack stage reached in 6 minutes')
  } catch (err) {
    await shot(page, 'ACK-PROBE-FAILURE')
    throw err
  } finally {
    // Leave no wedged game behind: forfeit if still in one.
    await forfeitGame(page, 3000).catch(() => null)
    await browser.close()
  }
}

await main()
