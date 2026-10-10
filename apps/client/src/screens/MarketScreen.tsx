// The Market: cosmetics changing hands between players for GATO. Distinct from
// the Shop, which sells the catalog at a fixed price and never runs out — here
// the stock is whatever other players put up, and the price is whatever they
// ask. Comments under a lot are the haggling channel the author asked for
// ("снизь цену, возьму этот предмет").
//
// Design and the economics behind it: plan/Market-Plan.md.

import type { MarketCategory, MarketComment, MarketListing } from '@metarchy/protocol'
import { MARKET_CATEGORIES, MARKET_COMMENT_MAX, MARKET_PAGE_SIZE } from '@metarchy/protocol'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar.js'
import { useWallet } from '../hooks/useWallet.js'
import { useDomain } from '../i18n/domain.js'
import { useT } from '../i18n/index.js'
import { ItemArt, itemName } from '../lib/itemDisplay.jsx'
import { gameSocket } from '../net/socket.js'
import { useSessionStore } from '../stores/session.js'
import { themeAsset } from '../theme.js'

export const CATEGORY_LABEL_KEYS: Record<MarketCategory, string> = {
  actorSkin: 'market.cat.actorSkin',
  argumentSkin: 'market.cat.argumentSkin',
  actorItem: 'market.cat.actorItem',
  avatar: 'market.cat.avatar'
}

function GatoPrice({ price }: { price: number }) {
  return (
    <span className="gato-price">
      <img className="gato-coin" src={themeAsset('currency.gato')} alt="" /> {price}
    </span>
  )
}

/**
 * The haggle under one lot. Loaded on open rather than with the shelf: most
 * lots have no thread and a page of twenty would otherwise carry twenty empty
 * ones.
 */
function CommentThread({ listing, onCount }: { listing: MarketListing; onCount(n: number): void }) {
  const t = useT()
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const [rows, setRows] = useState<MarketComment[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    gameSocket
      .marketComments(listing.id)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setRows([]))
    return () => {
      cancelled = true
    }
  }, [listing.id])

  async function post() {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      const next = await gameSocket.marketComment(listing.id, body)
      setRows(next)
      onCount(next.length)
      setDraft('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lot-thread">
      {rows === null && <p className="hint-text">{t('common.loading')}</p>}
      {rows?.length === 0 && <p className="hint-text">{t('market.noComments')}</p>}
      {rows?.map((c) => (
        <p key={c.id} className="lot-comment">
          <span className="lot-comment-who">{c.author.nickname}</span> {c.body}
        </p>
      ))}
      <div className="row">
        <input
          type="text"
          value={draft}
          maxLength={MARKET_COMMENT_MAX}
          placeholder={t('market.commentPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void post()}
        />
        <button
          className="btn"
          style={{ flex: 'none', width: 'auto' }}
          disabled={busy || !online || draft.trim().length === 0}
          onClick={() => void post()}
        >
          {t('market.send')}
        </button>
      </div>
    </div>
  )
}

function LotCard({
  listing,
  balance,
  busy,
  onBuy,
  onCancel,
  onComments
}: {
  listing: MarketListing
  balance: number | null
  busy: boolean
  onBuy(): void
  onCancel(): void
  onComments(n: number): void
}) {
  const t = useT()
  const d = useDomain()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const affordable = balance !== null && balance >= listing.price

  // Why the button is off, most specific reason first — a disabled control with
  // no explanation is the thing players write feedback about.
  const blocked = listing.owned ? t('market.alreadyOwned') : affordable ? null : t('shop.notEnough')

  return (
    <div className="lot-card">
      <div className="lot-art">
        <ItemArt itemId={listing.itemId} />
      </div>
      <div className="lot-main">
        <span className="lot-name">{itemName(listing.itemId, t, d)}</span>
        <span className="lot-seller">
          {listing.mine ? t('market.yours') : listing.seller.nickname}
        </span>
        <div className="lot-links">
          <button className="lot-comments" onClick={() => setOpen((v) => !v)}>
            💬 {listing.comments}
          </button>
          {/* Two ways to reach the seller, and they are not the same thing: a
              comment is public haggling on the lot, a DM is the private half the
              author asked for ("списаться, чтобы обговорить детали"). */}
          {!listing.mine && (
            <button
              className="lot-comments"
              onClick={() => navigate(`/chat?to=${encodeURIComponent(listing.seller.nickname)}`)}
            >
              ✉ {t('market.writeSeller')}
            </button>
          )}
        </div>
      </div>
      <div className="lot-actions">
        <GatoPrice price={listing.price} />
        {listing.mine ? (
          <button className="btn danger" disabled={busy || !online} onClick={onCancel}>
            {t('market.cancelLot')}
          </button>
        ) : (
          <button
            className="btn"
            disabled={busy || !online || !!blocked}
            title={blocked ?? t('market.buy')}
            onClick={onBuy}
          >
            {t('market.buy')}
          </button>
        )}
        {blocked && !listing.mine && <span className="lot-blocked">{blocked}</span>}
      </div>
      {open && <CommentThread listing={listing} onCount={onComments} />}
    </div>
  )
}

export function MarketScreen() {
  const t = useT()
  const navigate = useNavigate()
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const { wallet, setWallet } = useWallet()
  const [category, setCategory] = useState<MarketCategory | null>(null)
  const [mine, setMine] = useState(false)
  const [rows, setRows] = useState<MarketListing[] | null>(null)
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (offset: number) => {
      const page = await gameSocket.marketBrowse({ category, mine, offset })
      setTotal(page.total)
      setRows((prev) => (offset === 0 || !prev ? page.rows : [...prev, ...page.rows]))
    },
    [category, mine]
  )

  // Refetch whenever the filter changes; the page resets to the top with it.
  useEffect(() => {
    if (!online) return
    let cancelled = false
    setRows(null)
    gameSocket
      .marketBrowse({ category, mine, offset: 0 })
      .then((page) => {
        if (cancelled) return
        setRows(page.rows)
        setTotal(page.total)
      })
      .catch(() => !cancelled && setRows([]))
    return () => {
      cancelled = true
    }
  }, [online, category, mine])

  async function act(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <TopBar />
      <div className="panel market-panel">
        <h2>{t('market.title')}</h2>
        <div className="gato-balance-row">
          <img className="gato-coin" src={themeAsset('currency.gato')} alt="" />
          <span className="gato-amount">
            {wallet ? t('profile.gatoBalance', { n: wallet.balance }) : '…'}
          </span>
          <button className="btn secondary" onClick={() => navigate('/profile/inventory')}>
            {t('market.toInventory')}
          </button>
        </div>
        <p className="hint-text">{t('market.blurb')}</p>

        <div className="market-filters">
          <button
            className={`chip-toggle ${category === null ? 'active' : ''}`}
            onClick={() => setCategory(null)}
          >
            {t('market.cat.all')}
          </button>
          {MARKET_CATEGORIES.map((c) => (
            <button
              key={c}
              className={`chip-toggle ${category === c ? 'active' : ''}`}
              onClick={() => setCategory(c)}
            >
              {t(CATEGORY_LABEL_KEYS[c])}
            </button>
          ))}
          <button
            className={`chip-toggle ${mine ? 'active' : ''}`}
            onClick={() => setMine((v) => !v)}
          >
            {t('market.mine')}
          </button>
        </div>

        {/* Offline is its own sentence: the fetch never starts, so "loading…"
            would sit there forever telling the player nothing. */}
        {!online && <p className="hint-text">{t('profile.connectToSave')}</p>}
        {online && rows === null && <p className="hint-text">{t('common.loading')}</p>}
        {rows?.length === 0 && (
          <p className="hint-text">{mine ? t('market.noneOfYours') : t('market.empty')}</p>
        )}
        {rows?.map((l) => (
          <LotCard
            key={l.id}
            listing={l}
            balance={wallet?.balance ?? null}
            busy={busy}
            onBuy={() =>
              void act(async () => {
                const done = await gameSocket.marketBuy(l.id)
                setWallet({ balance: done.balance, owned: done.owned })
              })
            }
            onCancel={() => void act(() => gameSocket.marketCancel(l.id))}
            onComments={(n) =>
              setRows((prev) =>
                (prev ?? []).map((x) => (x.id === l.id ? { ...x, comments: n } : x))
              )
            }
          />
        ))}
        {rows && rows.length < total && (
          <button className="btn secondary" disabled={busy} onClick={() => void load(rows.length)}>
            {t('replay.more', { shown: rows.length, total })}
          </button>
        )}
        <p className="error-text">{error}</p>
        {rows && total > MARKET_PAGE_SIZE && (
          <p className="hint-text">{t('market.count', { n: total })}</p>
        )}
      </div>
    </div>
  )
}
