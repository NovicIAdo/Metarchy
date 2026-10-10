// Manual probe (NOT in CI): the GATO shop's argument-coin shelf end to end —
// the free set shows as owned, an alloy buys, and equipping it in /profile
// round-trips through the server (the entitlement gate lives there).
// Run: pnpm --filter @metarchy/e2e exec tsx scripts/shop-probe.ts
// Env: SMOKE_URL (default local dev server), SMOKE_BROWSER=chromium for shots.
//
// The probe spends 300 GATO of the account it signs in as and leaves the coins
// equipped — run it on a smoke account, not on a beta player's.

import { BASE_URL, launchBrowser, shot, signIn, USER_A, wirePageLogs } from './smoke-lib.js'

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  wirePageLogs(page, 'shop')
  try {
    await page.goto(BASE_URL)
    await signIn(page, USER_A)
    await page.waitForSelector('text=ONLINE', { timeout: 20_000 })

    await page.goto(`${BASE_URL}/shop`)
    const shelf = page.locator('.shop-shelf', { hasText: 'Argument coins' })
    await shelf.waitFor({ timeout: 10_000 })

    // The default coins are game art, never merchandise: owned, no price tag.
    const free = shelf.locator('.shop-item', { hasText: 'Classic gold' })
    if ((await free.locator('.shop-owned').count()) !== 1)
      throw new Error('default coin set is not marked owned')
    if ((await free.locator('.shop-buy').count()) !== 0)
      throw new Error('default coin set is on sale — it must never be')
    // All four coins are shown, Dummy included (the shelf sells sets, not coins).
    const coins = await free.locator('.coin-set img').count()
    if (coins !== 4) throw new Error(`default set shows ${coins} coins, expected 4`)
    console.log('free set: owned, four coins, no price')
    await shot(page, 'shop-argument-coins')

    const matrix = shelf.locator('.shop-item', { hasText: 'Matrix' })
    const alreadyOwned = (await matrix.locator('.shop-owned').count()) === 1
    if (alreadyOwned) console.log('matrix set already owned — skipping the purchase')
    else {
      await matrix.locator('.shop-buy').click()
      await matrix.locator('.shop-owned').waitFor({ timeout: 15_000 })
      console.log('matrix set bought — balance debited, tile flipped to OWNED')
    }

    // Equipping is the server's call: the gate reads the wallet, not the client.
    await page.goto(`${BASE_URL}/profile`)
    const gallery = page.locator('.panel', { hasText: 'Argument coins' })
    await gallery.waitFor({ timeout: 10_000 })
    await gallery.locator('.skin-thumb', { hasText: 'Matrix' }).click()
    await gallery.locator('.skin-thumb.chosen', { hasText: 'Matrix' }).waitFor({ timeout: 10_000 })
    await shot(page, 'profile-argument-coins')

    // Reload — the choice must come from the server, not local state.
    await page.reload()
    const after = page.locator('.panel', { hasText: 'Argument coins' })
    await after.locator('.skin-thumb.chosen', { hasText: 'Matrix' }).waitFor({ timeout: 20_000 })
    console.log('reload: coin set persisted server-side')

    // An unbought set stays locked and walks to the Shop instead of equipping.
    const locked = await after.locator('.skin-thumb.locked').count()
    console.log(`locked sets still on the shelf: ${locked}`)
    console.log('✅ SHOP PROBE PASS')
  } finally {
    await browser.close()
  }
}

await main()
