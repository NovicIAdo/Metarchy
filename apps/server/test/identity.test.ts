import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSignInRequest } from '@metarchy/chain-solana'
import { makePgliteSql, migrate } from '../src/db.js'
import { emailKey, walletWithGrants } from '../src/exclusives.js'
import { MemoryStore } from '../src/store.js'
import type { IdentityStore, MfaPolicy, WalletLinkChallenge } from '../src/identity.js'
import { MemoryIdentityStore } from '../src/identity.js'
import { SqlIdentityStore } from '../src/identity-sql.js'
import { MemoryProfileStore } from '../src/profiles.js'
import type { ProfileStore } from '../src/profiles.js'
import { SqlProfileStore } from '../src/store-sql.js'

const user = (userId: string, aal: 'aal1' | 'aal2' = 'aal1') => ({ userId, email: null, aal })
const challenge = (primaryAuthUserId: string, userId = primaryAuthUserId): WalletLinkChallenge => {
  const id = randomUUID()
  return {
    id,
    primaryAuthUserId,
    userId,
    request: {
      ...createSignInRequest(
        'https://game.metarchy.test/',
        `Link a Solana wallet to Metarchy player ${userId}.`,
        'solana:devnet'
      ),
      requestId: id
    }
  }
}

type Backend = { identities: IdentityStore; profiles: ProfileStore; close(): Promise<void> }
const backends: [string, (mfa: MfaPolicy) => Promise<Backend>][] = [
  [
    'memory',
    async (mfa) => {
      const profiles = new MemoryProfileStore()
      return { identities: new MemoryIdentityStore(profiles, mfa), profiles, close: async () => {} }
    }
  ],
  [
    'PGlite under the server role',
    async (mfa) => {
      const sql = await makePgliteSql('memory://')
      await migrate(sql)
      await sql.exec('set role metarchy_server')
      return {
        identities: new SqlIdentityStore(sql, mfa),
        profiles: new SqlProfileStore(sql),
        close: () => sql.close()
      }
    }
  ]
]

describe.each(backends)('profile identity: %s', (_name, make) => {
  it('preserves canonical email cosmetics and never lets an alias overwrite the grant email', async () => {
    const { identities, close } = await make({ hasVerifiedFactor: async () => false })
    try {
      const primary = randomUUID(),
        wallet = randomUUID()
      await identities.login({ ...user(primary), email: 'canonical@test.local' })
      const issued = challenge(primary)
      await identities.saveChallenge(issued)
      await identities.link({
        challengeId: issued.id,
        primary: { ...user(primary), email: 'canonical@test.local' },
        wallet: { ...user(wallet), email: 'alias@test.local' },
        address: 'email-gift-wallet'
      })
      const profile = await identities.login({ ...user(wallet), email: 'alias@test.local' })
      const email = await identities.canonicalEmail(wallet)
      expect(email).toBe('canonical@test.local')
      const game = new MemoryStore()
      expect(
        (
          await walletWithGrants(game, profile.userId, email, {
            [emailKey('canonical@test.local')]: ['skin.politician.ann'],
            [emailKey('alias@test.local')]: ['skin.politician.asa']
          })
        ).owned
      ).toContain('skin.politician.ann')
      expect(
        (
          await walletWithGrants(game, profile.userId, email, {
            [emailKey('alias@test.local')]: ['skin.politician.asa']
          })
        ).owned
      ).not.toContain('skin.politician.asa')
    } finally {
      await close()
    }
  })

  it('keeps existing IDs and resolves a fresh linked wallet to the original profile', async () => {
    const { identities, profiles, close } = await make({ hasVerifiedFactor: async () => false })
    try {
      const primary = randomUUID(),
        wallet = randomUUID()
      expect((await identities.login(user(primary))).userId).toBe(primary)
      await profiles.rename(primary, 'OriginalPlayer')
      const issued = challenge(primary)
      await identities.saveChallenge(issued)
      await identities.link({
        challengeId: issued.id,
        primary: user(primary),
        wallet: user(wallet),
        address: 'wallet-address'
      })
      expect(await identities.resolve(wallet)).toBe(primary)
      expect(await identities.login(user(wallet))).toMatchObject({
        userId: primary,
        nickname: 'OriginalPlayer'
      })
      expect((await profiles.listProfiles({ query: null, limit: 20, offset: 0 })).total).toBe(1)
      expect(await identities.account(wallet)).toMatchObject({
        userId: primary,
        requiresMfa: false,
        wallets: [{ address: 'wallet-address', authUserId: wallet, loginEnabled: true }]
      })
    } finally {
      await close()
    }
  })

  it('rejects independent profiles, cross-account wallet ownership, and consumed challenges', async () => {
    const { identities, close } = await make({ hasVerifiedFactor: async () => false })
    try {
      const a = randomUUID(),
        b = randomUUID(),
        wallet = randomUUID(),
        independent = randomUUID()
      await identities.login(user(a))
      await identities.login(user(b))
      await identities.login(user(independent))
      const first = challenge(a)
      await identities.saveChallenge(first)
      await expect(
        identities.link({
          challengeId: first.id,
          primary: user(a),
          wallet: user(independent),
          address: 'independent'
        })
      ).rejects.toThrow(/profile/i)
      await identities.link({
        challengeId: first.id,
        primary: user(a),
        wallet: user(wallet),
        address: 'owned'
      })
      await expect(
        identities.link({
          challengeId: first.id,
          primary: user(a),
          wallet: user(wallet),
          address: 'owned'
        })
      ).rejects.toThrow(/used|consumed/i)
      const other = challenge(b)
      await identities.saveChallenge(other)
      await expect(
        identities.link({
          challengeId: other.id,
          primary: user(b),
          wallet: user(wallet),
          address: 'owned'
        })
      ).rejects.toThrow(/another|different/i)
      expect(await identities.resolve(independent)).toBe(independent)
      expect(await identities.resolve(wallet)).toBe(a)
    } finally {
      await close()
    }
  })

  it('consumes the challenge once even when two links race', async () => {
    const { identities, close } = await make({ hasVerifiedFactor: async () => false })
    try {
      const primary = randomUUID(),
        wallet = randomUUID()
      await identities.login(user(primary))
      const issued = challenge(primary)
      await identities.saveChallenge(issued)
      const args = {
        challengeId: issued.id,
        primary: user(primary),
        wallet: user(wallet),
        address: 'race'
      }
      const results = await Promise.allSettled([identities.link(args), identities.link(args)])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(await identities.resolve(wallet)).toBe(primary)
    } finally {
      await close()
    }
  })

  it('blocks profile merging when a first login races a wallet link', async () => {
    const { identities, profiles, close } = await make({ hasVerifiedFactor: async () => false })
    try {
      const primary = randomUUID(),
        wallet = randomUUID()
      await identities.login(user(primary))
      const issued = challenge(primary)
      await identities.saveChallenge(issued)
      await Promise.allSettled([
        identities.login(user(wallet)),
        identities.link({
          challengeId: issued.id,
          primary: user(primary),
          wallet: user(wallet),
          address: 'login-race'
        })
      ])
      const resolved = await identities.resolve(wallet)
      const listed = await profiles.listProfiles({ query: null, limit: 20, offset: 0 })
      expect(listed.total).toBe(resolved === primary ? 1 : 2)
    } finally {
      await close()
    }
  })

  it('rolls back the losing alias when two different accounts claim the same address', async () => {
    const { identities, close } = await make({ hasVerifiedFactor: async () => false })
    try {
      const a = randomUUID(),
        b = randomUUID(),
        walletA = randomUUID(),
        walletB = randomUUID()
      await identities.login(user(a))
      await identities.login(user(b))
      const ca = challenge(a),
        cb = challenge(b)
      await identities.saveChallenge(ca)
      await identities.saveChallenge(cb)
      const results = await Promise.allSettled([
        identities.link({
          challengeId: ca.id,
          primary: user(a),
          wallet: user(walletA),
          address: 'same-address'
        }),
        identities.link({
          challengeId: cb.id,
          primary: user(b),
          wallet: user(walletB),
          address: 'same-address'
        })
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      if (results[0]?.status === 'fulfilled') {
        expect(await identities.resolve(walletA)).toBe(a)
        expect(await identities.resolve(walletB)).toBe(walletB)
        expect((await identities.challenge(cb.id, b)).consumedAt).toBeUndefined()
      } else {
        expect(await identities.resolve(walletA)).toBe(walletA)
        expect(await identities.resolve(walletB)).toBe(b)
        expect((await identities.challenge(ca.id, a)).consumedAt).toBeUndefined()
      }
    } finally {
      await close()
    }
  })

  it('requires aal2 and a verified wallet factor; reflects new primary MFA on existing aliases', async () => {
    const factors = new Set<string>()
    const { identities, close } = await make({ hasVerifiedFactor: async (id) => factors.has(id) })
    try {
      const primary = randomUUID(),
        wallet = randomUUID()
      await identities.login(user(primary))
      const issued = challenge(primary)
      await identities.saveChallenge(issued)
      factors.add(primary)
      const args = {
        challengeId: issued.id,
        primary: user(primary, 'aal2'),
        wallet: user(wallet),
        address: 'mfa-wallet'
      }
      await expect(identities.link(args)).rejects.toThrow(/mfa/i)
      await expect(identities.link({ ...args, wallet: user(wallet, 'aal2') })).rejects.toThrow(
        /factor|setup/i
      )
      factors.add(wallet)
      await expect(
        identities.link({ ...args, primary: user(primary), wallet: user(wallet, 'aal2') })
      ).rejects.toThrow(/mfa/i)
      await identities.link({ ...args, wallet: user(wallet, 'aal2') })
      await expect(identities.login(user(wallet))).rejects.toThrow(/mfa/i)
      expect((await identities.login(user(wallet, 'aal2'))).userId).toBe(primary)
      factors.delete(wallet)
      expect((await identities.account(wallet)).wallets[0]?.loginEnabled).toBe(false)
      await expect(identities.login(user(wallet, 'aal2'))).rejects.toThrow(/factor|setup/i)
      factors.add(wallet)
      const retry = challenge(primary)
      await identities.saveChallenge(retry)
      await identities.link({ ...args, challengeId: retry.id, wallet: user(wallet, 'aal2') })
      expect((await identities.account(primary)).wallets).toHaveLength(1)
    } finally {
      await close()
    }
  })

  it('rejects wrong primary and expiry without consuming a valid challenge', async () => {
    const { identities, close } = await make({ hasVerifiedFactor: async () => false })
    try {
      const primary = randomUUID(),
        wallet = randomUUID()
      await identities.login(user(primary))
      const issued = challenge(primary)
      await identities.saveChallenge(issued)
      await expect(
        identities.link({
          challengeId: issued.id,
          primary: user(randomUUID()),
          wallet: user(wallet),
          address: 'wrong'
        })
      ).rejects.toThrow(/challenge/i)
      const expired = challenge(primary)
      expired.request.issuedAt = new Date(Date.now() - 600_000).toISOString()
      expired.request.expirationTime = new Date(Date.now() - 300_000).toISOString()
      await identities.saveChallenge(expired)
      await expect(
        identities.link({
          challengeId: expired.id,
          primary: user(primary),
          wallet: user(wallet),
          address: 'expired'
        })
      ).rejects.toThrow(/expired/i)
      await identities.link({
        challengeId: issued.id,
        primary: user(primary),
        wallet: user(wallet),
        address: 'valid'
      })
    } finally {
      await close()
    }
  })
})

it('keeps identity tables, challenges, and MFA metadata private to the game server', async () => {
  const sql = await makePgliteSql('memory://')
  try {
    await migrate(sql)
    for (const role of ['anon', 'authenticated']) {
      await sql.exec(`set role ${role}`)
      await expect(sql.query('select * from metarchy_private.auth_principals')).rejects.toThrow(
        /permission/i
      )
      await expect(sql.query('select * from metarchy_private.solana_wallets')).rejects.toThrow(
        /permission/i
      )
      await expect(
        sql.query('select * from metarchy_private.wallet_link_challenges')
      ).rejects.toThrow(/permission/i)
      await expect(sql.query('select * from metarchy_private.verified_mfa_users')).rejects.toThrow(
        /permission/i
      )
      await expect(
        sql.query('select * from metarchy_private.canonical_auth_emails')
      ).rejects.toThrow(/permission/i)
      await expect(sql.query('select * from metarchy_private.profile_auth_emails')).rejects.toThrow(
        /permission/i
      )
      await sql.exec('reset role')
    }
    await sql.exec('set role metarchy_server')
    expect((await sql.query('select * from metarchy_private.verified_mfa_users')).rows).toEqual([])
  } finally {
    await sql.close()
  }
})

it('rejects default memory linking without a trusted account-wide MFA policy', async () => {
  const profiles = new MemoryProfileStore()
  const identities = new MemoryIdentityStore(profiles)
  const primary = randomUUID(),
    issued = challenge(primary)
  await identities.login(user(primary))
  await identities.saveChallenge(issued)
  expect(await identities.hasMfaPolicy()).toBe(false)
  await expect(
    identities.link({
      challengeId: issued.id,
      primary: user(primary),
      wallet: user(randomUUID()),
      address: 'untrusted-policy'
    })
  ).rejects.toThrow(/MFA policy/i)
})

it('rolls back a memory link if its final authoritative policy read fails', async () => {
  const primary = randomUUID(),
    wallet = randomUUID()
  const profiles = new MemoryProfileStore()
  const identities = new MemoryIdentityStore(profiles, {
    hasVerifiedFactor: async () => {
      if ((await identities.resolve(wallet)) === primary) throw new Error('policy unavailable')
      return false
    }
  })
  await identities.login(user(primary))
  const issued = challenge(primary)
  await identities.saveChallenge(issued)
  await expect(
    identities.link({
      challengeId: issued.id,
      primary: user(primary),
      wallet: user(wallet),
      address: 'rollback-policy'
    })
  ).rejects.toThrow('policy unavailable')
  expect(await identities.resolve(wallet)).toBe(wallet)
  expect((await identities.account(primary)).wallets).toEqual([])
  expect((await identities.challenge(issued.id, primary)).consumedAt).toBeUndefined()
})

it('preserves a linking challenge and consumed wallet mapping across database restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'metarchy-wallet-identity-'))
  const primary = randomUUID(),
    wallet = randomUUID(),
    issued = challenge(primary)
  let sql = await makePgliteSql(directory)
  try {
    await migrate(sql)
    await sql.exec('set role metarchy_server')
    let identities = new SqlIdentityStore(sql)
    await identities.login(user(primary))
    await identities.saveChallenge(issued)
    await sql.close()
    sql = await makePgliteSql(directory)
    await sql.exec('set role metarchy_server')
    identities = new SqlIdentityStore(sql)
    expect((await identities.challenge(issued.id, primary)).request).toEqual(issued.request)
    const input = {
      challengeId: issued.id,
      primary: user(primary),
      wallet: user(wallet),
      address: 'durable-wallet'
    }
    await identities.link(input)
    await sql.close()
    sql = await makePgliteSql(directory)
    await sql.exec('set role metarchy_server')
    identities = new SqlIdentityStore(sql)
    expect((await identities.login(user(wallet))).userId).toBe(primary)
    await expect(identities.link(input)).rejects.toThrow(/consumed/i)
  } finally {
    await sql.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('reads only verified MFA UUIDs through the private view without granting access to Auth secrets', async () => {
  const sql = await makePgliteSql('memory://')
  const primary = randomUUID(),
    pending = randomUUID()
  try {
    // Model the hosted Auth metadata before applying the new migration; applying
    // the entire old schema here would need unrelated Supabase Auth functions.
    await sql.exec(`create role metarchy_server nologin;
      create schema auth;
      create table auth.mfa_factors (user_id uuid, status text, secret text);
      create table profiles (user_id uuid primary key, nickname text, avatar text, wardrobe jsonb, created_at timestamptz default now());
      grant select, insert, update on profiles to metarchy_server;
      insert into auth.mfa_factors values ('${primary}', 'verified', 'must-stay-private'), ('${pending}', 'unverified', 'also-private');`)
    await sql.exec(
      await readFile(
        new URL(
          '../../../supabase/migrations/20261009162320_solana_wallet_identity.sql',
          import.meta.url
        ),
        'utf8'
      )
    )
    await sql.exec('set role metarchy_server')
    expect(
      (await sql.query<{ user_id: string }>('select * from metarchy_private.verified_mfa_users'))
        .rows
    ).toEqual([{ user_id: primary }])
    await expect(sql.query('select secret from auth.mfa_factors')).rejects.toThrow(/permission/i)
    const identities = new SqlIdentityStore(sql)
    expect((await identities.account(primary)).requiresMfa).toBe(true)
    expect((await identities.account(pending)).requiresMfa).toBe(false)
    await expect(identities.login(user(primary))).rejects.toThrow(/mfa/i)
    expect((await identities.login(user(primary, 'aal2'))).userId).toBe(primary)
  } finally {
    await sql.close()
  }
})

it('uses the hosted canonical email view while withholding Auth credentials from the server role', async () => {
  const sql = await makePgliteSql('memory://')
  const primary = randomUUID(),
    wallet = randomUUID()
  try {
    await sql.exec(`create role metarchy_server nologin;
      create schema auth;
      create table auth.users (id uuid primary key, email text, encrypted_password text);
      create table auth.mfa_factors (user_id uuid, status text, secret text);
      create table profiles (user_id uuid primary key, nickname text, avatar text, wardrobe jsonb, created_at timestamptz default now());
      grant select, insert, update on profiles to metarchy_server;
      insert into auth.users values ('${primary}', 'canonical@test.local', 'private-hash'), ('${wallet}', 'alias@test.local', 'another-private-hash');`)
    await sql.exec(
      await readFile(
        new URL(
          '../../../supabase/migrations/20261009162320_solana_wallet_identity.sql',
          import.meta.url
        ),
        'utf8'
      )
    )
    await sql.exec('set role metarchy_server')
    const identities = new SqlIdentityStore(sql)
    expect(await identities.hasMfaPolicy()).toBe(true)
    await identities.login({ ...user(primary), email: 'stale-jwt@test.local' })
    const issued = challenge(primary)
    await identities.saveChallenge(issued)
    await identities.link({
      challengeId: issued.id,
      primary: { ...user(primary), email: 'stale-jwt@test.local' },
      wallet: user(wallet),
      address: 'hosted-email-wallet'
    })
    await identities.login({ ...user(wallet), email: 'alias@test.local' })
    expect(await identities.canonicalEmail(wallet)).toBe('canonical@test.local')
    await expect(sql.query('select encrypted_password from auth.users')).rejects.toThrow(
      /permission/i
    )
    await sql.exec('reset role')
    await sql.query('update auth.users set email = $1 where id = $2', [
      'new-canonical@test.local',
      primary
    ])
    await sql.exec('set role metarchy_server')
    expect(await identities.canonicalEmail(wallet)).toBe('new-canonical@test.local')
  } finally {
    await sql.close()
  }
})
