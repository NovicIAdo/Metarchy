// The deep-link callback parser is the security-relevant part of native OAuth:
// only our scheme is honored, a code wins, provider errors surface verbatim.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }))
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(), close: vi.fn() } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock('../src/supabase.js', () => ({ supabase: { auth: {} } }))

import { NATIVE_REDIRECT, parseAuthCallback } from '../src/native/oauth.js'

describe('parseAuthCallback', () => {
  it('ignores URLs outside our scheme', () => {
    expect(parseAuthCallback('https://evil.example/auth-callback?code=x')).toBeNull()
    expect(parseAuthCallback('com.other.app://auth-callback?code=x')).toBeNull()
  })

  it('extracts the PKCE code from the query', () => {
    expect(parseAuthCallback(`${NATIVE_REDIRECT}?code=abc123`)).toEqual({
      kind: 'code',
      code: 'abc123'
    })
  })

  it('surfaces provider errors, preferring the description', () => {
    expect(
      parseAuthCallback(`${NATIVE_REDIRECT}?error=access_denied&error_description=Nope`)
    ).toEqual({ kind: 'error', message: 'Nope' })
    expect(parseAuthCallback(`${NATIVE_REDIRECT}?error=access_denied`)).toEqual({
      kind: 'error',
      message: 'access_denied'
    })
  })

  it('reads errors that ride the fragment instead of the query', () => {
    expect(parseAuthCallback(`${NATIVE_REDIRECT}#error_description=Link%20expired`)).toEqual({
      kind: 'error',
      message: 'Link expired'
    })
  })

  it('treats an empty callback as a cancelled sign-in', () => {
    expect(parseAuthCallback(NATIVE_REDIRECT)).toEqual({
      kind: 'error',
      message: 'sign-in was cancelled'
    })
  })
})
