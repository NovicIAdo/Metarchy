// Manual probe (NOT in CI): the GitBook-style Rules screen (sidebar nav + EN/RU
// language toggle) and the bilingual How-to-Play tutorial. Screenshots go to
// e2e/screenshots. Both are reachable pre-login.
// Run: pnpm --filter @metarchy/e2e exec tsx scripts/learn-probe.ts

import { BASE_URL, launchBrowser, shot, signIn, USER_A, wirePageLogs } from './smoke-lib.js'

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  wirePageLogs(page, 'learn')
  try {
    await page.goto(BASE_URL)
    await signIn(page, USER_A)
    await page.waitForSelector('text=ONLINE', { timeout: 20_000 })

    // Home → How to Play (tutorial), walk to the CTA
    await page.getByRole('button', { name: 'How to Play' }).first().click()
    await page.waitForSelector('.tutorial-art img', { timeout: 10_000 })
    await shot(page, 'tutorial-en')
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Next →' }).click()
    await page.waitForSelector('button:has-text("Play vs Bot")', { timeout: 10_000 })
    console.log('tutorial EN: walked all 6 steps to the Play CTA')

    // Tutorial → full rules (GitBook-style)
    await page.getByRole('button', { name: 'Read the full rules' }).click()
    await page.waitForSelector('.rules-nav-page', { timeout: 10_000 })
    const sections = await page.locator('.rules-nav-page').count()
    console.log(`rules: ${sections} sidebar pages`)
    await shot(page, 'rules-en')

    // Jump to a section via the sidebar
    await page.locator('.rules-nav-page', { hasText: 'Actors' }).first().click()
    await page.waitForSelector('.rules-page-title', { timeout: 10_000 })
    const title = await page.locator('.rules-page-title').textContent()
    console.log(`jumped to section: "${title?.trim()}"`)

    // Switch to Russian
    await page.locator('.lang-btn', { hasText: 'RU' }).click()
    await page.waitForFunction(
      () => (document.querySelector('.rules-nav-parttitle')?.textContent ?? '').length > 0,
      { timeout: 10_000 }
    )
    const ruPart = await page.locator('.rules-nav-parttitle').first().textContent()
    const cyrillic = /[а-яё]/i.test(ruPart ?? '')
    console.log(`RU part title: "${ruPart?.trim()}" — cyrillic: ${cyrillic}`)
    if (!cyrillic) throw new Error('language toggle did not switch to Russian')
    await shot(page, 'rules-ru')

    console.log('✅ LEARN PROBE PASS')
  } finally {
    await browser.close()
  }
}

await main()
