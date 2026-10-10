// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkAccountMfa } from '../src/auth/mfa.js'

function auth(currentLevel: string, nextLevel: string, hasFactor = nextLevel === 'aal2') {
  return {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel, nextLevel },
          error: null
        }),
        listFactors: async () => ({
          data: { all: hasFactor ? [{ id: 'factor', status: 'verified' }] : [] },
          error: null
        })
      }
    }
  } as unknown as SupabaseClient
}
describe('MFA across linked login methods', () => {
  it('requires setup when the canonical account has MFA but the wallet login has no factor', async () => {
    expect(await checkAccountMfa(auth('aal1', 'aal1'), async () => ({ requiresMfa: true }))).toBe(
      'setup'
    )
  })
  it('challenges existing factors and accepts an already verified token', async () => {
    const policy = vi.fn(async () => ({ requiresMfa: true }))
    expect(await checkAccountMfa(auth('aal1', 'aal2'), policy)).toBe('verify')
    expect(await checkAccountMfa(auth('aal2', 'aal2'), policy)).toBe('ok')
    expect(policy).not.toHaveBeenCalled()
  })
  it('never treats a failed MFA policy check as successful verification', async () => {
    await expect(
      checkAccountMfa(auth('aal1', 'aal1'), async () => {
        throw new Error('offline')
      })
    ).rejects.toThrow('offline')
    expect(await checkAccountMfa(auth('aal1', 'aal1'), async () => ({ requiresMfa: false }))).toBe(
      'ok'
    )
  })
  it('requires a new factor after removal even when the old token still reports aal2', async () => {
    expect(
      await checkAccountMfa(auth('aal2', 'aal2', false), async () => ({ requiresMfa: true }))
    ).toBe('setup')
  })
})
