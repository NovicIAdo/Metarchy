// Manual probe (NOT in CI): the /profile skin galleries — pick a whole-figure
// skin for the robot, verify it round-trips through the server, screenshot it.
// Run: pnpm --filter @metarchy/e2e exec tsx scripts/skin-probe.ts
// Env: SMOKE_URL (default local dev server), SMOKE_BROWSER=chromium for shots.

import { BASE_URL, launchBrowser, shot, signIn, USER_A, wirePageLogs } from './smoke-lib.js'

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  wirePageLogs(page, 'skin')
  try {
    await page.goto(BASE_URL)
    await signIn(page, USER_A)
    await page.waitForSelector('text=ONLINE', { timeout: 20_000 })

    await page.goto(`${BASE_URL}/profile`)
    // The robot gallery: pick the "Industrial" skin thumbnail.
    const robotBlock = page.locator('.skin-block', { hasText: 'Robot' })
    await robotBlock.waitFor({ timeout: 10_000 })
    await robotBlock.locator('.skin-thumb', { hasText: 'Industrial' }).click()
    await page.waitForSelector(
      '.skin-block:has-text("Robot") .skin-thumb.chosen:has-text("Industrial")',
      {
        timeout: 10_000
      }
    )
    console.log('robot skin "Industrial" selected')
    await shot(page, 'skin-galleries')

    // Reload — the choice must come from the server, not local state.
    await page.reload()
    await page.waitForSelector(
      '.skin-block:has-text("Robot") .skin-thumb.chosen:has-text("Industrial")',
      {
        timeout: 20_000
      }
    )
    console.log('reload: robot skin persisted server-side')

    // Back to Default to leave the account clean for other probes.
    const robot2 = page.locator('.skin-block', { hasText: 'Robot' })
    await robot2.locator('.skin-thumb', { hasText: 'Default' }).click()
    await page.waitForSelector(
      '.skin-block:has-text("Robot") .skin-thumb.chosen:has-text("Default")',
      {
        timeout: 10_000
      }
    )
    console.log('reset: robot back to Default')
    console.log('✅ SKIN PROBE PASS')
  } finally {
    await browser.close()
  }
}

await main()
