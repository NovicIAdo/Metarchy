// The end-of-Phase-4 recap, every turn (author request): "в конце Фазы 4, на всех
// ходах, надо выводить суммари окошко для всех игроков, в котором будет подводиться
// итог, в каких локациях были какие конфликты, и какие акторы сколько принесли и
// каких ценностей / ресурсов и каким игрокам… И если в фазе 4 конфликтов не было,
// значит выдавать суммари, что конфликтов не произошло, и какие Акторы сколько чего
// кому принесли."
//
// It is a consensus gate like every other ack: 15 seconds on the server clock, or
// sooner once everyone has pressed Get It. A watcher sees the same screen without
// the button — the recap is public by construction (each reward in it was already
// a public event when it happened).

import type {
  PlayerView,
  ResourceType,
  SeatId,
  TurnSummaryEntry,
  ValueType
} from '@metarchy/engine'
import type { ReactElement } from 'react'
import type { ClientIntent } from '@metarchy/protocol'
import { motion } from 'framer-motion'
import { useDomain } from '../../i18n/domain.js'
import { useT } from '../../i18n/index.js'
import { ActorHead } from '../../components/ActorHead.js'
import { useGameStore } from '../../stores/game.js'
import { ModalOverlay } from './ModalOverlay.js'

/** Non-null only while Phase 4 is showing its recap. */
export function turnSummaryOf(
  view: PlayerView | null
): { entries: TurnSummaryEntry[]; acked: SeatId[] } | null {
  if (!view || view.phase.kind !== 'p4_conflict') return null
  const stage = view.phase.stage
  if (stage.t !== 'summary_ack') return null
  return { entries: view.phase.summary, acked: stage.acked }
}

export function TurnSummary({
  view,
  send,
  nameOf
}: {
  view: PlayerView
  send: (intent: ClientIntent) => void
  nameOf: (seat: SeatId) => string
}) {
  const t = useT()
  const domain = useDomain()
  const players = useGameStore((s) => s.players)
  const summary = turnSummaryOf(view)
  if (!summary) return null

  const spectator = view.spectator === true
  const myAck = !spectator && summary.acked.includes(view.seat)
  const contested = summary.entries.filter((e) => !e.peaceful)
  const alone = summary.entries.filter((e) => e.peaceful)

  /** "+2 Power to Anna" — the whole point of the screen, per the author. */
  const rewardLine = (entry: TurnSummaryEntry): ReactElement[] =>
    entry.results.map((r) => {
      const unit =
        r.reward === null
          ? null
          : r.reward.kind === 'value'
            ? domain.value(r.reward.type as ValueType)
            : domain.resource(r.reward.type as ResourceType)
      return (
        <li key={r.actorId} className={`summary-result ${r.outcome}`}>
          <ActorHead
            className="summary-actor-icon"
            type={entry.actorType}
            wardrobe={players.find((p) => p.seat === r.seat)?.wardrobe ?? null}
          />
          <span className="summary-who">{nameOf(r.seat)}</span>
          <span className="summary-outcome">{t('bet.' + r.outcome)}</span>
          <span className="summary-reward">
            {r.reward === null
              ? t('summary.nothing')
              : t('summary.gained', { n: r.reward.amount, unit: unit ?? r.reward.type })}
            {/* A Win bet is +1 of the same unit — say so, or the number looks wrong. */}
            {r.winBet ? ` · ${t('summary.winBet')}` : ''}
          </span>
        </li>
      )
    })

  return (
    <ModalOverlay className="summary-over">
      <motion.div
        className="panel turn-summary"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.22 }}
      >
        <p className="hud-label">{t('summary.header', { n: view.turn })}</p>
        <h2>{contested.length > 0 ? t('summary.title') : t('summary.noConflicts')}</h2>

        {contested.length > 0 && (
          <section className="summary-section">
            <p className="hud-label">{t('summary.conflicts')}</p>
            {contested.map((entry) => (
              <div key={`${entry.locationId}:${entry.actorType}`} className="summary-group">
                <p className="summary-where">
                  {domain.location(entry.locationId)} · {domain.actor(entry.actorType)}
                </p>
                <ul className="summary-results">{rewardLine(entry)}</ul>
              </div>
            ))}
          </section>
        )}

        {alone.length > 0 && (
          <section className="summary-section">
            {/* Named separately: with no conflicts at all this is the whole story. */}
            <p className="hud-label">{t('summary.unopposed')}</p>
            {alone.map((entry) => (
              <div key={`${entry.locationId}:${entry.actorType}`} className="summary-group">
                <p className="summary-where">
                  {domain.location(entry.locationId)} · {domain.actor(entry.actorType)}
                </p>
                <ul className="summary-results">{rewardLine(entry)}</ul>
              </div>
            ))}
          </section>
        )}

        {summary.entries.length === 0 && <p className="hint-text">{t('summary.empty')}</p>}

        {spectator ? (
          <p className="hint-text">{t('summary.watching')}</p>
        ) : myAck ? (
          <p className="hint-text waiting-pulse">
            {t('summary.waiting', { n: view.waitingOn.length })}
          </p>
        ) : (
          <button className="btn confirm" onClick={() => send({ type: 'conflict.summary.ack' })}>
            {t('game.getIt')}
          </button>
        )}
      </motion.div>
    </ModalOverlay>
  )
}
