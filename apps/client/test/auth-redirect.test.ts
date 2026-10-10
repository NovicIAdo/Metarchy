import { describe, expect, it } from 'vitest'
import { parseAuthRedirectError } from '../src/authRedirect.js'

describe('parseAuthRedirectError', () => {
  it('explains an expired/consumed confirmation link', () => {
    const msg = parseAuthRedirectError(
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb='
    )
    expect(msg).toMatch(/expired or was already used/i)
    expect(msg).toMatch(/try signing in/i)
  })

  it('falls back to the decoded error description', () => {
    const msg = parseAuthRedirectError(
      '#error=server_error&error_code=unexpected_failure&error_description=Something+went+wrong'
    )
    expect(msg).toBe('Something went wrong')
  })

  it('ignores hashes without an auth error', () => {
    expect(parseAuthRedirectError('')).toBeNull()
    expect(parseAuthRedirectError('#')).toBeNull()
    expect(parseAuthRedirectError('#access_token=abc&refresh_token=def')).toBeNull()
    expect(parseAuthRedirectError('#/some/route')).toBeNull()
  })
})
