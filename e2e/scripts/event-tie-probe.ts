// Event tie-break arena probe: plays vs_bots games until a turn-2 P1 event
// ties (compare events on low early values tie often), then asserts the tie
// opens the full conflict scene — avatar cards + RPS coins — screenshots it,
// resolves the tie and exits. Local/manual tool like the other probes; ties
// are random, so this is NOT wired into CI.
//
// Run: SMOKE_URL=http://localhost:5173 SMOKE_BROWSER=chromium \
//        pnpm --filter @metarchy/e2e exec tsx scripts/event-tie-probe.ts

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

const ATTEMPTS = 3

/** Click through P3/P4/P5 until turn 2 (trimmed copy of the smoke's loop). */
async function reachTurn2(page: Page): Promise<void> {
  const endsAt = Date.now() + 6 * 60_000
  while (Date.now() < endsAt) {
    const label = (await page.locator('.hud-turn').textContent()) ?? ''
    if (label.includes('Turn 2')) return
    for (const [locator, timeout] of [
      [page.getByRole('button', { name: /reveal conflict/i }), 2500],
      [page.getByRole('button', { name: /get it!/i }), 2500],
      [page.locator('.arena-rps', { hasText: 'rock' }).first(), 2500],
      [page.getByRole('button', { name: /play no cards|commit \d+ action card/i }), 2500],
      [page.getByRole('button', { name: /^skip$/i }), 2500]
    ] as const) {
      if (await locator.isVisible().catch(() => false)) {
        await tryClick(locator, timeout as number)
        break
      }
    }
    await page.waitForTimeout(400)
  }
  throw new Error('never reached turn 2')
}

/** Never leave the smoke user bound to a live game — it disables "vs Bot"
    for every later run (probe or smoke) against the same server. Handles
    both places we can be stranded: on the board, or on Home with the
    "Return to the board" panel. */
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

/** True when the tie arena was reached and resolved; false when no tie. */
async function playAttempt(page: Page): Promise<boolean> {
  await signIn(page, USER_A)

  // Instant bots make click actionability unreliable (repo lore: buttons
  // detach/disable between dispatch and verification) — drive by OUTCOME:
  // we are in once .game-stage exists. A Home stuck with the game already
  // created offers "Return to the board" instead of vs Bot.
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
  await reachTurn2(page)

  // Turn 2 P1, three outcomes: MY tie → the arena; a clean event → Get It /
  // Confirm; a bots-only tie → the compact spectator modal with no button
  // for me (bots or the server deadline resolve it without my input).
  const arenaFrame = page.locator('.arena-player-frame').first()
  const cleanEvent = page.getByRole('button', { name: /get it!|^confirm$/i }).first()
  const spectatorTie = page.locator('.event-modal', { hasText: 'Tie between' }).first()
  await arenaFrame.or(cleanEvent).or(spectatorTie).first().waitFor({ timeout: 25000 })

  if (await spectatorTie.isVisible().catch(() => false)) {
    console.log('— bots tied among themselves (spectator modal), not my arena')
    return false
  }
  if (!(await arenaFrame.isVisible().catch(() => false))) return false

  const frames = await page.locator('.arena-player-frame').count()
  if (frames < 2) throw new Error(`tie arena with ${frames} player card(s)`)
  // The tie can land while the phase splash still covers the screen — let it
  // finish so the screenshot shows the arena, not the announcement.
  await page.waitForTimeout(2400)
  await shot(page, 'event-tie-arena')
  const rock = page.locator('.arena-rps', { hasText: 'rock' }).first()
  if (!(await tryClick(rock, 5000, 'tie-rock'))) throw new Error('tie RPS not clickable')
  // Resolution hands back to the result stage (bots answer re-rolls
  // instantly); wait for the modal's Get It.
  for (let i = 0; i < 30; i++) {
    if (await tryClick(page.locator('.arena-rps', { hasText: 'rock' }).first(), 800)) continue
    if (
      await page
        .getByRole('button', { name: /get it!/i })
        .isVisible()
        .catch(() => false)
    )
      break
    await page.waitForTimeout(500)
  }
  await shot(page, 'event-tie-resolved')
  console.log(`✅ EVENT TIE PROBE PASS — arena with ${frames} player cards`)
  return true
}

async function main(): Promise<void> {
  const browser = await launchBrowser()
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      wirePageLogs(page, `probe-${attempt}`)
      await applyCpuThrottle(page)
      try {
        if (await playAttempt(page)) return
        console.log(`— attempt ${attempt}: event resolved without a tie, retrying`)
      } catch (err) {
        console.log(`⚠ attempt ${attempt} failed: ${String(err).split('\n')[0]}`)
        await shot(page, `tie-probe-fail-${attempt}`)
        if (attempt === ATTEMPTS) throw err
      } finally {
        await forfeitIfInGame(page)
        await page.close()
      }
    }
    throw new Error(`no event tie in ${ATTEMPTS} games — rerun the probe`)
  } finally {
    await browser.close()
  }
}

await main()
