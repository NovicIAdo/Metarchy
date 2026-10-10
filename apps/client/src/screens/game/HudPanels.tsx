// HUD chrome around the board: the top bar carries turn/phase, my
// resources/values/deck counters (prototype top strip), the server deadline,
// the Global Stats button and the connection status; the hand strip keeps the
// own cards on the table at all times (author backlog: table transparency).

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { PlayerView, ResourceType, ValueType } from '@metarchy/engine'
import { useCountdown } from '../../hooks/useCountdown.js'
import { useT } from '../../i18n/index.js'
import { useDomain } from '../../i18n/domain.js'
import { themeAsset } from '../../theme.js'
import { useGameStore } from '../../stores/game.js'
import { useSessionStore } from '../../stores/session.js'
import { valuesPoolIndex } from '../../stores/ui.js'

const RESOURCES: readonly ResourceType[] = ['product', 'electricity', 'recycling']
const VALUES: readonly ValueType[] = ['power', 'art', 'knowledge', 'fame']

/**
 * My standing at a glance — icon+count pairs in the middle of the top bar. A
 * watcher is seatless (view.seat is the sentinel -1), so it has no pool and no
 * stock of its own: the personal half would read as a row of fake zeroes and is
 * dropped. The deck counters are public and stay.
 */
function StatsStrip({ view }: { view: PlayerView }) {
  const t = useT()
  const d = useDomain()
  const values = view.spectator ? null : view.values[valuesPoolIndex(view)]
  return (
    <span className="hud-stats-strip">
      {!view.spectator && (
        <>
          {VALUES.map((v) => (
            <span key={v} className="hud-strip-stat" title={d.value(v)}>
              <img src={themeAsset(`value.${v}`)} alt={d.value(v)} />
              {values ? values[v] : 0}
            </span>
          ))}
          <span className="hud-strip-divider" />
          {RESOURCES.map((r) => (
            <span key={r} className="hud-strip-stat" title={d.resource(r)}>
              <img src={themeAsset(`resource.${r}`)} alt={d.resource(r)} />
              {view.me.resources[r]}
            </span>
          ))}
          <span className="hud-strip-divider" />
        </>
      )}
      <span className="hud-strip-stat" title={t('game.hud.eventsLeftDeck')}>
        <img src={themeAsset('deck.event')} alt={t('game.hud.eventDeck')} />
        {view.decks.event}
      </span>
      <span className="hud-strip-stat" title={t('game.hud.actionsLeftDeck')}>
        <img src={themeAsset('deck.action')} alt={t('game.hud.actionDeck')} />
        {view.decks.action}
      </span>
    </span>
  )
}

/**
 * The own hand, always on the table (author backlog) — a compact fan of card
 * art docked bottom-left (top-left on short screens). Tap opens Global Stats,
 * where the same cards render full-size with names.
 */
export function HandStrip({ view, onOpen }: { view: PlayerView; onOpen(): void }) {
  const t = useT()
  const d = useDomain()
  if (view.me.hand.length === 0) return null
  return (
    <button className="hud-hand" onClick={onOpen} title={t('game.hud.handTip')}>
      {view.me.hand.map((c) => (
        <img
          key={c.instanceId}
          className="hud-hand-card"
          src={themeAsset(`card.action.${c.card}`)}
          alt={d.actionCard(c.card)}
          draggable={false}
        />
      ))}
    </button>
  )
}

export function TopBar({ view, onStats }: { view: PlayerView | null; onStats(): void }) {
  const t = useT()
  const d = useDomain()
  const deadline = useGameStore((s) => s.deadline)
  const socketStatus = useSessionStore((s) => s.socketStatus)
  const remaining = useCountdown(deadline?.endsAt ?? null)

  const turnLabel = view
    ? view.isTieBreakerTurn
      ? t('game.hud.tiebreaker')
      : t('game.hud.turnOf', { n: view.turn, max: view.maxTurns })
    : t('game.hud.syncing')
  const phaseLabel = view ? d.phase(view.phase.kind) : ''

  // Body-portaled like the modals: .game-stage is position:fixed and therefore
  // its own stacking context — no z-index inside it can outrank a body-level
  // .modal-overlay. The bar must live at body level to stay clickable (Global
  // Stats, deadline) over the P1 event and the conflict arena.
  return createPortal(
    <div className="hud hud-top">
      <span className="hud-turn">
        {turnLabel}
        {phaseLabel && <span className="hud-phase"> · {phaseLabel}</span>}
      </span>
      {view && <StatsStrip view={view} />}
      <span className="hud-top-right">
        {remaining !== null && (
          <span className={`hud-deadline ${remaining <= 10 ? 'urgent' : ''}`}>⏱ {remaining}s</span>
        )}
        {view && (
          <button className="hud-stats-btn" onClick={onStats} title={t('game.hud.globalStats')}>
            ☰ {t('game.hud.stats')}
          </button>
        )}
        <span className="status-chip">
          <span className={`status-dot ${socketStatus}`} />
          {t(`status.${socketStatus}`)}
        </span>
      </span>
    </div>,
    document.body
  )
}

/** Transient server rejections (invalid intent, etc.) surface here. */
export function ErrorToast() {
  const lastError = useSessionStore((s) => s.lastError)
  const setError = useSessionStore((s) => s.setError)
  useEffect(() => {
    if (!lastError) return
    const timer = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timer)
  }, [lastError, setError])
  if (!lastError) return null
  return <div className="hud hud-toast">{lastError}</div>
}
