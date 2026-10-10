import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({
  complete: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  updateUser: vi.fn(async () => ({ error: null })),
  wallets: vi.fn(async () => ({
    userId: 'player',
    requiresMfa: false,
    wallets: [
      {
        address: 'SolanaAddress',
        authUserId: 'wallet',
        linkedAt: new Date().toISOString(),
        loginEnabled: true
      }
    ]
  }))
}))
vi.mock('../src/auth/solana.js', () => ({
  solanaAuth: {
    wallets: f.wallets,
    beginLink: async () => ({
      address: 'NewAddress',
      requiresMfa: false,
      complete: f.complete,
      cancel: f.cancel
    })
  },
  getWalletConnector: async () => ({
    list: () => [{ id: 'test', name: 'Phantom' }],
    subscribe: () => () => {}
  })
}))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: { updateUser: f.updateUser } } }))
vi.mock('../src/i18n/index.js', () => ({ useT: () => (key: string) => key }))
import { AddEmailLogin, SolanaAccountPanel } from '../src/components/SolanaAccountPanel.js'
import { useSessionStore } from '../src/stores/session.js'
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
describe('account login methods', () => {
  it('shows an existing address and explicitly links a selected wallet', async () => {
    render(<SolanaAccountPanel />)
    await waitFor(() => expect(screen.getByText('SolanaAddress')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'profile.linkSolana' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Phantom' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Phantom' }))
    await waitFor(() => expect(f.complete).toHaveBeenCalledOnce())
  })
  it("does not update a new account with the previous account's late link completion", async () => {
    useSessionStore.getState().setAuth('old-account', null)
    let resolve!: () => void
    f.complete.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done
        })
    )
    render(<SolanaAccountPanel />)
    await waitFor(() => expect(screen.getByText('SolanaAddress')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'profile.linkSolana' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Phantom' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Phantom' }))
    await waitFor(() => expect(f.complete).toHaveBeenCalledOnce())
    await act(async () => {
      useSessionStore.getState().setAuth('new-account', null)
    })
    await waitFor(() => expect(f.wallets).toHaveBeenCalledTimes(2))
    await act(async () => {
      resolve()
    })
    expect(screen.queryByText('profile.walletLinked')).toBeNull()
    expect(f.wallets).toHaveBeenCalledTimes(2)
    expect(
      screen.getByRole('button', { name: 'profile.linkSolana' }).hasAttribute('disabled')
    ).toBe(false)
  })
  it('adds email/password to the current wallet user only after matching passwords', async () => {
    render(<AddEmailLogin />)
    fireEvent.change(screen.getByLabelText('auth.email'), {
      target: { value: 'player@example.com' }
    })
    fireEvent.change(screen.getByLabelText('profile.newPassword'), {
      target: { value: 'long-password' }
    })
    fireEvent.change(screen.getByLabelText('profile.repeatPassword'), {
      target: { value: 'other-password' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'profile.addEmail' }))
    await waitFor(() => expect(screen.getByText('profile.passwordsDiffer')).toBeTruthy())
    expect(f.updateUser).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('profile.repeatPassword'), {
      target: { value: 'long-password' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'profile.addEmail' }))
    await waitFor(() =>
      expect(f.updateUser).toHaveBeenCalledWith(
        { email: 'player@example.com', password: 'long-password' },
        expect.any(Object)
      )
    )
  })
})
