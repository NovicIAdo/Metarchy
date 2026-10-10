// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addressFromPublicKey, type SolanaSignInRequest } from '@metarchy/chain-solana'
import { createNativeSolanaConnector } from '../src/native/solana.js'

const native = vi.hoisted(() => ({ signIn: vi.fn(), disconnect: vi.fn() }))
vi.mock('@capacitor/core', () => ({ registerPlugin: vi.fn(() => native) }))

const options = {
  identityName: 'Metarchy',
  identityIcon: '/favicon.png',
  chain: 'solana:devnet' as const
}
const key = generateKeyPairSync('ed25519')
const publicKey = new Uint8Array(
  key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
)
const address = addressFromPublicKey(publicKey)
let request: SolanaSignInRequest

function messageFor(input: SolanaSignInRequest = request): string {
  return [
    `${new URL(input.uri).host} wants you to sign in with your Solana account:`,
    address,
    '',
    input.statement,
    '',
    `URI: ${input.uri}`,
    'Version: 1',
    ...(input.chainId ? [`Chain ID: ${input.chainId}`] : []),
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expirationTime}`,
    ...(input.requestId ? [`Request ID: ${input.requestId}`] : [])
  ].join('\n')
}

function response(message = messageFor()) {
  return {
    publicKeyBase64: Buffer.from(publicKey).toString('base64'),
    signedMessageBase64: Buffer.from(message).toString('base64'),
    signatureBase64: sign(null, Buffer.from(message), key.privateKey).toString('base64')
  }
}

beforeEach(() => {
  native.signIn.mockReset()
  native.disconnect.mockReset().mockResolvedValue(undefined)
  const issued = Date.now()
  request = {
    uri: 'https://metarchy.example/auth/solana',
    statement: 'Sign in to Metarchy.',
    nonce: 'challenge123456789',
    issuedAt: new Date(issued).toISOString(),
    expirationTime: new Date(issued + 5 * 60_000).toISOString(),
    requestId: 'request-42',
    chainId: 'solana:devnet'
  }
})
afterEach(() => {
  vi.useRealTimers()
})

describe('native Solana connector', () => {
  it('rejects cancellation in the same turn as native proof resolution', async () => {
    let resolve: (value: unknown) => void = () => {}
    native.signIn.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const connector = createNativeSolanaConnector(options)
    const pending = connector.signIn('solana-mobile', request)
    const rejected = expect(pending).rejects.toThrow('cancelled')
    resolve(response())
    queueMicrotask(() => {
      void connector.disconnect()
    })
    await rejected
  })
  it('exposes the Android wallet choice', () => {
    const connector = createNativeSolanaConnector(options)
    expect(connector.list()).toEqual([{ id: 'solana-mobile', name: 'Seeker / Mobile wallet' }])
    expect(connector.subscribe(vi.fn())).toBeTypeOf('function')
  })

  it('binds the public HTTPS identity to the signed challenge and verifies the returned proof', async () => {
    native.signIn.mockResolvedValue(response())
    const proof = await createNativeSolanaConnector(options).signIn('solana-mobile', request)
    expect(native.signIn).toHaveBeenCalledWith({
      identityUri: request.uri,
      ...options,
      statement: request.statement,
      nonce: request.nonce,
      issuedAt: request.issuedAt,
      expirationTime: request.expirationTime,
      requestId: request.requestId,
      chainId: request.chainId
    })
    expect(proof.address).toBe(address)
    expect(proof.message).toBe(messageFor())
    expect(proof.signature).toHaveLength(64)
  })

  it.each([
    ['public key', { publicKeyBase64: Buffer.alloc(31).toString('base64') }],
    ['signature', { signatureBase64: Buffer.alloc(63).toString('base64') }],
    ['missing message', { signedMessageBase64: '' }],
    ['invalid UTF-8', { signedMessageBase64: Buffer.from([0xc3, 0x28]).toString('base64') }],
    ['invalid base64', { signatureBase64: '!not-base64!' }],
    ['non-string data', { publicKeyBase64: 123 }]
  ])('rejects malformed %s before creating an authentication proof', async (_label, invalid) => {
    native.signIn.mockResolvedValue({ ...response(), ...invalid })
    await expect(
      createNativeSolanaConnector(options).signIn('solana-mobile', request)
    ).rejects.toThrow()
  })

  it('rejects an absent native response', async () => {
    native.signIn.mockResolvedValue(undefined)
    await expect(
      createNativeSolanaConnector(options).signIn('solana-mobile', request)
    ).rejects.toThrow()
  })

  it('rejects a signature made by another account', async () => {
    const otherKey = generateKeyPairSync('ed25519')
    native.signIn.mockResolvedValue({
      ...response(),
      signatureBase64: sign(null, Buffer.from(messageFor()), otherKey.privateKey).toString('base64')
    })
    await expect(
      createNativeSolanaConnector(options).signIn('solana-mobile', request)
    ).rejects.toThrow()
  })

  it.each(['nonce', 'uri'] as const)(
    'rejects a valid signature for a different %s',
    async (field) => {
      native.signIn.mockResolvedValue(
        response(
          messageFor({
            ...request,
            [field]: field === 'nonce' ? 'different123' : 'https://evil.example/auth'
          })
        )
      )
      await expect(
        createNativeSolanaConnector(options).signIn('solana-mobile', request)
      ).rejects.toThrow()
    }
  )

  it.each([
    'https://user:pass@metarchy.example/auth',
    'http://metarchy.example/auth',
    'capacitor://localhost'
  ])('rejects a non-public HTTPS identity %s before opening a wallet', async (uri) => {
    await expect(
      createNativeSolanaConnector(options).signIn('solana-mobile', { ...request, uri })
    ).rejects.toThrow()
    expect(native.signIn).not.toHaveBeenCalled()
  })

  it('rejects an unknown wallet choice before opening a wallet', async () => {
    await expect(createNativeSolanaConnector(options).signIn('phantom', request)).rejects.toThrow()
    expect(native.signIn).not.toHaveBeenCalled()
  })

  it.each(['WALLET_CANCELLED', 'WALLET_NOT_FOUND'])(
    'propagates %s and allows a clean retry',
    async (code) => {
      const error = Object.assign(new Error(code), { code })
      native.signIn.mockRejectedValueOnce(error).mockResolvedValueOnce(response())
      const connector = createNativeSolanaConnector(options)
      await expect(connector.signIn('solana-mobile', request)).rejects.toBe(error)
      await expect(connector.signIn('solana-mobile', request)).resolves.toMatchObject({ address })
    }
  )

  it('prevents overlapping native requests across connector instances', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void
    native.signIn.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    const first = createNativeSolanaConnector(options).signIn('solana-mobile', request)
    await expect(
      createNativeSolanaConnector(options).signIn('solana-mobile', request)
    ).rejects.toThrow(/progress/i)
    resolve(response())
    await expect(first).resolves.toMatchObject({ address })
    expect(native.signIn).toHaveBeenCalledTimes(1)
  })

  it('bounds a stalled wallet request and asks the plugin to clear its authorization', async () => {
    vi.useFakeTimers()
    native.signIn.mockReturnValue(new Promise(() => {}))
    const result = expect(
      createNativeSolanaConnector(options).signIn('solana-mobile', request)
    ).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(120_000)
    await result
    expect(native.disconnect).toHaveBeenCalledTimes(1)
    native.signIn.mockResolvedValue(response())
    await expect(
      createNativeSolanaConnector(options).signIn('solana-mobile', request)
    ).resolves.toMatchObject({ address })
  })

  it('disconnect cancels an in-flight proof and ignores a late wallet response', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void
    native.signIn.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    const connector = createNativeSolanaConnector(options)
    const result = expect(connector.signIn('solana-mobile', request)).rejects.toThrow(/cancel/i)
    await connector.disconnect()
    await result
    resolve(response())
    expect(native.disconnect).toHaveBeenCalledTimes(1)
  })

  it('disconnect revokes the native authorization', async () => {
    await createNativeSolanaConnector(options).disconnect()
    expect(native.disconnect).toHaveBeenCalledTimes(1)
  })
})
