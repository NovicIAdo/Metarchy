// Native (Capacitor) OAuth: Google forbids OAuth inside WebViews, so the sign-in
// happens in the system browser (Custom Tabs) and comes back through the
// com.metarchy.game://auth-callback deep link with a PKCE code. The web build
// never touches any of this — Capacitor.isNativePlatform() gates every entry.

import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../supabase.js'

export const NATIVE_REDIRECT = 'com.metarchy.game://auth-callback'

/** Fired at the auth screen when a callback carries an error instead of a code. */
export const AUTH_ERROR_EVENT = 'metarchy:auth-error'

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform()
}

export type AuthCallback = { kind: 'code'; code: string } | { kind: 'error'; message: string }

/** Pure part of the deep-link handling — unit-testable without Capacitor. */
export function parseAuthCallback(url: string): AuthCallback | null {
  if (!url.startsWith(NATIVE_REDIRECT)) return null
  let params: URLSearchParams
  try {
    const u = new URL(url)
    // Providers answer in the query; supabase errors may ride the fragment.
    params = new URLSearchParams([
      ...new URLSearchParams(u.search),
      ...new URLSearchParams(u.hash.replace(/^#/, ''))
    ])
  } catch {
    return { kind: 'error', message: 'malformed sign-in callback' }
  }
  const code = params.get('code')
  if (code) return { kind: 'code', code }
  const message = params.get('error_description') ?? params.get('error') ?? 'sign-in was cancelled'
  return { kind: 'error', message }
}

/** Open the provider's consent page in the system browser (not the WebView). */
export async function nativeSignInWith(provider: 'google' | 'apple'): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true }
  })
  if (error) throw error
  if (!data.url) throw new Error('no authorization URL from Supabase')
  await Browser.open({ url: data.url })
}

async function handleAppUrl(url: string): Promise<void> {
  const parsed = parseAuthCallback(url)
  if (!parsed) return
  // Custom-tab dismissal is best-effort: it may already be gone.
  await Browser.close().catch(() => undefined)
  if (parsed.kind === 'code') {
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code)
    if (!error) return
    window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT, { detail: error.message }))
    return
  }
  window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT, { detail: parsed.message }))
}

/** Idempotent app-boot hook; a no-op on the web. */
export function wireNativeAuth(): void {
  if (!isNativePlatform()) return
  void App.addListener('appUrlOpen', ({ url }) => {
    void handleAppUrl(url)
  })
}
