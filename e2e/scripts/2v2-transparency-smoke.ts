// 2v2 team-transparency smoke: four browser contexts assemble a private 2v2,
// then player A stages a placement WITHOUT committing — the ally (C) must see
// the live draft in the right-edge AllyPanel (staged orb + location + argument
// badge) while both opponents see nothing. After A commits, C's panel flips to
// sealed ✓ placements. Verifies the team.staging relay end-to-end on staging.
//
// Local tool (not in CI — four Pixi canvases are too heavy for the runner):
//   pnpm --filter @metarchy/e2e exec tsx scripts/2v2-transparency-smoke.ts
// Env: SMOKE_URL, SMOKE_BROWSER (chrome|chromium).

import type { Page } from 'playwright'
import { launchBrowser, placeActor, shot, signIn, wirePageLogs } from './smoke-lib.js'

// Four test accounts: SMOKE_2V2_EMAILS (comma-separated) share SMOKE_PASSWORD.
const PASSWORD = process.env.SMOKE_PASSWORD ?? ''
const USERS = (process.env.SMOKE_2V2_EMAILS ?? '')
  .split(',')
  .filter(Boolean)
  .map((email) => ({ email: email.trim(), password: PASSWORD }))

async function stagedOrbs(page: Page): Promise<number> {
  return page.locator('.ally-orb.staged').count()
}

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

    // A hosts a private 2v2; join order fixes seats 0..3 → allies (A,C) and (B,D).
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
    for (const page of pages) await page.getByRole('button', { name: /^ready$/i }).click()
    await Promise.all(
      pages.map((page) => page.locator('.board-host canvas').waitFor({ timeout: 30000 }))
    )
    console.log('✓ 2v2 game started in all four browsers')

    // The ally column mounts for everyone once the phase splash clears.
    await Promise.all(pages.map((page) => page.locator('.hud-ally').waitFor({ timeout: 20000 })))
    console.log('✓ AllyPanel mounted on all four screens')

    // A stages one actor (no commit). C must see the live draft; B and D not.
    await placeActor(a, 'politician', 'square', false)
    await c.locator('.ally-orb.staged').waitFor({ timeout: 10000 })
    const planText = (await c.locator('.ally-orb.staged').textContent()) ?? ''
    if (!/square/i.test(planText)) throw new Error(`ally plan lacks the location: "${planText}"`)
    const badges = await c.locator('.ally-orb.staged .ally-orb-badges img').count()
    if (badges < 1) throw new Error('ally plan lacks the argument badge')
    await shot(c, '2v2-ally-live-draft')
    if ((await stagedOrbs(b)) !== 0 || (await stagedOrbs(d)) !== 0)
      throw new Error('opponents can see a cross-team draft')
    console.log('✓ live draft visible to the ally only (location + argument badge)')

    // A finishes and commits — C's panel flips to sealed ✓ placements.
    await placeActor(a, 'scientist', 'university', false)
    await placeActor(a, 'artist', 'theatre', false)
    await placeActor(a, 'robot', 'factory', false)
    const commit = a.getByRole('button', { name: /commit placements/i })
    if (!(await commit.isEnabled())) throw new Error('commit disabled with 4 staged')
    await commit.click()
    await c.locator('.ally-orb.placed').first().waitFor({ timeout: 10000 })
    const placed = await c.locator('.ally-orb.placed').count()
    if (placed !== 4) throw new Error(`expected 4 sealed ally placements, saw ${placed}`)
    await shot(c, '2v2-ally-sealed')
    console.log('✓ sealed placements took over after commit (4×✓)')

    console.log('✅ 2V2 TRANSPARENCY SMOKE PASS — live ally draft, no cross-team leak, sealed flip')
  } finally {
    await browser.close()
  }
}

await main()
