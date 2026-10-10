// Manual probe (NOT in CI): a guest who joined a private lobby by code can Leave
// and return home, then start a fresh game (no lingering "already in game").
// Run: pnpm --filter @metarchy/e2e exec tsx scripts/lobby-leave-probe.ts

import { launchBrowser, shot, signIn, USER_A, USER_B, wirePageLogs } from './smoke-lib.js'

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const ctxA = await browser.newContext({ viewport: { width: 1120, height: 700 } })
  const ctxB = await browser.newContext({ viewport: { width: 1120, height: 700 } })
  const host = await ctxA.newPage()
  const guest = await ctxB.newPage()
  wirePageLogs(host, 'host')
  wirePageLogs(guest, 'guest')
  try {
    await Promise.all([signIn(host, USER_A), signIn(guest, USER_B)])
    await Promise.all([
      host.waitForSelector('text=ONLINE', { timeout: 20_000 }),
      guest.waitForSelector('text=ONLINE', { timeout: 20_000 })
    ])

    await host.getByRole('button', { name: /Private 1v1/i }).click()
    await host.locator('.invite-code').waitFor({ timeout: 10_000 })
    const code = ((await host.locator('.invite-code').textContent()) ?? '').trim()
    console.log(`host lobby code ${code}`)

    await guest.getByPlaceholder('ABC123').fill(code)
    await guest.getByRole('button', { name: /^join$/i }).click()
    await guest.getByRole('button', { name: /^leave$/i }).waitFor({ timeout: 10_000 })
    console.log('guest joined the lobby; Ready + Leave visible')
    await shot(guest, 'lobby-with-leave')

    // Leave → back on the Home screen.
    await guest.getByRole('button', { name: /^leave$/i }).click()
    await guest.waitForSelector('button:has-text("Find 1v1")', { timeout: 10_000 })
    console.log('guest left → back home')

    // No lingering hold: guest can immediately start a bot game.
    await guest.getByRole('button', { name: /^vs Bot$/i }).click()
    await guest.waitForURL(/\/game\//, { timeout: 15_000 })
    console.log('guest started a fresh vs-bot game after leaving')

    console.log('✅ LOBBY LEAVE PROBE PASS')
  } finally {
    await browser.close()
  }
}

await main()
