// The spectator lobby: a live list of ranked games open to watchers. Picking one
// asks the server to start a spectator stream, then routes to the read-only board
// at /watch/:gameId. Ranked-only is enforced server-side (private/bot never list).

import type { WatchableGame } from '@metarchy/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar.js'
import { useT } from '../i18n/index.js'
import { gameSocket } from '../net/socket.js'
import { useSessionStore } from '../stores/session.js'
import { themeAsset } from '../theme.js'

export function WatchScreen() {
  const navigate = useNavigate()
  const t = useT()
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const [games, setGames] = useState<WatchableGame[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setBusy(true)
    setError(null)
    try {
      setGames(await gameSocket.spectateList())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (online) void refresh()
  }, [online])

  async function watch(gameId: string) {
    setError(null)
    try {
      await gameSocket.spectateJoin(gameId)
      navigate(`/watch/${gameId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="screen">
      <TopBar />
      <img className="logo" src={themeAsset('logo')} alt="Metarchy" />

      <div className="panel" style={{ maxWidth: 560, width: '100%' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{t('watch.title')}</h2>
          <button
            className="btn secondary"
            disabled={busy || !online}
            onClick={() => void refresh()}
          >
            {t('watch.refresh')}
          </button>
        </div>
        <p className="hint-text">{t('watch.subtitle')}</p>

        {games === null && <p className="hint-text">{t('watch.loading')}</p>}
        {games?.length === 0 && <p className="hint-text">{t('watch.none')}</p>}

        {games && games.length > 0 && (
          <ul className="watch-list">
            {games.map((g) => (
              <li key={g.gameId} className="watch-item">
                <div className="watch-item-main">
                  <div className="watch-players">
                    {g.players.map((p, i) => (
                      <span key={p.seat} className="watch-player">
                        {p.avatar && (
                          <img
                            className="avatar-chip"
                            src={themeAsset(`avatar.${p.avatar}`)}
                            alt=""
                          />
                        )}
                        <span className="nickname">{p.nickname}</span>
                        {i < g.players.length - 1 && (
                          <span className="watch-vs">{t('watch.vs')}</span>
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="watch-meta hint-text">
                    {t(`mode.${g.mode}`)} · {t('watch.turn', { n: g.turn })} · 👁{' '}
                    {t('watch.watching', { n: g.spectators })}
                  </div>
                </div>
                <button className="btn" disabled={!online} onClick={() => void watch(g.gameId)}>
                  {t('watch.watch')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="error-text">{error}</p>
        <button className="btn secondary" onClick={() => navigate('/')}>
          {t('common.back')}
        </button>
      </div>
    </div>
  )
}
