// Throwaway visual probe: play a quick game (forfeit it), then the profile page
// must list it under Recent games.

import { USER_A, forfeitGame, launchBrowser, shot, signIn, tryClick } from './smoke-lib.js'

const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1024, height: 900 } })
await signIn(page, USER_A)

await page.getByRole('button', { name: /^vs bot$/i }).click()
await page.locator('.game-stage').waitFor({ timeout: 15000 })
await page.waitForTimeout(1000)
await forfeitGame(page)
await page.getByText(/defeat/i).waitFor({ timeout: 15000 })
await tryClick(page.getByRole('button', { name: /back to home/i }), 5000)

await page.goto((process.env.SMOKE_URL ?? 'http://localhost:5173') + '/profile')
await page.locator('.history-row').first().waitFor({ timeout: 10000 })
await shot(page, 'profile-history')

await browser.close()
console.log('HISTORY PROBE DONE')
