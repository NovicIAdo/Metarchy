// Supabase redirects failed email links back to the app with the failure in
// the URL fragment: #error=access_denied&error_code=otp_expired&error_description=…
// Confirmation links are single-use, so the common case is a second click.

export function parseAuthRedirectError(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const code = params.get('error_code')
  const description = params.get('error_description')
  if (!code && !description) return null
  if (code === 'otp_expired')
    return 'This confirmation link has expired or was already used — if you clicked it once before, your email is likely confirmed. Try signing in.'
  return description ?? 'The sign-in link could not be processed. Please try again.'
}
