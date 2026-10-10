// The market beat, every turn (author request): once the Action-Card market
// closes, say out loud who stocked up and who passed — "P1 bought 2 cards, P2
// bought none" — for players AND watchers. It rides the same public `bought`
// counts the engine fills as the phase closes, and it fades on its own: the
// market phase is already ending, so there is nothing to ack here.

import type { PlayerView, SeatId } from '@metarchy/engine'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useT } from '../../i18n/index.js'
import { gamesPluralForm } from '../leaderboard.js'
import { useSettingsStore } from '../../stores/settings.js'

/** How long the market recap stays up before dissolving into the next turn. */
const MARKET_SUMMARY_MS = 3500

/** Non-null only while the market phase is closing with its buys counted. */
export function marketSummaryOf(
  view: PlayerView | null
): { bought: { seat: SeatId; count: number }[] } | null {
  if (!view || view.phase.kind !== 'p5_market') return null
  // Present only once the engine has closed the market and counted the buys.
  if (view.phase.bought.length === 0) return null
  return { bought: view.phase.bought }
}

export function MarketSummary({
  view,
  nameOf
}: {
  view: PlayerView
  nameOf: (seat: SeatId) => string
}) {
  const t = useT()
  const lang = useSettingsStore((s) => s.language)
  const data = marketSummaryOf(view)
  const [open, setOpen] = useState(true)

  // Self-dismissing: the market is already over, so this is a read, not a gate.
  useEffect(() => {
    setOpen(true)
    const id = setTimeout(() => setOpen(false), MARKET_SUMMARY_MS)
    return () => clearTimeout(id)
  }, [view.turn])

  if (!data || !open) return null

  const anyBought = data.bought.some((b) => b.count > 0)

  return (
    <motion.div
      className="market-summary"
      role="status"
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
    >
      <p className="hud-label">{t('market.summary.title')}</p>
      {anyBought ? (
        <ul className="market-summary-list">
          {data.bought.map((b) => (
            <li key={b.seat}>
              {b.count > 0
                ? t('market.summary.bought.' + gamesPluralForm(b.count, lang), {
                    name: nameOf(b.seat),
                    n: b.count
                  })
                : t('market.summary.none', { name: nameOf(b.seat) })}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint-text">{t('market.summary.allPassed')}</p>
      )}
    </motion.div>
  )
}
