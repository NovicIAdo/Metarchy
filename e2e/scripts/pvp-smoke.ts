// Two-browser PvP smoke: player A creates a private 1v1, player B joins by
// invite code, both ready up, both place and commit in P2 (sealed placements
// stay hidden cross-seat until the phase ends), then A forfeits — B must see
// Victory and A Defeat. Two isolated browser contexts, one Chromium/Chrome.
//
// Env: SMOKE_URL, SMOKE_EMAIL(_B), SMOKE_PASSWORD(_B), SMOKE_BROWSER.

import type { Page } from 'playwright'
import {
  USER_A,
  applyCpuThrottle,
  forfeitGame,
  USER_B,
  launchBrowser,
  passP1,
  placeAllAndCommit,
  shot,
  signIn,
  tryClick,
  wirePageLogs
} from './smoke-lib.js'

/** Last WebSocket frames per page: direction, type, and the phase of any view. */
const frames = new Map<Page, string[]>()
function recordFrames(page: Page): void {
  const log: string[] = []
  frames.set(page, log)
  const t0 = Date.now()
  const note = (dir: string, payload: string | Buffer): void => {
    try {
      const msg = JSON.parse(String(payload)) as {
        t?: string
        p?: { playerView?: { phase?: { kind?: string } }; intent?: { type?: string } }
      }
      if (msg.t === 'ping' || msg.t === 'pong') return
      const detail = msg.p?.playerView?.phase?.kind ?? msg.p?.intent?.type ?? ''
      log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${dir} ${msg.t} ${detail}`)
      if (log.length > 40) log.shift()
    } catch {
      /* not JSON */
    }
  }
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => note('→', f.payload))
    ws.on('framereceived', (f) => note('←', f.payload))
    ws.on('close', () => log.push('ws closed'))
  })
}

async function waitPhase(
  page: Page,
  needle: string,
  tag: string,
  // The socket frame log (3791d5c) shows the server and the views arriving on
  // time; on the CPU-rasterized runner the page just takes tens of seconds to
  // re-render the phase change. Budget for that, not for a GPU laptop.
  timeoutMs = 90000
): Promise<void> {
  const start = Date.now()
  let seen = ''
  for (;;) {
    const label =
      (await page
        .locator('.hud-turn')
        .textContent()
        .catch(() => '')) ?? ''
    // CI-only stalls: print every change of what the player actually sees, so
    // the log tells an unsent ack from a server that never advanced.
    const panel = await page
      .locator('.reveal-panel')
      .innerText({ timeout: 500 })
      .catch(() => '—')
    const status = await page
      .locator('.status-chip')
      .innerText({ timeout: 500 })
      .catch(() => '?')
    const state = `${label} | ${status} | ${panel.replace(/\s+/g, ' ')}`
    if (state !== seen) {
      console.log(`… [${tag} +${((Date.now() - start) / 1000).toFixed(1)}s] ${state}`)
      seen = state
    }
    if (label.includes(needle)) return
    // The P2 reveal beat holds the phase until every player acks it (b765afb).
    // tryClick, not a bare click: under software-GL an honest click can stall
    // for seconds on a perfectly visible button — the raw fallback lands.
    const getIt = page.getByRole('button', { name: /get it!/i })
    if (await getIt.isVisible().catch(() => false)) await tryClick(getIt, 2500, 'reveal-ack')
    if (Date.now() - start > timeoutMs) {
      console.log(`… [${tag}] last frames:\n  ${(frames.get(page) ?? []).join('\n  ')}`)
      throw new Error(`phase "${needle}" not reached, at "${label}"`)
    }
    await page.waitForTimeout(400)
  }
}

async function main(): Promise<void> {
  const browser = await launchBrowser()
  // Two pages render simultaneously on one CPU-rasterized runner — keep them small.
  const ctxA = await browser.newContext({ viewport: { width: 1120, height: 700 } })
  const ctxB = await browser.newContext({ viewport: { width: 1120, height: 700 } })
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  wirePageLogs(pageA, 'A')
  wirePageLogs(pageB, 'B')
  recordFrames(pageA)
  recordFrames(pageB)
  await applyCpuThrottle(pageA)
  await applyCpuThrottle(pageB)

  try {
    await Promise.all([signIn(pageA, USER_A), signIn(pageB, USER_B)])
    console.log('✓ both players signed in')

    // A creates a private 1v1 and reads the invite code from the lobby.
    await pageA.getByRole('button', { name: /private 1v1/i }).click()
    await pageA.locator('.invite-code').waitFor({ timeout: 10000 })
    const code = ((await pageA.locator('.invite-code').textContent()) ?? '').trim()
    if (code.length !== 6) throw new Error(`bad invite code "${code}"`)
    console.log(`✓ lobby created, code ${code}`)
    await shot(pageA, 'pvp-lobby-a')

    // B joins by code.
    await pageB.getByPlaceholder('ABC123').fill(code)
    await pageB.getByRole('button', { name: /^join$/i }).click()
    await pageB.getByRole('button', { name: /^ready$/i }).waitFor({ timeout: 10000 })

    await pageA.getByRole('button', { name: /^ready$/i }).click()
    await pageB.getByRole('button', { name: /^ready$/i }).click()

    await Promise.all([
      pageA.locator('.board-host canvas').waitFor({ timeout: 20000 }),
      pageB.locator('.board-host canvas').waitFor({ timeout: 20000 })
    ])
    await pageA.waitForTimeout(1500) // texture load
    console.log('✓ game started for both')

    await Promise.all([passP1(pageA), passP1(pageB)])

    // Both place in parallel — slow runners must beat the P2 deadline together.
    await Promise.all([placeAllAndCommit(pageA), placeAllAndCommit(pageB)])
    await shot(pageA, 'pvp-a-committed')
    // Turn 1 has no Phase 3 (rules 2026-08): P2 goes straight to Conflicts.
    await Promise.all([waitPhase(pageA, 'Conflicts', 'A'), waitPhase(pageB, 'Conflicts', 'B')])
    await shot(pageA, 'pvp-p4-a')
    await shot(pageB, 'pvp-p4-b')
    console.log('✓ both committed; Conflicts reached in both browsers')

    // A forfeits: B must win, A must lose.
    await forfeitGame(pageA, 10000)
    await Promise.all([
      pageA.locator('.gameover-verdict').waitFor({ timeout: 60000 }),
      pageB.locator('.gameover-verdict').waitFor({ timeout: 60000 })
    ])
    const verdictA = ((await pageA.locator('.gameover-verdict').textContent()) ?? '').trim()
    const verdictB = ((await pageB.locator('.gameover-verdict').textContent()) ?? '').trim()
    await shot(pageA, 'pvp-gameover-a')
    await shot(pageB, 'pvp-gameover-b')
    if (!/defeat/i.test(verdictA)) throw new Error(`A expected Defeat, got "${verdictA}"`)
    if (!/victory/i.test(verdictB)) throw new Error(`B expected Victory, got "${verdictB}"`)
    console.log(`✅ PVP SMOKE PASS — A "${verdictA}", B "${verdictB}"`)
  } catch (err) {
    await shot(pageA, 'PVP-FAILURE-A')
    await shot(pageB, 'PVP-FAILURE-B')
    throw err
  } finally {
    await browser.close()
  }
}

await main()
