import { randomUUID } from 'node:crypto'
import {
  base64ToBytes,
  createSignInRequest,
  publicKeyFromAddress,
  validateIdentityUri,
  verifySignedSignIn
} from '@metarchy/chain-solana'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthedUser, TokenVerifier } from './auth.js'
import { AuthError } from './auth.js'
import type { AuthConfig, ServerConfig } from './config.js'
import type { IdentityStore } from './identity.js'
import { IdentityError } from './identity.js'

export interface WalletAuth {
  getUser(accessToken: string): Promise<unknown>
}
class WalletHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** Supabase's authenticated user endpoint returns fresh provider identities. */
export function makeWalletAuth(config: AuthConfig, fetcher: typeof fetch = fetch): WalletAuth {
  return {
    async getUser(accessToken) {
      if (!config.supabaseUrl || !config.anonKey)
        throw new WalletHttpError('Solana wallet linking is not configured.', 503)
      let response: Response
      try {
        response = await fetcher(`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
          headers: { apikey: config.anonKey, authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000)
        })
      } catch {
        throw new WalletHttpError(
          'Wallet authentication service is unavailable. Please retry.',
          503
        )
      }
      if (response.status === 401 || response.status === 403)
        throw new AuthError('Wallet authentication session is invalid.')
      if (!response.ok)
        throw new WalletHttpError(
          'Wallet authentication service is unavailable. Please retry.',
          503
        )
      try {
        return await response.json()
      } catch {
        throw new WalletHttpError('Wallet authentication service returned an invalid user.', 503)
      }
    }
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Current-user factor status comes from Auth, never from JWT/user metadata. */
export function verifiedUserHasMfa(userData: unknown, expectedUserId: string): boolean {
  const user = record(userData)
  if (!user || user.id !== expectedUserId)
    throw new AuthError('Auth user does not match the verified session.')
  return (
    Array.isArray(user.factors) &&
    user.factors.some((factor) => record(factor)?.status === 'verified')
  )
}

/** Authoritative identity_data custom claims originate in Supabase Auth's Web3 verifier. */
export function verifiedSolanaIdentity(
  userData: unknown,
  expectedUserId: string,
  chainId?: string
): string {
  const user = record(userData)
  if (!user || user.id !== expectedUserId || !Array.isArray(user.identities))
    throw new WalletHttpError('Wallet Auth identity does not match the verified session.', 400)
  const addresses = new Set<string>()
  for (const raw of user.identities) {
    const identity = record(raw),
      data = record(identity?.identity_data),
      claims = record(data?.custom_claims)
    if (
      !identity ||
      identity.provider !== 'web3' ||
      identity.user_id !== expectedUserId ||
      !data ||
      !claims ||
      claims.chain !== 'solana'
    )
      continue
    if (typeof claims.address !== 'string' || data.sub !== `web3:solana:${claims.address}`) continue
    if (chainId !== undefined && claims.network !== chainId) continue
    if (identity.provider_id !== undefined && identity.provider_id !== data.sub) continue
    if (
      typeof identity.id === 'string' &&
      identity.id.startsWith('web3:') &&
      identity.id !== data.sub
    )
      continue
    try {
      publicKeyFromAddress(claims.address)
      addresses.add(claims.address)
    } catch {
      /* not a canonical Solana address */
    }
  }
  if (addresses.size !== 1)
    throw new WalletHttpError(
      'A verified Solana wallet identity is required for this session.',
      400
    )
  return [...addresses][0]!
}

const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const textField = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

export function registerSolanaAuth(
  fastify: FastifyInstance,
  deps: {
    config: ServerConfig
    identities: IdentityStore
    verifier: TokenVerifier
    walletAuth?: WalletAuth
  }
): void {
  const walletAuth =
    deps.walletAuth ??
    (deps.config.auth.supabaseUrl && deps.config.auth.anonKey
      ? makeWalletAuth(deps.config.auth)
      : undefined)
  const origins = new Set([
    'https://localhost',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...(deps.config.solana?.allowedOrigins ?? [])
  ])
  for (const origin of origins) {
    if (validateIdentityUri(origin).origin !== origin)
      throw new Error('SOLANA_AUTH_ALLOWED_ORIGINS must contain exact HTTPS or local HTTP origins')
  }
  if (deps.config.solana?.uri) origins.add(validateIdentityUri(deps.config.solana.uri).origin)
  const buckets = new Map<string, { started: number; count: number }>()
  const take = (key: string, limit: number): boolean => {
    const now = Date.now()
    if (buckets.size > 10_000) {
      for (const [id, old] of buckets) if (now - old.started >= 60_000) buckets.delete(id)
      if (buckets.size > 10_000 && !buckets.has(key)) return false
    }
    let bucket = buckets.get(key)
    if (!bucket || now - bucket.started >= 60_000) {
      bucket = { started: now, count: 0 }
      buckets.set(key, bucket)
    }
    return ++bucket.count <= limit
  }
  const configured = async (): Promise<string> => {
    if (!deps.config.solana?.uri || !walletAuth)
      throw new WalletHttpError('Solana wallet linking is not configured.', 503)
    if (!(await deps.identities.hasMfaPolicy()))
      throw new WalletHttpError('Wallet linking requires an authoritative MFA policy store.', 503)
    return deps.config.solana.uri
  }
  const authenticate = async (request: FastifyRequest, mutate = false): Promise<AuthedUser> => {
    let user: AuthedUser
    try {
      const header = request.headers.authorization
      if (!header || !/^Bearer [^\s]+$/i.test(header) || header.length > 8_200)
        throw new AuthError('A bearer authentication token is required.')
      user = await deps.verifier.verify(header.slice(7))
    } catch (error) {
      if (!take(`invalid:${request.ip}`, 40))
        throw new WalletHttpError(
          'Too many invalid authentication attempts. Please retry shortly.',
          429
        )
      throw error
    }
    // Verified players behind a shared HTTP proxy receive independent limits.
    if (!take(`${mutate ? 'link' : 'metadata'}:${user.userId}`, mutate ? 12 : 120))
      throw new WalletHttpError('Too many authentication attempts. Please retry shortly.', 429)
    return user
  }

  void fastify.register(
    async (auth) => {
      // These hooks are scoped to /auth; game assets and telemetry keep their own policy.
      auth.addHook('onRequest', async (request, reply) => {
        const origin = request.headers.origin
        if (origin) {
          if (!origins.has(origin))
            throw new WalletHttpError('This origin is not allowed for wallet authentication.', 403)
          reply.header('access-control-allow-origin', origin).header('vary', 'Origin')
        }
        reply.header('cache-control', 'no-store')
      })
      auth.setErrorHandler((error, _request, reply) => {
        const statusCode =
          error &&
          typeof error === 'object' &&
          'statusCode' in error &&
          typeof error.statusCode === 'number'
            ? error.statusCode
            : 500
        const status =
          error instanceof AuthError
            ? 401
            : error instanceof IdentityError || error instanceof WalletHttpError
              ? error.status
              : statusCode >= 400 && statusCode < 500
                ? statusCode
                : 500
        const message =
          status >= 500 && !(error instanceof WalletHttpError)
            ? 'Wallet authentication could not be completed.'
            : error instanceof Error
              ? error.message
              : 'Wallet authentication could not be completed.'
        return reply.code(status).send({ error: message, message })
      })
      auth.options('/*', async (request, reply) => {
        const method = request.headers['access-control-request-method']
        const headers = request.headers['access-control-request-headers']
        if (method && method !== 'GET' && method !== 'POST')
          throw new WalletHttpError('Unsupported authentication method.', 403)
        if (
          typeof headers === 'string' &&
          headers
            .split(',')
            .some((h) => !['authorization', 'content-type'].includes(h.trim().toLowerCase()))
        )
          throw new WalletHttpError('Unsupported authentication request headers.', 403)
        return reply
          .header('access-control-allow-methods', 'GET, POST, OPTIONS')
          .header('access-control-allow-headers', 'Authorization, Content-Type')
          .header('access-control-max-age', '600')
          .code(204)
          .send()
      })
      auth.get('/wallets', async (request) => {
        const principal = await authenticate(request)
        const account = await deps.identities.account(principal.userId)
        if (!walletAuth || account.wallets.some((wallet) => wallet.authUserId === principal.userId))
          return account
        const data = await walletAuth.getUser(request.headers.authorization!.slice(7))
        if (!(await deps.identities.hasMfaPolicy()))
          account.requiresMfa ||= verifiedUserHasMfa(data, principal.userId)
        let address: string
        try {
          address = verifiedSolanaIdentity(data, principal.userId)
        } catch (error) {
          if (error instanceof WalletHttpError && error.status === 400) return account
          throw error
        }
        const rawCreatedAt = record(data)?.created_at
        const createdAt =
          typeof rawCreatedAt === 'string' && Number.isFinite(Date.parse(rawCreatedAt))
            ? new Date(rawCreatedAt).toISOString()
            : new Date().toISOString()
        return {
          ...account,
          wallets: [
            ...account.wallets,
            {
              address,
              authUserId: principal.userId,
              linkedAt: createdAt,
              loginEnabled: !account.requiresMfa || verifiedUserHasMfa(data, principal.userId)
            }
          ]
        }
      })
      auth.post('/solana/challenge', { bodyLimit: 1_024 }, async (request) => {
        const configuredUri = await configured()
        const primary = await authenticate(request, true)
        const profile = await deps.identities.login(primary)
        const id = randomUUID()
        // Native Capacitor has an asset origin; its SIWS identity is the public app.
        // Allowed browser origins sign their actual origin, including local Vite.
        const origin = request.headers.origin
        const uri = origin && origin !== 'https://localhost' ? `${origin}/` : configuredUri
        const signIn = {
          ...createSignInRequest(
            uri,
            `Link a Solana wallet to Metarchy player ${profile.userId}.`,
            deps.config.solana?.chainId ?? 'solana:devnet'
          ),
          requestId: id
        }
        await deps.identities.saveChallenge({
          id,
          primaryAuthUserId: primary.userId,
          userId: profile.userId,
          request: signIn
        })
        return { id, ...signIn }
      })
      auth.post('/solana/link', { bodyLimit: 16 * 1_024 }, async (request) => {
        await configured()
        const primary = await authenticate(request, true)
        const body = record(request.body)
        if (
          !body ||
          !uuid(body.challengeId) ||
          !textField(body.walletAccessToken, 8_192) ||
          !textField(body.message, 4_096) ||
          !textField(body.signature, 88)
        )
          throw new WalletHttpError('Invalid wallet linking request.', 400)
        const wallet = await deps.verifier.verify(body.walletAccessToken)
        const challenge = await deps.identities.challenge(body.challengeId, primary.userId)
        const address = verifiedSolanaIdentity(
          await walletAuth!.getUser(body.walletAccessToken),
          wallet.userId,
          challenge.request.chainId
        )
        try {
          verifySignedSignIn(
            { address, message: body.message, signature: base64ToBytes(body.signature) },
            challenge.request
          )
        } catch {
          throw new WalletHttpError('Wallet signature does not match this linking challenge.', 400)
        }
        return deps.identities.link({ challengeId: body.challengeId, primary, wallet, address })
      })
      // Auth API paths never reach a same-origin SPA fallback.
      const missing = (_request: FastifyRequest, reply: FastifyReply) =>
        reply.code(404).send({ error: 'Authentication route not found.' })
      auth.route({
        method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'TRACE'],
        url: '/*',
        handler: missing
      })
    },
    { prefix: '/auth' }
  )
}
