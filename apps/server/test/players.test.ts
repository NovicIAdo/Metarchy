// The Players directory (author backlog #2) over a real socket: the roster, the
// nickname search, and a player's public profile by name — the shape a shared
// link resolves to. Like profile.update, these are session-level messages the
// gateway answers before the hub sees them, because they read the ProfileStore.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TestServer } from './helpers.js'
import { connectAs, startTestServer } from './helpers.js'

describe('players directory', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
  })
  afterAll(async () => {
    await ts.server.close()
  })

  /** Register a player under a known name and leave the socket open. */
  async function register(nickname: string): Promise<{ userId: string }> {
    const userId = randomUUID()
    const { client } = await connectAs(ts, userId)
    client.send({ t: 'profile.update', p: { nickname } })
    await client.expect('profile.updated')
    return { userId }
  }

  it('lists the roster with the ranked record, and searches by username', async () => {
    await register('Highlander_X')
    await register('web34ever')
    const { client } = await connectAs(ts, randomUUID())

    client.send({ t: 'players.list', seq: 4 })
    const all = await client.expect('players')
    expect(all.seq).toBe(4)
    const names = all.p.rows.map((r) => r.nickname)
    expect(names).toContain('Highlander_X')
    expect(names).toContain('web34ever')
    expect(all.p.total).toBeGreaterThanOrEqual(3)
    // Nobody has finished a game here: an empty record and no rating at all,
    // rather than the default 1500 dressed up as a standing.
    const highlander = all.p.rows.find((r) => r.nickname === 'Highlander_X')
    expect(highlander?.ranked).toEqual({ played: 0, wins: 0, losses: 0 })
    expect(highlander?.rating).toBeNull()

    // Search is a case-insensitive substring of the nickname.
    client.send({ t: 'players.list', p: { query: 'HIGHLAND' } })
    const hit = await client.expect('players')
    expect(hit.p.rows.map((r) => r.nickname)).toEqual(['Highlander_X'])
    expect(hit.p.total).toBe(1)

    client.send({ t: 'players.list', p: { query: 'nobody-by-this-name' } })
    const miss = await client.expect('players')
    expect(miss.p.rows).toEqual([])
    expect(miss.p.total).toBe(0)
    client.close()
  })

  it('serves a public profile by nickname, case-insensitively', async () => {
    const { userId } = await register('Okeesha_2')
    const { client } = await connectAs(ts, randomUUID())

    client.send({ t: 'player.get', seq: 9, p: { nickname: 'okeesha_2' } })
    const profile = await client.expect('player')
    expect(profile.seq).toBe(9)
    expect(profile.p.card.nickname).toBe('Okeesha_2')
    expect(profile.p.card.userId).toBe(userId)
    // Every category is present, so the screen never has to guess a shape.
    expect(Object.keys(profile.p.record).sort()).toEqual(['bots', 'private', 'ranked', 'team'])
    // No finished rated game, so no standing is claimed.
    expect(profile.p.ratings).toEqual([])
    client.close()
  })

  it('answers not_found for a name nobody holds', async () => {
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'player.get', p: { nickname: 'GhostWhoDoesNotExist' } })
    const error = await client.expect('error')
    expect(error.p.code).toBe('not_found')
    client.close()
  })

  it('a nickname search cannot smuggle a LIKE wildcard', async () => {
    await register('Wildcards')
    const { client } = await connectAs(ts, randomUUID())
    // '%' is not in the legal nickname charset, so as a *search* it must match
    // literally — never "everything".
    client.send({ t: 'players.list', p: { query: '%' } })
    const res = await client.expect('players')
    expect(res.p.rows).toEqual([])
    expect(res.p.total).toBe(0)
    client.close()
  })
})
