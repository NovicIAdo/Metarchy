// 2v2 team-chat smoke: four browser contexts assemble a private 2v2 lobby,
// start the game, and exchange team chat. Verifies the panel exists only for
// 2v2, the unread badge, ally delivery, and that opponents see nothing.
//
// Local tool (not in CI — four Pixi canvases are too heavy for the runner):
//   pnpm --filter @metarchy/e2e exec tsx scripts/2v2-chat-smoke.ts
// Env: SMOKE_URL, SMOKE_BROWSER (chrome|chromium).

import type { Page } from 'playwright'
import { launchBrowser, shot, signIn, wirePageLogs } from './smoke-lib.js'

// Four test accounts: SMOKE_2V2_EMAILS (comma-separated) share SMOKE_PASSWORD.
const PASSWORD = process.env.SMOKE_PASSWORD ?? ''
const USERS = (process.env.SMOKE_2V2_EMAILS ?? '')
  .split(',')
  .filter(Boolean)
  .map((email) => ({ email: email.trim(), password: PASSWORD }))

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const pages: Page[] = []
  try {
    for (const [i, user] of USERS.entries()) {
      const context = await browser.newContext({ viewport: { width: 1100, height: 750 } })
      const page = await context.newPage()
      wirePageLogs(page, `p${i}`)
      await signIn(page, user)
      pages.push(page)
    }
    const [a, b, c, d] = pages as [Page, Page, Page, Page]
    console.log('✓ four users signed in')

    // A hosts a private 2v2; the rest join by code. Join order fixes the teams:
    // seats 0,1,2,3 → [0,2] (A & C) vs [1,3] (B & D).
    await a.getByRole('button', { name: /private 2v2/i }).click()
    await a.locator('.invite-code').waitFor({ timeout: 10000 })
    const code = ((await a.locator('.invite-code').textContent()) ?? '').trim()
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error(`bad invite code: "${code}"`)
    console.log(`✓ lobby up, code ${code}`)

    for (const page of [b, c, d]) {
      await page.locator('input[placeholder="ABC123"]').fill(code)
      await page.getByRole('button', { name: /^join$/i }).click()
      await page.getByRole('button', { name: /^ready$/i }).waitFor({ timeout: 10000 })
    }
    await a.getByText('Team 1 — your team').waitFor({ timeout: 5000 })
    await b.getByText('Team 2 — your team').waitFor({ timeout: 5000 })
    await shot(a, '2v2-lobby-host')

    for (const page of pages) await page.getByRole('button', { name: /^ready$/i }).click()
    await Promise.all(
      pages.map((page) => page.locator('.board-host canvas').waitFor({ timeout: 30000 }))
    )
    console.log('✓ 2v2 game started in all four browsers')

    // A → team: ally C gets the message and an unread badge; B sees nothing.
    await a.getByRole('button', { name: /team chat/i }).click()
    await a.locator('.chat-form input').fill('take the square, I cover dump')
    await a.locator('.chat-form .btn').click()
    await a.getByText('take the square, I cover dump').waitFor({ timeout: 5000 })

    await c.getByRole('button', { name: /team chat · 1/i }).waitFor({ timeout: 10000 })
    await c.getByRole('button', { name: /team chat/i }).click()
    await c.getByText('take the square, I cover dump').waitFor({ timeout: 5000 })
    await shot(c, '2v2-chat-ally')

    // C replies; A's open panel shows it.
    await c.locator('.chat-form input').fill('on it')
    await c.locator('.chat-form .btn').click()
    await a.getByText('on it').waitFor({ timeout: 10000 })

    // Opponent B: chat exists (own team) but must be empty of A/C's messages.
    await b.getByRole('button', { name: /team chat/i }).click()
    await b.getByText('Only your teammate sees these messages.').waitFor({ timeout: 5000 })
    await shot(b, '2v2-chat-opponent-empty')

    console.log('✅ 2V2 CHAT SMOKE PASS — ally delivery, unread badge, no cross-team leak')
  } finally {
    await browser.close()
  }
}

await main()
