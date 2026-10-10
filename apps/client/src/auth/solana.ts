import { Capacitor } from '@capacitor/core'
import type { SolanaWalletConnector } from '@metarchy/chain-solana'
import { validateIdentityUri } from '@metarchy/chain-solana'
import { createClient } from '@supabase/supabase-js'
import { config, serverHttpBase, solanaAuthUrl, solanaChain } from '../config.js'
import { supabase } from '../supabase.js'
import { createSolanaAuth } from './solana-service.js'

export function walletIdentityUri(): string {
  const uri = Capacitor.isNativePlatform() ? solanaAuthUrl : `${window.location.origin}/`
  const url = validateIdentityUri(uri)
  if (Capacitor.isNativePlatform() && url.protocol !== 'https:')
    throw new Error('Configure the public HTTPS wallet app URL for this mobile build')
  return uri
}

let connector: Promise<SolanaWalletConnector> | undefined
export function getWalletConnector(): Promise<SolanaWalletConnector> {
  connector ??= (async () => {
    const identity = {
      name: 'Metarchy',
      uri: walletIdentityUri(),
      icon: '/themes/cyberpunk/logo.png'
    }
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      const native = await import('../native/solana.js')
      return native.createNativeSolanaConnector({
        identityName: identity.name,
        identityIcon: identity.icon,
        chain: solanaChain
      })
    }
    if (Capacitor.isNativePlatform())
      throw new Error(
        'Solana wallet login is currently available on Android and in compatible browsers'
      )
    const browser = await import('@metarchy/chain-solana/browser')
    await browser.registerMobileWallet(identity, solanaChain)
    return browser.createBrowserSolanaConnector({ chain: solanaChain })
  })().catch((error: unknown) => {
    connector = undefined
    throw error
  })
  return connector
}

export async function disconnectSolanaWallet(): Promise<void> {
  solanaAuth.cancelPending()
  const current = connector
  if (current) await (await current).disconnect()
}

export const solanaAuth = createSolanaAuth({
  primary: supabase,
  createLinkClient: () =>
    createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storageKey: `metarchy-wallet-auth-${crypto.randomUUID()}`,
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }),
  connector: getWalletConnector,
  uri: walletIdentityUri,
  chain: solanaChain,
  httpBase: serverHttpBase
})
