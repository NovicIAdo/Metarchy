// P3 results ceremonies: after each wave of action cards resolves — blocks,
// then relocations, then value exchanges — every player gets one screen with
// everything that wave did ("X played Sabotage, the Factory is offline"),
// held until they hit Get It! (engine ack stages; bots and deadline defaults
// ack instantly). At most three per turn, none when nothing was played.

import { motion } from 'framer-motion'
import type { ActorType, PlayerView, SeatId } from '@metarchy/engine'
import type { ClientIntent } from '@metarchy/protocol'
import { useT } from '../../i18n/index.js'
import { useDomain } from '../../i18n/domain.js'
import { ActorHead } from '../../components/ActorHead.js'
import { useGameStore } from '../../stores/game.js'
import { themeAsset } from '../../theme.js'
import { SEAT_COLORS } from '../../board/layout.js'
import { ModalOverlay } from './ModalOverlay.js'

function seatColorCss(seat: SeatId): string {
  return `#${SEAT_COLORS[seat].toString(16).padStart(6, '0')}`
}

function useNameOf(view: PlayerView): (seat: SeatId) => string {
  const t = useT()
  const players = useGameStore((s) => s.players)
  return (seat) => {
    if (seat === view.seat) return t('game.you')
    const p = players.find((x) => x.seat === seat)
    return p ? `${p.nickname}${p.bot ? ' 🤖' : ''}` : t('game.seat', { n: seat })
  }
}

export function ActionResultsModal({
  view,
  send
}: {
  view: PlayerView
  send(intent: ClientIntent): void
}) {
  const t = useT()
  const d = useDomain()
  const nameOf = useNameOf(view)
  const players = useGameStore((s) => s.players)
  const phase = view.phase
  if (phase.kind !== 'p3_action') return null
  const step = phase.step
  if (step.t !== 'blocks_ack' && step.t !== 'relocations_ack' && step.t !== 'exchanges_ack')
    return null

  const waitingOnMe = view.waitingOn.includes(view.seat)

  let title = ''
  let rows: React.ReactNode = null
  if (step.t === 'blocks_ack') {
    title = t('game.results.titleBlocked')
    rows = (
      <ul className="event-rows">
        {step.blocks.map((b, i) => (
          <li key={i}>
            <img className="results-card-art" src={themeAsset(`card.action.${b.card}`)} alt="" />
            <span className="hud-seat-dot" style={{ background: seatColorCss(b.seat) }} />
            <span className="event-row-name">
              {t('game.results.blockedPre', { who: nameOf(b.seat), card: d.actionCard(b.card) })}{' '}
              <b>{d.location(b.locationId)}</b> {t('game.results.blockedPost')}
            </span>
          </li>
        ))}
      </ul>
    )
  } else if (step.t === 'relocations_ack') {
    title = t('game.results.titleReloc')
    rows =
      step.moves.length === 0 ? (
        <p className="hint-text arena-waiting">{t('game.results.relocNone')}</p>
      ) : (
        <ul className="event-rows">
          {step.moves.map((m, i) => {
            const ownerSeat = Number(m.actorId.split(':')[0]) as SeatId
            const actorType = m.actorId.split(':')[1] as ActorType
            const wardrobe = players.find((p) => p.seat === ownerSeat)?.wardrobe ?? null
            return (
              <li key={i}>
                <ActorHead className="results-card-art" type={actorType} wardrobe={wardrobe} />
                <span className="hud-seat-dot" style={{ background: seatColorCss(m.seat) }} />
                <span className="event-row-name">
                  {t('game.results.relocPre', {
                    who: nameOf(m.seat),
                    card: d.actionCard('relocation'),
                    actor: d.actor(actorType),
                    owner: ownerSeat === view.seat ? t('game.youLower') : nameOf(ownerSeat)
                  })}{' '}
                  <b>{d.location(m.from)}</b> → <b>{d.location(m.to)}</b>
                </span>
              </li>
            )
          })}
        </ul>
      )
  } else {
    title = t('game.results.titleExch')
    rows = (
      <ul className="event-rows">
        {step.exchanges.map((x, i) => (
          <li key={i}>
            <img
              className="results-card-art"
              src={themeAsset('card.action.change_values')}
              alt=""
            />
            <span className="hud-seat-dot" style={{ background: seatColorCss(x.seat) }} />
            <span className="event-row-name">
              {t('game.results.exchPre', {
                who: nameOf(x.seat),
                card: d.actionCard('change_values')
              })}{' '}
              <b>{d.value(x.give)}</b> {t('game.results.exchMid', { to: nameOf(x.from) })}{' '}
              <b>{d.value(x.take)}</b>
              {t('game.results.exchPost')}
            </span>
          </li>
        ))}
      </ul>
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
        <p className="hud-label">{t('game.results.header')}</p>
        <h2>{title}</h2>
        {rows}
        {waitingOnMe ? (
          <button className="btn" onClick={() => send({ type: 'action.ack' })}>
            {t('game.getIt')}
          </button>
        ) : (
          <p className="hint-text arena-waiting">{t('game.waitingOthers')}</p>
        )}
      </motion.div>
    </ModalOverlay>
  )
}
