// The GATO wallet as screen state: balance + owned shop item ids, fetched once
// the socket is online. Buying flows call setWallet with the server's reply
// (shop.buy answers with the updated wallet) instead of refetching.

import { useCallback, useEffect, useState } from 'react'
import { gameSocket } from '../net/socket.js'
import { useSessionStore } from '../stores/session.js'

export interface WalletState {
  balance: number
  owned: string[]
}

export function useWallet(): {
  wallet: WalletState | null
  setWallet(w: WalletState): void
} {
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const [wallet, setWallet] = useState<WalletState | null>(null)

  const refresh = useCallback(async () => {
    try {
      setWallet(await gameSocket.walletGet())
    } catch {
      // Offline/timeout — the screens render a placeholder until the next mount.
    }
  }, [])

  useEffect(() => {
    if (online) void refresh()
  }, [online, refresh])

  return { wallet, setWallet }
}
