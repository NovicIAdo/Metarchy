import type { SupabaseClient } from '@supabase/supabase-js'
export async function checkAccountMfa(
  client: SupabaseClient,
  policy: () => Promise<{ requiresMfa: boolean }>
): Promise<'verify' | 'setup' | 'ok'> {
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  if (!data) throw new Error('Could not check two-factor authentication')
  // An old aal2 token can outlive removal of its factor; nextLevel alone is cached.
  const factors = await client.auth.mfa.listFactors()
  if (factors.error) throw factors.error
  if (factors.data.all.some((factor) => factor.status === 'verified'))
    return data.currentLevel === 'aal2' ? 'ok' : 'verify'
  return (await policy()).requiresMfa ? 'setup' : 'ok'
}
