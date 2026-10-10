// vs_bots client smoke: drives the real client against the real server through a
// headless browser (smoke-lib picks Chrome locally / Chromium in CI). Signs in,
// plays a full turn — P2 drag&drop placement, P3 cards, P4 conflict arena, P5
// market buy — then turn 2's event, and forfeits to verify the game-over screen.
//
// Env: SMOKE_URL, SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_BROWSER (chrome|chromium),
//      SMOKE_VIEWPORT=WxH (e.g. 844x390 for a landscape-phone pass).

import {
  USER_A,
  applyCpuThrottle,
  forfeitGame,
  launchBrowser,
  passP1,
  placeActor,
  shot,
  signIn,
  tryClick,
  wirePageLogs
} from './smoke-lib.js'

function viewportFromEnv(): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(process.env.SMOKE_VIEWPORT ?? '')
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1440, height: 900 }
}

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: viewportFromEnv() })
  wirePageLogs(page, 'browser')
  await applyCpuThrottle(page)

  try {
    await signIn(page, USER_A)
    await shot(page, 'home')

    await page.getByRole('button', { name: /^vs bot$/i }).click()
    // vs_bots can skip the lobby or flash it briefly — the click must tolerate
    // the game starting between the visibility check and the click itself.
    const ready = page.getByRole('button', { name: /^ready$/i })
    await ready.or(page.locator('.game-stage')).first().waitFor({ timeout: 15000 })
    if (await ready.isVisible().catch(() => false))
      await ready.click({ timeout: 3000 }).catch(() => null)

    await page.locator('.game-stage').waitFor({ timeout: 15000 })
    await page.locator('.board-host canvas').waitFor({ timeout: 15000 })
    await page.waitForTimeout(1500) // texture load
    await shot(page, 'board-initial')

    await passP1(page)
    await shot(page, 'p2-start')

    await placeActor(page, 'politician', 'square', true, true) // real drag
    await shot(page, 'p2-politician-staged')
    await placeActor(page, 'scientist', 'university', false)
    await placeActor(page, 'artist', 'theatre', false)
    await placeActor(page, 'robot', 'factory', true)
    await shot(page, 'p2-all-staged')

    const commit = page.getByRole('button', { name: /commit placements/i })
    if (!(await commit.isEnabled())) throw new Error('commit disabled with 4 staged')
    await commit.click()
    await page.waitForTimeout(1200)
    await shot(page, 'p2-committed')

    // Bots commit instantly; the reveal beat then holds the turn on the
    // disclosed board until everyone acks it — "Get it!" clears it (b765afb).
    for (let i = 0; i < 20; i++) {
      const label = (await page.locator('.hud-turn').textContent()) ?? ''
      if (!label.includes('Distribution')) break
      const getIt = page.getByRole('button', { name: /get it!/i })
      if (await getIt.isVisible().catch(() => false)) await tryClick(getIt, 2500, 'reveal-ack')
      await page.waitForTimeout(500)
    }
    const phase = (await page.locator('.hud-turn').textContent()) ?? ''
    if (phase.includes('Distribution')) throw new Error('stuck in P2 after commit')
    await shot(page, 'post-p2')

    // P3 → P4 arena → P5 market → turn 2. Bots act instantly; we answer whatever
    // shows. Time-budgeted, not iteration-counted: a CI runner rasterizing Pixi
    // on CPU can spend seconds per pass, and an unlucky seed deals 4 conflicts —
    // an iteration cap starves exactly those runs. A stall detector still fails
    // fast when nothing moves (server deadlines would have auto-advanced by then).
    let arenaRevealShot = false
    let arenaResultShot = false
    let sawArena = false
    let bought = false
    const loopEndsAt = Date.now() + 9 * 60_000
    const STALL_MS = 150_000
    const RELOAD_AFTER_MS = 60_000
    let lastProgressAt = Date.now()
    let lastLabel = ''
    let reloads = 0
    const snapshot = (): Promise<string> =>
      page
        .evaluate(() =>
          JSON.stringify(
            (window as unknown as { __metarchy?: () => unknown }).__metarchy?.() ?? null
          )
        )
        .catch(() => 'unavailable')
    while (Date.now() < loopEndsAt) {
      const label = (await page.locator('.hud-turn').textContent()) ?? ''
      if (label.includes('Turn 2')) break
      if (label !== lastLabel) {
        lastLabel = label
        lastProgressAt = Date.now()
      }
      const stalledFor = Date.now() - lastProgressAt
      if (stalledFor > STALL_MS)
        throw new Error(
          `game stalled at "${label}" for ${Math.round(stalledFor / 1000)}s; state ${await snapshot()}`
        )
      if (stalledFor > RELOAD_AFTER_MS && reloads < 2) {
        // A stuck tab is what a real player fixes with a reload — state lives on
        // the server. Log the client's view first so CI failures name the culprit.
        reloads += 1
        console.log(
          `⚠ no progress for ${Math.round(stalledFor / 1000)}s — state ${await snapshot()}; reloading (${reloads}/2)`
        )
        await shot(page, `stall-reload-${reloads}`)
        await page.reload()
        await page
          .locator('.board-host canvas')
          .waitFor({ timeout: 30000 })
          .catch(() => null)
        lastProgressAt = Date.now()
        continue
      }

      const playCards = page.getByRole('button', { name: /play no cards|commit \d+ action card/i })
      const reveal = page.getByRole('button', { name: /reveal conflict/i })
      // A drawn round stops on its review before the refight's RPS buttons.
      const resolveAgain = page.getByRole('button', { name: /resolve conflict again/i })
      const getIt = page.getByRole('button', { name: /get it!/i })
      const arenaRock = page.locator('.arena-rps', { hasText: 'rock' })
      const buy = page.getByRole('button', { name: /^buy$/i })
      // Before a buy the market's close button reads Skip; after one, "✓ Done".
      const skip = page.getByRole('button', { name: /^(✓\s*)?(skip|done)$/i })

      if (await reveal.isVisible().catch(() => false)) {
        sawArena = true
        if (!arenaRevealShot) {
          await shot(page, 'p4-arena-sealed')
          arenaRevealShot = true
        }
        if (await tryClick(reveal, 2500, 'reveal')) lastProgressAt = Date.now()
        await page.waitForTimeout(400)
        continue
      }
      if (await resolveAgain.isVisible().catch(() => false)) {
        sawArena = true
        if (await tryClick(resolveAgain, 2500, 'resolve-again')) lastProgressAt = Date.now()
        await page.waitForTimeout(300)
        continue
      }
      if (await getIt.isVisible().catch(() => false)) {
        sawArena = true
        if (!arenaResultShot) {
          await shot(page, 'p4-arena-results')
          arenaResultShot = true
        }
        if (await tryClick(getIt, 2500, 'get-it')) lastProgressAt = Date.now()
        await page.waitForTimeout(300)
        continue
      }
      if (
        await arenaRock
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        sawArena = true
        await shot(page, 'p4-arena-refight')
        if (await tryClick(arenaRock.first(), 2500, 'rps-rock')) lastProgressAt = Date.now()
        await page.waitForTimeout(300)
        continue
      }
      if (await playCards.isVisible().catch(() => false)) {
        if (await tryClick(playCards, 2500, 'play-cards')) lastProgressAt = Date.now()
        await page.waitForTimeout(400)
        continue
      }
      if (!bought && (await buy.isEnabled().catch(() => false))) {
        bought = await tryClick(buy)
        if (bought) {
          lastProgressAt = Date.now()
          console.log('✓ bought a market card')
        }
        await page.waitForTimeout(300)
        continue
      }
      if (await skip.isVisible().catch(() => false)) {
        await shot(page, 'p5-market')
        if (await tryClick(skip)) lastProgressAt = Date.now()
        await page.waitForTimeout(400)
        continue
      }
      await page.waitForTimeout(400)
    }

    const turn2Label = (await page.locator('.hud-turn').textContent()) ?? ''
    if (!turn2Label.includes('Turn 2')) throw new Error(`never reached turn 2: "${turn2Label}"`)
    await shot(page, 'turn2-event')
    console.log(
      `✓ reached "${turn2Label.trim()}"${sawArena ? ' (P4 arena exercised)' : ' (no conflicts this run)'}${bought ? ' (market buy staged)' : ''}`
    )

    // Turn 2: event modal → P2 dock (bought card now in hand) → forfeit → game over.
    await passP1(page)
    await page.locator('.dock').waitFor({ timeout: 10000 })
    await shot(page, 'turn2-p2')
    await forfeitGame(page, 10000)
    await page.locator('.gameover-verdict').waitFor({ timeout: 10000 })
    const verdict = (await page.locator('.gameover-verdict').textContent()) ?? ''
    await shot(page, 'gameover')
    if (!/defeat/i.test(verdict)) throw new Error(`expected Defeat after forfeit, got "${verdict}"`)
    console.log(`✅ SMOKE PASS — full loop + game over ("${verdict.trim()}")`)
  } catch (err) {
    await shot(page, 'FAILURE')
    throw err
  } finally {
    await browser.close()
  }
}

await main()
