import { registerPlugin } from '@capacitor/core'
import {
  addressFromPublicKey,
  base64ToBytes,
  verifySignedSignIn,
  type SolanaSignInRequest,
  type SolanaWalletConnector
} from '@metarchy/chain-solana'

interface NativeSignInInput {
  identityUri: string
  identityName: string
  identityIcon: string
  chain: string
  statement: string
  nonce: string
  issuedAt: string
  expirationTime: string
  requestId?: string
  chainId?: string
}

interface SolanaWalletPlugin {
  signIn(input: NativeSignInInput): Promise<unknown>
  disconnect(): Promise<void>
}

const nativeWallet = registerPlugin<SolanaWalletPlugin>('SolanaWallet')
const REQUEST_TIMEOUT_MS = 95_000
// All connectors share the one Android plugin and wallet activity.
let activeSignIn: { cancel: () => void; cancelled: boolean } | undefined
let disconnecting: Promise<void> | undefined

function walletError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

function bounded<T>(promise: Promise<T>, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout?.()
      reject(walletError('Wallet request timed out. Please try again.', 'WALLET_TIMEOUT'))
    }, REQUEST_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function publicIdentity(uri: string): void {
  const identity = new URL(uri)
  if (
    identity.protocol !== 'https:' ||
    !identity.hostname ||
    identity.username ||
    identity.password ||
    identity.hash
  ) {
    throw walletError('A public HTTPS wallet identity is required.', 'WALLET_INVALID_REQUEST')
  }
}

function decodeResponse(response: unknown, request: SolanaSignInRequest) {
  if (typeof response !== 'object' || response === null)
    throw new Error('Invalid native wallet response')
  const values = response as Record<string, unknown>
  const decode = (name: string, maxLength: number): Uint8Array => {
    const value = values[name]
    if (typeof value !== 'string' || !value || value.length > maxLength)
      throw new Error(`Invalid wallet ${name}`)
    return base64ToBytes(value)
  }
  const publicKey = decode('publicKeyBase64', 44)
  const signature = decode('signatureBase64', 88)
  const messageBytes = decode('signedMessageBase64', 24_000)
  if (
    publicKey.length !== 32 ||
    signature.length !== 64 ||
    messageBytes.length === 0 ||
    messageBytes.length > 16_384
  ) {
    throw new Error('Invalid native wallet proof length')
  }
  const message = new TextDecoder('utf-8', { fatal: true }).decode(messageBytes)
  const proof = { address: addressFromPublicKey(publicKey), message, signature }
  verifySignedSignIn(proof, request)
  return proof
}

export function createNativeSolanaConnector(options: {
  identityName: string
  identityIcon: string
  chain: 'solana:devnet' | 'solana:mainnet' | 'solana:testnet'
}): SolanaWalletConnector {
  return {
    list: () => [{ id: 'solana-mobile', name: 'Seeker / Mobile wallet' }],
    subscribe: () => () => {},
    async signIn(walletId, request) {
      if (walletId !== 'solana-mobile') throw new Error('Unknown mobile wallet choice')
      if (activeSignIn || disconnecting)
        throw walletError('A wallet request is already in progress.', 'WALLET_BUSY')
      publicIdentity(request.uri)
      const operation = { cancelled: false, cancel: () => {} }
      const cancellation = new Promise<never>((_resolve, reject) => {
        operation.cancel = () => {
          operation.cancelled = true
          reject(walletError('Wallet request cancelled.', 'WALLET_CANCELLED'))
        }
      })
      activeSignIn = operation
      try {
        const response = await bounded(
          Promise.race([
            nativeWallet.signIn({
              identityUri: request.uri,
              ...options,
              statement: request.statement,
              nonce: request.nonce,
              issuedAt: request.issuedAt,
              expirationTime: request.expirationTime,
              ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
              ...(request.chainId !== undefined ? { chainId: request.chainId } : {})
            }),
            cancellation
          ]),
          () => {
            void this.disconnect().catch(() => {})
          }
        )
        if (operation.cancelled) throw walletError('Wallet request cancelled.', 'WALLET_CANCELLED')
        const proof = decodeResponse(response, request)
        if (operation.cancelled) throw walletError('Wallet request cancelled.', 'WALLET_CANCELLED')
        return proof
      } finally {
        if (activeSignIn === operation) activeSignIn = undefined
      }
    },
    async disconnect() {
      activeSignIn?.cancel()
      if (!disconnecting) {
        disconnecting = bounded(nativeWallet.disconnect()).finally(() => {
          disconnecting = undefined
        })
      }
      await disconnecting
    }
  }
}
