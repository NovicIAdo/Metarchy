// profile.update is a session-level message: the gateway handles it before the
// hub ever sees it, and the rename is authoritative — the client's own
// validation is only a courtesy.

import { randomUUID } from 'node:crypto'
import { nicknameIssueOf, validateNickname } from '@metarchy/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultNickname } from '../src/profiles.js'
import type { TestServer } from './helpers.js'
import { connectAs, startTestServer, TestClient } from './helpers.js'

describe('profile.update', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
  })
  afterAll(async () => {
    await ts.server.close()
  })

  it('the auto-generated placeholder is itself a legal nickname', () => {
    expect(validateNickname(defaultNickname(randomUUID())).ok).toBe(true)
  })

  it('renames and echoes the new profile', async () => {
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'profile.update', seq: 7, p: { nickname: '  Chairman_Meow ' } })
    const updated = await client.expect('profile.updated')
    expect(updated.seq).toBe(7)
    expect(updated.p.profile.nickname).toBe('Chairman_Meow') // trimmed
    client.close()
  })

  it('a later welcome carries the renamed profile', async () => {
    const userId = randomUUID()
    const first = await connectAs(ts, userId)
    first.client.send({ t: 'profile.update', p: { nickname: 'Persistent' } })
    await first.client.expect('profile.updated')
    first.client.close()

    const { welcome } = await connectAs(ts, userId)
    expect(welcome.p.profile.nickname).toBe('Persistent')
  })

  it('sets and clears the avatar; a later welcome carries it', async () => {
    const userId = randomUUID()
    const { client } = await connectAs(ts, userId)
    client.send({ t: 'profile.update', seq: 9, p: { avatar: 'viper' } })
    const updated = await client.expect('profile.updated')
    expect(updated.p.profile.avatar).toBe('viper')
    client.close()

    const back = await connectAs(ts, userId)
    expect(back.welcome.p.profile.avatar).toBe('viper')
    back.client.send({ t: 'profile.update', p: { avatar: null } })
    const cleared = await back.client.expect('profile.updated')
    expect(cleared.p.profile.avatar).toBeNull()
    back.client.close()
  })

  it('rejects an avatar id outside the preset enum at the wire', async () => {
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'profile.update', p: { avatar: 'not-a-real-avatar' } })
    const error = await client.expect('error')
    expect(error.p.code).toBe('bad_message')
    client.close()
  })

  it('dresses the politician, survives a reconnect, and clears back to canonical', async () => {
    const userId = randomUUID()
    const { client } = await connectAs(ts, userId)
    const loadout = { body: 2, costume: [1, 3], hair: [4, 2], accessories: [[2, 5]] }
    client.send({ t: 'profile.update', seq: 4, p: { wardrobe: { politician: loadout } } })
    const updated = await client.expect('profile.updated')
    expect(updated.p.profile.wardrobe).toEqual({ politician: loadout })
    client.close()

    const back = await connectAs(ts, userId)
    expect(back.welcome.p.profile.wardrobe).toEqual({ politician: loadout })
    back.client.send({ t: 'profile.update', p: { wardrobe: { politician: null } } })
    const cleared = await back.client.expect('profile.updated')
    expect(cleared.p.profile.wardrobe ?? null).toBeNull()
    back.client.close()
  })

  it('rejects an out-of-catalog loadout at the wire', async () => {
    const { client } = await connectAs(ts, randomUUID())
    client.send({
      t: 'profile.update',
      p: { wardrobe: { politician: { body: 1, costume: [9, 1] } } }
    })
    const error = await client.expect('error')
    expect(error.p.code).toBe('bad_message')
    client.close()
  })

  it('picks whole-figure skins, keeps them alongside a layered politician, reconnects', async () => {
    const userId = randomUUID()
    const { client } = await connectAs(ts, userId)
    // Skins are GATO shop goods now — buy the entitlements first (shop.test.ts
    // covers the unowned-skin refusal).
    client.send({ t: 'shop.buy', p: { itemId: 'skin.robot.industrial' } })
    await client.expect('wallet')
    client.send({ t: 'shop.buy', p: { itemId: 'skin.artist.obsidian-suit' } })
    await client.expect('wallet')
    client.send({ t: 'profile.update', p: { wardrobe: { skins: { robot: 'industrial' } } } })
    const a = await client.expect('profile.updated')
    expect(a.p.profile.wardrobe).toEqual({ skins: { robot: 'industrial' } })
    // A second patch merges at the wardrobe top level (client sends whole skins).
    client.send({
      t: 'profile.update',
      p: { wardrobe: { skins: { robot: 'industrial', artist: 'obsidian-suit' } } }
    })
    const b = await client.expect('profile.updated')
    expect(b.p.profile.wardrobe).toEqual({
      skins: { robot: 'industrial', artist: 'obsidian-suit' }
    })
    client.close()

    const back = await connectAs(ts, userId)
    expect(back.welcome.p.profile.wardrobe).toEqual({
      skins: { robot: 'industrial', artist: 'obsidian-suit' }
    })
    back.client.close()
  })

  it('rejects a cross-actor skin id at the wire', async () => {
    const { client } = await connectAs(ts, randomUUID())
    // chrome-exo is a scientist skin, not a robot skin
    client.send({ t: 'profile.update', p: { wardrobe: { skins: { robot: 'chrome-exo' } } } })
    const error = await client.expect('error')
    expect(error.p.code).toBe('bad_message')
    client.close()
  })

  it('rejects an invalid nickname without touching the profile', async () => {
    const userId = randomUUID()
    const { client, welcome } = await connectAs(ts, userId)
    const original = welcome.p.profile.nickname

    client.send({ t: 'profile.update', p: { nickname: 'admin' } })
    const error = await client.expect('error')
    expect(error.p.code).toBe('invalid_input')

    const again = await connectAs(ts, userId)
    expect(again.welcome.p.profile.nickname).toBe(original)
    client.close()
    again.client.close()
  })

  it('takes a bracketed clan tag but not a two-word name', async () => {
    const { client } = await connectAs(ts, randomUUID())
    client.send({ t: 'profile.update', p: { nickname: '[MTA]Asa_(7)' } })
    expect((await client.expect('profile.updated')).p.profile.nickname).toBe('[MTA]Asa_(7)')

    client.send({ t: 'profile.update', p: { nickname: 'Asa the Great' } })
    const error = await client.expect('error')
    expect(error.p.code).toBe('invalid_input')
    // The refusal has to survive the wire as a code the client can translate.
    expect(nicknameIssueOf(error.p.message)).toBe('charset')
    client.close()
  })

  it('refuses a nickname another player holds, case-insensitively', async () => {
    const a = await connectAs(ts, randomUUID())
    a.client.send({ t: 'profile.update', p: { nickname: 'Highlander' } })
    await a.client.expect('profile.updated')

    const b = await connectAs(ts, randomUUID())
    b.client.send({ t: 'profile.update', p: { nickname: 'highlander' } })
    const error = await b.client.expect('error')
    expect(error.p.code).toBe('conflict')
    // Not a Postgres unique-violation string — a code the client translates.
    expect(nicknameIssueOf(error.p.message)).toBe('taken')

    a.client.close()
    b.client.close()
  })

  it('needs a hello first', async () => {
    const client = await TestClient.connect(ts.wsUrl)
    client.send({ t: 'profile.update', p: { nickname: 'Sneaky' } })
    const error = await client.expect('error')
    expect(error.p.code).toBe('unauthenticated')
    client.close()
  })
})
