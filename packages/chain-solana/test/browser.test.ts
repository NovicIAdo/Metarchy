import { ed25519 } from '@noble/curves/ed25519.js'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBrowserSolanaConnector,
  createFreshMobileAuthorizationCache
} from '../src/browser.js'
import { addressFromPublicKey, createSignInRequest, formatSignInMessage } from '../src/index.js'

const secret = new Uint8Array(32).fill(4)
const publicKey = ed25519.getPublicKey(secret)
const account: WalletAccount = {
  address: addressFromPublicKey(publicKey),
  publicKey,
  chains: ['solana:devnet'],
  features: ['solana:signIn', 'solana:signMessage']
}
const request = () =>
  createSignInRequest('https://metarchy.example/', 'Sign in to Metarchy.', 'solana:devnet')

function fixture(signIn = true) {
  const disconnect = vi.fn(async () => {})
  const connect = vi.fn(async () => ({ accounts: [account] }))
  const wallet: Wallet = {
    version: '1.0.0',
    name: 'Test Wallet',
    icon: 'data:image/png;base64,AA==',
    chains: ['solana:devnet'],
    accounts: [account],
    features: {
      'standard:connect': { version: '1.0.0', connect },
      'standard:disconnect': { version: '1.0.0', disconnect },
      ...(signIn
        ? {
            'solana:signIn': {
              version: '1.0.0',
              signIn: vi.fn(async (r: ReturnType<typeof request>) => {
                const signedMessage = new TextEncoder().encode(
                  formatSignInMessage(account.address, r)
                )
                return [{ account, signedMessage, signature: ed25519.sign(signedMessage, secret) }]
              })
            }
          }
        : {
            'solana:signMessage': {
              version: '1.0.0',
              signMessage: vi.fn(async ({ message }: { message: Uint8Array }) => [
                { signedMessage: message, signature: ed25519.sign(message, secret) }
              ])
            }
          })
    }
  }
  let wallets: Wallet[] = [wallet]
  const listeners = new Map<string, () => void>()
  const registry = {
    get: () => wallets,
    on: (event: 'register' | 'unregister', fn: () => void) => {
      listeners.set(event, fn)
      return () => {
        listeners.delete(event)
      }
    }
  }
  const connector = createBrowserSolanaConnector({ registry, chain: 'solana:devnet' })
  return {
    wallet,
    connector,
    connect,
    disconnect,
    registry,
    listeners,
    setWallets: (w: Wallet[]) => {
      wallets = w
    }
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('Wallet Standard connector', () => {
  it.each([true, false])(
    'authenticates a sign-in/sign-message wallet (%s)',
    async (supportsSignIn) => {
      const { connector, connect, disconnect } = fixture(supportsSignIn)
      const choice = connector.list()[0]!
      const proof = await connector.signIn(choice.id, request())
      expect(proof.address).toBe(account.address)
      if (!supportsSignIn) expect(connect).toHaveBeenCalledOnce()
      await connector.disconnect()
      expect(disconnect).toHaveBeenCalledOnce()
    }
  )

  it('discovers new wallets and removes unsupported or unregistered wallets', () => {
    const f = fixture()
    const listener = vi.fn()
    const off = f.connector.subscribe(listener)
    f.setWallets([{ ...f.wallet, name: 'No signing', features: {} }])
    f.listeners.get('unregister')!()
    expect(listener).toHaveBeenCalledOnce()
    expect(f.connector.list()).toEqual([])
    off()
    expect(f.listeners.size).toBe(0)
  })

  it('propagates cancellation and never substitutes an old connected address', async () => {
    const f = fixture(false)
    f.connect.mockRejectedValueOnce(new Error('User rejected'))
    await expect(f.connector.signIn(f.connector.list()[0]!.id, request())).rejects.toThrow(
      'User rejected'
    )
    await expect(f.connector.signIn('missing', request())).rejects.toThrow()
  })

  it('rejects changed signed bytes and mismatched wallet public keys', async () => {
    const f = fixture()
    ;(f.wallet.features as Record<string, unknown>)['solana:signIn'] = {
      version: '1.0.0',
      signIn: async () => [
        {
          account,
          signedMessage: new TextEncoder().encode('another request'),
          signature: new Uint8Array(64)
        }
      ]
    }
    await expect(f.connector.signIn(f.connector.list()[0]!.id, request())).rejects.toThrow()
  })

  it('cancels an unresolved request on disconnect and permits a fresh attempt', async () => {
    const f = fixture()
    const feature = f.wallet.features['solana:signIn'] as { signIn: ReturnType<typeof vi.fn> }
    feature.signIn.mockImplementationOnce(() => new Promise(() => {}))
    const pending = f.connector.signIn(f.connector.list()[0]!.id, request())
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await f.connector.disconnect()
    await rejected
    expect((await f.connector.signIn(f.connector.list()[0]!.id, request())).address).toBe(
      account.address
    )
  })

  it('does not open a signing prompt when a cancelled connection resolves late', async () => {
    const f = fixture(false)
    let resolve: (value: { accounts: WalletAccount[] }) => void = () => {}
    f.connect.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const signMessage = (
      f.wallet.features['solana:signMessage'] as { signMessage: ReturnType<typeof vi.fn> }
    ).signMessage
    const pending = f.connector.signIn(f.connector.list()[0]!.id, request())
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await f.connector.disconnect()
    await rejected
    resolve({ accounts: [account] })
    await new Promise((done) => setTimeout(done, 0))
    expect(signMessage).not.toHaveBeenCalled()
  })

  it('clears authorization restored by a cancelled connection completing late', async () => {
    const f = fixture(false)
    let connected = false
    let resolve: (value: { accounts: WalletAccount[] }) => void = () => {}
    f.connect.mockImplementationOnce(() =>
      new Promise<{ accounts: WalletAccount[] }>((done) => {
        resolve = done
      }).then((value) => {
        connected = true
        return value
      })
    )
    f.disconnect.mockImplementation(async () => {
      connected = false
    })
    const pending = f.connector.signIn(f.connector.list()[0]!.id, request())
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await f.connector.disconnect()
    await rejected
    resolve({ accounts: [account] })
    await new Promise((done) => setTimeout(done, 0))
    expect(connected).toBe(false)
    expect(f.disconnect.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('serializes wallet teardown before permitting another prompt', async () => {
    const f = fixture()
    await f.connector.signIn(f.connector.list()[0]!.id, request())
    let release: () => void = () => {}
    f.disconnect.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done
        })
    )
    const clearing = f.connector.disconnect()
    await expect(f.connector.signIn(f.connector.list()[0]!.id, request())).rejects.toThrow(
      'in progress'
    )
    release()
    await clearing
  })

  it('clears late restored authorization even when the cancelled signing request rejects', async () => {
    const f = fixture(false)
    let connected = true
    let reject: (error: Error) => void = () => {}
    let started: () => void = () => {}
    const signing = new Promise<void>((done) => {
      started = done
    })
    const feature = f.wallet.features['solana:signMessage'] as {
      signMessage: ReturnType<typeof vi.fn>
    }
    feature.signMessage.mockImplementationOnce(() => {
      started()
      return new Promise((_done, fail) => {
        reject = fail
      }).catch((error: unknown) => {
        connected = true
        throw error
      })
    })
    f.disconnect.mockImplementation(async () => {
      connected = false
    })
    const pending = f.connector.signIn(f.connector.list()[0]!.id, request())
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await signing
    await f.connector.disconnect()
    await rejected
    reject(new Error('Wallet rejected signing after reauthorization'))
    await new Promise((done) => setTimeout(done, 0))
    expect(connected).toBe(false)
  })

  it('uses message signing only for an explicitly unsupported mobile SIWS result', async () => {
    const f = fixture(false)
    ;(
      f.wallet.features['solana:signMessage'] as { signMessage: ReturnType<typeof vi.fn> }
    ).signMessage.mockImplementation(async ({ message }: { message: Uint8Array }) => {
      const signature = ed25519.sign(message, secret)
      const signedMessage = new Uint8Array(message.length + signature.length)
      signedMessage.set(message)
      signedMessage.set(signature, message.length)
      return [{ signedMessage, signature }]
    })
    f.setWallets([
      {
        ...f.wallet,
        name: 'Mobile Wallet Adapter',
        features: {
          ...f.wallet.features,
          'solana:signIn': {
            version: '1.0.0',
            signIn: async () => {
              throw new Error('Sign in failed, no sign in result returned by wallet')
            }
          }
        }
      }
    ])
    expect((await f.connector.signIn(f.connector.list()[0]!.id, request())).address).toBe(
      account.address
    )
  })

  it.each(['Phantom', 'Solflare'])(
    'supports guarded legacy %s injection and rejects unknown generic providers',
    async (name) => {
      const f = fixture()
      f.setWallets([])
      const key = { toBytes: () => publicKey }
      const provider = {
        isPhantom: name === 'Phantom',
        isSolflare: name === 'Solflare',
        publicKey: key,
        connect: async () => ({ publicKey: key }),
        disconnect: vi.fn(async () => {}),
        signMessage: async (message: Uint8Array) => ({
          signature: ed25519.sign(message, secret),
          publicKey: key
        })
      }
      vi.stubGlobal(
        'window',
        name === 'Phantom'
          ? { phantom: { solana: provider }, solana: { ...provider, isPhantom: false } }
          : { solflare: provider }
      )
      const choice = f.connector.list()[0]!
      expect(choice.name).toBe(name)
      expect((await f.connector.signIn(choice.id, request())).address).toBe(account.address)
      await f.connector.disconnect()
      expect(provider.disconnect).toHaveBeenCalledOnce()
      vi.stubGlobal('window', { solana: provider })
      expect(f.connector.list()).toEqual([])
    }
  )

  it('never caches a previous mobile SIWS authorization result', async () => {
    const cache = createFreshMobileAuthorizationCache()
    await cache.set({ sign_in_result: { signed_message: 'old nonce' } } as never)
    expect(await cache.get()).toBeUndefined()
    await cache.clear()
    expect(await cache.get()).toBeUndefined()
  })
})
