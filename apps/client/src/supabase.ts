import { Capacitor } from '@capacitor/core'
import { createClient } from '@supabase/supabase-js'
import { parseAuthRedirectError } from './authRedirect.js'
import { config } from './config.js'

// Captured before createClient — supabase-js owns the hash once it starts
// processing the redirect.
let pendingAuthRedirectError = parseAuthRedirectError(window.location.hash)
if (pendingAuthRedirectError !== null)
  history.replaceState(null, '', window.location.pathname + window.location.search)

/** One-shot: the message belongs to this load's auth screen, not every remount. */
export function takeAuthRedirectError(): string | null {
  const error = pendingAuthRedirectError
  pendingAuthRedirectError = null
  return error
}

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Native OAuth returns through a deep link with a PKCE code (native/oauth.ts);
    // the web keeps the implicit hash flow that authRedirect.ts already handles.
    flowType: Capacitor.isNativePlatform() ? 'pkce' : 'implicit'
  }
})
