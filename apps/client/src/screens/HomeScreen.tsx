import type { RankedMode } from '@metarchy/protocol'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar.js'
import { sendFeedback } from '../error-report.js'
import { useCountdown } from '../hooks/useCountdown.js'
import { useT } from '../i18n/index.js'
import { gameSocket } from '../net/socket.js'
import type { QueueState } from '../stores/game.js'
import { useGameStore } from '../stores/game.js'
import { useSessionStore } from '../stores/session.js'
import { themeAsset } from '../theme.js'

/**
 * Waiting for a ranked match. Author request: show who has already been found
 * and how long until a bot takes the empty seat. Both come straight from
 * queue.status — `found` is the other humans queued for this mode (at the
 * deadline the queue seats them together and fills the rest with bots), and
 * `botAt` is a fixed server instant so the message does not have to repeat
 * every second.
 */
function QueuePanel({ queue }: { queue: QueueState }) {
  const t = useT()
  const secondsToBot = useCountdown(queue.botAt)
  // The player themselves plus everyone else already waiting.
  const filled = queue.found.length + 1

  return (
    <div className="panel">
      <h2>{t('home.findingMatch')}</h2>
      <p className="waiting-pulse">
        {queue.mode === '1v1' ? t('home.queue.1v1') : t('home.queue.ffa3')} ·{' '}
        {t('home.queue.position', { n: queue.position })}
      </p>

      <p className="hint-text">{t('home.queue.filled', { n: filled, max: queue.seats })}</p>
      {queue.found.length > 0 && (
        <ul className="queue-found">
          {queue.found.map((p) => (
            <li key={p.nickname}>
              {p.avatar && (
                <img className="avatar-chip" src={themeAsset(`avatar.${p.avatar}`)} alt="" />
              )}
              <span>{p.nickname}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="hint-text">
        {queue.widenedRange ? t('home.queue.widening') : t('home.queue.searching')}
      </p>
      {secondsToBot !== null && (
        <p className="queue-bot-timer">
          {secondsToBot > 0 ? t('home.queue.botIn', { n: secondsToBot }) : t('home.queue.botNow')}
        </p>
      )}

      <button className="btn secondary" onClick={() => gameSocket.leaveQueue()}>
        {t('common.cancel')}
      </button>
    </div>
  )
}

export function HomeScreen() {
  const navigate = useNavigate()
  const t = useT()
  const socketStatus = useSessionStore((s) => s.socketStatus)
  const dmUnread = useSessionStore((s) => s.dmUnread)
  const activeGame = useGameStore((s) => s.activeGame)
  const queue = useGameStore((s) => s.queue)
  const [inviteInput, setInviteInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackState, setFeedbackState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  async function submitFeedback() {
    setFeedbackState('sending')
    const ok = await sendFeedback(feedbackText)
    setFeedbackState(ok ? 'sent' : 'failed')
    if (ok) {
      setFeedbackText('')
      setTimeout(() => {
        setFeedbackOpen(false)
        setFeedbackState('idle')
      }, 1500)
    }
  }

  const online = socketStatus === 'online'

  // A queued player is taken straight to the board; someone who merely walked
  // home mid-game is not — that is what "Return to the board" is for.
  const wasQueued = useRef(false)
  useEffect(() => {
    if (queue) wasQueued.current = true
  }, [queue])
  useEffect(() => {
    if (!wasQueued.current || !activeGame) return
    wasQueued.current = false
    navigate(`/game/${activeGame.gameId}`)
  }, [activeGame, navigate])

  async function run(action: () => Promise<{ p: { gameId: string } }>) {
    setBusy(true)
    setError(null)
    try {
      const created = await action()
      navigate(`/game/${created.p.gameId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function queueFor(mode: RankedMode) {
    setBusy(true)
    setError(null)
    try {
      await gameSocket.joinQueue(mode)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Two lanes on a wide browser, one stacked lane on a phone. The lanes are a
  // split by intent, not a cosmetic reflow: everything that STARTS a game is on
  // the left, everything you merely visit (rules, archives, hub screens) is on
  // the right, so a desktop player never scrolls past the play buttons to reach
  // the shop. Below the breakpoint the grid collapses and the order below is
  // exactly the order a phone reads.
  return (
    <div className="screen">
      <TopBar />
      <img className="logo" src={themeAsset('logo')} alt="Metarchy" />

      <div className="home-grid">
        <div className="home-col">
          <button
            className="btn home-cta"
            disabled={!online || busy || !!activeGame || !!queue}
            onClick={() => void run(() => gameSocket.createGame({ mode: 'tutorial' }))}
          >
            🎓 {t('home.tutorial')}
          </button>

          {activeGame && (
            <div className="panel">
              <h2>{t('home.inProgress')}</h2>
              <button className="btn" onClick={() => navigate(`/game/${activeGame.gameId}`)}>
                {t('home.returnToBoard')}
              </button>
            </div>
          )}

          {queue ? (
            <QueuePanel queue={queue} />
          ) : (
            <div className="panel">
              <h2>{t('home.ranked')}</h2>
              <div className="row">
                <button
                  className="btn"
                  disabled={!online || busy || !!activeGame}
                  onClick={() => void queueFor('1v1')}
                >
                  {t('home.find1v1')}
                </button>
                <button
                  className="btn"
                  disabled={!online || busy || !!activeGame}
                  onClick={() => void queueFor('ffa3')}
                >
                  {t('home.findFfa3')}
                </button>
              </div>
              <p className="hint-text">{t('home.rankedHint')}</p>
            </div>
          )}

          <div className="panel">
            <h2>{t('home.play')}</h2>
            <div className="row" style={{ marginBottom: 10 }}>
              <button
                className="btn"
                disabled={!online || busy || !!activeGame || !!queue}
                onClick={() => void run(() => gameSocket.createGame({ mode: 'vs_bots' }))}
              >
                {t('home.vsBot')}
              </button>
              <button
                className="btn"
                disabled={!online || busy || !!activeGame || !!queue}
                onClick={() =>
                  void run(() => gameSocket.createGame({ mode: 'vs_bots', seatCount: 3 }))
                }
              >
                {t('home.vs2Bots')}
              </button>
            </div>
            <div className="row">
              <button
                className="btn"
                disabled={!online || busy || !!activeGame || !!queue}
                onClick={() =>
                  void run(() => gameSocket.createGame({ mode: '1v1', private: true }))
                }
              >
                {t('home.private1v1')}
              </button>
              <button
                className="btn"
                disabled={!online || busy || !!activeGame || !!queue}
                onClick={() =>
                  void run(() => gameSocket.createGame({ mode: 'ffa3', private: true }))
                }
              >
                {t('home.private3p')}
              </button>
              <button
                className="btn"
                disabled={!online || busy || !!activeGame || !!queue}
                onClick={() =>
                  void run(() => gameSocket.createGame({ mode: '2v2', private: true }))
                }
              >
                {t('home.private2v2')}
              </button>
            </div>
            <p className="hint-text">{t('home.privateHint')}</p>
          </div>

          <div className="panel">
            <h2>{t('home.joinByCode')}</h2>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                void run(() => gameSocket.joinGame(inviteInput.trim().toUpperCase()))
              }}
            >
              <input
                type="text"
                placeholder="ABC123"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                maxLength={6}
                style={{ textTransform: 'uppercase', letterSpacing: '0.3em' }}
              />
              <button
                className="btn"
                type="submit"
                disabled={!online || busy || inviteInput.trim().length !== 6 || !!activeGame}
              >
                {t('home.join')}
              </button>
            </form>
            <p className="error-text">{error}</p>
          </div>
        </div>

        <div className="home-col">
          {/* One tile grid instead of five stacked full-width rows: the labels are
              one long word in several languages ("LEADERBOARD", "Таблица лидеров"),
              so they get their own auto-fit track rather than a fixed count that
              overflows the moment a translation grows. */}
          <nav className="panel home-links">
            <div className="home-nav">
              <button className="btn secondary" onClick={() => navigate('/tutorial')}>
                {t('home.howToPlay')}
              </button>
              <button className="btn secondary" onClick={() => navigate('/rules')}>
                {t('home.rules')}
              </button>
              <button className="btn secondary" onClick={() => navigate('/watch')}>
                {t('home.watchGame')}
              </button>
              <button className="btn secondary" onClick={() => navigate('/replays')}>
                {t('replay.title')}
              </button>
              {/* The persisted chat: the global room and private messages. The
                  dot is the only thing in the app that tells a player somebody
                  wrote to them — without it a DM arrives into silence. */}
              <button
                className={`btn secondary ${dmUnread ? 'has-unread' : ''}`}
                onClick={() => navigate('/chat')}
              >
                💬 {t('chat.title')}
              </button>
              <button className="btn secondary" onClick={() => navigate('/leaderboard')}>
                {t('home.leaderboard')}
              </button>
              <button className="btn secondary" onClick={() => navigate('/players')}>
                {t('home.players')}
              </button>
              <button className="btn secondary" onClick={() => navigate('/shop')}>
                {t('home.shop')}
              </button>
              <button className="btn secondary" onClick={() => navigate('/market')}>
                {t('home.market')}
              </button>
              <button className="btn secondary" onClick={() => navigate('/settings')}>
                {t('home.settings')}
              </button>
            </div>
          </nav>

          {feedbackOpen ? (
            <div className="panel">
              <h2>{t('home.feedback')}</h2>
              <textarea
                className="feedback-input"
                placeholder={t('home.feedbackPlaceholder')}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                maxLength={500}
                rows={4}
              />
              {feedbackState === 'sent' && <p className="hint-text">{t('home.feedbackThanks')}</p>}
              {feedbackState === 'failed' && (
                <p className="error-text">{t('home.feedbackFailed')}</p>
              )}
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn secondary"
                  onClick={() => {
                    setFeedbackOpen(false)
                    setFeedbackState('idle')
                  }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="btn"
                  disabled={feedbackState === 'sending' || feedbackText.trim().length === 0}
                  onClick={() => void submitFeedback()}
                >
                  {feedbackState === 'sending' ? t('home.sending') : t('home.send')}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn secondary" onClick={() => setFeedbackOpen(true)}>
              {t('home.feedback')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
