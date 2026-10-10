import { getWallets, type Wallets } from '@wallet-standard/app'
import type { Wallet } from '@wallet-standard/base'
import type { AuthorizationCache } from '@solana-mobile/wallet-standard-mobile'
import type { StandardConnectFeature, StandardDisconnectFeature } from '@wallet-standard/features'
import type {
  SolanaSignInFeature,
  SolanaSignMessageFeature
} from '@solana/wallet-standard-features'
import {
  addressFromPublicKey,
  formatSignInMessage,
  verifySignedSignIn,
  type SignedSolanaMessage,
  type SolanaSignInRequest,
  type SolanaWalletConnector
} from './index.js'

type SigningFeatures = Partial<
  SolanaSignInFeature &
    SolanaSignMessageFeature &
    StandardConnectFeature &
    StandardDisconnectFeature
>

interface InjectedProvider {
  publicKey?: unknown
  connect(): Promise<{ publicKey?: unknown } | void>
  signMessage(message: Uint8Array): Promise<Uint8Array | { signature: Uint8Array }>
  disconnect?(): Promise<void>
}
function keyBytes(value: unknown): Uint8Array {
  const key = value as { toBytes?: () => Uint8Array; toBuffer?: () => Uint8Array } | undefined
  const bytes = key?.toBytes?.() ?? key?.toBuffer?.()
  if (!bytes || bytes.length !== 32) throw new Error('Invalid injected wallet public key')
  return new Uint8Array(bytes)
}

const injectedWallets = new WeakMap<object, Wallet>()
/** Only known, explicitly branded injection points; never trust generic window.solana. */
function discoverInjected(): Wallet[] {
  if (typeof window === 'undefined') return []
  const injected = window as unknown as { phantom?: { solana?: unknown }; solflare?: unknown }
  const candidates = [
    ['Phantom', 'isPhantom', injected.phantom?.solana],
    ['Solflare', 'isSolflare', injected.solflare]
  ] as const
  return candidates.flatMap(([name, brand, value]) => {
    if (!value || typeof value !== 'object') return []
    const fields = value as Record<string, unknown>
    if (
      fields[brand] !== true ||
      typeof fields.connect !== 'function' ||
      typeof fields.signMessage !== 'function'
    )
      return []
    let wallet = injectedWallets.get(value)
    if (!wallet) {
      const provider = value as InjectedProvider
      let accounts: Wallet['accounts'] = []
      const features: StandardConnectFeature &
        StandardDisconnectFeature &
        SolanaSignMessageFeature = {
        'standard:connect': {
          version: '1.0.0',
          async connect() {
            const result = await provider.connect()
            const publicKey = keyBytes(result?.publicKey ?? provider.publicKey)
            accounts = [
              {
                address: addressFromPublicKey(publicKey),
                publicKey,
                chains: ['solana:devnet', 'solana:mainnet', 'solana:testnet'],
                features: ['solana:signMessage']
              }
            ]
            return { accounts }
          }
        },
        'standard:disconnect': {
          version: '1.0.0',
          async disconnect() {
            accounts = []
            await provider.disconnect?.()
          }
        },
        'solana:signMessage': {
          version: '1.0.0',
          async signMessage(...inputs) {
            return Promise.all(
              inputs.map(async (input) => {
                const result = await provider.signMessage(input.message)
                if (addressFromPublicKey(keyBytes(provider.publicKey)) !== input.account.address)
                  throw new Error('Wallet account changed during signing')
                const signature = result instanceof Uint8Array ? result : result.signature
                if (!(signature instanceof Uint8Array))
                  throw new Error('Invalid injected wallet signature')
                return {
                  signedMessage: input.message,
                  signature,
                  signatureType: 'ed25519' as const
                }
              })
            )
          }
        }
      }
      wallet = {
        name,
        version: '1.0.0',
        icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
        chains: ['solana:devnet', 'solana:mainnet', 'solana:testnet'],
        features,
        get accounts() {
          return accounts
        }
      }
      injectedWallets.set(value, wallet)
    }
    return [wallet]
  })
}

export function createBrowserSolanaConnector(options: {
  chain: string
  registry?: Pick<Wallets, 'get' | 'on'>
}): SolanaWalletConnector {
  const registry = options.registry ?? getWallets()
  const ids = new WeakMap<Wallet, string>()
  let nextId = 0
  const active = new Set<Wallet>()
  let busy = false
  let generation = 0
  let cancelActive: (() => void) | undefined
  let disconnecting: Promise<void> | undefined
  const latestOperation = new WeakMap<Wallet, number>()
  function teardown(targets: { wallet: Wallet; afterOperation?: number }[]): Promise<void> {
    const previous = disconnecting
    const task = (async () => {
      await previous
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.allSettled(
            targets
              .filter(
                ({ wallet, afterOperation }) =>
                  afterOperation === undefined || latestOperation.get(wallet) === afterOperation
              )
              .map(({ wallet }) =>
                (wallet.features as SigningFeatures)['standard:disconnect']?.disconnect()
              )
          ),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 5_000)
          })
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
    })()
    const queued = task.finally(() => {
      if (disconnecting === queued) disconnecting = undefined
    })
    disconnecting = queued
    return queued
  }
  const wallets = () => {
    const standard = registry.get()
    return [
      ...standard,
      ...discoverInjected().filter((w) => !standard.some((s) => s.name === w.name))
    ].filter((wallet) => {
      const f = wallet.features as SigningFeatures
      return (
        wallet.chains.includes(options.chain as `${string}:${string}`) &&
        (typeof f['solana:signIn']?.signIn === 'function' ||
          (typeof f['solana:signMessage']?.signMessage === 'function' &&
            typeof f['standard:connect']?.connect === 'function'))
      )
    })
  }
  const idFor = (wallet: Wallet) => {
    let id = ids.get(wallet)
    if (!id) {
      id = `wallet-${++nextId}`
      ids.set(wallet, id)
    }
    return id
  }

  async function sign(
    wallet: Wallet,
    request: SolanaSignInRequest,
    current: number
  ): Promise<SignedSolanaMessage> {
    let cleanupQueued = false
    const ensureCurrent = () => {
      if (current === generation) return
      // A provider may restore authorization after our first disconnect. Clean that
      // completion only if no newer attempt has claimed this same wallet.
      if (!cleanupQueued) {
        cleanupQueued = true
        void teardown([{ wallet, afterOperation: current }]).catch(() => {})
      }
      throw new Error('Wallet request was cancelled')
    }
    try {
      ensureCurrent()
      const f = wallet.features as SigningFeatures
      const signIn = f['solana:signIn']
      if (signIn) {
        try {
          const [output] = await signIn.signIn({
            domain: new URL(request.uri).host,
            version: '1',
            ...request
          })
          ensureCurrent()
          if (
            !output ||
            addressFromPublicKey(new Uint8Array(output.account.publicKey)) !==
              output.account.address ||
            (output.signatureType && output.signatureType !== 'ed25519')
          )
            throw new Error('Invalid wallet sign-in response')
          return {
            address: output.account.address,
            message: new TextDecoder('utf-8', { fatal: true }).decode(output.signedMessage),
            signature: output.signature
          }
        } catch (error) {
          ensureCurrent()
          // MWA advertises SIWS even when its selected wallet only implements message signing.
          if (
            wallet.name !== 'Mobile Wallet Adapter' ||
            !(error instanceof Error) ||
            error.message !== 'Sign in failed, no sign in result returned by wallet' ||
            !f['solana:signMessage'] ||
            !f['standard:connect']
          )
            throw error
        }
      }
      ensureCurrent()
      const connected = await f['standard:connect']!.connect()
      ensureCurrent()
      const account = connected.accounts.find(
        (a) =>
          a.chains.includes(options.chain as `${string}:${string}`) &&
          a.features.includes('solana:signMessage')
      )
      if (!account || addressFromPublicKey(new Uint8Array(account.publicKey)) !== account.address)
        throw new Error('No Solana signing account selected')
      const message = new TextEncoder().encode(formatSignInMessage(account.address, request))
      const [output] = await f['solana:signMessage']!.signMessage({ account, message })
      ensureCurrent()
      if (!output || (output.signatureType && output.signatureType !== 'ed25519'))
        throw new Error('Invalid wallet signing response')
      // MWA's message API appends the detached signature. Normalize only that exact
      // SDK representation; modified/prefixed messages from other wallets still fail.
      const bytes = output.signedMessage
      const mobileEnvelope =
        wallet.name === 'Mobile Wallet Adapter' &&
        output.signature.length === 64 &&
        bytes.length === message.length + 64 &&
        message.every((byte, i) => bytes[i] === byte) &&
        output.signature.every((byte, i) => bytes[message.length + i] === byte)
      return {
        address: account.address,
        message: new TextDecoder('utf-8', { fatal: true }).decode(mobileEnvelope ? message : bytes),
        signature: output.signature
      }
    } catch (error) {
      ensureCurrent()
      throw error
    }
  }

  return {
    list: () =>
      wallets().map((wallet) => ({ id: idFor(wallet), name: wallet.name, icon: wallet.icon })),
    subscribe(listener) {
      const offRegister = registry.on('register', listener)
      const offUnregister = registry.on('unregister', listener)
      return () => {
        offRegister()
        offUnregister()
      }
    },
    async signIn(walletId, request) {
      if (busy || disconnecting) throw new Error('Another wallet request is in progress')
      const wallet = wallets().find((w) => idFor(w) === walletId)
      if (!wallet) throw new Error('Wallet is unavailable or does not support Solana signing')
      busy = true
      active.add(wallet)
      const current = ++generation
      latestOperation.set(wallet, current)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const cancelled = new Promise<never>((_resolve, reject) => {
          cancelActive = () => reject(new Error('Wallet request was cancelled'))
        })
        const proof = await Promise.race([
          sign(wallet, request, current),
          cancelled,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error('Wallet request timed out. Please try again.')),
              90_000
            )
          })
        ])
        if (current !== generation) throw new Error('Wallet request was cancelled')
        verifySignedSignIn(proof, request)
        return proof
      } finally {
        if (timer) clearTimeout(timer)
        if (current === generation) {
          ++generation
          busy = false
          cancelActive = undefined
        }
      }
    },
    async disconnect() {
      ++generation
      cancelActive?.()
      cancelActive = undefined
      busy = false
      const connected = [...active]
      active.clear()
      await teardown(connected.map((wallet) => ({ wallet })))
    }
  }
}

let mobileRegistration: Promise<void> | undefined
/** Authorization includes sign_in_result; returning cached results would replay an old nonce. */
export function createFreshMobileAuthorizationCache(): AuthorizationCache {
  return {
    async get() {
      return undefined
    },
    async set(_authorization) {},
    async clear() {}
  }
}
/** Official MWA registers only on supported Android browsers; desktop extensions use Wallet Standard. */
export function registerMobileWallet(
  identity: { name: string; uri: string; icon: string },
  chain: `${string}:${string}`
): Promise<void> {
  mobileRegistration ??= import('@solana-mobile/wallet-standard-mobile')
    .then((mwa) => {
      mwa.registerMwa({
        appIdentity: identity,
        chains: [chain],
        authorizationCache: createFreshMobileAuthorizationCache(),
        chainSelector: mwa.createDefaultChainSelector(),
        onWalletNotFound: async () => {
          throw new Error(
            'Install a Solana wallet such as Seed Vault Wallet, Phantom or Solflare, then try again.'
          )
        }
      })
    })
    .catch((error: unknown) => {
      mobileRegistration = undefined
      throw error
    })
  return mobileRegistration
}
