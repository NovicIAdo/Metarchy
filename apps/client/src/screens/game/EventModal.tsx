// P1 event modal (rulebook Phase 1): the drawn card with its art and rule text,
// then the stage flow — value comparison or secret discard, tie-breaks by RPS,
// and the winner reveal with "Get It!".

import { useEffect, useState } from 'react'
import type {
  EventCardId,
  EventWinner,
  PlayerView,
  ResourceType,
  Rps,
  SeatId
} from '@metarchy/engine'
import { COMPARE_EVENT_METRIC, DISCARD_EVENT_RESOURCE, eventKind } from '@metarchy/engine'
import type { ClientIntent } from '@metarchy/protocol'
import { motion } from 'framer-motion'
import { useT } from '../../i18n/index.js'
import { useDomain } from '../../i18n/domain.js'
import { gameSocket } from '../../net/socket.js'
import { useGameStore } from '../../stores/game.js'
import { useArgCoins } from '../../lib/argCoins.js'
import { themeAsset } from '../../theme.js'
import { SEAT_COLORS } from '../../board/layout.js'
import { EventTieArena } from './EventTieArena.js'
import { ModalOverlay } from './ModalOverlay.js'
import { poolOfSeat } from './phase-helpers.js'

const RPS_CHOICES: readonly Rps[] = ['rock', 'paper', 'scissors']

function useNameOf(): (seat: SeatId) => string {
  const t = useT()
  const players = useGameStore((s) => s.players)
  return (seat) => {
    const p = players.find((x) => x.seat === seat)
    return p ? `${p.nickname}${p.bot ? ' 🤖' : ''}` : t('game.seat', { n: seat })
  }
}

function seatColorCss(seat: SeatId): string {
  return `#${SEAT_COLORS[seat].toString(16).padStart(6, '0')}`
}

/**
 * Per-seat stock of the discard resource — public (rulebook §Open Information):
 * judging how deep the rivals' pockets are IS the decision this event poses.
 */
function stockRows(view: PlayerView, resource: ResourceType): { seat: SeatId; amount: number }[] {
  const seats = [view.seat, ...view.others.map((o) => o.seat)].sort((a, b) => a - b)
  return seats
    .filter((s) => view.activeSeats.includes(s))
    .map((seat) => ({
      seat,
      amount:
        seat === view.seat
          ? view.me.resources[resource]
          : (view.others.find((o) => o.seat === seat)?.resources?.[resource] ?? 0)
    }))
}

/** Per-seat metric values for compare events ('total' sums the three values + fame). */
function compareRows(view: PlayerView, card: EventCardId): { seat: SeatId; amount: number }[] {
  const metric = COMPARE_EVENT_METRIC[card as keyof typeof COMPARE_EVENT_METRIC]
  const seats = [view.seat, ...view.others.map((o) => o.seat)].sort((a, b) => a - b)
  return seats
    .filter((s) => view.activeSeats.includes(s))
    .map((seat) => {
      const pool = poolOfSeat(view, seat)
      if (!pool) return { seat, amount: 0 }
      const amount =
        metric === 'total'
          ? pool.power + pool.art + pool.knowledge + pool.fame
          : pool[metric as keyof typeof pool]
      return { seat, amount }
    })
}

export function EventModal({ view, send }: { view: PlayerView; send(intent: ClientIntent): void }) {
  const t = useT()
  const d = useDomain()
  const argCoin = useArgCoins()
  const [amount, setAmount] = useState(0)
  const nameOf = useNameOf()
  const allyStaging = useGameStore((s) => s.allyStaging)

  // 2v2 team transparency: stream the discard slider to the ally (debounced;
  // ally-only relay). Stops the moment my amount is sealed.
  const allyLive = !view.spectator && !!view.teams && view.allies.length > 0
  useEffect(() => {
    if (!allyLive || view.phase.kind !== 'p1_event') return
    const stage = view.phase.stage
    if (stage.t !== 'discard_commit' || stage.myAmount !== null) return
    if (!view.waitingOn.includes(view.seat)) return
    const resource = DISCARD_EVENT_RESOURCE[view.phase.card as keyof typeof DISCARD_EVENT_RESOURCE]
    const chosen = Math.min(amount, resource ? view.me.resources[resource] : 0)
    const gameId = useGameStore.getState().activeGame?.gameId
    if (!gameId) return
    const timer = setTimeout(() => {
      gameSocket.sendTeamStaging(gameId, { kind: 'discard', turn: view.turn, amount: chosen })
    }, 200)
    return () => clearTimeout(timer)
  }, [amount, allyLive, view])

  const phase = view.phase
  if (phase.kind !== 'p1_event') return null
  const card = phase.card
  const stage = phase.stage
  const waitingOnMe = view.waitingOn.includes(view.seat)
  // Watchers see the same event, minus every control. The engine already hands
  // them public data only (sealed amounts and unthrown coins stay hidden), so
  // nothing here can leak a live decision to the stands.
  const spectator = view.spectator === true
  const kind = eventKind(card)

  const waiting = <p className="hint-text arena-waiting">{t('game.waitingOthers')}</p>
  const rpsRow = (type: 'tiebreak.rps') => (
    <div className="row">
      {RPS_CHOICES.map((choice) => (
        <button key={choice} className="btn arena-rps" onClick={() => send({ type, choice })}>
          <img src={argCoin(choice)} alt="" />
          {d.argument(choice)}
        </button>
      ))}
    </div>
  )

  let body: React.ReactNode = null

  if (stage.t === 'compare_ack') {
    const rows = compareRows(view, card)
    // PhaseView deliberately types this as unknown; the engine shape is EventWinner.
    const winner = stage.winner as EventWinner | null
    const winnerSeats =
      winner === null
        ? []
        : winner.kind === 'seat'
          ? [winner.seat]
          : (view.teams?.[winner.team] ?? [])
    // The event went through a tie-break I fought in → the arena plays the
    // reveal (everyone's final throw) next to the outcome. Spectators and
    // clean comparisons keep the compact modal below.
    if (stage.tiebreakChoices && (spectator || stage.tiebreakChoices[view.seat] !== undefined)) {
      return (
        <EventTieArena
          view={view}
          send={send}
          card={card}
          participants={Object.keys(stage.tiebreakChoices).map((s) => Number(s) as SeatId)}
          round={0}
          chosen={[]}
          myChoice={null}
          result={{
            choices: stage.tiebreakChoices,
            winnerSeats,
            text:
              winner === null
                ? t('game.event.noReward')
                : winnerSeats.includes(view.seat)
                  ? t('game.event.youTieWin', { fame: d.value('fame') })
                  : t('game.event.othersTieWin', {
                      names: winnerSeats.map((s) => nameOf(s)).join(', '),
                      fame: d.value('fame')
                    })
          }}
        />
      )
    }
    body = (
      <>
        <ul className="event-rows">
          {rows.map((r) => (
            <li key={r.seat} className={winnerSeats.includes(r.seat) ? 'winner' : ''}>
              <span className="hud-seat-dot" style={{ background: seatColorCss(r.seat) }} />
              <span className="event-row-name">
                {r.seat === view.seat ? t('game.you') : nameOf(r.seat)}
              </span>
              <b>{r.amount}</b>
            </li>
          ))}
        </ul>
        <p className="hint-text arena-waiting">
          {winner === null
            ? t('game.event.noReward')
            : winnerSeats.includes(view.seat)
              ? t('game.event.leastYouWin', { fame: d.value('fame') })
              : t('game.event.othersWin', {
                  names: winnerSeats.map((s) => nameOf(s)).join(', '),
                  fame: d.value('fame')
                })}
        </p>
        {waitingOnMe ? (
          <button className="btn" onClick={() => send({ type: 'event.ack' })}>
            {t('game.getIt')}
          </button>
        ) : (
          waiting
        )}
      </>
    )
  } else if (stage.t === 'compare_standoff') {
    // User rule: never throw players into the tie-break arena unannounced —
    // show the tied minimum first; everyone confirms (10s deadline auto-confirms).
    const rows = compareRows(view, card)
    const tiedNames = stage.participants
      .map((s) => (s === view.seat ? t('game.youLower') : nameOf(s)))
      .join(', ')
    body = (
      <>
        <ul className="event-rows">
          {rows.map((r) => (
            <li key={r.seat} className={stage.participants.includes(r.seat) ? 'winner' : ''}>
              <span className="hud-seat-dot" style={{ background: seatColorCss(r.seat) }} />
              <span className="event-row-name">
                {r.seat === view.seat ? t('game.you') : nameOf(r.seat)}
              </span>
              <b>{r.amount}</b>
            </li>
          ))}
        </ul>
        <p className="hint-text arena-waiting">{t('game.event.standoff', { names: tiedNames })}</p>
        {waitingOnMe ? (
          <button className="btn" onClick={() => send({ type: 'event.ack' })}>
            {t('game.event.resolveConflict')}
          </button>
        ) : (
          waiting
        )}
      </>
    )
  } else if (stage.t === 'compare_tiebreak' || stage.t === 'discard_tiebreak') {
    const tiebreak = stage.tiebreak
    // My tie → the full conflict scene, prototype-style (Meta_scratch renders
    // the same ConflictResolutionView it uses for location conflicts).
    // Spectators keep the compact modal below.
    if (spectator || tiebreak.participants.includes(view.seat)) {
      return (
        <EventTieArena
          view={view}
          send={send}
          card={card}
          participants={tiebreak.participants}
          round={tiebreak.round}
          chosen={tiebreak.chosen}
          myChoice={tiebreak.myChoice}
          revealed={tiebreak.revealed}
          {...(stage.t === 'discard_tiebreak' ? { discarded: stage.revealed } : {})}
        />
      )
    }
    const mine = tiebreak.participants.includes(view.seat) && tiebreak.myChoice === null
    body = (
      <>
        {stage.t === 'discard_tiebreak' && (
          <ul className="event-rows">
            {Object.entries(stage.revealed).map(([seat, discarded]) => (
              <li key={seat}>
                <span
                  className="hud-seat-dot"
                  style={{ background: seatColorCss(Number(seat) as SeatId) }}
                />
                <span className="event-row-name">
                  {t('game.event.discardedRow', {
                    who: Number(seat) === view.seat ? t('game.you') : nameOf(Number(seat) as SeatId)
                  })}
                </span>
                <b>{discarded}</b>
              </li>
            ))}
          </ul>
        )}
        <p className="hint-text arena-waiting">
          {t('game.event.tieBetween', {
            names: tiebreak.participants
              .map((s) => (s === view.seat ? t('game.youLower') : nameOf(s)))
              .join(', '),
            n: tiebreak.round
          })}
        </p>
        {mine ? rpsRow('tiebreak.rps') : waiting}
      </>
    )
  } else if (stage.t === 'discard_commit') {
    const resource = DISCARD_EVENT_RESOURCE[card as keyof typeof DISCARD_EVENT_RESOURCE]
    const max = resource ? view.me.resources[resource] : 0
    const chosen = Math.min(amount, max)
    const rows = resource ? stockRows(view, resource) : []
    // 2v2 ally transparency: their sealed amount (engine-shared) or the live
    // slider (team.staging relay) rides on the ally's stock row.
    const sealedAmounts = new Map(stage.sealed.map((s) => [s.seat, s.amount]))
    const allyPlanOf = (seat: SeatId): { amount: number; sealed: boolean } | null => {
      if (!view.allies.includes(seat)) return null
      const sealedAmount = sealedAmounts.get(seat)
      if (sealedAmount !== undefined) return { amount: sealedAmount, sealed: true }
      if (
        allyStaging &&
        allyStaging.fromSeat === seat &&
        allyStaging.staging.kind === 'discard' &&
        allyStaging.staging.turn === view.turn
      )
        return { amount: allyStaging.staging.amount, sealed: false }
      return null
    }
    body = (
      <>
        <p className="hud-label">
          {resource ? t('game.event.resourceOnHand', { res: d.resource(resource) }) : ''}
        </p>
        <ul className="event-rows">
          {rows.map((r) => {
            const allyPlan = allyPlanOf(r.seat)
            return (
              <li key={r.seat}>
                <span className="hud-seat-dot" style={{ background: seatColorCss(r.seat) }} />
                <span className="event-row-name">
                  {r.seat === view.seat ? t('game.you') : nameOf(r.seat)}
                </span>
                <b>{r.amount}</b>
                {allyPlan && (
                  <span className={`ally-discard ${allyPlan.sealed ? 'sealed' : 'live'}`}>
                    🤝{' '}
                    {allyPlan.sealed
                      ? t('game.ally.discardSealed', { n: allyPlan.amount })
                      : t('game.ally.discardPlanning', { n: allyPlan.amount })}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        {spectator ? (
          <p className="hint-text arena-waiting">
            {t('game.event.sealedCount', {
              n: stage.committedSeats.length,
              total: rows.length
            })}
          </p>
        ) : stage.myAmount !== null || !waitingOnMe ? (
          <p className="hint-text arena-waiting">{t('game.event.discardSealed')}</p>
        ) : (
          <>
            <div className="row" style={{ alignItems: 'center' }}>
              <img
                className="event-resource-icon"
                src={themeAsset(`resource.${resource}`)}
                alt=""
              />
              <input
                type="range"
                min={0}
                max={max}
                value={chosen}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
              <span className="scaffold-amount">
                {chosen}/{max} {resource ? d.resource(resource) : ''}
              </span>
            </div>
            <button
              className="btn confirm"
              onClick={() => send({ type: 'event.discard', amount: chosen })}
            >
              ✓ {t('game.confirm')}
            </button>
          </>
        )}
      </>
    )
  } else {
    // discard_ack
    const resultText =
      stage.winner === null
        ? t('game.event.discardNoWinner')
        : stage.winner === view.seat
          ? stage.drewCard
            ? t('game.event.youDiscardMostCard')
            : t('game.event.youDiscardMostEmpty')
          : stage.drewCard
            ? t('game.event.otherDiscardMostCard', { who: nameOf(stage.winner) })
            : t('game.event.otherDiscardMostEmpty', { who: nameOf(stage.winner) })
    // Same arena-reveal routing as compare_ack: my tie-break ends on stage.
    if (stage.tiebreakChoices && (spectator || stage.tiebreakChoices[view.seat] !== undefined)) {
      return (
        <EventTieArena
          view={view}
          send={send}
          card={card}
          participants={Object.keys(stage.tiebreakChoices).map((s) => Number(s) as SeatId)}
          round={0}
          chosen={[]}
          myChoice={null}
          {...(stage.revealed ? { discarded: stage.revealed } : {})}
          result={{
            choices: stage.tiebreakChoices,
            winnerSeats: stage.winner === null ? [] : [stage.winner],
            text: resultText
          }}
        />
      )
    }
    body = (
      <>
        {stage.revealed && (
          <ul className="event-rows">
            {Object.entries(stage.revealed).map(([seat, discarded]) => (
              <li key={seat} className={Number(seat) === stage.winner ? 'winner' : ''}>
                <span
                  className="hud-seat-dot"
                  style={{ background: seatColorCss(Number(seat) as SeatId) }}
                />
                <span className="event-row-name">
                  {t('game.event.discardedRow', {
                    who: Number(seat) === view.seat ? t('game.you') : nameOf(Number(seat) as SeatId)
                  })}
                </span>
                <b>{discarded}</b>
              </li>
            ))}
          </ul>
        )}
        <p className="hint-text arena-waiting">{resultText}</p>
        {waitingOnMe ? (
          <button className="btn" onClick={() => send({ type: 'event.ack' })}>
            {t('game.getIt')}
          </button>
        ) : (
          waiting
        )}
      </>
    )
  }

  return (
    <ModalOverlay>
      <motion.div
        className="panel event-modal"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25 }}
      >
        <div className="event-head">
          <img className="event-art" src={themeAsset(`card.event.${card}`)} alt="" />
          <div>
            <p className="hud-label">
              {kind === 'compare' ? t('game.event.headCompare') : t('game.event.headDiscard')}
            </p>
            <h2>{d.eventCard(card)}</h2>
            <p className="event-rule">{d.eventCardRule(card)}</p>
          </div>
        </div>
        {body}
      </motion.div>
    </ModalOverlay>
  )
}
