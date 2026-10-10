import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TestServer } from './helpers.js'
import { connectAs, startTestServer, TestClient } from './helpers.js'

describe('gateway', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
  })
  afterAll(async () => {
    await ts.server.close()
  })

  it('serves /healthz', async () => {
    const res = await fetch(`${ts.httpUrl}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, rooms: 0 })
  })

  it('authenticates a valid token and sends welcome', async () => {
    const userId = randomUUID()
    const { client, welcome } = await connectAs(ts, userId)
    expect(welcome.p.profile.userId).toBe(userId)
    expect(welcome.p.profile.nickname.length).toBeGreaterThan(2)
    expect(welcome.p.activeGame).toBeNull()
    client.close()
  })

  it('rejects a garbage token and closes with 4001', async () => {
    const client = await TestClient.connect(ts.wsUrl)
    const reply = await client.hello('not-a-jwt')
    expect(reply.t).toBe('error')
    if (reply.t === 'error') expect(reply.p.code).toBe('auth_failed')
    const closed = await client.waitClose()
    expect(closed.code).toBe(4001)
  })

  it('rejects a token signed by an unknown key', async () => {
    const other = await import('./helpers.js').then((m) => m.makeTestAuth())
    const client = await TestClient.connect(ts.wsUrl)
    const reply = await client.hello(await other.mint(randomUUID()))
    expect(reply.t).toBe('error')
    await client.waitClose()
  })

  it('rejects non-hello messages before authentication', async () => {
    const client = await TestClient.connect(ts.wsUrl)
    client.send({ t: 'queue.leave' })
    const err = await client.expect('error')
    expect(err.p.code).toBe('unauthenticated')
    client.close()
  })

  it('answers ping with pong, echoing seq, pre- and post-auth', async () => {
    const client = await TestClient.connect(ts.wsUrl)
    client.send({ t: 'ping', seq: 5 })
    expect((await client.expect('pong')).seq).toBe(5)
    const token = await ts.auth.mint(randomUUID())
    await client.hello(token)
    client.send({ t: 'ping', seq: 9 })
    expect((await client.expect('pong')).seq).toBe(9)
    client.close()
  })

  it('rejects malformed frames with bad_message', async () => {
    const client = await TestClient.connect(ts.wsUrl)
    client.send('{nope')
    expect((await client.expect('error')).p.code).toBe('bad_message')
    client.send({ t: 'no.such.message' })
    expect((await client.expect('error')).p.code).toBe('bad_message')
    client.close()
  })

  it('rejects a second hello on the same socket', async () => {
    const userId = randomUUID()
    const { client } = await connectAs(ts, userId)
    client.send({ t: 'hello', seq: 3, p: { accessToken: await ts.auth.mint(userId) } })
    const err = await client.expect('error')
    expect(err.p.code).toBe('already_authenticated')
    expect(err.seq).toBe(3)
    client.close()
  })

  it('supersedes the previous connection of the same user', async () => {
    const userId = randomUUID()
    const { client: first } = await connectAs(ts, userId)
    const { client: second } = await connectAs(ts, userId)
    const closed = await first.waitClose()
    expect(closed.code).toBe(4000)
    expect(second.isClosed).toBe(false)
    second.close()
  })

  it('replies unavailable for 2v2, the one mode with no queue behind it', async () => {
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'queue.join', seq: 1, p: { mode: '2v2' } })
    const err = await client.expect('error')
    expect(err.p.code).toBe('unavailable')
    client.close()
  })

  it('closes oversized frames via maxPayload', async () => {
    const client = await TestClient.connect(ts.wsUrl)
    client.send(JSON.stringify({ t: 'ping', pad: 'x'.repeat(64 * 1024) }))
    const closed = await client.waitClose()
    expect(closed.code).toBe(1009)
  })
})

describe('gateway rate limiting', () => {
  it('throttles a flooding connection', async () => {
    const ts = await startTestServer({ rate: { capacity: 5, refillPerSec: 1 } })
    try {
      const client = await TestClient.connect(ts.wsUrl)
      for (let i = 0; i < 30; i++) client.send({ t: 'ping' })
      const err = await client.next((m) => m.t === 'error')
      expect(err.t === 'error' && err.p.code).toBe('rate_limited')
      client.close()
    } finally {
      await ts.server.close()
    }
  })
})
