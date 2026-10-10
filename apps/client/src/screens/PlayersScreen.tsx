// The Players directory (author backlog #2): everyone who has registered, with
// their avatar, username and ranked win rate, searchable by name, each row a
// link to that player's public profile.
//
// Unlike the leaderboard this reads over the game socket, not PostgREST: win
// rates come from game_players, which RLS keeps private on purpose, so the
// server aggregates and publishes only these four numbers.

import type { PlayerCard } from '@metarchy/protocol'
import { winRate } from '@metarchy/protocol'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar.js'
import { useT } from '../i18n/index.js'
import { gameSocket } from '../net/socket.js'
import { useSessionStore } from '../stores/session.js'
import { themeAsset } from '../theme.js'

/** Matches the server's page size (PLAYERS_PAGE_SIZE) — it caps the reply anyway. */
const PAGE = 20
/** Long enough that a typed name is not a query per keystroke. */
const SEARCH_DEBOUNCE_MS = 250

export function PlayersScreen() {
  const navigate = useNavigate()
  const t = useT()
  const online = useSessionStore((s) => s.socketStatus) === 'online'
  const myUserId = useSessionStore((s) => s.userId)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<PlayerCard[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Debounce the typing, not the paging: a keystroke also resets to page one.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      setQuery(search.trim())
      setOffset(0)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [search])

  useEffect(() => {
    if (!online) return
    let cancelled = false
    setError(null)
    void gameSocket
      .fetchPlayers({ ...(query ? { query } : {}), ...(offset ? { offset } : {}) })
      .then((msg) => {
        if (cancelled) return
        setRows(msg.p.rows)
        setTotal(msg.p.total)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [online, query, offset])

  return (
    <div className="screen">
      <TopBar />
      <div className="panel players-panel">
        <h2>{t('players.title')}</h2>

        <input
          className="players-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('players.searchPlaceholder')}
          aria-label={t('players.searchPlaceholder')}
        />

        {error && <p className="error-text">{error}</p>}
        {!rows && !error && <p className="hint-text">{t('common.loading')}</p>}
        {rows && rows.length === 0 && <p className="hint-text">{t('players.empty')}</p>}

        {rows && rows.length > 0 && (
          <ul className="players-list">
            {rows.map((p) => {
              const rate = winRate(p.ranked)
              return (
                <li key={p.userId}>
                  <button
                    className="players-row"
                    onClick={() => navigate(`/player/${encodeURIComponent(p.nickname)}`)}
                  >
                    {p.avatar && (
                      <img className="avatar-chip" src={themeAsset(`avatar.${p.avatar}`)} alt="" />
                    )}
                    <span className="players-name">
                      {p.nickname}
                      {p.userId === myUserId ? ' ' + t('players.you') : ''}
                    </span>
                    <span className="players-rate">
                      {/* No ranked games yet is a dash, never a 0% that reads as "always loses". */}
                      {rate === null ? '—' : t('players.rate', { n: rate })}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {total > PAGE && (
          <div className="players-pager">
            <button
              className="btn secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
            >
              {t('players.prev')}
            </button>
            <span className="hint-text">
              {t('players.pageOf', {
                from: total === 0 ? 0 : offset + 1,
                to: Math.min(offset + PAGE, total),
                total
              })}
            </span>
            <button
              className="btn secondary"
              disabled={offset + PAGE >= total}
              onClick={() => setOffset(offset + PAGE)}
            >
              {t('players.next')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
