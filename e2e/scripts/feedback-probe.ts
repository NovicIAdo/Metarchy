// Throwaway visual+wire probe: the Home feedback button opens a form, sending
// posts to /client-errors (source=feedback) and the UI confirms.

import { USER_A, launchBrowser, shot, signIn, tryClick } from './smoke-lib.js'

const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1024, height: 900 } })

const posted: string[] = []
page.on('request', (r) => {
  if (r.url().endsWith('/client-errors') && r.method() === 'POST') posted.push(r.postData() ?? '')
})

await signIn(page, USER_A)
await tryClick(page.getByRole('button', { name: /send feedback/i }), 5000)
await page.locator('.feedback-input').waitFor({ timeout: 8000 })
await page
  .locator('.feedback-input')
  .fill('Beta probe: the bet timer feels a touch short on turn 1.')
await shot(page, 'feedback-open')
await tryClick(page.getByRole('button', { name: /^send$/i }), 5000)
await page.getByText(/thanks — got it/i).waitFor({ timeout: 8000 })
await shot(page, 'feedback-sent')

const ok = posted.some((b) => b.includes('"source":"feedback"') && b.includes('bet timer'))
console.log(
  ok ? 'PROBE OK — feedback posted with source=feedback' : 'PROBE FAIL — no matching post'
)
console.log('posts seen:', JSON.stringify(posted))
await browser.close()
process.exit(ok ? 0 : 1)
