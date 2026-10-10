import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addressFromPublicKey,
  createSignInRequest,
  formatSignInMessage
} from '@metarchy/chain-solana'
import type { SolanaSignInRequest } from '@metarchy/chain-solana'
import { MemoryIdentityStore } from '../src/identity.js'
import { MemoryProfileStore } from '../src/profiles.js'
import type * as Exclusives from '../src/exclusives.js'

// The shipped grant table is keyed by email hashes, so it cannot name a test
// address: every importer gets the same wallet logic over a known grant.
const { GRANTED_EMAIL, GIFTS } = vi.hoisted(() => ({
  GRANTED_EMAIL: 'gifted@test.local',
  GIFTS: ['skin.politician.ann', 'skin.scientist.ann']
}))
vi.mock('../src/exclusives.js', async (importOriginal) => {
  const real = await importOriginal<typeof Exclusives>()
  const table = { [real.emailKey(GRANTED_EMAIL)]: GIFTS }
  return {
    ...real,
    walletWithGrants: (...args: Parameters<typeof real.walletWithGrants>) =>
      real.walletWithGrants(args[0], args[1], args[2], args[3] ?? table)
  }
})
import { makeWalletAuth, verifiedSolanaIdentity } from '../src/solana-auth.js'
import type { TestServer } from './helpers.js'
import { startTestServer, TestClient } from './helpers.js'

const uri = 'https://game.metarchy.test/'
type ChallengeResponse = SolanaSignInRequest & { id: string }
const fixture = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const address = addressFromPublicKey(
    new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32))
  )
  return {
    address,
    sign: (message: string) => sign(null, Buffer.from(message), privateKey).toString('base64')
  }
}
const authUser = (userId: string, address: string, extra: Record<string, unknown> = {}) => {
  const { sub = `web3:solana:${address}`, ...claims } = extra
  return {
    id: userId,
    identities: [
      {
        id: randomUUID(),
        provider: 'web3',
        provider_id: `web3:solana:${address}`,
        user_id: userId,
        identity_data: {
          sub,
          custom_claims: { chain: 'solana', address, network: 'solana:devnet', ...claims }
        }
      }
    ]
  }
}
const servers: TestServer[] = []
afterEach(async () => {
  for (const ts of servers.splice(0)) await ts.server.close()
  vi.restoreAllMocks()
})

async function setup() {
  const primary = randomUUID(),
    wallet = randomUUID(),
    key = fixture()
  const factors = new Set<string>()
  const profiles = new MemoryProfileStore()
  const identities = new MemoryIdentityStore(profiles, {
    hasVerifiedFactor: async (id) => factors.has(id)
  })
  let data: unknown = authUser(wallet, key.address)
  const ts = await startTestServer(
    { solana: { uri, chainId: 'solana:devnet', allowedOrigins: ['http://localhost:5173'] } },
    {
      profiles,
      identities,
      walletAuth: { getUser: async () => data }
    }
  )
  servers.push(ts)
  const primaryToken = await ts.auth.mint(primary)
  const walletToken = await ts.auth.mint(wallet)
  const post = async (path: string, token: string, body: unknown, headers = {}) => {
    const response = await fetch(`${ts.httpUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    })
    return {
      status: response.status,
      headers: response.headers,
      body: (await response.json()) as Record<string, unknown>
    }
  }
  const issue = async (token = primaryToken) => {
    const result = await post('/auth/solana/challenge', token, {})
    expect(result.status).toBe(200)
    return result.body as unknown as ChallengeResponse
  }
  const linkBody = (issued: ChallengeResponse, token = walletToken) => {
    const message = formatSignInMessage(key.address, { ...issued, requestId: issued.id })
    return {
      challengeId: issued.id,
      walletAccessToken: token,
      message,
      signature: key.sign(message)
    }
  }
  return {
    ts,
    primary,
    wallet,
    key,
    factors,
    profiles,
    identities,
    primaryToken,
    walletToken,
    post,
    issue,
    linkBody,
    setAuthUser: (value: unknown) => {
      data = value
    }
  }
}

describe('authenticated Solana linking HTTP', () => {
  it('keeps MFA metadata available before wallet linking is configured', async () => {
    const primary = randomUUID()
    const profiles = new MemoryProfileStore()
    const identities = new MemoryIdentityStore(profiles, {
      hasVerifiedFactor: async (id) => id === primary
    })
    const ts = await startTestServer(
      { solana: { allowedOrigins: ['https://email.metarchy.test'] } },
      { profiles, identities }
    )
    servers.push(ts)
    const token = await ts.auth.mint(primary)
    const metadata = await fetch(`${ts.httpUrl}/auth/wallets`, {
      headers: { authorization: `Bearer ${token}`, origin: 'https://localhost' }
    })
    expect(metadata.status).toBe(200)
    expect(await metadata.json()).toEqual({ userId: primary, requiresMfa: true, wallets: [] })
    const browserMetadata = await fetch(`${ts.httpUrl}/auth/wallets`, {
      headers: { authorization: `Bearer ${token}`, origin: 'https://email.metarchy.test' }
    })
    expect(browserMetadata.status).toBe(200)
    expect(browserMetadata.headers.get('access-control-allow-origin')).toBe(
      'https://email.metarchy.test'
    )
    const response = await fetch(`${ts.httpUrl}/auth/solana/challenge`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}'
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('not configured')
    })
  })

  it('shows the wallet-first player own address from authoritative Auth identity', async () => {
    const s = await setup()
    const metadata = await fetch(`${s.ts.httpUrl}/auth/wallets`, {
      headers: { authorization: `Bearer ${s.walletToken}` }
    })
    expect(metadata.status).toBe(200)
    expect(await metadata.json()).toMatchObject({
      userId: s.wallet,
      wallets: [{ address: s.key.address, authUserId: s.wallet, loginEnabled: true }]
    })
  })

  it('blocks link activation without account-wide MFA policy and checks MFA on standalone wallet logins', async () => {
    const primary = randomUUID(),
      key = fixture(),
      profiles = new MemoryProfileStore()
    const identities = new MemoryIdentityStore(profiles)
    const data = { ...authUser(primary, key.address), factors: [{ status: 'verified' }] }
    const ts = await startTestServer(
      { solana: { uri, allowedOrigins: [] } },
      { profiles, identities, walletAuth: { getUser: async () => data } }
    )
    servers.push(ts)
    const token = await ts.auth.mint(primary)
    const response = await fetch(`${ts.httpUrl}/auth/solana/challenge`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}'
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('MFA policy') })
    const metadata = await fetch(`${ts.httpUrl}/auth/wallets`, {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(await metadata.json()).toMatchObject({ requiresMfa: true })
    const client = await TestClient.connect(ts.wsUrl)
    expect((await client.hello(token)).t).toBe('error')
    await client.waitClose()
    const verified = await TestClient.connect(ts.wsUrl)
    expect((await verified.hello(await ts.auth.mint(primary, { aal: 'aal2' }))).t).toBe('welcome')
    verified.close()
  })

  it('keeps email-granted cosmetics in the game wallet after linked-wallet login', async () => {
    const s = await setup()
    const [email, gifts] = [GRANTED_EMAIL, GIFTS]
    const primaryToken = await s.ts.auth.mint(s.primary, { email })
    const primary = await TestClient.connect(s.ts.wsUrl)
    await primary.hello(primaryToken)
    primary.send({ t: 'wallet.get' })
    expect((await primary.expect('wallet')).p.owned).toEqual(expect.arrayContaining([...gifts]))
    primary.close()
    const issued = await s.issue(primaryToken)
    expect((await s.post('/auth/solana/link', primaryToken, s.linkBody(issued))).status).toBe(200)
    const wallet = await TestClient.connect(s.ts.wsUrl)
    await wallet.hello(s.walletToken)
    wallet.send({ t: 'wallet.get' })
    expect((await wallet.expect('wallet')).p.owned).toEqual(expect.arrayContaining([...gifts]))
    wallet.close()
  })

  it('keeps auth paths as JSON APIs when the server also hosts a SPA', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'metarchy-wallet-spa-'))
    let ts: TestServer | undefined
    try {
      await writeFile(join(directory, 'index.html'), '<html>Metarchy client</html>')
      ts = await startTestServer({ staticDir: directory })
      const page = await fetch(`${ts.httpUrl}/profile`)
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('Metarchy client')
      const unknownApi = await fetch(`${ts.httpUrl}/auth/unknown`)
      expect(unknownApi.status).toBe(404)
      expect(unknownApi.headers.get('content-type')).toContain('json')
      const missingToken = await fetch(`${ts.httpUrl}/auth/wallets`)
      expect(missingToken.status).toBe(401)
      expect(missingToken.headers.get('content-type')).toContain('json')
    } finally {
      await ts?.server.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('links a fresh wallet, consumes its proof, and opens the existing profile on wallet login', async () => {
    const s = await setup()
    const client = await TestClient.connect(s.ts.wsUrl)
    await client.hello(s.primaryToken)
    client.close()
    await s.profiles.rename(s.primary, 'PreservedPlayer')
    const issued = await s.issue()
    expect(issued.statement).toContain(s.primary)
    expect(Date.parse(issued.expirationTime) - Date.parse(issued.issuedAt)).toBe(300_000)
    expect(issued.uri).toBe(uri)
    const body = s.linkBody(issued)
    expect((await s.post('/auth/solana/link', s.primaryToken, body)).status).toBe(200)
    expect((await s.post('/auth/solana/link', s.primaryToken, body)).status).toBe(409)
    const metadata = await fetch(`${s.ts.httpUrl}/auth/wallets`, {
      headers: { authorization: `Bearer ${s.walletToken}` }
    })
    expect(await metadata.json()).toMatchObject({
      userId: s.primary,
      requiresMfa: false,
      wallets: [{ address: s.key.address, authUserId: s.wallet, loginEnabled: true }]
    })
    const walletClient = await TestClient.connect(s.ts.wsUrl)
    const welcome = await walletClient.hello(s.walletToken)
    expect(welcome.t === 'welcome' && welcome.p.profile).toMatchObject({
      userId: s.primary,
      nickname: 'PreservedPlayer'
    })
    walletClient.close()
  })

  it('rejects bad tokens, signatures, wrong-primary requests, and identity mismatches', async () => {
    const s = await setup()
    expect((await s.post('/auth/solana/challenge', 'garbage', {})).status).toBe(401)
    const issued = await s.issue(),
      body = s.linkBody(issued)
    expect(
      (await s.post('/auth/solana/link', s.primaryToken, { ...body, walletAccessToken: 'garbage' }))
        .status
    ).toBe(401)
    expect(
      (
        await s.post('/auth/solana/link', s.primaryToken, {
          ...body,
          signature: Buffer.alloc(64).toString('base64')
        })
      ).status
    ).toBe(400)
    expect(
      (await s.post('/auth/solana/link', await s.ts.auth.mint(randomUUID()), body)).status
    ).toBe(400)
    s.setAuthUser(authUser(s.wallet, fixture().address))
    expect((await s.post('/auth/solana/link', s.primaryToken, body)).status).toBe(400)
    s.setAuthUser({ ...authUser(s.wallet, s.key.address), id: randomUUID() })
    expect((await s.post('/auth/solana/link', s.primaryToken, body)).status).toBe(400)
    s.setAuthUser({
      id: s.wallet,
      user_metadata: { chain: 'solana', address: s.key.address },
      identities: []
    })
    expect((await s.post('/auth/solana/link', s.primaryToken, body)).status).toBe(400)
    s.setAuthUser(authUser(s.wallet, s.key.address))
    expect((await s.post('/auth/solana/link', s.primaryToken, body)).status).toBe(200)
  })

  it('rejects changed requestId, domain, and expired challenges', async () => {
    const s = await setup()
    const issued = await s.issue()
    for (const changed of [
      { ...issued, requestId: s.primary },
      { ...issued, uri: 'https://attacker.test/' }
    ]) {
      const message = formatSignInMessage(s.key.address, changed)
      expect(
        (
          await s.post('/auth/solana/link', s.primaryToken, {
            challengeId: issued.id,
            walletAccessToken: s.walletToken,
            message,
            signature: s.key.sign(message)
          })
        ).status
      ).toBe(400)
    }
    const old = {
      ...createSignInRequest(
        uri,
        `Link a Solana wallet to Metarchy player ${s.primary}.`,
        'solana:devnet'
      ),
      issuedAt: new Date(Date.now() - 600_000).toISOString(),
      expirationTime: new Date(Date.now() - 300_000).toISOString()
    }
    const id = randomUUID()
    await s.identities.saveChallenge({
      id,
      primaryAuthUserId: s.primary,
      userId: s.primary,
      request: { ...old, requestId: id }
    })
    expect(
      (await s.post('/auth/solana/link', s.primaryToken, s.linkBody({ ...old, id }))).status
    ).toBe(400)
  })

  it('allows aal1 policy reads, blocks game/challenge/link without required MFA and a wallet factor', async () => {
    const s = await setup()
    s.factors.add(s.primary)
    const metadata = await fetch(`${s.ts.httpUrl}/auth/wallets`, {
      headers: { authorization: `Bearer ${s.primaryToken}` }
    })
    expect(metadata.status).toBe(200)
    expect(await metadata.json()).toMatchObject({ requiresMfa: true })
    expect((await s.post('/auth/solana/challenge', s.primaryToken, {})).status).toBe(403)
    const client = await TestClient.connect(s.ts.wsUrl)
    const failure = await client.hello(s.primaryToken)
    expect(failure.t === 'error' && failure.p.message).toMatch(/mfa/i)
    await client.waitClose()
    const primaryAal2 = await s.ts.auth.mint(s.primary, { aal: 'aal2' })
    const walletAal2 = await s.ts.auth.mint(s.wallet, { aal: 'aal2' })
    const issued = await s.issue(primaryAal2)
    expect(
      (await s.post('/auth/solana/link', primaryAal2, s.linkBody(issued, walletAal2))).status
    ).toBe(403)
    s.factors.add(s.wallet)
    expect((await s.post('/auth/solana/link', primaryAal2, s.linkBody(issued))).status).toBe(403)
    expect(
      (await s.post('/auth/solana/link', primaryAal2, s.linkBody(issued, walletAal2))).status
    ).toBe(200)
    const walletClient = await TestClient.connect(s.ts.wsUrl)
    expect((await walletClient.hello(s.walletToken)).t).toBe('error')
    await walletClient.waitClose()
  })

  it('permits configured native and dev origins with exact CORS and browser identity URIs', async () => {
    const s = await setup()
    const browser = await s.post(
      '/auth/solana/challenge',
      s.primaryToken,
      {},
      { origin: 'http://localhost:5173' }
    )
    expect(browser.status).toBe(200)
    expect(browser.body.uri).toBe('http://localhost:5173/')
    expect(browser.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    const native = await s.post(
      '/auth/solana/challenge',
      s.primaryToken,
      {},
      { origin: 'https://localhost' }
    )
    expect(native.status).toBe(200)
    expect(native.body.uri).toBe(uri)
    const evil = await s.post(
      '/auth/solana/challenge',
      s.primaryToken,
      {},
      { origin: 'https://evil.test' }
    )
    expect(evil.status).toBe(403)
    expect(evil.headers.get('access-control-allow-origin')).toBeNull()
    const preflight = await fetch(`${s.ts.httpUrl}/auth/solana/link`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://localhost',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type'
      }
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://localhost')
  })

  it('bounds request bodies and authentication attempts and returns JSON for unknown auth routes', async () => {
    const s = await setup()
    const large = await s.post('/auth/solana/link', s.primaryToken, { padding: 'x'.repeat(20_000) })
    expect(large.status).toBe(413)
    const missing = await fetch(`${s.ts.httpUrl}/auth/does-not-exist`)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('content-type')).toContain('json')
    const replies = await Promise.all(
      Array.from({ length: 50 }, () => s.post('/auth/solana/challenge', 'bad-token', {}))
    )
    expect(replies.some((r) => r.status === 429)).toBe(true)
  })
})

describe('authoritative wallet identities', () => {
  it('keeps default local email authentication available without Solana linking configured', async () => {
    const ts = await startTestServer()
    servers.push(ts)
    const token = await ts.auth.mint(randomUUID())
    const response = await fetch(`${ts.httpUrl}/auth/wallets`, {
      headers: { authorization: `Bearer ${token}`, origin: 'http://localhost:5173' }
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(await response.json()).toMatchObject({ requiresMfa: false })
  })

  it('does not pool authenticated players behind the same proxy into an IP limit', async () => {
    const ts = await startTestServer()
    servers.push(ts)
    const tokens = await Promise.all(Array.from({ length: 45 }, () => ts.auth.mint(randomUUID())))
    const responses = await Promise.all(
      tokens.map((token) =>
        fetch(`${ts.httpUrl}/auth/wallets`, {
          headers: { authorization: `Bearer ${token}` }
        })
      )
    )
    expect(responses.every((response) => response.status === 200)).toBe(true)
  })

  it('accepts Supabase web3 custom claims and rejects user metadata and subject mismatches', () => {
    const id = randomUUID(),
      address = fixture().address
    expect(verifiedSolanaIdentity(authUser(id, address), id, 'solana:devnet')).toBe(address)
    expect(() =>
      verifiedSolanaIdentity(
        authUser(id, address, { sub: `web3:solana:${fixture().address}` }),
        id,
        'solana:devnet'
      )
    ).toThrow()
    expect(() =>
      verifiedSolanaIdentity(authUser(id, address, { chain: 'ethereum' }), id, 'solana:devnet')
    ).toThrow()
    expect(() =>
      verifiedSolanaIdentity(
        authUser(id, address, { network: 'solana:mainnet' }),
        id,
        'solana:devnet'
      )
    ).toThrow()
    expect(() =>
      verifiedSolanaIdentity(
        { id, identities: [], user_metadata: { address, chain: 'solana' } },
        id,
        'solana:devnet'
      )
    ).toThrow()
  })

  it('uses the public API key and wallet bearer token for a fresh Auth user lookup', async () => {
    const data = authUser(randomUUID(), fixture().address)
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }))
    const auth = makeWalletAuth(
      { supabaseUrl: 'https://project.supabase.co', anonKey: 'public-test-key' },
      fetcher
    )
    expect(await auth.getUser('wallet-session')).toEqual(data)
    const [url, options] = fetcher.mock.calls[0]!
    expect(url).toBe('https://project.supabase.co/auth/v1/user')
    expect(options.headers).toMatchObject({
      apikey: 'public-test-key',
      authorization: 'Bearer wallet-session'
    })
    fetcher.mockResolvedValue(new Response('{}', { status: 401 }))
    await expect(auth.getUser('revoked-session')).rejects.toThrow(/authentication/i)
  })
})
