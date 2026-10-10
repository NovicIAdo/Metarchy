// Throwaway visual probe for the avatar feature: picker on /profile, chip in
// the in-game roster. Not a CI smoke — screenshots for eyeballing only.

import { USER_A, launchBrowser, shot, signIn, tryClick } from './smoke-lib.js'

const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } })
await signIn(page, USER_A)

await page.goto((process.env.SMOKE_URL ?? 'http://localhost:5173') + '/profile')
await page.locator('.avatar-grid').waitFor({ timeout: 10000 })
await shot(page, 'profile-picker')

await tryClick(page.locator('.avatar-option').nth(1), 5000) // golden
await page.waitForTimeout(600)
await shot(page, 'profile-picked-golden')

await page.goto(process.env.SMOKE_URL ?? 'http://localhost:5173')
await page.getByRole('button', { name: /^vs bot$/i }).click()
await page.locator('.game-stage').waitFor({ timeout: 15000 })
await page.locator('.hud-right .hud-player').first().waitFor({ timeout: 10000 })
await page.waitForTimeout(1200)
await shot(page, 'ingame-roster-avatar')

await browser.close()
console.log('PROBE DONE')
