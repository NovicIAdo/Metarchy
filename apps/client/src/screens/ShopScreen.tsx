// The Shop: avatars, whole-figure actor skins and argument-coin sets sell for
// GATO (the soft currency; balance + entitlements live server-side, catalog and
// prices in protocol shop.ts). Buying updates the wallet in place; owned goods
// show as OWNED. Nothing the game needs to be played is on sale — the default
// actors, coins and launch faces ship owned, and the shelves are cosmetics on
// top. Later shelves (currency packs, music, boards, cards) remain staged posts.

import type { ActorType } from '@metarchy/engine'
import type { ArgSkinId, ShopItem } from '@metarchy/protocol'
import { FREE_AVATAR_IDS, SHOP_CATALOG } from '@metarchy/protocol'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CoinSet } from '../components/CoinSet.js'
import { TopBar } from '../components/TopBar.js'
import { useWallet } from '../hooks/useWallet.js'
import { useDomain } from '../i18n/domain.js'
import { useT } from '../i18n/index.js'
import { ARG_SET_NAME_KEYS, SKIN_NAME_KEYS } from '../lib/cosmetics.js'
import { gameSocket } from '../net/socket.js'
import { useSessionStore } from '../stores/session.js'
import { themeAsset } from '../theme.js'

function GatoPrice({ price }: { price: number }) {
  return (
    <span className="gato-price">
      <img className="gato-coin" src={themeAsset('currency.gato')} alt="" /> {price}
    </span>
  )
}

function BuyableItem({
  item,
  name,
  assetKey,
  figure,
  owned,
  balance,
  busy,
  onBuy,
  preview
}: {
  item: ShopItem
  name: string
  assetKey?: string
  figure?: boolean
  owned: boolean
  balance: number | null
  busy: boolean
  onBuy(item: ShopItem): void
  /** Replaces the single thumbnail — used by coin sets, which sell four at once. */
  preview?: React.ReactNode
}) {
  const t = useT()
  const affordable = balance !== null && balance >= item.price
  return (
    <div className={`shop-item ${figure ? 'shop-item-figure' : ''}`}>
      {preview ?? <img src={themeAsset(assetKey as string)} alt="" draggable={false} />}
      <span className="shop-name">{name}</span>
      {owned ? (
        <span className="shop-owned">{t('shop.owned')}</span>
      ) : (
        <button
          className="btn secondary shop-buy"
          disabled={busy || !affordable}
          title={affordable ? t('shop.buy') : t('shop.notEnough')}
          onClick={() => onBuy(item)}
        >
          <GatoPrice price={item.price} />
        </button>
      )}
    </div>
  )
}

export function ShopScreen() {
  const navigate = useNavigate()
  const t = useT()
  const d = useDomain()
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const { wallet, setWallet } = useWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function buy(item: ShopItem) {
    if (busy || !online) return
    setBusy(true)
    setError(null)
    try {
      setWallet(await gameSocket.shopBuy(item.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const ownedSet = new Set(wallet?.owned ?? [])
  const avatarGoods = SHOP_CATALOG.filter((i) => i.kind === 'avatar')
  const skinGoods = SHOP_CATALOG.filter((i) => i.kind === 'skin')
  const argSkinGoods = SHOP_CATALOG.filter((i) => i.kind === 'argSkin')

  return (
    <div className="screen shop-screen">
      <TopBar />
      <img className="logo" src={themeAsset('logo')} alt="Metarchy" />

      <div className="panel shop">
        <div className="row" style={{ alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{t('shop.title')}</h2>
          <span className="gato-balance">
            <img className="gato-coin" src={themeAsset('currency.gato')} alt="" />
            {wallet ? t('shop.balance', { n: wallet.balance }) : '…'}
          </span>
        </div>
        <p className="hint-text">{t('shop.intro')}</p>
        {error && <p className="error-text">{error}</p>}

        <div className="shop-shelf">
          <p className="hud-label">{t('shop.shelf.avatars.title')}</p>
          <p className="hint-text shop-blurb">{t('shop.shelf.avatars.blurb')}</p>
          <div className="shop-grid">
            {FREE_AVATAR_IDS.map((id) => (
              <div key={id} className="shop-item">
                <img src={themeAsset(`avatar.${id}`)} alt="" draggable={false} />
                <span className="shop-name">{t(`shop.item.${id}`)}</span>
                <span className="shop-owned">{t('shop.owned')}</span>
              </div>
            ))}
            {avatarGoods.map((item) => (
              <BuyableItem
                key={item.id}
                item={item}
                name={d.actor(item.avatar as ActorType)}
                assetKey={`avatar.${item.avatar}`}
                owned={ownedSet.has(item.id)}
                balance={wallet?.balance ?? null}
                busy={busy || !online}
                onBuy={buy}
              />
            ))}
          </div>
        </div>

        <div className="shop-shelf">
          <p className="hud-label">{t('shop.shelf.actorSkins.title')}</p>
          <p className="hint-text shop-blurb">{t('shop.shelf.actorSkins.blurb')}</p>
          <div className="shop-grid">
            {skinGoods.map((item) => {
              const nameKey = SKIN_NAME_KEYS[item.skin ?? '']
              return (
                <BuyableItem
                  key={item.id}
                  item={item}
                  name={`${d.actor(item.actor as ActorType)} · ${nameKey ? t(nameKey) : item.skin}`}
                  assetKey={`skin.${item.actor}.${item.skin}`}
                  figure
                  owned={ownedSet.has(item.id)}
                  balance={wallet?.balance ?? null}
                  busy={busy || !online}
                  onBuy={buy}
                />
              )
            })}
          </div>
        </div>

        <div className="shop-shelf">
          <p className="hud-label">{t('shop.shelf.argumentSkins.title')}</p>
          <p className="hint-text shop-blurb">{t('shop.shelf.argumentSkins.blurb')}</p>
          <div className="shop-grid">
            {/* The game's own coins: never for sale, listed so the free set is
                visible next to the alloys. */}
            <div className="shop-item">
              <CoinSet set={null} />
              <span className="shop-name">{t('shop.argSet.default')}</span>
              <span className="shop-owned">{t('shop.owned')}</span>
            </div>
            {argSkinGoods.map((item) => (
              <BuyableItem
                key={item.id}
                item={item}
                name={t(ARG_SET_NAME_KEYS[item.argSkin as string] ?? item.id)}
                preview={<CoinSet set={item.argSkin as ArgSkinId} />}
                owned={ownedSet.has(item.id)}
                balance={wallet?.balance ?? null}
                busy={busy || !online}
                onBuy={buy}
              />
            ))}
          </div>
        </div>

        <div className="shop-shelf">
          <p className="hud-label">{t('shop.shelf.currency.title')}</p>
          <p className="hint-text shop-blurb">{t('shop.shelf.currency.blurb')}</p>
          <div className="shop-grid">
            <div className="shop-item">
              <span className="shop-soon">?</span>
              <span className="shop-name">{t('shop.item.currencySoon')}</span>
            </div>
          </div>
        </div>

        <div className="shop-shelf">
          <p className="hud-label">{t('shop.shelf.music.title')}</p>
          <p className="hint-text shop-blurb">{t('shop.shelf.music.blurb')}</p>
          <div className="shop-grid">
            <div className="shop-item">
              <span className="shop-soon">?</span>
              <span className="shop-name">{t('shop.item.musicSoon')}</span>
            </div>
          </div>
        </div>

        <div className="shop-shelf">
          <p className="hud-label">{t('shop.shelf.board.title')}</p>
          <p className="hint-text shop-blurb">{t('shop.shelf.board.blurb')}</p>
          <div className="shop-grid">
            <div className="shop-item">
              <img src={themeAsset('location.city')} alt="" draggable={false} />
              <span className="shop-name">{t('shop.item.cyberpunk')}</span>
              <span className="shop-owned">{t('shop.owned')}</span>
            </div>
          </div>
        </div>

        <div className="shop-shelf">
          <p className="hud-label">{t('shop.shelf.cards.title')}</p>
          <p className="hint-text shop-blurb">{t('shop.shelf.cards.blurb')}</p>
          <div className="shop-grid">
            <div className="shop-item">
              <img src={themeAsset('card.action.cable_stolen')} alt="" draggable={false} />
              <span className="shop-name">{t('shop.item.synthwave')}</span>
              <span className="shop-owned">{t('shop.owned')}</span>
            </div>
          </div>
        </div>
      </div>

      <button className="btn secondary" style={{ maxWidth: 440 }} onClick={() => navigate('/')}>
        {t('common.back')}
      </button>
    </div>
  )
}
