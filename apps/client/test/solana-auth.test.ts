// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto'
import {
  addressFromPublicKey,
  formatSignInMessage,
  type SolanaWalletConnector
} from '@metarchy/chain-solana'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { createSolanaAuth } from '../src/auth/solana-service.js'
import { useSessionStore } from '../src/stores/session.js'

const key = generateKeyPairSync('ed25519')
const address = addressFromPublicKey(
  new Uint8Array(key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32))
)
function fixture() {
  const primaryAuth = {
    setSession: vi.fn(async () => ({ data: { session: { user: { id: 'wallet' } } }, error: null })),
    signInWithWeb3: vi.fn(async () => ({
      data: { session: { user: { id: 'wallet' } } },
      error: null
    })),
    getSession: vi.fn(async () => ({
      data: { session: { access_token: 'primary-token', user: { id: 'email' } } },
      error: null
    }))
  }
  const temporaryAuth = {
    dispose: vi.fn(async () => {}),
    signInWithWeb3: vi.fn(async () => ({
      data: {
        session: {
          access_token: 'wallet-token',
          refresh_token: 'wallet-refresh',
          user: { id: 'wallet' }
        }
      },
      error: null
    })),
    getSession: vi.fn(async () => ({
      data: { session: { access_token: 'wallet-token', user: { id: 'wallet' } } },
      error: null
    })),
    signOut: vi.fn(async () => ({ error: null }))
  }
  const connector: SolanaWalletConnector = {
    list: () => [{ id: 'test', name: 'Test' }],
    subscribe: () => () => {},
    disconnect: vi.fn(async () => {}),
    signIn: vi.fn(async (_id, request) => {
      const message = formatSignInMessage(address, request)
      return {
        address,
        message,
        signature: new Uint8Array(sign(null, Buffer.from(message), key.privateKey))
      }
    })
  }
  const issued = Date.now()
  const challenge = {
    id: 'challenge-1',
    ...{
      uri: 'https://metarchy.example/',
      statement: 'Link wallet to player email.',
      nonce: 'abcdefgh12345678',
      issuedAt: new Date(issued).toISOString(),
      expirationTime: new Date(issued + 300_000).toISOString(),
      requestId: 'challenge-1'
    }
  }
  const fetcher = vi.fn(
    async (url: string | URL | Request) =>
      new Response(
        JSON.stringify(
          String(url).endsWith('/challenge')
            ? challenge
            : { userId: 'email', requiresMfa: false, wallets: [] }
        ),
        { status: 200 }
      )
  )
  const service = createSolanaAuth({
    primary: { auth: primaryAuth } as unknown as SupabaseClient,
    createLinkClient: () => ({ auth: temporaryAuth }) as unknown as SupabaseClient,
    connector: async () => connector,
    uri: () => 'https://metarchy.example/',
    chain: 'solana:devnet',
    httpBase: () => 'https://metarchy.example',
    fetcher
  })
  return { service, primaryAuth, temporaryAuth, connector, fetcher }
}

describe('wallet authentication', () => {
  it('creates a normal Supabase session with the selected wallet proof', async () => {
    const f = fixture()
    await f.service.signIn('test')
    expect(f.temporaryAuth.signInWithWeb3).toHaveBeenCalledWith(
      expect.objectContaining({ chain: 'solana', signature: expect.any(Uint8Array) })
    )
    expect(f.primaryAuth.setSession).toHaveBeenCalledWith({
      access_token: 'wallet-token',
      refresh_token: 'wallet-refresh'
    })
    expect(f.primaryAuth.signInWithWeb3).not.toHaveBeenCalled()
    expect(f.temporaryAuth.signOut).not.toHaveBeenCalled()
    expect(f.temporaryAuth.dispose).toHaveBeenCalledOnce()
  })

  it('rejects a bad signature before asking Auth to create a session', async () => {
    const f = fixture()
    vi.mocked(f.connector.signIn).mockResolvedValueOnce({
      address,
      message: 'wrong purpose',
      signature: new Uint8Array(64)
    })
    await expect(f.service.signIn('test')).rejects.toThrow()
    expect(f.primaryAuth.signInWithWeb3).not.toHaveBeenCalled()
    expect(f.primaryAuth.setSession).not.toHaveBeenCalled()
  })

  it('cancels during the Auth exchange without publishing a late session', async () => {
    const f = fixture()
    let resolve!: (value: Awaited<ReturnType<typeof f.temporaryAuth.signInWithWeb3>>) => void
    f.temporaryAuth.signInWithWeb3.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const login = f.service.signIn('test')
    const rejected = expect(login).rejects.toThrow(/cancel/i)
    await vi.waitFor(() => expect(f.temporaryAuth.signInWithWeb3).toHaveBeenCalledOnce())
    f.service.cancelPending()
    await rejected
    resolve({
      data: {
        session: {
          access_token: 'late-token',
          refresh_token: 'late-refresh',
          user: { id: 'wallet' }
        }
      },
      error: null
    })
    await vi.waitFor(() => expect(f.temporaryAuth.signOut).toHaveBeenCalled())
    expect(f.primaryAuth.setSession).not.toHaveBeenCalled()
  })

  it('preserves an account that changes during wallet authentication', async () => {
    const f = fixture()
    f.temporaryAuth.signInWithWeb3.mockImplementationOnce(async () => {
      f.primaryAuth.getSession.mockResolvedValue({
        data: { session: { access_token: 'other-token', user: { id: 'other' } } },
        error: null
      })
      return {
        data: {
          session: {
            access_token: 'wallet-token',
            refresh_token: 'wallet-refresh',
            user: { id: 'wallet' }
          }
        },
        error: null
      }
    })
    await expect(f.service.signIn('test')).rejects.toThrow(/account changed/i)
    expect(f.primaryAuth.setSession).not.toHaveBeenCalled()
  })

  it('links with a temporary session without replacing the primary session', async () => {
    const f = fixture()
    const attempt = await f.service.beginLink('test')
    await attempt.complete()
    expect(f.primaryAuth.signInWithWeb3).not.toHaveBeenCalled()
    expect(f.temporaryAuth.signInWithWeb3).toHaveBeenCalledOnce()
    expect(f.fetcher).toHaveBeenLastCalledWith(
      'https://metarchy.example/auth/solana/link',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer primary-token' }),
        body: expect.stringContaining('wallet-token')
      })
    )
    expect(f.temporaryAuth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('refuses to finish linking after the primary account changes', async () => {
    const f = fixture()
    const attempt = await f.service.beginLink('test')
    f.primaryAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'other', user: { id: 'other' } } },
      error: null
    })
    await expect(attempt.complete()).rejects.toThrow()
    expect(f.fetcher.mock.calls.some(([url]) => String(url).endsWith('/link'))).toBe(false)
    await attempt.cancel()
  })
})

describe('canonical player identity', () => {
  it('keeps canonical game ownership through token refresh and clears it on account switch', () => {
    const store = useSessionStore.getState()
    store.setAuth('wallet-subject', null)
    store.setProfile({ userId: 'email-profile', nickname: 'Player', avatar: null })
    store.setAuth('wallet-subject', null)
    expect(useSessionStore.getState().userId).toBe('email-profile')
    expect(useSessionStore.getState().authUserId).toBe('wallet-subject')
    store.setAuth('other', null)
    expect(useSessionStore.getState().profile).toBeNull()
    expect(useSessionStore.getState().userId).toBe('other')
    store.setAuth(null, null)
    expect(useSessionStore.getState().userId).toBeNull()
  })
})
