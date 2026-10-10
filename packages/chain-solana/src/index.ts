export interface SolanaSignInRequest {
  uri: string
  statement: string
  nonce: string
  issuedAt: string
  expirationTime: string
  requestId?: string
  chainId?: string
}
export interface SignedSolanaMessage {
  address: string
  message: string
  signature: Uint8Array
}
export interface SolanaWalletChoice {
  id: string
  name: string
  icon?: string
}
export interface SolanaWalletConnector {
  list(): SolanaWalletChoice[]
  subscribe(listener: () => void): () => void
  signIn(walletId: string, request: SolanaSignInRequest): Promise<SignedSolanaMessage>
  disconnect(): Promise<void>
}
export function addressFromPublicKey(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error('Invalid Solana public key')
  return base58.encode(bytes)
}

export function publicKeyFromAddress(address: string): Uint8Array {
  const bytes = base58.decode(address)
  if (addressFromPublicKey(bytes) !== address) throw new Error('Invalid Solana address')
  return bytes
}

export function base64ToBytes(value: string): Uint8Array {
  const bytes = base64.decode(value)
  if (base64.encode(bytes) !== value) throw new Error('Invalid base64')
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  return base64.encode(bytes)
}

export function validateIdentityUri(uri: string): URL {
  const url = new URL(uri)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error('Wallet sign-in requires an HTTPS app URL')
  }
  return url
}

export function createSignInRequest(
  uri: string,
  statement: string,
  chainId?: string
): SolanaSignInRequest {
  validateIdentityUri(uri)
  if (!statement || /[\r\n]/.test(statement)) throw new Error('Invalid sign-in statement')
  const now = Date.now()
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  return {
    uri,
    statement,
    nonce,
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + 300_000).toISOString(),
    ...(chainId ? { chainId } : {})
  }
}

export function formatSignInMessage(address: string, request: SolanaSignInRequest): string {
  const domain = validateIdentityUri(request.uri).host
  return createSignInMessageText({ domain, address, version: '1', ...request })
}

/** Require the exact request we issued, not merely a valid signature for some SIWS message. */
export function verifySignedSignIn(proof: SignedSolanaMessage, request: SolanaSignInRequest): void {
  const issued = Date.parse(request.issuedAt)
  const expiration = Date.parse(request.expirationTime)
  const now = Date.now()
  if (
    !/^[A-Za-z0-9]{8,}$/.test(request.nonce) ||
    !request.statement ||
    /[\r\n]/.test(request.statement) ||
    !Number.isFinite(issued) ||
    !Number.isFinite(expiration) ||
    issued > now + 60_000 ||
    expiration <= now ||
    expiration <= issued ||
    expiration - issued > 300_000
  ) {
    throw new Error('Invalid or expired wallet sign-in request')
  }
  const publicKey = publicKeyFromAddress(proof.address)
  if (
    proof.message !== formatSignInMessage(proof.address, request) ||
    proof.signature.length !== 64 ||
    !ed25519.verify(proof.signature, new TextEncoder().encode(proof.message), publicKey, {
      zip215: false
    })
  ) {
    throw new Error('Wallet signature does not match this sign-in request')
  }
}
import { ed25519 } from '@noble/curves/ed25519.js'
import { base58, base64 } from '@scure/base'
import { createSignInMessageText } from '@solana/wallet-standard-util'
