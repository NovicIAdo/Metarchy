// Live probe for the coached, no-timer Tutorial against a deployed server.
// Verifies end to end, in a real browser:
//   1. a 'tutorial' game creates on staging — proves the games.mode CHECK
//      migration landed (a rejected mode would never reach the board);
//   2. there is NO deadline badge — the tutorial is clockless;
//   3. the coach shows its intro "window" (dismissable) and a spotlight
//      ring/chip, and the real P2 placement flow works underneath it;
//   4. the game keeps advancing across phases with no clock.
//
// Run: SMOKE_URL=https://metarchy-staging.fly.dev pnpm -C e2e exec tsx scripts/tutorial-probe.ts

import {
  CENTERS,
  USER_A,
  canvasPoint,
  forfeitGame,
  launchBrowser,
  placeActor,
  shot,
  signIn,
  tryClick,
  wirePageLogs
} from './smoke-lib.js'
import type { Page } from 'playwright'

/** The coach card is a scrim over the modal below — dismiss it before acting. */
async function dismissCoach(page: Page): Promise<boolean> {
  if (
    await page
      .locator('.coach-card')
      .isVisible()
      .catch(() => false)
  ) {
    await tryClick(page.locator('.coach-card-btn'), 2000, 'coach-dismiss')
    await page.waitForTimeout(200)
    return true
  }
  return false
}

/** Tap-place with a short picker wait — false = this location refused (blocked). */
async function tryPlace(page: Page, actor: string, location: string): Promise<boolean> {
  const chip = page.locator('.dock-orb', { hasText: new RegExp(actor, 'i') })
  if (!(await chip.isVisible().catch(() => false))) return true // already placed
  // The orb TOGGLES: on a retry after a blocked location it is still selected,
  // and clicking again would put it back down — then the board tap would open
  // the "who goes here?" plate instead of this actor's picker.
  const held = ((await chip.getAttribute('class')) ?? '').includes('selected')
  if (!held) await chip.click()
  await page.waitForTimeout(200)
  const target = await canvasPoint(page, CENTERS[location] as { x: number; y: number })
  await page.mouse.click(target.x, target.y)
  const ok = await page
    .locator('.board-picker .radial-avatar')
    .waitFor({ timeout: 1600 })
    .then(() => true)
    .catch(() => false)
  if (!ok) return false
  await page.locator('.radial-coin:enabled').first().click()
  await page.locator('.radial-skip').click()
  await page.waitForTimeout(250)
  return true
}

/**
 * Place all four wherever legal right now — the bot's turn-2 block demo may
 * have disabled any one location, so every actor carries a fallback list.
 */
async function placeAllFlexible(page: Page): Promise<void> {
  const spots: [string, string[]][] = [
    ['politician', ['square', 'university']],
    ['scientist', ['university', 'theatre']],
    ['artist', ['theatre', 'square']],
    ['robot', ['factory', 'power_plant', 'dump']]
  ]
  for (const [actor, options] of spots) {
    let placed = false
    for (const location of options) {
      await dismissCoach(page)
      if (await tryPlace(page, actor, location)) {
        placed = true
        break
      }
    }
    if (!placed) throw new Error(`could not place ${actor} on any legal location`)
  }
  await dismissCoach(page)
  await tryClick(page.getByRole('button', { name: /commit placements/i }), 4000, 'commit')
}

async function assertNoTimer(page: Page, tag: string): Promise<void> {
  if (
    await page
      .locator('.hud-deadline')
      .isVisible()
      .catch(() => false)
  )
    throw new Error(`deadline badge present (${tag}) — the tutorial must be clockless`)
  console.log(`✓ no timer badge (${tag})`)
}

async function turnLabel(page: Page): Promise<string> {
  return (
    (await page
      .locator('.hud-turn')
      .textContent()
      .catch(() => '')) ?? ''
  )
}

/**
 * One active game per user — clear anything a prior run left behind. A leftover
 * game shows up as either an auto-redirect onto its board, a "Return to the
 * board" resume button, or just a DISABLED Tutorial button on Home (races
 * between welcome and the first render) — handle all three, then wait for the
 * Tutorial button to actually become enabled.
 */
async function forfeitActive(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(800) // let welcome/activeGame land
    const tutorialBtn = page.getByRole('button', { name: /tutorial/i }).first()
    if (await tutorialBtn.isEnabled().catch(() => false)) return
    const resume = page.getByRole('button', { name: /return to the board/i })
    if (await resume.isVisible().catch(() => false)) await tryClick(resume)
    const onBoard = await page
      .locator('.game-stage')
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    if (onBoard) {
      // Coach cards may cover the forfeit button — clear them first.
      for (let i = 0; i < 8; i++) {
        if (await dismissCoach(page)) continue
        const ff = page.locator('.hud-forfeit')
        if (await ff.isVisible().catch(() => false)) {
          await forfeitGame(page)
          break
        }
        await page.waitForTimeout(300)
      }
      await page.waitForTimeout(800)
      console.log(`✓ cleared a leftover active game (attempt ${attempt + 1})`)
    }
    await page.goto((process.env.SMOKE_URL ?? 'https://metarchy-staging.fly.dev') + '/')
  }
  // The seat must be free by now — insist on an enabled Tutorial button.
  const start = Date.now()
  for (;;) {
    const tutorialBtn = page.getByRole('button', { name: /tutorial/i }).first()
    if (await tutorialBtn.isEnabled().catch(() => false)) return
    if (Date.now() - start > 15000) throw new Error('Tutorial button never became enabled')
    await page.waitForTimeout(500)
  }
}

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  wirePageLogs(page, 'browser')
  try {
    await signIn(page, USER_A)
    await forfeitActive(page) // re-runnable: drop any game a prior run left active
    await page.getByRole('button', { name: /tutorial/i }).click() // 🎓 Tutorial (not How to Play)
    await page.locator('.game-stage').waitFor({ timeout: 20000 })
    console.log('✓ tutorial game created on staging (migration OK)')
    await page.waitForTimeout(1500) // let the phase splash pass
    await assertNoTimer(page, 'board load')

    // P1 event — dismiss the coach window, then clear the event to Distribution.
    let sawCard = false
    for (let i = 0; i < 40; i++) {
      if ((await turnLabel(page)).includes('Distribution')) break
      if (await dismissCoach(page)) sawCard = true
      const getIt = page.getByRole('button', { name: /get it!/i })
      const confirm = page.getByRole('button', { name: /confirm/i })
      if (await getIt.isVisible().catch(() => false)) await tryClick(getIt)
      else if (await confirm.isVisible().catch(() => false)) await tryClick(confirm)
      await page.waitForTimeout(500)
    }
    if (sawCard) console.log('✓ coach intro window shown and dismissable')
    await shot(page, 'tutorial-distribution')

    // Turn-1 narrative intro: page through it, capturing every page (the goal,
    // secret placement, and the Conflict foreshadow the author asked for).
    let introPages = 0
    let sawConflictPage = false
    for (let i = 0; i < 8; i++) {
      const card = page.locator('.coach-card')
      if (!(await card.isVisible().catch(() => false))) {
        if (introPages > 0) break
        await page.waitForTimeout(400) // splash still clearing
        continue
      }
      introPages++
      await shot(page, `tutorial-intro-${introPages}`)
      const txt = (await card.textContent().catch(() => '')) ?? ''
      if (/conflict|конфликт/i.test(txt)) sawConflictPage = true
      const wasLast = /got it|понятно/i.test(txt)
      await tryClick(page.locator('.coach-card-btn'), 2000, 'intro-next')
      await page.waitForTimeout(350)
      if (wasLast) break
    }
    if (introPages > 0) console.log(`✓ turn-1 narrative intro shown (${introPages} pages)`)
    if (!sawConflictPage) throw new Error('intro never explained the Conflict')
    console.log('✓ intro foreshadows the Conflict')

    // The spotlight now sits on the dock.
    let ringSeen = false
    for (let i = 0; i < 12; i++) {
      await dismissCoach(page)
      if (
        await page
          .locator('.coach-ring, .coach-chip')
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        ringSeen = true
        break
      }
      await page.waitForTimeout(400)
    }
    if (!ringSeen) throw new Error('coach spotlight (ring/chip) never appeared on the dock')
    console.log('✓ coach spotlight visible after the intro')
    await shot(page, 'tutorial-coach-spotlight')

    // Player feedback (14 y/o): "стрелочки указывающие на что кликать и куда
    // потом ставить". With an Actor in hand there is one arrow per Location it
    // may enter — the Politician's Square and University.
    await page.locator('.dock-orb').first().click()
    const arrows = page.locator('.coach-arrow')
    await arrows.first().waitFor({ timeout: 5000 })
    const arrowCount = await arrows.count()
    if (arrowCount !== 2) throw new Error(`expected 2 placement arrows, got ${arrowCount}`)
    await shot(page, 'tutorial-placement-arrows')
    console.log('✓ placement arrows point at both legal Locations')

    // And the other way round: a tap on a Location asks who should go there.
    // (The Politician is still in hand — put it back down first.)
    await page.locator('.dock-orb').first().click()
    const theatre = await canvasPoint(page, CENTERS.theatre as { x: number; y: number })
    await page.mouse.click(theatre.x, theatre.y)
    const chooser = page.locator('.chooser-head')
    await chooser.first().waitFor({ timeout: 5000 })
    const offered = await chooser.count()
    if (offered !== 2) throw new Error(`Theatre should offer Scientist and Artist, got ${offered}`)
    await shot(page, 'tutorial-actor-chooser')
    console.log('✓ tapping a Location offers the Actors it accepts')
    await page.mouse.click(150, 780) // tap away — nothing staged
    await page.waitForTimeout(250)

    await placeActor(page, 'politician', 'square', false)
    await placeActor(page, 'scientist', 'university', false)
    await placeActor(page, 'artist', 'theatre', false)
    await placeActor(page, 'robot', 'factory', false)
    await dismissCoach(page)
    await page.getByRole('button', { name: /commit placements/i }).click()
    console.log('✓ placed all four and committed through the coach')
    await shot(page, 'tutorial-committed')
    await assertNoTimer(page, 'after commit')

    // Turn 1 has no Phase 3 at all (rulebook §Turn Structure) — nobody can hold an
    // Action Card yet — so the commit leads straight into the Conflict the intro
    // foreshadowed. A "Play No Cards" prompt here would be the regression.
    await page.locator('.coach-card').waitFor({ timeout: 12000 })
    const afterCommit =
      (await page
        .locator('.coach-card')
        .textContent()
        .catch(() => '')) ?? ''
    if (!/conflict|конфликт/i.test(afterCommit))
      throw new Error(`turn-1 commit did not open the Conflict: ${afterCommit.slice(0, 80)}`)
    console.log('✓ turn 1 skips Phase 3 — the commit opens the Conflict directly')
    await shot(page, 'tutorial-turn1-conflict')

    // Advance through the remaining phases with no clock. The mirror bot makes
    // turn 1 a guaranteed conflict tour (four draws + the politician re-fight),
    // so reaching Turn 2 proves the whole teaching loop clicks through.
    let reachedTurn2 = false
    let drawLessonShots = 0
    for (let i = 0; i < 90; i++) {
      const turn = await turnLabel(page)
      if (turn.includes('Turn 2')) {
        console.log(`✓ reached ${turn.trim()} with no timer`)
        reachedTurn2 = true
        break
      }
      // Snapshot the first P4 draw-lesson cards (the mirror bot's whole point).
      if (turn.includes('Phase 4') && drawLessonShots < 2) {
        const card = page.locator('.coach-card')
        if (await card.isVisible().catch(() => false)) {
          await shot(page, `tutorial-draw-lesson-${drawLessonShots + 1}`)
          drawLessonShots += 1
        }
      }
      await dismissCoach(page)
      for (const name of [
        /get it!/i,
        /play no cards/i,
        /reveal conflict|открыть конфликт/i,
        /resolve conflict again|продолжить разрешение/i,
        /done|готово/i,
        /confirm/i
      ]) {
        const b = page.getByRole('button', { name }).first()
        if (await b.isVisible().catch(() => false)) {
          await tryClick(b)
          break
        }
      }
      const rock = page.locator('.arena-rps', { hasText: 'rock' }).first()
      if (await rock.isVisible().catch(() => false)) await tryClick(rock)
      await page.waitForTimeout(650)
    }
    if (!reachedTurn2) throw new Error('never reached Turn 2 — the teaching loop is stuck')
    if (drawLessonShots === 0) throw new Error('no P4 draw-lesson coach card was ever shown')
    console.log(`✓ mirror-bot conflicts taught their lessons (${drawLessonShots} cards shot)`)
    await assertNoTimer(page, 'end')
    await shot(page, 'tutorial-advanced')

    // Turns 2–3 to the graduation screen: the bot plays its turn-1 market buy
    // (the "opponents play cards too" lesson must appear), placements re-run
    // with fallbacks (its block may disable any one location), and after turn 3
    // the finish card offers the first-real-game CTA.
    let sawOpponentCard = false
    let finished = false
    for (let i = 0; i < 160; i++) {
      if (
        await page
          .locator('.coach-finished')
          .isVisible()
          .catch(() => false)
      ) {
        finished = true
        break
      }
      const cardText =
        (await page
          .locator('.coach-card')
          .textContent()
          .catch(() => '')) ?? ''
      if (/opponents play cards|соперники тоже/i.test(cardText)) {
        if (!sawOpponentCard) await shot(page, 'tutorial-opponent-card')
        sawOpponentCard = true
      }
      if (
        await page
          .locator('.dock-orb')
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        await placeAllFlexible(page)
        continue
      }
      await dismissCoach(page)
      for (const name of [
        /get it!/i,
        /play no cards/i,
        /reveal conflict|открыть конфликт/i,
        /resolve conflict again|продолжить разрешение/i,
        /resolve the conflict|разрешить конфликт/i,
        /done|готово/i,
        /confirm/i
      ]) {
        const b = page.getByRole('button', { name }).first()
        if (await b.isVisible().catch(() => false)) {
          await tryClick(b)
          break
        }
      }
      const rock2 = page.locator('.arena-rps', { hasText: 'rock' }).first()
      if (await rock2.isVisible().catch(() => false)) await tryClick(rock2)
      await page.waitForTimeout(650)
    }
    if (!finished) throw new Error('never reached the tutorial finish screen')
    if (!sawOpponentCard) throw new Error("the bot's card demo lesson never appeared")
    const cta = page.getByRole('button', { name: /first game vs bot|первую игру/i })
    if (!(await cta.isVisible().catch(() => false)))
      throw new Error('the graduation CTA (first game vs bot) is missing')
    console.log('✓ full 3-turn arc: bot card demo shown, graduation card + CTA on the finish')
    await shot(page, 'tutorial-finished')
    console.log('SMOKE PASSED')
  } finally {
    await page.waitForTimeout(300)
    await browser.close()
  }
}

await main()
