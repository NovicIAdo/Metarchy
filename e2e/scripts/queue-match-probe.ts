// Reproduces the user's report: two humans both pick "Find 1v1" and should be
// matched into the SAME game. Two isolated contexts, two smoke accounts.
// Run: pnpm --filter @metarchy/e2e exec tsx scripts/queue-match-probe.ts
// Env: SMOKE_URL (default local), SMOKE_BROWSER=chromium.

import { launchBrowser, shot, signIn, USER_A, USER_B, wirePageLogs } from './smoke-lib.js'

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const ctxA = await browser.newContext({ viewport: { width: 1120, height: 700 } })
  const ctxB = await browser.newContext({ viewport: { width: 1120, height: 700 } })
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  wirePageLogs(pageA, 'A')
  wirePageLogs(pageB, 'B')
  try {
    await Promise.all([signIn(pageA, USER_A), signIn(pageB, USER_B)])
    await Promise.all([
      pageA.waitForSelector('text=ONLINE', { timeout: 20_000 }),
      pageB.waitForSelector('text=ONLINE', { timeout: 20_000 })
    ])
    console.log('✓ both signed in')

    // Both queue for ranked 1v1, nearly simultaneously.
    await pageA.getByRole('button', { name: 'Find 1v1' }).click()
    await pageB.getByRole('button', { name: 'Find 1v1' }).click()
    console.log('✓ both clicked Find 1v1')

    // Expect both to be taken to a game board within a few ticks.
    const waitGame = async (p: typeof pageA, tag: string): Promise<string> => {
      await p.waitForURL(/\/game\//, { timeout: 30_000 })
      const url = p.url()
      const id = url.split('/game/')[1] ?? ''
      console.log(`${tag} landed in game ${id}`)
      return id
    }
    const [idA, idB] = await Promise.all([waitGame(pageA, 'A'), waitGame(pageB, 'B')])
    await Promise.all([shot(pageA, 'queue-a'), shot(pageB, 'queue-b')])

    if (!idA || !idB) throw new Error('a player never reached a game')
    if (idA !== idB)
      throw new Error(`different games! A=${idA} B=${idB} (matched to bots, not each other)`)
    console.log(`✅ QUEUE MATCH PROBE PASS — both humans in the same game ${idA}`)
  } finally {
    await browser.close()
  }
}

await main()
