// The conflict arena (P4): a modal over the board with the location closeup as
// backdrop. Sealed arguments flip open after everyone hits "Reveal Conflict";
// re-fights and the politician deadlock run through the same RPS buttons; the
// result stage lists what every actor takes home ("Get It!" per rulebook).

import { AnimatePresence, motion } from 'framer-motion'
import type { PlayerView, ResourceType, Rps, SeatId, ValueType } from '@metarchy/engine'
import type { ClientIntent } from '@metarchy/protocol'
import { useT, type TFunction } from '../../../i18n/index.js'
import { useDomain, type DomainLabels } from '../../../i18n/domain.js'
import { useArgCoins } from '../../../lib/argCoins.js'
import { useGameStore } from '../../../stores/game.js'
import { themeAsset } from '../../../theme.js'
import { ActorArt } from '../../../components/ActorArt.js'
import { SEAT_COLORS } from '../../../board/layout.js'
import { ModalOverlay } from '../ModalOverlay.js'
import type { ArenaModel, ArenaParticipant, RewardPreview } from './derive.js'

const RPS_CHOICES: readonly Rps[] = ['rock', 'paper', 'scissors']

function seatColorCss(seat: SeatId): string {
  return `#${SEAT_COLORS[seat].toString(16).padStart(6, '0')}`
}

export function rewardText(reward: RewardPreview | null, d: DomainLabels, t: TFunction): string {
  if (!reward) return t('game.conflict.nothing')
  const name =
    reward.kind === 'value'
      ? d.value(reward.type as ValueType)
      : d.resource(reward.type as ResourceType)
  return `+${reward.amount} ${name}`
}

function rewardIconKey(reward: RewardPreview): string {
  return reward.kind === 'value' ? `value.${reward.type}` : `resource.${reward.type}`
}

function useNameOf(): (seat: SeatId) => string {
  const players = useGameStore((s) => s.players)
  return (seat) => {
    const p = players.find((x) => x.seat === seat)
    return p ? `${p.nickname}${p.bot ? ' 🤖' : ''}` : `Seat ${seat}`
  }
}

function ParticipantCard({
  p,
  mySeat,
  showBet
}: {
  p: ArenaParticipant
  mySeat: SeatId
  /** Bets resolve in the FIRST conflict only — later cards never show one. */
  showBet: boolean
}) {
  const t = useT()
  const argCoin = useArgCoins()
  const d = useDomain()
  const nameOf = useNameOf()
  const players = useGameStore((s) => s.players)
  const color = seatColorCss(p.seat)
  const wardrobe = players.find((x) => x.seat === p.seat)?.wardrobe ?? null
  return (
    // Only the losing FIGURE is dimmed (and, per the author, blurred): the
    // argument and bet underneath stay readable — blurring the whole card hid
    // exactly what the player needed to read.
    <div className={`arena-card ${p.outcome === 'lose' ? 'lost' : ''}`}>
      <div className="arena-figure" style={{ filter: `drop-shadow(0 0 16px ${color})` }}>
        <ActorArt type={p.actorId.split(':')[1] ?? ''} wardrobe={wardrobe} />
        {p.done && <span className="arena-done">✓</span>}
      </div>
      <span className="arena-name" style={{ color }}>
        {p.seat === mySeat ? t('game.you') : nameOf(p.seat)}
      </span>
      <div className="arena-arg">
        <AnimatePresence mode="popLayout" initial={false}>
          {p.argument !== null ? (
            <motion.img
              key="arg"
              src={argCoin(p.argument, p.seat)}
              alt={p.argument}
              initial={{ rotateY: 90, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              transition={{ duration: 0.3 }}
            />
          ) : (
            <motion.span key="sealed" className="arena-sealed" exit={{ opacity: 0 }}>
              ?
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {showBet && p.bet && (
        <span
          className={`arena-bet ${p.betSuccess === null ? '' : p.betSuccess ? 'fired' : 'missed'}`}
        >
          {t('game.conflict.bet')}: {d.bet(p.bet)}
          {p.betSuccess === null ? '' : p.betSuccess ? ' ✓' : ' ✗'}
        </span>
      )}
      {p.outcome && (
        <motion.span
          className={`outcome-badge ${p.outcome}`}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
        >
          {d.bet(p.outcome).toUpperCase()}
          {p.winBet && ' ★'}
        </motion.span>
      )}
    </div>
  )
}

/**
 * Why the outcome shifted away from the plain argument round: fired Draw/Lose
 * bets rewrite it (§8.3), and without spelling that out a converted win looks
 * like a bug. Missed bets carry no story — the ✗ on the card/report suffices.
 */
function betStoryLines(
  participants: ArenaParticipant[],
  nameOf: (seat: SeatId) => string,
  t: TFunction
): string[] {
  const names = (list: ArenaParticipant[]): string =>
    list.map((p) => (p.mine ? t('game.you') : nameOf(p.seat))).join(', ')
  const lines: string[] = []
  const firedDraw = participants.filter((p) => p.bet === 'draw' && p.betSuccess)
  const firedLose = participants.filter((p) => p.bet === 'lose' && p.betSuccess)
  if (firedDraw.length === 1) {
    lines.push(t('game.conflict.drawFiresOne', { names: names(firedDraw) }))
  } else if (firedDraw.length > 1) {
    lines.push(t('game.conflict.drawFiresMany', { names: names(firedDraw) }))
  }
  if (firedLose.length > 0) {
    lines.push(t('game.conflict.loseFires', { names: names(firedLose) }))
  }
  return lines
}

function RpsRow({
  send,
  type
}: {
  send(intent: ClientIntent): void
  type: 'conflict.rps' | 'tiebreak.rps'
}) {
  const d = useDomain()
  const argCoin = useArgCoins()
  return (
    <div className="row">
      {RPS_CHOICES.map((choice) => (
        <button key={choice} className="btn arena-rps" onClick={() => send({ type, choice })}>
          <img src={argCoin(choice)} alt="" />
          {d.argument(choice)}
        </button>
      ))}
    </div>
  )
}

export function ConflictArena({
  arena,
  view,
  send
}: {
  arena: ArenaModel
  view: PlayerView
  send(intent: ClientIntent): void
}) {
  const t = useT()
  const d = useDomain()
  const stage = arena.stage
  const nameOf = useNameOf()
  const waitingOthers = <p className="hint-text arena-waiting">{t('game.waitingOthers')}</p>
  const betStory = betStoryLines(arena.participants, nameOf, t)
  // Bets are placed and resolve in the FIRST conflict only — showing them on
  // later cards (or their story) is noise. The first conflict's result already
  // said which bet landed.
  const showBets = arena.index === 0

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
          style={{ backgroundImage: `url(${themeAsset(`location.${arena.locationId}.closeup`)})` }}
        />
        <div className="arena-content">
          <p className="hud-label">
            {t('game.conflict.counter', { n: arena.index + 1, total: arena.total })}
          </p>
          <h2>
            {t('game.conflict.actorsAt', {
              actor: d.actor(arena.actorType),
              loc: d.location(arena.locationId)
            })}
          </h2>

          <div className="arena-participants">
            {arena.participants.map((p) => (
              <ParticipantCard key={p.actorId} p={p} mySeat={view.seat} showBet={showBets} />
            ))}
          </div>

          {stage.t === 'reveal' && (
            <>
              <p className="hint-text arena-waiting">{t('game.conflict.sealed')}</p>
              {stage.myAck ? (
                waitingOthers
              ) : (
                <button className="btn" onClick={() => send({ type: 'conflict.reveal.ack' })}>
                  {t('game.conflict.reveal')}
                </button>
              )}
            </>
          )}

          {(stage.t === 'rps' || stage.t === 'deadlock') && (
            <>
              {stage.t === 'rps' &&
                showBets &&
                betStory.map((line) => (
                  <p key={line} className="hint-text arena-waiting arena-bet-story">
                    {line}
                  </p>
                ))}
              <p className="hint-text arena-waiting">
                {stage.t === 'deadlock'
                  ? t('game.conflict.deadlock', { n: stage.round })
                  : t('game.conflict.refight', { n: stage.round })}
              </p>
              {stage.myTurn ? (
                <RpsRow
                  send={send}
                  type={stage.t === 'deadlock' ? 'tiebreak.rps' : 'conflict.rps'}
                />
              ) : (
                waitingOthers
              )}
            </>
          )}

          {stage.t === 'result' && (
            <>
              {showBets &&
                betStory.map((line) => (
                  <p key={line} className="hint-text arena-waiting arena-bet-story">
                    {line}
                  </p>
                ))}
              <ul className="arena-results">
                {arena.participants.map((p) => (
                  <li key={p.actorId}>
                    <span className={`outcome-dot ${p.outcome ?? 'lose'}`} />
                    <span className="arena-result-text">
                      {`${p.mine ? t('game.you') : nameOf(p.seat)} · ${
                        p.placedArgument ? d.argument(p.placedArgument) : '?'
                      }${
                        showBets && p.bet
                          ? ` · ${t('game.conflict.bet')} ${d.bet(p.bet)}${p.betSuccess === null ? '' : p.betSuccess ? ' ✓' : ' ✗'}`
                          : ''
                      } — ${p.outcome ? d.bet(p.outcome) : ''}${p.winBet ? ' ★' : ''} → ${
                        p.reward ? rewardText(p.reward, d, t) : t('game.conflict.returnsNothing')
                      }`}
                    </span>
                    {p.reward && (
                      <img
                        className="arena-reward-icon"
                        src={themeAsset(rewardIconKey(p.reward))}
                        alt=""
                      />
                    )}
                  </li>
                ))}
              </ul>
              {stage.myAck ? (
                waitingOthers
              ) : (
                <button className="btn" onClick={() => send({ type: 'conflict.result.ack' })}>
                  {t('game.getIt')}
                </button>
              )}
            </>
          )}

          {stage.t === 'refight' && (
            <>
              {showBets &&
                betStory.map((line) => (
                  <p key={line} className="hint-text arena-waiting arena-bet-story">
                    {line}
                  </p>
                ))}
              <ul className="arena-results">
                {arena.participants.map((p) => (
                  <li key={p.actorId}>
                    <span className={`outcome-dot ${p.outcome ?? 'draw'}`} />
                    <span className="arena-result-text">
                      {`${p.mine ? t('game.you') : nameOf(p.seat)} · ${
                        p.argument ? d.argument(p.argument) : '?'
                      }${
                        showBets && p.bet
                          ? ` · ${t('game.conflict.bet')} ${d.bet(p.bet)}${p.betSuccess === null ? '' : p.betSuccess ? ' ✓' : ' ✗'}`
                          : ''
                      }${p.outcome ? ` — ${d.bet(p.outcome)}` : ''}`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="hint-text arena-waiting">{t('game.conflict.refightReview')}</p>
              {stage.myAck ? (
                waitingOthers
              ) : (
                <button className="btn" onClick={() => send({ type: 'conflict.refight.ack' })}>
                  {t('game.conflict.refightAgain')}
                </button>
              )}
            </>
          )}
        </div>
      </motion.div>
    </ModalOverlay>
  )
}

/** Rulebook: others' conflicts aren't shown in detail — a low-key progress strip. */
export function SpectatorBanner({ arena }: { arena: ArenaModel }) {
  const t = useT()
  const d = useDomain()
  return (
    <div className="hud-panel bottom-panel waiting">
      <span className="waiting-pulse">
        {t('game.conflict.spectator', {
          n: arena.index + 1,
          total: arena.total,
          actor: d.actor(arena.actorType),
          loc: d.location(arena.locationId)
        })}
      </span>
    </div>
  )
}
