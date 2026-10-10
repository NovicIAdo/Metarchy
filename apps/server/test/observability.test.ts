// Stage 6 observability: /metrics exposes prom-client output with game gauges
// and counters; /client-errors ingests browser reports with rate limiting.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TestServer } from './helpers.js'
import { connectAs, startTestServer } from './helpers.js'

describe('observability endpoints', () => {
  let ts: TestServer
  beforeAll(async () => {
    ts = await startTestServer()
  })
  afterAll(async () => {
    await ts.server.close()
  })

  it('/metrics reflects rooms, sessions and started games', async () => {
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'game.create', seq: 1, p: { mode: 'vs_bots' } })
    await client.expect('game.created')
    await client.expect('game.started')

    const body = await (await fetch(`${ts.httpUrl}/metrics`)).text()
    expect(body).toContain('metarchy_rooms 1')
    expect(body).toContain('metarchy_sessions 1')
    expect(body).toContain('metarchy_games_started_total{mode="vs_bots"} 1')
    expect(body).toContain('nodejs_eventloop_lag_seconds')
    client.close()
  })

  it('/metrics hides from requests that came through the public edge', async () => {
    const publicReq = await fetch(`${ts.httpUrl}/metrics`, {
      headers: { 'fly-client-ip': '203.0.113.7' }
    })
    expect(publicReq.status).toBe(404)
  })

  it('/client-errors accepts JSON and text/plain, then rate-limits the chatty', async () => {
    const post = (body: string, contentType: string) =>
      fetch(`${ts.httpUrl}/client-errors`, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body
      })

    const json = await post(
      JSON.stringify({ message: 'boom', source: 'window' }),
      'application/json'
    )
    expect(json.status).toBe(204)
    // sendBeacon path: a JSON string arriving as text/plain.
    const beacon = await post(JSON.stringify({ message: 'beacon boom' }), 'text/plain')
    expect(beacon.status).toBe(204)

    const statuses: number[] = []
    for (let i = 0; i < 12; i++)
      statuses.push(
        (await post(JSON.stringify({ message: `spam ${i}` }), 'application/json')).status
      )
    expect(statuses).toContain(429)

    const body = await (await fetch(`${ts.httpUrl}/metrics`)).text()
    expect(body).toMatch(/metarchy_client_errors_total \d+/)
  })
})
