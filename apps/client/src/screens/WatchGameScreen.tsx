// Spectator board route (/watch/:gameId): (re)joins the spectator stream, then
// renders the same ActiveGame board in read-only mode (view.spectator). The
// server sends a strictly-public view, so the board naturally hides anything the
// table has not revealed yet.

import type { SeatId } from '@metarchy/engine'
import { Suspense, lazy, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useT } from '../i18n/index.js'
import { gameSocket } from '../net/socket.js'
import { useGameStore } from '../stores/game.js'
import { useSessionStore } from '../stores/session.js'
import { useUiStore } from '../stores/ui.js'

const ActiveGame = lazy(() =>
  import('./game/ActiveGame.js').then((m) => ({ default: m.ActiveGame }))
)

export function WatchGameScreen() {
  const { gameId } = useParams<{ gameId: string }>()
  const navigate = useNavigate()
  const t = useT()
  const spectating = useGameStore((s) => s.spectating)
  const view = useGameStore((s) => s.view)
  const gameOver = useGameStore((s) => s.gameOver)
  const players = useGameStore((s) => s.players)
  const online = useSessionStore((s) => s.socketStatus === 'online')

  // Deep-link or reconnect: (re)subscribe to the spectator stream when this tab
  // is not already watching this game.
  useEffect(() => {
    if (!gameId || !online) return
    if (spectating?.gameId !== gameId) {
      void gameSocket.spectateJoin(gameId).catch(() => navigate('/watch'))
    }
  }, [gameId, online, spectating, navigate])

  const leave = (): void => {
    if (gameId) gameSocket.spectateLeave(gameId)
    useUiStore.getState().reset()
    navigate('/watch')
  }

  if (!gameId) return null

  const over =
    gameOver ??
    (view?.phase.kind === 'finished'
      ? { winnerSeats: view.phase.winnerSeats, ranking: view.phase.ranking }
      : null)

  if (over) {
    const nameOf = (seat: SeatId): string =>
      players.find((p) => p.seat === seat)?.nickname ?? t('gameshell.seat', { n: seat })
    return (
      <div className="screen">
        <div className="panel">
          <h2>{t('watch.gameOver')}</h2>
          <ul className="player-list">
            {over.ranking.map((entry, i) => (
              <li key={i} className="gameover-row">
                <span className="rank">#{i + 1}</span>
                <span style={{ flex: 1 }}>{entry.seats.map(nameOf).join(' & ')}</span>
                <span className="vp">
                  {entry.vp} {t('gameshell.vp')}
                </span>
              </li>
            ))}
          </ul>
          <button className="btn" onClick={leave}>
            {t('watch.backToList')}
          </button>
        </div>
      </div>
    )
  }

  if (!view || !view.spectator || spectating?.gameId !== gameId) {
    return (
      <div className="screen">
        <div className="panel">
          <p className="waiting-pulse">{t('watch.connecting')}</p>
          <button className="btn secondary" onClick={leave}>
            {t('common.back')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <Suspense
      fallback={
        <div className="screen">
          <div className="panel">{t('gameshell.loadingBoard')}</div>
        </div>
      }
    >
      <ActiveGame gameId={gameId} />
    </Suspense>
  )
}
