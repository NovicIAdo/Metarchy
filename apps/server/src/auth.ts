// Supabase JWT verification (architecture/Game-Server.md §9). Key sources, in
// precedence order: inline JWKS (tests/ops) → HS256 secret (legacy projects) →
// remote JWKS from the Supabase project URL.

import type { JWTPayload } from 'jose'
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose'
import type { AuthConfig } from './config.js'

export interface AuthedUser {
  userId: string
  email: string | null
  /** Missing claims are treated as aal1; only the verified JWT can assert aal2. */
  aal?: 'aal1' | 'aal2'
}

export interface TokenVerifier {
  verify(accessToken: string): Promise<AuthedUser>
}

export class AuthError extends Error {}

export function makeTokenVerifier(cfg: AuthConfig): TokenVerifier {
  const issuer = cfg.issuer ?? (cfg.supabaseUrl ? `${cfg.supabaseUrl}/auth/v1` : undefined)
  const options = {
    audience: 'authenticated',
    ...(issuer ? { issuer } : {})
  }

  let verifyToken: (token: string) => Promise<{ payload: JWTPayload }>
  if (cfg.jwksJson) {
    const jwks = createLocalJWKSet(JSON.parse(cfg.jwksJson))
    verifyToken = (token) => jwtVerify(token, jwks, options)
  } else if (cfg.jwtSecret) {
    const secret = new TextEncoder().encode(cfg.jwtSecret)
    verifyToken = (token) => jwtVerify(token, secret, options)
  } else if (cfg.supabaseUrl) {
    const jwks = createRemoteJWKSet(new URL(`${cfg.supabaseUrl}/auth/v1/.well-known/jwks.json`))
    verifyToken = (token) => jwtVerify(token, jwks, options)
  } else {
    throw new Error('auth config needs jwksJson, jwtSecret or supabaseUrl')
  }

  return {
    async verify(accessToken) {
      let payload: JWTPayload
      try {
        payload = (await verifyToken(accessToken)).payload
      } catch (error) {
        throw new AuthError(error instanceof Error ? error.message : 'token verification failed')
      }
      if (typeof payload.sub !== 'string' || payload.sub.length === 0)
        throw new AuthError('token has no subject')
      if (payload.role !== undefined && payload.role !== 'authenticated')
        throw new AuthError(`unexpected role ${String(payload.role)}`)
      return {
        userId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : null,
        aal: payload.aal === 'aal2' ? 'aal2' : 'aal1'
      }
    }
  }
}
