// P3 results-screen probe: bots buy market cards on turn 1 about half the
// time and play them on turn 2 — replay vs_bots games until a turn-2 P3
// results screen (blocks/relocations/exchanges ceremony) appears, screenshot
// it, ack it, and confirm the game moves on. Manual tool like the other
// probes (bot card plays are random — not CI material).
//
// Run: SMOKE_URL=http://localhost:5173 SMOKE_BROWSER=chromium \
//        pnpm --filter @metarchy/e2e exec tsx scripts/p3-results-probe.ts

import type { Page } from 'playwright'
import {
  USER_A,
  forfeitGame,
  applyCpuThrottle,
  launchBrowser,
  passP1,
  placeAllAndCommit,
  shot,
  signIn,
  tryClick,
  wirePageLogs
} from './smoke-lib.js'

const ATTEMPTS = 4

async function forfeitIfInGame(page: Page): Promise<void> {
  const returnBtn = page.getByRole('button', { name: /return to the board/i })
  if (await returnBtn.isVisible().catch(() => false)) {
    await returnBtn.click({ timeout: 2000 }).catch(() => null)
    await page.waitForTimeout(1000)
  }
  const forfeit = page.locator('.hud-forfeit')
  if (await forfeit.isVisible().catch(() => false)) {
    await forfeitGame(page, 3000).catch(() => null)
    await page
      .locator('.gameover-verdict')
      .waitFor({ timeout: 8000 })
      .catch(() => null)
  }
}

/** Drive turn 1 + turn 2 up to P3, buying one market card on the way. */
async function reachTurn2P3(page: Page): Promise<void> {
  const endsAt = Date.now() + 7 * 60_000
  let placedTurn2 = false
  let bought = false
  while (Date.now() < endsAt) {
    const label = (await page.locator('.hud-turn').textContent()) ?? ''
    if (label.includes('Turn 2') && label.includes('Actions')) return
    if (label.includes('Turn 3')) throw new Error('overshot into turn 3')

    if (label.includes('Turn 2') && label.includes('Distribution') && !placedTurn2) {
      await placeAllAndCommit(page)
      placedTurn2 = true
      continue
    }
    // Turn-1 market: buy a card so WE have one to play on turn 2.
    const buy = page.getByRole('button', { name: /^buy$/i })
    if (!bought && (await buy.isEnabled().catch(() => false))) {
      bought = await tryClick(buy, 2500, 'buy')
      await page.waitForTimeout(300)
      continue
    }
    for (const locator of [
      page.getByRole('button', { name: /get it!/i }),
      page.getByRole('button', { name: /^confirm$/i }),
      page.locator('.arena-rps', { hasText: 'rock' }).first(),
      page.getByRole('button', { name: /reveal conflict/i }),
      page.getByRole('button', { name: /play no cards|commit \d+ action card/i }),
      page.getByRole('button', { name: /^skip$/i })
    ]) {
      if (await locator.isVisible().catch(() => false)) {
        await tryClick(locator, 2500)
        break
      }
    }
    await page.waitForTimeout(400)
  }
  throw new Error('never reached turn 2 P3')
}

async function playAttempt(page: Page): Promise<boolean> {
  await signIn(page, USER_A)

  const stage = page.locator('.game-stage')
  const vsBot = page.getByRole('button', { name: /^vs bot$/i })
  const returnBtn = page.getByRole('button', { name: /return to the board/i })
  await vsBot.or(returnBtn).first().waitFor({ timeout: 15000 })
  const entryDeadline = Date.now() + 30000
  while (!(await stage.isVisible().catch(() => false))) {
    if (Date.now() > entryDeadline) throw new Error('never entered the game')
    if (await returnBtn.isVisible().catch(() => false))
      await returnBtn.click({ timeout: 2000 }).catch(() => null)
    else await vsBot.click({ timeout: 2000 }).catch(() => null)
    await page.waitForTimeout(600)
  }
  await page.locator('.board-host canvas').waitFor({ timeout: 15000 })

  await passP1(page)
  await placeAllAndCommit(page)
  await reachTurn2P3(page)

  // Play the card we bought on turn 1 (most of the deck is blocks — that
  // path shows the ceremony immediately; relocation/exchange need extra
  // input, so those unlucky draws just retry).
  const cardTile = page.locator('.action-card').first()
  if (await cardTile.isVisible().catch(() => false)) await tryClick(cardTile, 3000, 'pick-card')
  await tryClick(
    page.getByRole('button', { name: /play no cards|commit \d+ action card/i }),
    5000,
    'commit-cards'
  )

  const results = page.locator('.event-modal', { hasText: 'Action cards · results' }).first()
  const movedOn = page
    .locator('.hud-turn', { hasText: /Conflicts|Market/ })
    .or(page.locator('.hud-turn', { hasText: 'Phase 1' }))
    .first()
  await results
    .or(movedOn)
    .first()
    .waitFor({ timeout: 25000 })
    .catch(() => null)

  if (!(await results.isVisible().catch(() => false))) return false

  let screens = 0
  while (await results.isVisible().catch(() => false)) {
    screens += 1
    await shot(page, `p3-results-${screens}`)
    if (!(await tryClick(page.getByRole('button', { name: /get it!/i }), 5000, 'results-ack')))
      throw new Error('results Get It! not clickable')
    await page.waitForTimeout(800)
  }
  console.log(`✅ P3 RESULTS PROBE PASS — ${screens} results screen(s) acked`)
  return true
}

async function main(): Promise<void> {
  const browser = await launchBrowser()
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      wirePageLogs(page, `p3probe-${attempt}`)
      await applyCpuThrottle(page)
      try {
        if (await playAttempt(page)) return
        console.log(`— attempt ${attempt}: bot played no cards this game, retrying`)
      } catch (err) {
        console.log(`⚠ attempt ${attempt} failed: ${String(err).split('\n')[0]}`)
        await shot(page, `p3-probe-fail-${attempt}`)
        if (attempt === ATTEMPTS) throw err
      } finally {
        await forfeitIfInGame(page)
        await page.close()
      }
    }
    throw new Error(`no bot card plays in ${ATTEMPTS} games — rerun the probe`)
  } finally {
    await browser.close()
  }
}

await main()
