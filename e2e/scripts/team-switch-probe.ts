// Throwaway visual probe: a half-empty 2v2 lobby must offer the switch button,
// and clicking it must move the host to the other team.

import { USER_A, launchBrowser, shot, signIn } from './smoke-lib.js'

const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } })
await signIn(page, USER_A)

await page.getByRole('button', { name: /2v2/i }).click()
await page.getByText('Team 1 — your team').waitFor({ timeout: 10000 })
await shot(page, 'lobby-team1')

await page.getByRole('button', { name: /switch to team 2/i }).click()
await page.getByText('Team 2 — your team').waitFor({ timeout: 10000 })
await shot(page, 'lobby-switched-team2')

await browser.close()
console.log('TEAM SWITCH PROBE DONE')
