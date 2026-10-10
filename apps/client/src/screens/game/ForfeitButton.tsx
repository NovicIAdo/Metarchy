// A forfeit is the one irreversible tap on the board: the seat is eliminated on
// the spot, its Actors leave the table, and outside vs_bots/tutorial it goes on
// the record as a loss. Beta showed exactly why it needs a gate — a player who
// had spent half an hour using this same bottom-right corner button to quit bot
// games tapped it six seconds into a ranked 3-player match (game e8dd7afb) and
// could do nothing but watch the remaining thirteen minutes. So the button now
// asks, and only the second tap reaches the server.

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { Mode } from '@metarchy/engine'
import { useT } from '../../i18n/index.js'
import { ModalOverlay } from './ModalOverlay.js'

/** vs_bots and tutorial cost nothing; every other mode is people and rating. */
function isStakes(mode: Mode): boolean {
  return mode !== 'vs_bots' && mode !== 'tutorial'
}

export function ForfeitButton({ mode, onForfeit }: { mode: Mode; onForfeit: () => void }) {
  const t = useT()
  const [asking, setAsking] = useState(false)

  // Escape is the reflex for "I did not mean to open this".
  useEffect(() => {
    if (!asking) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAsking(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [asking])

  return (
    <>
      <button className="btn danger hud-forfeit" onClick={() => setAsking(true)}>
        {t('game.forfeit')}
      </button>
      {asking && (
        <ModalOverlay
          className="forfeit-over"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAsking(false)
          }}
        >
          <motion.div
            className="panel forfeit-confirm"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <h2>{t('game.forfeitConfirm.title')}</h2>
            <p>{t('game.forfeitConfirm.body')}</p>
            {isStakes(mode) && <p className="warn-text">{t('game.forfeitConfirm.rated')}</p>}
            <div className="forfeit-confirm-actions">
              {/* Staying is the safe default, so it is the button under the thumb. */}
              <button className="btn" onClick={() => setAsking(false)}>
                {t('game.forfeitConfirm.keep')}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  setAsking(false)
                  onForfeit()
                }}
              >
                {t('game.forfeit')}
              </button>
            </div>
          </motion.div>
        </ModalOverlay>
      )}
    </>
  )
}
