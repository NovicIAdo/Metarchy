// Game route: lobby (invite code, ready checks) → live board (ActiveGame) →
// game-over ranking. The board itself lives in screens/game/.

import { Suspense, lazy, useEffect } from 'react'
import type { SeatId } from '@metarchy/engine'
import { useNavigate, useParams } from 'react-router-dom'
import { SEAT_COLORS } from '../board/layout.js'
import { useDomain } from '../i18n/domain.js'
import { useT } from '../i18n/index.js'
import { ItemArt, itemName } from '../lib/itemDisplay.jsx'
import { gameSocket } from '../net/socket.js'
import { useGameStore } from '../stores/game.js'
import { useUiStore } from '../stores/ui.js'
import { themeAsset } from '../theme.js'

// The board pulls in PixiJS — keep it out of the auth/home entry chunk.
const ActiveGame = lazy(() =>
  import('./game/ActiveGame.js').then((m) => ({ default: m.ActiveGame }))
)

export function GameScreen() {
  const { gameId } = useParams<{ gameId: string }>()
  const navigate = useNavigate()
  const activeGame = useGameStore((s) => s.activeGame)
  const lobby = useGameStore((s) => s.lobby)
  const view = useGameStore((s) => s.view)
  const gameOver = useGameStore((s) => s.gameOver)
  const players = useGameStore((s) => s.players)
  const inviteCode = useGameStore((s) => s.inviteCode)
  const resetGame = useGameStore((s) => s.resetGame)
  const gatoReward = useGameStore((s) => s.gatoReward)
  const lootDrop = useGameStore((s) => s.lootDrop)
  const t = useT()
  const d = useDomain()

  useEffect(() => {
    if (gameId && activeGame?.gameId === gameId && activeGame.status === 'active' && !view)
      gameSocket.resyncNow(gameId)
  }, [gameId, activeGame, view])

  if (!gameId) return null

  // The finished event sets gameOver; a resync after the fact carries it in the view.
  const over =
    gameOver ??
    (view?.phase.kind === 'finished'
      ? { winnerSeats: view.phase.winnerSeats, ranking: view.phase.ranking }
      : null)

  if (over) {
    const mySeat = activeGame?.seat
    const iWon = mySeat !== undefined && over.winnerSeats.includes(mySeat)
    const nameOf = (seat: SeatId): string => {
      const p = players.find((x) => x.seat === seat)
      return p ? `${p.nickname}${p.bot ? ' 🤖' : ''}` : t('gameshell.seat', { n: seat })
    }
    return (
      <div className="screen">
        <div className="panel">
          {activeGame?.mode === 'tutorial' && (
            <div className="coach-finished">
              <h2>{t('coach.finished.title')}</h2>
              <p className="hint-text">{t('coach.finished.body')}</p>
              <button
                className="btn confirm"
                onClick={() => {
                  // Straight into the promised first real match: vs_bots starts
                  // immediately (no lobby), same flow as the Home button.
                  useUiStore.getState().reset()
                  resetGame()
                  void gameSocket
                    .createGame({ mode: 'vs_bots' })
                    .then((created) => navigate(`/game/${created.p.gameId}`))
                    .catch(() => navigate('/'))
                }}
              >
                {t('coach.finished.cta')}
              </button>
            </div>
          )}
          <p className={`gameover-verdict ${iWon ? 'win' : 'lose'}`}>
            {iWon ? t('gameshell.victory') : t('gameshell.defeat')}
          </p>
          {/* Ranked payout — pushed a beat after this screen appears, so it
              simply shows up. Absent entirely outside ranked play; 0 is still
              worth saying, or the player thinks the credit was lost. */}
          {gatoReward?.gameId === gameId && (
            <p className="gameover-reward">
              {gatoReward.amount > 0
                ? t('gameshell.reward', { n: gatoReward.amount })
                : t('gameshell.rewardNone')}
            </p>
          )}
          {/* A cosmetic drop, same beat as the payout. Named, not just counted:
              "you won something" is worth nothing without knowing what. */}
          {lootDrop?.gameId === gameId && (
            <p className="gameover-drop">
              <ItemArt itemId={lootDrop.itemId} />
              {t('gameshell.drop', { name: itemName(lootDrop.itemId, t, d) })}
            </p>
          )}
          <ul className="player-list">
            {over.ranking.map((entry, i) => {
              const mine = mySeat !== undefined && entry.seats.includes(mySeat)
              return (
                <li key={i} className={`gameover-row ${mine ? 'me' : ''}`}>
                  <span className="rank">#{i + 1}</span>
                  {entry.seats.map((seat) => (
                    <span
                      key={seat}
                      className="hud-seat-dot"
                      style={{
                        background: `#${SEAT_COLORS[seat].toString(16).padStart(6, '0')}`
                      }}
                    />
                  ))}
                  <span style={{ flex: 1 }}>
                    {entry.seats.map((s) => nameOf(s)).join(' & ')}
                    {mine ? ' ' + t('gameshell.you') : ''}
                  </span>
                  {/* What the VP were made of (absent on pre-field games). */}
                  {entry.values && (
                    <span className="gameover-values">
                      {(['power', 'art', 'knowledge', 'fame'] as const).map((v) => (
                        <span key={v} className="hud-mini-stat" title={t('value.' + v)}>
                          <img src={themeAsset(`value.${v}`)} alt={t('value.' + v)} />
                          {entry.values?.[v] ?? 0}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="vp">
                    {entry.vp} {t('gameshell.vp')}
                  </span>
                </li>
              )
            })}
          </ul>
          <button
            className="btn"
            onClick={() => {
              useUiStore.getState().reset()
              resetGame()
              navigate('/')
            }}
          >
            {t('gameshell.backHome')}
          </button>
        </div>
      </div>
    )
  }

  if (activeGame?.gameId !== gameId) {
    return (
      <div className="screen">
        <div className="panel">
          <h2>{t('gameshell.notInGame')}</h2>
          <button className="btn" onClick={() => navigate('/')}>
            {t('gameshell.backHome')}
          </button>
        </div>
      </div>
    )
  }

  if (activeGame.status === 'lobby') {
    const me = lobby?.players.find((p) => p.seat === activeGame.seat)
    const mode = lobby?.mode ?? activeGame.mode
    const seatsTotal = lobby?.seatsTotal ?? 0

    const slotFor = (seat: SeatId) => {
      const p = lobby?.players.find((x) => x.seat === seat)
      if (!p)
        return (
          <li key={seat}>
            <span className="waiting-tag">{t('gameshell.emptySeat')}</span>
          </li>
        )
      return (
        <li key={seat}>
          <span>
            <span
              className="hud-seat-dot"
              style={{ background: `#${SEAT_COLORS[seat].toString(16).padStart(6, '0')}` }}
            />{' '}
            {p.avatar && (
              <img className="avatar-chip" src={themeAsset(`avatar.${p.avatar}`)} alt="" />
            )}
            {p.nickname}
            {p.bot ? ' 🤖' : ''}
            {p.seat === activeGame.seat ? ' ' + t('gameshell.you') : ''}
          </span>
          {p.ready ? (
            <span className="ready-tag">{t('gameshell.ready')}</span>
          ) : (
            <span className="waiting-tag">{t('gameshell.waiting')}</span>
          )}
        </li>
      )
    }

    return (
      <div className="screen">
        <div className="panel">
          <h2>{t('gameshell.lobby', { mode: t('mode.' + mode) })}</h2>
          {inviteCode && (
            <>
              <div className="invite-code">{inviteCode}</div>
              <p className="hint-text" style={{ textAlign: 'center', marginBottom: 12 }}>
                {seatsTotal > 2
                  ? t('gameshell.shareCodeFriends')
                  : t('gameshell.shareCodeOpponent')}
              </p>
            </>
          )}
          {mode === '2v2' ? (
            // Effective teams come from the server (join order + declared prefs);
            // seats are dealt to match ([0,2] vs [1,3]) when the game starts.
            <>
              {([0, 1] as const).map((team) => {
                const members = (lobby?.players ?? []).filter((p) => p.team === team)
                const myTeam = members.some((p) => p.seat === activeGame.seat)
                const slots = Math.floor(seatsTotal / 2)
                return (
                  <div key={team}>
                    <p className="team-label">
                      {t('gameshell.team', { n: team + 1 })}
                      {myTeam ? ' — ' + t('gameshell.yourTeam') : ''}
                    </p>
                    <ul className="player-list">
                      {members.map((p) => slotFor(p.seat))}
                      {Array.from({ length: slots - members.length }, (_, i) => (
                        <li key={`empty-${i}`}>
                          <span className="waiting-tag">{t('gameshell.emptySeat')}</span>
                        </li>
                      ))}
                    </ul>
                    {!myTeam && !me?.ready && members.length < slots && (
                      <button
                        className="btn secondary team-switch"
                        onClick={() => gameSocket.pickTeam(gameId, team)}
                      >
                        {t('gameshell.switchTeam', { n: team + 1 })}
                      </button>
                    )}
                  </div>
                )
              })}
              <p className="hint-text" style={{ marginBottom: 12 }}>
                {t('gameshell.pickSideHint')}
              </p>
            </>
          ) : (
            <ul className="player-list">
              {Array.from({ length: seatsTotal }, (_, seat) => slotFor(seat as SeatId))}
            </ul>
          )}
          <div className="row" style={{ marginTop: 4 }}>
            <button
              className="btn"
              disabled={me?.ready === true}
              onClick={() => gameSocket.ready(gameId)}
            >
              {me?.ready ? t('gameshell.waitingForOthers') : t('gameshell.readyButton')}
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                gameSocket.leaveLobby(gameId)
                useUiStore.getState().reset()
                resetGame()
                navigate('/')
              }}
            >
              {t('gameshell.leave')}
            </button>
          </div>
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
