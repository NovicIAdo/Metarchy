// P5 market (rulebook Phase 5): one Action Card costs 1 of each resource. Buys
// are sealed and dealt when the market closes — simultaneous play, no card peek.

import type { PlayerView } from '@metarchy/engine'
import type { ClientIntent } from '@metarchy/protocol'
import { useT } from '../../i18n/index.js'
import { useDomain } from '../../i18n/domain.js'
import { themeAsset } from '../../theme.js'

const PRICE: readonly ('product' | 'electricity' | 'recycling')[] = [
  'product',
  'electricity',
  'recycling'
]

export function MarketPanel({
  view,
  send
}: {
  view: PlayerView
  send(intent: ClientIntent): void
}) {
  const t = useT()
  const d = useDomain()
  const phase = view.phase
  if (phase.kind !== 'p5_market') return null
  if (!view.waitingOn.includes(view.seat))
    return (
      <p className="hint-text arena-waiting">
        <span className="waiting-pulse">{t('game.market.closed')}</span>
      </p>
    )

  const staged = phase.sealedBuys.find((b) => b.seat === view.seat)?.count ?? 0
  const { product, electricity, recycling } = view.me.resources
  const affordable = Math.min(product, electricity, recycling)
  const canBuy = view.decks.action > 0 && staged < affordable

  return (
    <>
      <div className="market-head">
        <img className="market-deck" src={themeAsset('deck.action')} alt="" />
        <div>
          <p className="hud-label">{t('game.market.head', { n: view.decks.action })}</p>
          <div className="market-price">
            <span>{t('game.market.oneCard')}</span>
            {PRICE.map((r) => (
              <img
                key={r}
                src={themeAsset(`resource.${r}`)}
                alt={d.resource(r)}
                title={d.resource(r)}
              />
            ))}
          </div>
          <p className="hint-text">
            {staged > 0 ? `${t('game.market.staged', { n: staged })} ` : ''}
            {t('game.market.afford', { n: Math.max(0, affordable - staged) })}
          </p>
        </div>
      </div>
      <div className="row">
        <button className="btn" disabled={!canBuy} onClick={() => send({ type: 'market.buy' })}>
          {t('game.market.buy')}
        </button>
        <button className="btn confirm" onClick={() => send({ type: 'market.done' })}>
          ✓ {t('game.done')}
        </button>
      </div>
      <p className="hint-text" style={{ textAlign: 'center' }}>
        {t('game.market.dealt')}
      </p>
    </>
  )
}
