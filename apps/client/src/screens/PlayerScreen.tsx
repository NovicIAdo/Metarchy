// One player's PUBLIC profile (author backlog #2): "можно кликнуть на любого из
// игроков и увидеть их профайл… увидеть сколько и каких игр сыграл игрок, какой
// у игрока винрэйт по каждой из категорий, пересмотреть бои в которых участвовал
// игрок, получить ссылку на игрока."
//
// Keyed by nickname because that is what a shared link carries, and nicknames
// are unique case-insensitively. Everything here is what the server chose to
// publish (server.ts sendPlayer) — the screen cannot reach anything else.

import type { AchievementState, PlayerCard, ModeRecord, ReplayEntry } from '@metarchy/protocol'
import { winRate } from '@metarchy/protocol'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AchievementsPanel } from '../components/AchievementsPanel.js'
import { TopBar } from '../components/TopBar.js'
import { useT } from '../i18n/index.js'
import { gameSocket } from '../net/socket.js'
import { useSessionStore } from '../stores/session.js'
import { themeAsset } from '../theme.js'
import { RecordPanel } from './ProfileScreen.js'

interface Standing {
  mode: string
  rating: number
  games: number
}

export function PlayerScreen() {
  const { nickname } = useParams<{ nickname: string }>()
  const navigate = useNavigate()
  const t = useT()
  const online = useSessionStore((s) => s.socketStatus) === 'online'
  const myUserId = useSessionStore((s) => s.userId)
  const [card, setCard] = useState<PlayerCard | null>(null)
  const [record, setRecord] = useState<ModeRecord | null>(null)
  const [ratings, setRatings] = useState<Standing[]>([])
  const [achievements, setAchievements] = useState<AchievementState | null>(null)
  const [games, setGames] = useState<ReplayEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!online || !nickname) return
    let cancelled = false
    setError(null)
    setCard(null)
    void gameSocket
      .fetchPlayer(nickname)
      .then((msg) => {
        if (cancelled) return
        setCard(msg.p.card)
        setRecord(msg.p.record)
        setRatings(msg.p.ratings)
        setAchievements(msg.p.achievements ?? null)
        // Their matches, for the "re-watch" half of the request. Only replayable
        // games exist here, which is the same list /replays would show.
        return gameSocket.replayList({ playerId: msg.p.card.userId })
      })
      .then((res) => {
        if (!cancelled && res) setGames(res.games)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [online, nickname])

  const shareLink =
    typeof window === 'undefined' || !card
      ? ''
      : `${window.location.origin}/player/${encodeURIComponent(card.nickname)}`

  const copyLink = (): void => {
    if (!shareLink) return
    void navigator.clipboard?.writeText(shareLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const rate = card ? winRate(card.ranked) : null

  return (
    <div className="screen">
      <TopBar />

      {error && (
        <div className="panel">
          <p className="error-text">{error}</p>
          <button className="btn secondary" onClick={() => navigate('/players')}>
            {t('players.title')}
          </button>
        </div>
      )}

      {!error && !card && <div className="panel">{t('common.loading')}</div>}

      {card && (
        <>
          <div className="panel player-head">
            {card.avatar && (
              <img className="player-avatar" src={themeAsset(`avatar.${card.avatar}`)} alt="" />
            )}
            <div className="player-ident">
              <h2>
                {card.nickname}
                {card.userId === myUserId ? ' ' + t('players.you') : ''}
              </h2>
              <p className="hint-text">
                {rate === null ? t('player.noRanked') : t('player.rankedRate', { n: rate })}
                {card.rating !== null
                  ? ` · ${t('player.rating', { n: Math.round(card.rating) })}`
                  : ''}
              </p>
              {ratings.length > 0 && (
                <ul className="player-standings">
                  {ratings.map((r) => (
                    <li key={r.mode}>
                      {t('mode.' + r.mode)} · {Math.round(r.rating)} ·{' '}
                      {t('player.games', { n: r.games })}
                    </li>
                  ))}
                </ul>
              )}
              {/* A player's page is where you decide you want to talk to them, so
                  it is where the private chat has to open from. Before this the
                  only way in was to type a nickname into the DM search. */}
              {card.userId !== myUserId && (
                <button
                  className="btn secondary player-write"
                  onClick={() => navigate(`/chat?to=${encodeURIComponent(card.nickname)}`)}
                >
                  ✉ {t('player.write')}
                </button>
              )}
            </div>
          </div>

          <div className="panel">
            <h2>{t('profile.record')}</h2>
            <RecordPanel record={record} />
          </div>

          <div className="panel">
            <h2>{t('achv.title')}</h2>
            <AchievementsPanel state={achievements} />
          </div>

          <div className="panel">
            <h2>{t('player.matches')}</h2>
            {!games && <p className="hint-text">{t('common.loading')}</p>}
            {games && games.length === 0 && <p className="hint-text">{t('player.noMatches')}</p>}
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
                              {p.bot ? ' 🤖' : ''}
                            </span>
                            {i < g.players.length - 1 && (
                              <span className="hint-text"> {t('replay.vs')} </span>
                            )}
                          </span>
                        ))}
                      </div>
                      <span className="hint-text">{t('mode.' + g.mode)}</span>
                    </div>
                    <button
                      className="btn secondary"
                      onClick={() => navigate(`/replay/${g.gameId}`)}
                    >
                      {t('replay.watch')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <h2>{t('player.share')}</h2>
            <p className="hint-text player-link">{shareLink}</p>
            <button className="btn secondary" onClick={copyLink}>
              {copied ? t('player.linkCopied') : t('player.copyLink')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
