// Manual probe (NOT in CI): the /profile fitting room end-to-end — customize the
// politician, save, assert the profile round-trips, screenshot the editor.
// Run: pnpm --filter @metarchy/e2e exec tsx scripts/wardrobe-probe.ts
// Env: SMOKE_URL (default local dev server), SMOKE_BROWSER=chromium for shots.

import { BASE_URL, launchBrowser, shot, signIn, USER_A, wirePageLogs } from './smoke-lib.js'

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  wirePageLogs(page, 'wardrobe')
  try {
    await page.goto(BASE_URL)
    await signIn(page, USER_A)
    await page.waitForSelector('text=ONLINE', { timeout: 20_000 })

    await page.goto(`${BASE_URL}/profile`)
    await page.getByRole('button', { name: 'Customize' }).click()
    await page.waitForSelector('.wardrobe-editor .layered-actor img', { timeout: 10_000 })

    // Dress her up: body 3, long coat in colorway 2, hair 4/3, visor 2 + mask 1.
    const chip = (row: number, name: string) =>
      page.locator('.wardrobe-row').nth(row).locator('.wardrobe-chip', { hasText: name }).first()
    await chip(0, '3').click()
    await chip(1, 'Long coat').click()
    await chip(1, '2').click()
    await chip(2, '4').click()
    await page.waitForTimeout(300)
    await shot(page, 'wardrobe-editor')

    await page.getByRole('button', { name: '✓ Save look' }).click()
    await page.waitForSelector('text=Custom ✓', { timeout: 10_000 })
    console.log('saved: profile shows Custom ✓')

    // Reload — the loadout must come back from the server, not local state.
    await page.reload()
    await page.waitForSelector('text=Custom ✓', { timeout: 20_000 })
    console.log('reload: loadout persisted server-side')
    await page.getByRole('button', { name: 'Customize' }).click()
    await page.waitForSelector('.wardrobe-editor', { timeout: 10_000 })
    const layers = await page.locator('.wardrobe-editor .layered-actor img').count()
    if (layers < 3) throw new Error(`expected ≥3 layers after reload, saw ${layers}`)
    console.log(`reload: editor re-opened with ${layers} layers`)
    await shot(page, 'wardrobe-after-reload')

    // Leave the account canonical for other probes/smokes.
    await page.getByRole('button', { name: 'Reset to default' }).click()
    await page.waitForSelector('text=Default ✓', { timeout: 10_000 })
    console.log('reset: back to canonical')
    console.log('✅ WARDROBE PROBE PASS')
  } finally {
    await browser.close()
  }
}

await main()
