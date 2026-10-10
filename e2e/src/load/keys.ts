// Persistent ES256 keys for load runs: the public JWKS goes into the target
// server's SUPABASE_JWKS_JSON secret, the private half stays in a local file so
// every generator worker can mint tokens for its own user population. Same
// verification path as production (jose + JWKS) — no auth bypass.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { JWK } from 'jose'
import { exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose'

export interface LoadKeys {
  issuer: string
  jwksJson: string
  privateJwk: JWK
}

const ISSUER = 'https://loadtest.metarchy.local/auth/v1'
const KID = 'loadtest-key'

export async function generateLoadKeys(): Promise<LoadKeys> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = await exportJWK(publicKey)
  publicJwk.kid = KID
  publicJwk.alg = 'ES256'
  const privateJwk = await exportJWK(privateKey)
  privateJwk.kid = KID
  privateJwk.alg = 'ES256'
  return {
    issuer: ISSUER,
    jwksJson: JSON.stringify({ keys: [publicJwk] }),
    privateJwk
  }
}

export async function saveLoadKeys(path: string, keys: LoadKeys): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(keys, null, 2), { mode: 0o600 })
}

export async function loadLoadKeys(path: string): Promise<LoadKeys> {
  return JSON.parse(await readFile(path, 'utf8')) as LoadKeys
}

export async function loadOrCreateKeys(path: string): Promise<LoadKeys> {
  try {
    return await loadLoadKeys(path)
  } catch {
    const keys = await generateLoadKeys()
    await saveLoadKeys(path, keys)
    return keys
  }
}

/** Token minter over the shared private key; 12h expiry outlives any run. */
export async function makeMinter(keys: LoadKeys): Promise<(userId: string) => Promise<string>> {
  const privateKey = await importJWK(keys.privateJwk, 'ES256')
  return (userId) =>
    new SignJWT({ email: `${userId.slice(0, 8)}@load.metarchy.local`, role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setSubject(userId)
      .setAudience('authenticated')
      .setIssuer(keys.issuer)
      .setIssuedAt()
      .setExpirationTime('12h')
      .sign(privateKey)
}
