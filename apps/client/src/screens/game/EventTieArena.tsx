// P1 event tie-break as a full conflict scene, the prototype way
// (Meta_scratch Phase1Event → ConflictResolutionView): when the tied party is
// ME, the small event modal gives way to the arena — Square closeup backdrop
// (the prototype's fallback stage for non-location conflicts), the tied
// PLAYERS standing as big avatar cards in their seat colors, RPS coins sealed
// until everyone throws. Spectators keep the compact modal.
//
// The engine resolves rounds in secret but publishes every settled round
// (tiebreak.choicesRevealed → TieBreakView.revealed / ack tiebreakChoices),
// so participants get the reveal: repeated rounds show the previous throws,
// and the final round flips every coin open next to the outcome.

import { motion } from 'framer-motion'
import type { EventCardId, PlayerView, Rps, SeatId } from '@metarchy/engine'
import type { ClientIntent } from '@metarchy/protocol'
import { useT } from '../../i18n/index.js'
import { useDomain } from '../../i18n/domain.js'
import { useArgCoins } from '../../lib/argCoins.js'
import { useGameStore } from '../../stores/game.js'
import { themeAsset } from '../../theme.js'
import { SEAT_COLORS } from '../../board/layout.js'
import { ModalOverlay } from './ModalOverlay.js'

const RPS_CHOICES: readonly Rps[] = ['rock', 'paper', 'scissors']

function seatColorCss(seat: SeatId): string {
  return `#${SEAT_COLORS[seat].toString(16).padStart(6, '0')}`
}

export type EventTieResult = {
  /** Final round throws, seat → gesture. */
  choices: Partial<Record<SeatId, Rps>>
  winnerSeats: SeatId[]
  text: string
}

function PlayerCard({
  seat,
  view,
  coin,
  prevCoin,
  done,
  outcome
}: {
  seat: SeatId
  view: PlayerView
  coin: Rps | null
  /** Last settled round's throw — shown dimmed until a fresh pick replaces it. */
  prevCoin: Rps | null
  done: boolean
  outcome: 'win' | 'lose' | null
}) {
  const t = useT()
  const d = useDomain()
  const argCoin = useArgCoins()
  const players = useGameStore((s) => s.players)
  const summary = players.find((p) => p.seat === seat)
  const mine = seat === view.seat
  const color = seatColorCss(seat)
  // The ghost preset doubles as "no avatar chosen" (prototype: anonymous mask).
  const avatar = summary?.avatar ?? 'ghost'

  return (
    <div className={`arena-card ${outcome === 'lose' ? 'lost' : ''}`}>
      <div
        className="arena-player-frame"
        style={{ borderColor: color, boxShadow: `0 0 28px ${color}66` }}
      >
        <img src={themeAsset(`avatar.${avatar}`)} alt="" draggable={false} />
        {done && <span className="arena-done">✓</span>}
      </div>
      <span className="arena-name" style={{ color }}>
        {mine
          ? t('game.you')
          : summary
            ? `${summary.nickname}${summary.bot ? ' 🤖' : ''}`
            : t('game.seat', { n: seat })}
      </span>
      <div className="arena-arg">
        {coin ? (
          <motion.img
            key={coin}
            src={argCoin(coin, seat)}
            alt={coin}
            initial={{ rotateY: 90, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            transition={{ duration: 0.3 }}
          />
        ) : prevCoin ? (
          <motion.img
            key={`prev-${prevCoin}`}
            className="arena-arg-prev"
            src={argCoin(prevCoin, seat)}
            alt={prevCoin}
            initial={{ rotateY: 90, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 0.55 }}
            transition={{ duration: 0.3 }}
          />
        ) : (
          <span className="arena-sealed">?</span>
        )}
      </div>
      {outcome && (
        <motion.span
          className={`outcome-badge ${outcome}`}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
        >
          {d.bet(outcome).toUpperCase()}
        </motion.span>
      )}
    </div>
  )
}

export function EventTieArena({
  view,
  send,
  card,
  participants,
  round,
  chosen,
  myChoice,
  revealed,
  discarded,
  result
}: {
  view: PlayerView
  send(intent: ClientIntent): void
  card: EventCardId
  participants: SeatId[]
  round: number
  chosen: SeatId[]
  myChoice: Rps | null
  /** Previous settled round's throws (rounds 2+). */
  revealed?: { round: number; choices: Partial<Record<SeatId, Rps>> } | null
  /** Discard-event stakes revealed before the tie (seat → amount). */
  discarded?: Partial<Record<SeatId, number>>
  /** Final reveal + outcome; when set the arena is in result mode. */
  result?: EventTieResult
}) {
  const t = useT()
  const d = useDomain()
  const argCoin = useArgCoins()
  const players = useGameStore((s) => s.players)
  const nameOf = (seat: SeatId): string => {
    if (seat === view.seat) return t('game.you')
    const p = players.find((x) => x.seat === seat)
    return p ? p.nickname : t('game.seat', { n: seat })
  }
  const throwsLine = (choices: Partial<Record<SeatId, Rps>>): string =>
    Object.entries(choices)
      .map(([seat, c]) => `${nameOf(Number(seat) as SeatId)}: ${c ? d.argument(c) : '?'}`)
      .join(' · ')

  const waitingOnMe = view.waitingOn.includes(view.seat)
  // A watcher rides along in the arena (author request: watching a tie is the
  // interesting part) but throws nothing — and sees only what the engine has
  // already settled, so a live game cannot be coached from the stands.
  const spectator = view.spectator === true

  return (
    <ModalOverlay>
      <motion.div
        className="panel arena"
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <div
          className="arena-backdrop"
          style={{ backgroundImage: `url(${themeAsset('location.square.closeup')})` }}
        />
        <div className="arena-content">
          <p className="hud-label">
            {result ? t('game.event.tieResolved') : t('game.event.tieRoundN', { n: round })}
          </p>
          <h2>{d.eventCard(card)}</h2>
          {discarded && (
            <p className="hint-text arena-waiting">
              {Object.entries(discarded)
                .map(([seat, n]) =>
                  t('game.event.discardedInline', {
                    who: nameOf(Number(seat) as SeatId),
                    n: n ?? 0
                  })
                )
                .join(' · ')}
            </p>
          )}

          <div className="arena-participants">
            {participants.map((seat) => (
              <PlayerCard
                key={seat}
                seat={seat}
                view={view}
                coin={
                  result ? (result.choices[seat] ?? null) : seat === view.seat ? myChoice : null
                }
                prevCoin={result ? null : (revealed?.choices[seat] ?? null)}
                done={!result && chosen.includes(seat)}
                outcome={result ? (result.winnerSeats.includes(seat) ? 'win' : 'lose') : null}
              />
            ))}
          </div>

          {result ? (
            <>
              <p className="hint-text arena-waiting">{result.text}</p>
              {waitingOnMe ? (
                <button className="btn" onClick={() => send({ type: 'event.ack' })}>
                  {t('game.getIt')}
                </button>
              ) : (
                <p className="hint-text arena-waiting">{t('game.waitingOthers')}</p>
              )}
            </>
          ) : (
            <>
              {revealed && (
                <p className="hint-text arena-waiting">
                  {t('game.event.tieAgain', {
                    n: revealed.round,
                    list: throwsLine(revealed.choices)
                  })}
                </p>
              )}
              <p className="hint-text arena-waiting">{t('game.event.rpsWinnerEvent')}</p>
              {spectator ? (
                <p className="hint-text arena-waiting">
                  {t('game.event.thrownCount', { n: chosen.length, total: participants.length })}
                </p>
              ) : myChoice === null ? (
                <div className="row">
                  {RPS_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      className="btn arena-rps"
                      onClick={() => send({ type: 'tiebreak.rps', choice })}
                    >
                      <img src={argCoin(choice)} alt="" />
                      {d.argument(choice)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="hint-text arena-waiting">{t('game.event.throwSealed')}</p>
              )}
            </>
          )}
        </div>
      </motion.div>
    </ModalOverlay>
  )
}
