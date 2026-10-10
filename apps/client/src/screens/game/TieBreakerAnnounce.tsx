// A game that would end on a Victory-Point tie doesn't just slide into an extra
// turn — this ceremony explains it first: the tied leaders' scores and that the
// game plays one more deciding turn. Shown once at the start of each tie-breaker
// turn (isTieBreakerTurn ⟺ a VP tie extended the game). The non-leaders are
// already eliminated by then, so activeSeats ARE the tied leaders.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { PlayerView, Values } from '@metarchy/engine'
import { victoryPoints } from '@metarchy/engine'
import { useT } from '../../i18n/index.js'
import { useGameStore } from '../../stores/game.js'
import { poolOfSeat } from './phase-helpers.js'
import { usePhaseIntroCover } from './PhaseSplash.js'

const NO_VALUES: Values = { power: 0, art: 0, knowledge: 0, fame: 0 }

export function TieBreakerAnnounce({ view }: { view: PlayerView }) {
  const t = useT()
  const players = useGameStore((s) => s.players)
  const covering = usePhaseIntroCover(view)
  const [shownTurn, setShownTurn] = useState<number | null>(null)

  if (!view.isTieBreakerTurn || covering || shownTurn === view.turn) return null

  const nameOf = (seat: number): string => {
    const p = players.find((x) => x.seat === seat)
    return p ? `${p.nickname}${p.bot ? ' 🤖' : ''}` : t('gameshell.seat', { n: seat })
  }
  const standings = view.activeSeats.map((seat) => ({
    seat,
    vp: victoryPoints(poolOfSeat(view, seat) ?? NO_VALUES)
  }))

  return createPortal(
    <div className="tiebreak-scrim">
      <div className="tiebreak-card">
        <h2 className="tiebreak-title">{t('game.tiebreak.title')}</h2>
        <p className="tiebreak-body">{t('game.tiebreak.body')}</p>
        <ul className="tiebreak-standings">
          {standings.map((s) => (
            <li key={s.seat} className={s.seat === view.seat ? 'me' : ''}>
              <span>
                {nameOf(s.seat)}
                {s.seat === view.seat ? ' ' + t('gameshell.you') : ''}
              </span>
              <span className="tiebreak-vp">
                {s.vp} {t('gameshell.vp')}
              </span>
            </li>
          ))}
        </ul>
        <button className="btn" onClick={() => setShownTurn(view.turn)}>
          {t('game.tiebreak.continue')}
        </button>
      </div>
    </div>,
    document.body
  )
}
