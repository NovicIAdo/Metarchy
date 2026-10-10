import type { SupabaseClient } from '@supabase/supabase-js'
import {
  bytesToBase64,
  createSignInRequest,
  verifySignedSignIn,
  type SolanaSignInRequest,
  type SolanaWalletConnector
} from '@metarchy/chain-solana'

export interface WalletAccountStatus {
  userId: string
  requiresMfa: boolean
  wallets: { address: string; authUserId: string; linkedAt: string; loginEnabled: boolean }[]
}
export interface WalletLinkAttempt {
  client: SupabaseClient
  address: string
  requiresMfa: boolean
  complete(): Promise<void>
  cancel(): Promise<void>
}

export function createSolanaAuth(options: {
  primary: SupabaseClient
  createLinkClient: () => SupabaseClient
  connector: () => Promise<SolanaWalletConnector>
  uri: () => string
  chain: string
  httpBase: () => string
  fetcher?: typeof fetch
}) {
  const fetcher = options.fetcher ?? fetch
  let busy = false
  let pendingLogin: { cancel: () => void } | undefined
  async function primarySession() {
    const { data, error } = await options.primary.auth.getSession()
    if (error) throw error
    if (!data.session) throw new Error('Sign in before linking a wallet')
    return data.session
  }
  async function api<T>(path: string, token: string, body?: unknown): Promise<T> {
    const response = await fetcher(`${options.httpBase()}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000)
    })
    const result = (await response.json()) as T & { error?: string; message?: string }
    if (!response.ok) throw new Error(result.message ?? result.error ?? 'Wallet request failed')
    return result
  }
  return {
    cancelPending(): void {
      pendingLogin?.cancel()
    },
    async signIn(walletId: string, onCommit?: () => void): Promise<void> {
      if (busy) throw new Error('Another wallet request is in progress')
      busy = true
      let cancelled = false
      let rejectCancellation!: (error: Error) => void
      const cancellation = new Promise<never>((_, reject) => {
        rejectCancellation = reject
      })
      const operation = {
        cancel: () => {
          cancelled = true
          rejectCancellation(new Error('Wallet sign-in was cancelled'))
        }
      }
      pendingLogin = operation
      const wait = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, cancellation])
      let client: SupabaseClient | undefined
      let finished = false
      let exchangeStarted = false
      let exchangeSettled = false
      let sessionPromoted = false
      const cleanup = () => {
        if (!client) return
        if (sessionPromoted) {
          // The primary owns these same tokens now. Logout would revoke its
          // refresh token; dispose only the isolated client's local resources.
          void client.auth.dispose().catch(() => {})
        } else {
          const isolated = client
          void isolated.auth
            .signOut({ scope: 'local' })
            .catch(() => {})
            .finally(() => isolated.auth.dispose())
            .catch(() => {})
        }
      }
      try {
        const initial = await wait(options.primary.auth.getSession())
        if (initial.error) throw initial.error
        const connector = await wait(options.connector())
        const request = createSignInRequest(options.uri(), 'Sign in to Metarchy.', options.chain)
        const proof = await wait(connector.signIn(walletId, request))
        verifySignedSignIn(proof, request)
        client = options.createLinkClient()
        exchangeStarted = true
        const exchange = client.auth.signInWithWeb3({
          chain: 'solana',
          message: proof.message,
          signature: proof.signature
        })
        // The SDK may save an isolated session after cancellation. Dispose that
        // late session without ever touching the primary account.
        void exchange.then(
          () => {
            exchangeSettled = true
            if (finished) cleanup()
          },
          () => {
            exchangeSettled = true
            if (finished) cleanup()
          }
        )
        const { data, error } = await wait(exchange)
        if (error) throw error
        if (!data.session) throw new Error('Wallet sign-in did not create a session')
        const current = await wait(options.primary.auth.getSession())
        if (current.error) throw current.error
        if (current.data.session?.user.id !== initial.data.session?.user.id)
          throw new Error('The signed-in account changed. Start wallet sign-in again.')
        if (cancelled) throw new Error('Wallet sign-in was cancelled')
        // Session promotion is the commit point: the UI stops offering cancel
        // before the primary SDK broadcasts the accepted login.
        pendingLogin = undefined
        onCommit?.()
        const promoted = await options.primary.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token
        })
        if (promoted.error) throw promoted.error
        if (!promoted.data.session) throw new Error('Wallet sign-in did not create a session')
        sessionPromoted = true
      } finally {
        finished = true
        if (pendingLogin === operation) pendingLogin = undefined
        if (!exchangeStarted || exchangeSettled) cleanup()
        busy = false
      }
    },
    async wallets(): Promise<WalletAccountStatus> {
      const session = await primarySession()
      return api('/auth/wallets', session.access_token)
    },
    async beginLink(walletId: string): Promise<WalletLinkAttempt> {
      if (busy) throw new Error('Another wallet request is in progress')
      busy = true
      let client: SupabaseClient | undefined
      try {
        const primary = await primarySession()
        const status = await api<WalletAccountStatus>('/auth/wallets', primary.access_token)
        const challenge = await api<SolanaSignInRequest & { id: string }>(
          '/auth/solana/challenge',
          primary.access_token,
          {}
        )
        if (challenge.uri !== options.uri())
          throw new Error('Wallet app URL does not match the server configuration')
        const request = { ...challenge, requestId: challenge.id }
        if ((await primarySession()).user.id !== primary.user.id)
          throw new Error('The signed-in account changed. Start wallet linking again.')
        const connector = await options.connector()
        const proof = await connector.signIn(walletId, request)
        verifySignedSignIn(proof, request)
        if ((await primarySession()).user.id !== primary.user.id)
          throw new Error('The signed-in account changed. Start wallet linking again.')
        client = options.createLinkClient()
        const { data, error } = await client.auth.signInWithWeb3({
          chain: 'solana',
          message: proof.message,
          signature: proof.signature
        })
        if (error) throw error
        if (!data.session) throw new Error('Wallet authentication failed')
        const linkClient = client
        let closed = false
        const cancel = async () => {
          if (closed) return
          closed = true
          await linkClient.auth.signOut({ scope: 'local' })
        }
        return {
          client: linkClient,
          address: proof.address,
          requiresMfa: status.requiresMfa,
          async complete() {
            if (closed) throw new Error('Wallet linking was cancelled')
            const current = await primarySession()
            if (current.user.id !== primary.user.id)
              throw new Error('The signed-in account changed. Start wallet linking again.')
            verifySignedSignIn(proof, request)
            const wallet = await linkClient.auth.getSession()
            if (wallet.error) throw wallet.error
            if (!wallet.data.session) throw new Error('Wallet session expired')
            await api('/auth/solana/link', current.access_token, {
              challengeId: challenge.id,
              walletAccessToken: wallet.data.session.access_token,
              message: proof.message,
              signature: bytesToBase64(proof.signature)
            })
            await cancel()
          },
          cancel
        }
      } catch (error) {
        await client?.auth.signOut({ scope: 'local' })
        throw error
      } finally {
        busy = false
      }
    }
  }
}
