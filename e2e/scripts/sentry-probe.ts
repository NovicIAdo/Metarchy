// One-off probe: proves the browser → Sentry pipeline live. Opens the client,
// throws a deliberate error, and asserts the SDK's envelope POST to the Sentry
// ingest endpoint is accepted (2xx). No sign-in needed — the SDK initializes
// before auth.
// Run: SMOKE_URL=http://localhost:5173 SMOKE_BROWSER=chromium tsx scripts/sentry-probe.ts

import { BASE_URL, launchBrowser, wirePageLogs } from './smoke-lib.js'

async function main(): Promise<void> {
  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  wirePageLogs(page, 'browser')

  // Only the envelope POST's body proves acceptance — Relay answers it with
  // {"id": "<event id>"}. A bare 200 may be a CORS preflight.
  const accepted = new Promise<string>((resolve) => {
    page.on('response', (res) => {
      const req = res.request()
      if (!res.url().includes('ingest.de.sentry.io')) return
      void res
        .text()
        .catch(() => '')
        .then((body) => {
          console.log(
            `· ingest ${req.method()} ${res.status()} ${res.url().split('?')[0]} → ${body.slice(0, 120)}`
          )
          if (req.method() === 'POST' && body.includes('"id"')) resolve(body)
        })
    })
  })

  try {
    await page.goto(BASE_URL)
    await page.waitForTimeout(1500) // let the SDK initialize
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('sentry-verify: browser pipeline wired end to end')
      }, 0)
    })
    const body = await Promise.race([
      accepted,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('no accepted envelope POST within 15s')), 15_000)
      )
    ])
    console.log(`✅ SENTRY PROBE PASS — envelope accepted with event id: ${body}`)
  } finally {
    await browser.close()
  }
}

await main()
