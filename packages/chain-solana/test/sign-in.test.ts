import { ed25519 } from '@noble/curves/ed25519.js'
import { createSignInMessage } from '@solana/wallet-standard-util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addressFromPublicKey,
  base64ToBytes,
  bytesToBase64,
  createSignInRequest,
  verifySignedSignIn,
  type SignedSolanaMessage,
  type SolanaSignInRequest
} from '../src/index.js'

const now = new Date('2026-10-09T15:00:00.000Z')
const secret = new Uint8Array(32).fill(7)
const publicKey = ed25519.getPublicKey(secret)
const request: SolanaSignInRequest = {
  uri: 'https://metarchy.example/',
  statement: 'Sign in to Metarchy.',
  nonce: '0123456789abcdef',
  issuedAt: now.toISOString(),
  expirationTime: new Date(now.getTime() + 300_000).toISOString(),
  chainId: 'solana:devnet'
}

function proof(overrides: Partial<SolanaSignInRequest> = {}): SignedSolanaMessage {
  const address = addressFromPublicKey(publicKey)
  const r = { ...request, ...overrides }
  const messageBytes = createSignInMessage({
    domain: new URL(r.uri).host,
    address,
    version: '1',
    ...r
  })
  return {
    address,
    message: new TextDecoder().decode(messageBytes),
    signature: ed25519.sign(messageBytes, secret)
  }
}

beforeEach(() => vi.useFakeTimers({ now }))
afterEach(() => vi.useRealTimers())

describe('Solana ownership proof', () => {
  it('accepts a valid signature bound to the requested app, nonce and expiration', () => {
    expect(() => verifySignedSignIn(proof(), request)).not.toThrow()
  })

  it('rejects a validly signed message for another app or nonce', () => {
    expect(() => verifySignedSignIn(proof({ uri: 'https://other.example/' }), request)).toThrow()
    expect(() => verifySignedSignIn(proof({ nonce: 'anothernonce1234' }), request)).toThrow()
  })

  it('rejects message tampering and a different selected account', () => {
    const signed = proof()
    expect(() =>
      verifySignedSignIn({ ...signed, message: signed.message + 'x' }, request)
    ).toThrow()
    expect(() =>
      verifySignedSignIn(
        {
          ...signed,
          address: addressFromPublicKey(ed25519.getPublicKey(new Uint8Array(32).fill(8)))
        },
        request
      )
    ).toThrow()
  })

  it('rejects signatures with the wrong length or from the wrong key', () => {
    const signed = proof()
    expect(() =>
      verifySignedSignIn({ ...signed, signature: new Uint8Array(63) }, request)
    ).toThrow()
    expect(() =>
      verifySignedSignIn(
        {
          ...signed,
          signature: ed25519.sign(
            new TextEncoder().encode(signed.message),
            new Uint8Array(32).fill(8)
          )
        },
        request
      )
    ).toThrow()
  })

  it('rejects expired, future and missing-expiration proofs', () => {
    vi.setSystemTime(new Date(now.getTime() + 300_001))
    expect(() => verifySignedSignIn(proof(), request)).toThrow()
    vi.setSystemTime(new Date(now.getTime() - 120_000))
    expect(() => verifySignedSignIn(proof(), request)).toThrow()
    vi.setSystemTime(now)
    const signed = proof()
    const message = signed.message
      .split('\n')
      .filter((line) => !line.startsWith('Expiration Time:'))
      .join('\n')
    expect(() =>
      verifySignedSignIn(
        { ...signed, message, signature: ed25519.sign(new TextEncoder().encode(message), secret) },
        request
      )
    ).toThrow()
  })

  it('binds the account-link purpose and target profile', () => {
    const r = {
      ...request,
      statement: 'Link this wallet to Metarchy account player-1.',
      requestId: 'player-1'
    }
    expect(() =>
      verifySignedSignIn(proof({ statement: r.statement, requestId: 'player-2' }), r)
    ).toThrow()
    expect(() =>
      verifySignedSignIn(proof({ statement: r.statement, requestId: r.requestId }), r)
    ).not.toThrow()
  })
})

describe('sign-in input and byte boundaries', () => {
  it('creates independent unpredictable nonces and five-minute sign-in inputs', () => {
    const a = createSignInRequest(
      'https://metarchy.example/',
      'Sign in to Metarchy.',
      'solana:devnet'
    )
    const b = createSignInRequest(
      'https://metarchy.example/',
      'Sign in to Metarchy.',
      'solana:devnet'
    )
    expect(a.nonce).toMatch(/^[A-Za-z0-9]{32,}$/)
    expect(a.nonce).not.toBe(b.nonce)
    expect(Date.parse(a.expirationTime) - Date.parse(a.issuedAt)).toBe(300_000)
  })

  it('rejects unsafe app URLs and multiline statements', () => {
    expect(() => createSignInRequest('http://public.example/', 'Sign in')).toThrow()
    expect(() =>
      createSignInRequest('https://name:password@metarchy.example/', 'Sign in')
    ).toThrow()
    expect(() =>
      createSignInRequest('https://metarchy.example/', 'Sign in\nNonce: spoof')
    ).toThrow()
    expect(() => createSignInRequest('http://localhost:5173/', 'Sign in')).not.toThrow()
  })

  it('round-trips bytes and rejects malformed base64 and public keys', () => {
    const bytes = new Uint8Array([0, 1, 128, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
    expect(() => base64ToBytes('!invalid!')).toThrow()
    expect(() => addressFromPublicKey(new Uint8Array(31))).toThrow()
  })
})
