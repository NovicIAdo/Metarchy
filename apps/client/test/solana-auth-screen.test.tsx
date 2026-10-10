import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  signIn: vi.fn(async () => {}),
  email: vi.fn(async () => ({ error: null }))
}))
vi.mock('../src/auth/solana.js', () => ({
  solanaAuth: { signIn: mocks.signIn },
  getWalletConnector: async () => ({
    list: () => [
      { id: 'phantom', name: 'Phantom' },
      { id: 'mobile', name: 'Seeker / Mobile wallet' }
    ],
    subscribe: () => () => {}
  })
}))
vi.mock('../src/supabase.js', () => ({
  takeAuthRedirectError: () => null,
  supabase: { auth: { signInWithPassword: mocks.email } }
}))
vi.mock('../src/native/oauth.js', () => ({
  AUTH_ERROR_EVENT: 'auth-error',
  isNativePlatform: () => false,
  nativeSignInWith: vi.fn()
}))
vi.mock('../src/i18n/index.js', () => ({ useT: () => (key: string) => key }))
vi.mock('../src/theme.js', () => ({ themeAsset: () => '/logo.png' }))
import { AuthScreen } from '../src/screens/AuthScreen.js'
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
describe('choice of player login', () => {
  it('keeps email login and offers discovered Solana wallets', async () => {
    render(
      <MemoryRouter>
        <AuthScreen />
      </MemoryRouter>
    )
    expect(screen.getByLabelText('auth.email')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'auth.walletChoice' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Phantom' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Seeker / Mobile wallet' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Phantom' }))
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith('phantom', expect.any(Function)))
    expect(mocks.email).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'auth.emailChoice' }))
    expect(screen.getByLabelText('auth.email')).toBeTruthy()
  })
})
