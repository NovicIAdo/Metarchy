// Public read straight from PostgREST — the game socket carries no leaderboard
// (architecture/Client.md §5). RLS makes the `leaderboard` view safe to expose.

import type { RankedMode } from '@metarchy/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar.js'
import { useT } from '../i18n/index.js'
import { useSessionStore } from '../stores/session.js'
import { useSettingsStore } from '../stores/settings.js'
import { supabase } from '../supabase.js'
import { themeAsset } from '../theme.js'
import type { LeaderboardRow, RankedRow } from './leaderboard.js'
import { LEADERBOARD_MODES, gamesPluralForm, rankRows } from './leaderboard.js'

export function LeaderboardScreen() {
  const navigate = useNavigate()
  const t = useT()
  const myUserId = useSessionStore((s) => s.userId)
  const lang = useSettingsStore((s) => s.language)
  const [mode, setMode] = useState<RankedMode>('1v1')
  const [rows, setRows] = useState<RankedRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setError(null)
    void supabase
      .from('leaderboard')
      .select('user_id, nickname, avatar, rating, rd, games')
      .eq('mode', mode)
      .order('rating', { ascending: false })
      .limit(50)
      .then(({ data, error: queryError }) => {
        if (cancelled) return
        if (queryError) setError(queryError.message)
        else setRows(rankRows((data ?? []) as LeaderboardRow[]))
      })
    return () => {
      cancelled = true
    }
  }, [mode])

  return (
    <div className="screen">
      <TopBar />
      <img className="logo" src={themeAsset('logo')} alt="Metarchy" />

      <div className="panel">
        <h2>{t('leaderboard.title')}</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          {LEADERBOARD_MODES.map((m) => (
            <button
              key={m}
              className={`btn ${mode === m ? '' : 'secondary'}`}
              onClick={() => setMode(m)}
            >
              {t('mode.' + m)}
            </button>
          ))}
        </div>

        {error && <p className="error-text">{error}</p>}
        {!rows && !error && <p className="hint-text">{t('common.loading')}</p>}
        {rows?.length === 0 && <p className="hint-text">{t('leaderboard.empty')}</p>}

        {rows && rows.length > 0 && (
          <ol className="leaderboard">
            {rows.map((row) => (
              <li key={row.user_id} className={row.user_id === myUserId ? 'me' : ''}>
                {/* A row is a link to that player's public profile, same as the
                    Players directory — the leaderboard should answer "who is
                    this?" with one tap, not a dead readout. */}
                <button
                  className="lb-row"
                  onClick={() => navigate(`/player/${encodeURIComponent(row.nickname)}`)}
                >
                  <span className="lb-rank">{row.rank}</span>
                  {row.avatar && (
                    <img className="avatar-chip" src={themeAsset(`avatar.${row.avatar}`)} alt="" />
                  )}
                  <span className="lb-name">{row.nickname}</span>
                  {row.provisional && (
                    <span className="lb-provisional">{t('leaderboard.provisional')}</span>
                  )}
                  <span className="lb-games">
                    {t('leaderboard.games.' + gamesPluralForm(row.games, lang), { n: row.games })}
                  </span>
                  <span className="lb-rating">{row.displayRating}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <button className="btn secondary" style={{ maxWidth: 440 }} onClick={() => navigate('/')}>
        {t('common.back')}
      </button>
    </div>
  )
}
