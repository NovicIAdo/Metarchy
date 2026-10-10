// The replay gallery: recorded ranked games. Picking one opens the step-through
// viewer at /replay/:gameId. The record itself (seed + move log) already lives on
// the server for every ranked game — this lists and links them, pages through
// the full archive, and lets the user star games into a favorites filter for
// later study.

import type { ReplayEntry } from '@metarchy/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar.js'
import { useT } from '../i18n/index.js'
import { gameSocket } from '../net/socket.js'
import { useSessionStore } from '../stores/session.js'
import { themeAsset } from '../theme.js'

export function ReplaysScreen() {
  const navigate = useNavigate()
  const t = useT()
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const [games, setGames] = useState<ReplayEntry[] | null>(null)
  const [total, setTotal] = useState(0)
  const [starredOnly, setStarredOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(offset: number) {
    setBusy(true)
    setError(null)
    try {
      const page = await gameSocket.replayList({ offset, starredOnly })
      setTotal(page.total)
      setGames((prev) => {
        if (offset === 0 || !prev) return page.games
        const known = new Set(prev.map((g) => g.gameId))
        return [...prev, ...page.games.filter((g) => !known.has(g.gameId))]
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (online) void load(0)
  }, [online, starredOnly])

  function toggleStar(entry: ReplayEntry): void {
    const starred = !entry.starred
    // Optimistic: flip locally (under the favorites filter an unstar drops the
    // row — the server's next page offsets shift the same way), revert on error.
    setGames((prev) => {
      if (!prev) return prev
      if (starredOnly && !starred) return prev.filter((g) => g.gameId !== entry.gameId)
      return prev.map((g) => (g.gameId === entry.gameId ? { ...g, starred } : g))
    })
    if (starredOnly) setTotal((n) => Math.max(0, n + (starred ? 1 : -1)))
    gameSocket.replayStar(entry.gameId, starred).catch((e) => {
      setError(e instanceof Error ? e.message : String(e))
      setGames((prev) => {
        if (!prev) return prev
        if (starredOnly && !starred) return [...prev, entry]
        return prev.map((g) => (g.gameId === entry.gameId ? { ...g, starred: entry.starred } : g))
      })
      if (starredOnly) setTotal((n) => Math.max(0, n + (starred ? -1 : 1)))
    })
  }

  const dateOf = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''

  return (
    <div className="screen">
      <TopBar />
      <img className="logo" src={themeAsset('logo')} alt="Metarchy" />

      <div className="panel" style={{ maxWidth: 560, width: '100%' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{t('replay.title')}</h2>
          <button className="btn secondary" disabled={busy || !online} onClick={() => void load(0)}>
            {t('replay.refresh')}
          </button>
        </div>
        <p className="hint-text">{t('replay.subtitle')}</p>
        <div className="replay-filters">
          <button
            type="button"
            className={starredOnly ? 'chip-toggle active' : 'chip-toggle'}
            aria-pressed={starredOnly}
            onClick={() => setStarredOnly((v) => !v)}
          >
            ★ {t('replay.starredOnly')}
          </button>
        </div>

        {games === null && <p className="hint-text">{t('replay.loading')}</p>}
        {games?.length === 0 && (
          <p className="hint-text">{t(starredOnly ? 'replay.noneStarred' : 'replay.none')}</p>
        )}

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
                        <span className={g.winnerSeats.includes(p.seat) ? 'nickname' : ''}>
                          {p.nickname}
                          {g.winnerSeats.includes(p.seat) ? ` · ${t('replay.won')}` : ''}
                        </span>
                        {i < g.players.length - 1 && (
                          <span className="watch-vs">{t('replay.vs')}</span>
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="watch-meta hint-text">
                    {t(`mode.${g.mode}`)}
                    {g.turns !== null ? ` · ${t('replay.turns', { n: g.turns })}` : ''}
                    {g.finishedAt ? ` · ${dateOf(g.finishedAt)}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className={g.starred ? 'star-btn active' : 'star-btn'}
                  aria-pressed={g.starred}
                  title={t(g.starred ? 'replay.unstar' : 'replay.star')}
                  aria-label={t(g.starred ? 'replay.unstar' : 'replay.star')}
                  onClick={() => toggleStar(g)}
                >
                  {g.starred ? '★' : '☆'}
                </button>
                <button className="btn" onClick={() => navigate(`/replay/${g.gameId}`)}>
                  {t('replay.watch')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {games && games.length < total && (
          <button
            className="btn secondary"
            disabled={busy || !online}
            onClick={() => void load(games.length)}
          >
            {t('replay.more', { shown: games.length, total })}
          </button>
        )}
        <p className="error-text">{error}</p>
        <button className="btn secondary" onClick={() => navigate('/')}>
          {t('common.back')}
        </button>
      </div>
    </div>
  )
}
