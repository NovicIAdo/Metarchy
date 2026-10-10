// Global stats (rulebook §Open Information), opened from the top-right button:
// every player's resources/values/hand size, my hand with card art, deck
// remainders, and the public play log of action cards AND events.

import type {
  PlayerView,
  ResourceType,
  Resources,
  SeatId,
  ValueType,
  Values
} from '@metarchy/engine'
import type { ActionCardId } from '@metarchy/engine'
import type { PlayerSummary } from '@metarchy/protocol'
import { useState } from 'react'
import { useT } from '../../i18n/index.js'
import { useDomain } from '../../i18n/domain.js'
import { themeAsset } from '../../theme.js'
import { useGameStore } from '../../stores/game.js'
import { SEAT_COLORS } from '../../board/layout.js'
import { ModalOverlay } from './ModalOverlay.js'
import { poolOfSeat } from './phase-helpers.js'

/** Big card art + name + rulebook description, shown when a card is tapped. */
function CardDetail({ card, onClose }: { card: ActionCardId; onClose(): void }) {
  const t = useT()
  const d = useDomain()
  return (
    <div className="card-detail-backdrop" onClick={onClose}>
      <div className="card-detail" onClick={(e) => e.stopPropagation()}>
        <img src={themeAsset(`card.action.${card}`)} alt="" draggable={false} />
        <h3>{d.actionCard(card)}</h3>
        <p>{d.actionCardRule(card)}</p>
        <button className="btn secondary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}

const RESOURCES: readonly ResourceType[] = ['product', 'electricity', 'recycling']
const VALUES: readonly ValueType[] = ['power', 'art', 'knowledge', 'fame']

function seatColorCss(seat: SeatId): string {
  // Defensive: a seat outside the roster (the spectator sentinel -1) has no
  // color, and an undefined here used to take the whole overlay down.
  return `#${(SEAT_COLORS[seat] ?? 0x8a8f98).toString(16).padStart(6, '0')}`
}

/**
 * The seat whose stats are "mine", or null while watching. A watcher's view is
 * seatless — `view.seat` is the sentinel -1, which is in no roster, has no seat
 * color and owns no resources — so every personal read must hang off this.
 */
function ownSeat(view: PlayerView): SeatId | null {
  return view.spectator ? null : view.seat
}

function PlayersSection({ view }: { view: PlayerView }) {
  const t = useT()
  const d = useDomain()
  const players = useGameStore((s) => s.players)
  const presence = useGameStore((s) => s.presence)

  const nameOf = (seat: SeatId): PlayerSummary | undefined => players.find((p) => p.seat === seat)
  // A watcher's `others` already lists every seat, so nothing is prepended —
  // folding the sentinel in both crashed seatColorCss and invented an own row.
  const mySeat = ownSeat(view)
  const seats = [...(mySeat === null ? [] : [mySeat]), ...view.others.map((o) => o.seat)].sort(
    (a, b) => a - b
  )

  const progressMark = (seat: SeatId): string => {
    if (view.eliminated.includes(seat)) return '☠'
    if (!view.activeSeats.includes(seat)) return ''
    return view.waitingOn.includes(seat) ? '…' : '✓'
  }

  const statsOf = (seat: SeatId): { resources: Resources | null; values: Values | null } => {
    if (seat === mySeat) return { resources: view.me.resources, values: poolOfSeat(view, seat) }
    return {
      resources: view.others.find((o) => o.seat === seat)?.resources ?? null,
      values: poolOfSeat(view, seat)
    }
  }
  const handCountOf = (seat: SeatId): number =>
    seat === mySeat
      ? view.me.hand.length
      : (view.others.find((o) => o.seat === seat)?.handCount ?? 0)

  return (
    <>
      <p className="hud-label">{t('game.stats.players')}</p>
      {seats.map((seat) => {
        const summary = nameOf(seat)
        const isMe = seat === mySeat
        const eliminated = view.eliminated.includes(seat)
        const seatPresence = presence[seat]
        const offline = seatPresence ? !seatPresence.connected && !summary?.bot : false
        const stats = statsOf(seat)
        return (
          <div key={seat} className={`hud-player ${eliminated ? 'eliminated' : ''}`}>
            <div className="hud-player-row">
              <span className="hud-seat-dot" style={{ background: seatColorCss(seat) }} />
              {summary?.avatar && (
                <img className="avatar-chip" src={themeAsset(`avatar.${summary.avatar}`)} alt="" />
              )}
              <span className="hud-player-name">
                {summary?.nickname ?? t('game.seat', { n: seat })}
                {summary?.bot ? ' 🤖' : ''}
                {isMe ? ` ${t('game.stats.you')}` : ''}
                {view.allies.includes(seat) ? ` ${t('game.stats.ally')}` : ''}
                {offline ? ' ⚡' : ''}
              </span>
              <span className="hud-player-mark">{progressMark(seat)}</span>
            </div>
            {!eliminated && stats.resources && (
              <div className="hud-player-stats">
                {RESOURCES.map((r) => (
                  <span key={r} className="hud-mini-stat" title={d.resource(r)}>
                    <img src={themeAsset(`resource.${r}`)} alt={d.resource(r)} />
                    {stats.resources?.[r] ?? 0}
                  </span>
                ))}
                <span className="hud-mini-stat" title={t('game.stats.cardsInHand')}>
                  <img src={themeAsset('deck.action')} alt={t('game.stats.cards')} />
                  {handCountOf(seat)}
                </span>
              </div>
            )}
            {!eliminated && stats.values && (
              <div className="hud-player-stats">
                {VALUES.map((v) => (
                  <span key={v} className="hud-mini-stat" title={d.value(v)}>
                    <img src={themeAsset(`value.${v}`)} alt={d.value(v)} />
                    {stats.values?.[v] ?? 0}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {view.teams && <p className="hint-text hud-note">{t('game.stats.teamPools')}</p>}
    </>
  )
}

export function GlobalStats({ view, onClose }: { view: PlayerView; onClose(): void }) {
  const t = useT()
  const d = useDomain()
  const players = useGameStore((s) => s.players)
  const [detail, setDetail] = useState<ActionCardId | null>(null)
  const mySeat = ownSeat(view)
  const nameOf = (seat: SeatId): string =>
    seat === mySeat
      ? t('game.youLower')
      : (players.find((p) => p.seat === seat)?.nickname ?? t('game.seat', { n: seat }))

  return (
    // stats-over: openable mid-conflict/mid-event, so it must outrank those
    // fullscreen overlays (they share .modal-overlay's base z-index).
    <ModalOverlay onClick={onClose} className="stats-over">
      <div className="panel global-stats" onClick={(e) => e.stopPropagation()}>
        <div className="chat-head">
          <h2 style={{ margin: 0 }}>{t('game.stats.title')}</h2>
          <button className="chat-close" aria-label={t('game.stats.closeStats')} onClick={onClose}>
            ✕
          </button>
        </div>

        <PlayersSection view={view} />

        {/* A watcher has no seat and no hand — everything below is about mine. */}
        {!view.spectator && (
          <>
            <p className="hud-label" style={{ marginTop: 12 }}>
              {t('game.stats.yourHand', { n: view.me.hand.length })}
            </p>
            {view.me.hand.length === 0 ? (
              <p className="hint-text">{t('game.action.noCardsHand')}</p>
            ) : (
              <div className="cards-hand">
                {view.me.hand.map((c) => (
                  <button
                    key={c.instanceId}
                    type="button"
                    className="cards-card"
                    onClick={() => setDetail(c.card)}
                    title={t('game.stats.tapEffect')}
                  >
                    <img src={themeAsset(`card.action.${c.card}`)} alt="" draggable={false} />
                    <figcaption>{d.actionCard(c.card)}</figcaption>
                  </button>
                ))}
              </div>
            )}
            <p className="hint-text">{t('game.stats.tapCard')}</p>
          </>
        )}

        <p className="hud-label" style={{ marginTop: 12 }}>
          {t('game.stats.decks')}
        </p>
        <div className="hud-player-stats">
          <span className="hud-mini-stat" title={t('game.stats.eventsLeft')}>
            <img src={themeAsset('deck.event')} alt={t('game.stats.events')} />
            {view.decks.event}
          </span>
          <span className="hud-mini-stat" title={t('game.stats.actionsLeft')}>
            <img src={themeAsset('deck.action')} alt={t('game.stats.actions')} />
            {view.decks.action}
          </span>
        </div>

        <p className="hud-label" style={{ marginTop: 12 }}>
          {t('game.stats.eventsPlayed')}
        </p>
        {view.eventsPlayed.length === 0 ? (
          <p className="hint-text">{t('game.stats.noEvents')}</p>
        ) : (
          <ul className="cards-played">
            {[...view.eventsPlayed].reverse().map((e, i) => (
              <li key={i}>
                <span className="cards-played-turn">
                  {t('game.stats.turnShort', { n: e.turn })}
                </span>
                <span className="cards-played-text">{d.eventCard(e.card)}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="hud-label" style={{ marginTop: 12 }}>
          {t('game.stats.actionsPlayed')}
        </p>
        {view.played.length === 0 ? (
          <p className="hint-text">{t('game.stats.nothingPlayed')}</p>
        ) : (
          <ul className="cards-played">
            {[...view.played].reverse().map((p, i) => (
              <li key={i}>
                <span className="cards-played-turn">
                  {t('game.stats.turnShort', { n: p.turn })}
                </span>
                <span className="hud-seat-dot" style={{ background: seatColorCss(p.seat) }} />
                <button
                  type="button"
                  className="cards-played-text as-link"
                  onClick={() => setDetail(p.card)}
                >
                  {nameOf(p.seat)} — {d.actionCard(p.card)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {detail && <CardDetail card={detail} onClose={() => setDetail(null)} />}
      </div>
    </ModalOverlay>
  )
}
