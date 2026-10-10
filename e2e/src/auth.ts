// Standalone test-token minting: a local JWKS plus ES256-signed JWTs shaped like
// Supabase access tokens. The server verifies them through its real jose path via
// the SUPABASE_JWKS_JSON / SUPABASE_JWT_ISSUER config escape hatch — no bypass.

import { exportJWK, generateKeyPair, SignJWT } from 'jose'

export interface TestAuth {
  jwksJson: string
  issuer: string
  mint(userId: string, opts?: { role?: string; expiresIn?: string }): Promise<string>
}

export async function makeTestAuth(): Promise<TestAuth> {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const jwk = await exportJWK(publicKey)
  jwk.kid = 'e2e-key'
  jwk.alg = 'ES256'
  const issuer = 'https://e2e.metarchy.local/auth/v1'
  return {
    jwksJson: JSON.stringify({ keys: [jwk] }),
    issuer,
    async mint(userId, opts = {}) {
      return new SignJWT({ email: 'player@e2e.local', role: opts.role ?? 'authenticated' })
        .setProtectedHeader({ alg: 'ES256', kid: 'e2e-key' })
        .setSubject(userId)
        .setAudience('authenticated')
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime(opts.expiresIn ?? '1h')
        .sign(privateKey)
    }
  }
}
