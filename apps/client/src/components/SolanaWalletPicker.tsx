import { useEffect, useState } from 'react'
import type { SolanaWalletChoice } from '@metarchy/chain-solana'
import { getWalletConnector } from '../auth/solana.js'
import { useT } from '../i18n/index.js'

export function SolanaWalletPicker({
  disabled = false,
  onSelect
}: {
  disabled?: boolean
  onSelect(id: string): void
}) {
  const t = useT()
  const [wallets, setWallets] = useState<SolanaWalletChoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    let off: (() => void) | undefined
    setError(null)
    void getWalletConnector()
      .then((connector) => {
        if (cancelled) return
        const refresh = () => setWallets(connector.list())
        refresh()
        off = connector.subscribe(refresh)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
      off?.()
    }
  }, [retry])
  return (
    <div className="solana-wallet-picker" aria-live="polite">
      <p className="hint-text">{t('auth.walletHint')}</p>
      {wallets === null && !error && <p className="hint-text">{t('auth.walletLoading')}</p>}
      {wallets?.map((wallet) => (
        <button
          className="btn secondary wallet-choice"
          key={wallet.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(wallet.id)}
        >
          {wallet.icon && <img src={wallet.icon} width={24} height={24} alt="" />} {wallet.name}
        </button>
      ))}
      {wallets?.length === 0 && <p className="hint-text">{t('auth.walletMissing')}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {(error || wallets?.length === 0) && (
        <button
          className="btn secondary"
          type="button"
          disabled={disabled}
          onClick={() => setRetry((n) => n + 1)}
        >
          {t('auth.walletRefresh')}
        </button>
      )}
    </div>
  )
}
