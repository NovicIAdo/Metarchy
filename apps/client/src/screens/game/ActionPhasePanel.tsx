// P3 action phase (rulebook Phase 3): card selection with real card art, then the
// step flow. Relocation is board-driven (tap a token, tap a glowing location —
// wiring lives in ActiveGame); this panel carries instructions, the exchange
// modal, and the relocation-collision tie-break.

import { useState } from 'react'
import type { PlayerView, Rps, SeatId, ValueType } from '@metarchy/engine'
import type { ClientIntent } from '@metarchy/protocol'
import { useT, type TFunction } from '../../i18n/index.js'
import { useDomain } from '../../i18n/domain.js'
import { useGameStore } from '../../stores/game.js'
import { useUiStore, valuesPoolIndex } from '../../stores/ui.js'
import { useArgCoins } from '../../lib/argCoins.js'
import { themeAsset } from '../../theme.js'
import { ModalOverlay } from './ModalOverlay.js'
import {
  exchangeTargetSeats,
  exchangeableValues,
  poolOfSeat,
  relocatableActors
} from './phase-helpers.js'

const RPS_CHOICES: readonly Rps[] = ['rock', 'paper', 'scissors']

function useNameOf(): (seat: SeatId) => string {
  const t = useT()
  const players = useGameStore((s) => s.players)
  return (seat) => {
    const p = players.find((x) => x.seat === seat)
    return p ? `${p.nickname}${p.bot ? ' 🤖' : ''}` : t('game.seat', { n: seat })
  }
}

/**
 * P3 card selection: the whole hand at once — tap the cards to play, untapped
 * cards are skipped automatically on commit (user rule: no per-card browsing).
 */
function SelectStep({ view, send }: { view: PlayerView; send(intent: ClientIntent): void }) {
  const t = useT()
  const d = useDomain()
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const phase = view.phase
  if (phase.kind !== 'p3_action' || phase.step.t !== 'select') return null
  const step = phase.step

  if (step.mySelection !== null || !view.waitingOn.includes(view.seat)) {
    const committed = step.committedSeats.length
    const total = view.activeSeats.length
    return (
      <p className="hint-text arena-waiting">
        <span className="waiting-pulse">
          {t('game.action.cardsLocked', { done: committed, total })}
        </span>
      </p>
    )
  }

  const toggle = (instanceId: string): void => {
    const next = new Set(chosen)
    if (next.has(instanceId)) next.delete(instanceId)
    else next.add(instanceId)
    setChosen(next)
  }

  return (
    <>
      <p className="hud-label">{t('game.action.selectCards')}</p>
      {view.me.hand.length === 0 ? (
        <p className="hint-text arena-waiting">{t('game.action.noCardsHand')}</p>
      ) : (
        <div className="card-grid">
          {view.me.hand.map((c) => (
            <button
              key={c.instanceId}
              className={`action-card ${chosen.has(c.instanceId) ? 'chosen' : ''}`}
              title={d.actionCardRule(c.card)}
              onClick={() => toggle(c.instanceId)}
            >
              <img src={themeAsset(`card.action.${c.card}`)} alt="" draggable={false} />
              <span>{d.actionCard(c.card)}</span>
            </button>
          ))}
        </div>
      )}
      <button
        className="btn confirm"
        onClick={() => send({ type: 'action.selectCards', cardInstanceIds: [...chosen] })}
      >
        ✓{' '}
        {chosen.size === 0
          ? t('game.action.playNoCards')
          : chosen.size === 1
            ? t('game.action.commitCardsOne', { n: chosen.size })
            : t('game.action.commitCardsMany', { n: chosen.size })}
      </button>
    </>
  )
}

function ordinal(n: number, t: TFunction): string {
  return n >= 1 && n <= 4 ? t(`game.ordinal.${n}`) : t('game.ordinal.n', { n })
}

function RelocateStep({ view, send }: { view: PlayerView; send(intent: ClientIntent): void }) {
  const t = useT()
  const d = useDomain()
  const relocateSource = useUiStore((s) => s.relocateSource)
  const setRelocateSource = useUiStore((s) => s.setRelocateSource)
  const relocateStaged = useUiStore((s) => s.relocateStaged)
  const phase = view.phase
  if (phase.kind !== 'p3_action' || phase.step.t !== 'relocate') return null

  if (!view.waitingOn.includes(view.seat))
    return (
      <p className="hint-text arena-waiting">
        <span className="waiting-pulse">{t('game.action.waitingRelocations')}</span>
      </p>
    )

  const quota = phase.selectedCounts?.find((x) => x.seat === view.seat)?.relocation ?? 0
  const used = phase.step.myOrders?.length ?? 0
  const multi = quota >= 2
  const source = view.board.placements.find((p) => p.actorId === relocateSource)
  const staged = relocateStaged
    ? view.board.placements.find((p) => p.actorId === relocateStaged.actorId)
    : undefined
  const movable = relocatableActors(view).length

  return (
    <>
      <p className="hud-label">
        {multi
          ? t('game.action.relocateMulti', {
              ord: ordinal(used + 1, t),
              card: d.actionCard('relocation'),
              n: used + 1,
              total: quota
            })
          : t('game.action.relocateSingle', {
              card: d.actionCard('relocation'),
              left: quota - used,
              total: quota
            })}
      </p>
      {staged && relocateStaged ? (
        // Staged move: nothing is sent until Done — tapping another actor or
        // destination replaces the choice.
        <div className="row" style={{ alignItems: 'center' }}>
          <p className="hint-text" style={{ flex: 1, margin: 0 }}>
            {t('game.action.relocateStaged', {
              actor: d.actor(staged.actorType),
              owner:
                staged.seat === view.seat
                  ? t('game.youLower')
                  : t('game.seatLower', { n: staged.seat }),
              from: d.location(staged.locationId),
              to: d.location(relocateStaged.to)
            })}
          </p>
          <button
            className="btn confirm"
            style={{ width: 'auto', flex: 'none' }}
            onClick={() => {
              send({ type: 'action.relocate', ...relocateStaged })
              // Done is final: the token stays drawn at its destination while
              // the server waits for the rest of the step (no snap-back).
              useUiStore.getState().pushSentMove(relocateStaged)
              useUiStore.getState().setRelocateSource(null)
            }}
          >
            ✓ {t('game.done')}
          </button>
        </div>
      ) : source ? (
        <div className="row" style={{ alignItems: 'center' }}>
          <p className="hint-text" style={{ flex: 1, margin: 0 }}>
            {t('game.action.relocateMoving', {
              actor: d.actor(source.actorType),
              owner:
                source.seat === view.seat
                  ? t('game.youLower')
                  : t('game.seatLower', { n: source.seat }),
              from: d.location(source.locationId)
            })}
          </p>
          <button
            className="btn reject"
            style={{ width: 'auto', flex: 'none' }}
            onClick={() => setRelocateSource(null)}
          >
            ✕ {t('common.cancel')}
          </button>
        </div>
      ) : (
        <p className="hint-text">
          {movable === 0 ? t('game.action.relocateHintNone') : t('game.action.relocateHint')}
        </p>
      )}
    </>
  )
}

function RelocateTiebreak({ view, send }: { view: PlayerView; send(intent: ClientIntent): void }) {
  const t = useT()
  const d = useDomain()
  const argCoin = useArgCoins()
  const nameOf = useNameOf()
  const phase = view.phase
  if (phase.kind !== 'p3_action' || phase.step.t !== 'relocate_tiebreak') return null
  const step = phase.step
  const collision = step.collisions[step.index]
  const tiebreak = step.tiebreak
  const mine = tiebreak.participants.includes(view.seat) && tiebreak.myChoice === null

  const contenderList = collision
    ? collision.contenders
        .map(
          (c) => `${c.seat === view.seat ? t('game.you') : nameOf(c.seat)} → ${d.location(c.to)}`
        )
        .join(` ${t('game.vs')} `)
    : ''
  const revealedList = tiebreak.revealed
    ? Object.entries(tiebreak.revealed.choices)
        .map(
          ([seat, c]) =>
            `${Number(seat) === view.seat ? t('game.youLower') : nameOf(Number(seat) as SeatId)} — ${d.argument(c)}`
        )
        .join(' · ')
    : ''

  return (
    <ModalOverlay>
      <div className="panel picker">
        <h2>{t('game.action.relocConflict')}</h2>
        {collision && (
          <p className="hint-text">
            {t('game.action.relocForActor', { list: contenderList, id: collision.actorId })}
          </p>
        )}
        {tiebreak.revealed && (
          <p className="hint-text">
            {t('game.action.tieRound', { round: tiebreak.revealed.round, list: revealedList })}
          </p>
        )}
        <p className="hint-text arena-waiting">{t('game.tiebreakRound', { n: tiebreak.round })}</p>
        {mine ? (
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
          <p className="hint-text arena-waiting">{t('game.action.waitingResolution')}</p>
        )}
      </div>
    </ModalOverlay>
  )
}

function ExchangeStep({ view, send }: { view: PlayerView; send(intent: ClientIntent): void }) {
  const t = useT()
  const d = useDomain()
  const nameOf = useNameOf()
  const [give, setGive] = useState<ValueType | null>(null)
  const [from, setFrom] = useState<SeatId | null>(null)
  const [take, setTake] = useState<ValueType | null>(null)
  const phase = view.phase
  if (phase.kind !== 'p3_action' || phase.step.t !== 'exchange') return null
  const step = phase.step
  const slot = step.queue[step.index]

  if (!slot || slot.seat !== view.seat)
    return (
      <p className="hint-text arena-waiting">
        <span className="waiting-pulse">
          {slot
            ? t('game.action.waitingExchangeWho', { who: nameOf(slot.seat) })
            : t('game.action.waitingExchange')}
        </span>
      </p>
    )

  const myPool = view.values[valuesPoolIndex(view)]
  const giveOptions = myPool ? exchangeableValues(myPool) : []
  const targetSeats = exchangeTargetSeats(view)
  const fromPool = from !== null ? poolOfSeat(view, from) : null
  const takeOptions = fromPool ? exchangeableValues(fromPool) : []

  const valueButton = (
    v: ValueType,
    count: number,
    active: boolean,
    onClick: () => void
  ): React.ReactNode => (
    <button key={v} className={`picker-option ${active ? 'chosen' : ''}`} onClick={onClick}>
      <img src={themeAsset(`value.${v}`)} alt="" />
      <span>{d.value(v)}</span>
      <span className="picker-note">×{count}</span>
    </button>
  )

  // Ordinal among MY exchange cards: "the second Change of Values card" only
  // matters when I committed more than one (user rule; single card = as is).
  const myTotal = step.queue.filter((s) => s.seat === view.seat).length
  const myOrdinal = step.queue.slice(0, step.index).filter((s) => s.seat === view.seat).length + 1

  return (
    <ModalOverlay>
      <div className="panel picker">
        <h2>
          {d.actionCard('change_values')} ({step.index + 1}/{step.queue.length})
        </h2>
        {myTotal >= 2 && (
          <p className="hint-text" style={{ marginBottom: 10 }}>
            {t('game.action.exchWhichPre')} <b>{ordinal(myOrdinal, t)}</b>{' '}
            {t('game.action.exchWhichPost', { card: d.actionCard('change_values') })}
          </p>
        )}

        <p className="hud-label">{t('game.action.giveYours')}</p>
        <div className="picker-grid three">
          {giveOptions.map((v) =>
            valueButton(v, myPool ? myPool[v] : 0, give === v, () => setGive(v))
          )}
        </div>

        <p className="hud-label">{t('game.action.takeFrom')}</p>
        <div className="picker-grid three">
          {targetSeats.map((seat) => (
            <button
              key={seat}
              className={`picker-option ${from === seat ? 'chosen' : ''}`}
              onClick={() => {
                setFrom(seat)
                setTake(null)
              }}
            >
              <span className="picker-none">{seat}</span>
              <span>{nameOf(seat)}</span>
            </button>
          ))}
        </div>

        {fromPool && (
          <>
            <p className="hud-label">{t('game.action.theirValue')}</p>
            <div className="picker-grid three">
              {takeOptions.map((v) => valueButton(v, fromPool[v], take === v, () => setTake(v)))}
            </div>
          </>
        )}

        <button
          className="btn confirm"
          disabled={!give || from === null || !take}
          onClick={() =>
            give && from !== null && take && send({ type: 'action.exchange', give, from, take })
          }
        >
          ✓ {myTotal >= 2 ? t('game.done') : t('game.action.changeValues')}
        </button>
      </div>
    </ModalOverlay>
  )
}

export function ActionPhasePanel({
  view,
  send
}: {
  view: PlayerView
  send(intent: ClientIntent): void
}) {
  const t = useT()
  const d = useDomain()
  const phase = view.phase
  if (phase.kind !== 'p3_action') return null
  const step = phase.step
  return (
    <>
      {view.board.disabledLocations.length > 0 && (
        <p className="hint-text" style={{ textAlign: 'center', marginBottom: 8 }}>
          ⛔ {t('game.action.blockedThisTurn')}:{' '}
          {view.board.disabledLocations.map((l) => d.location(l)).join(', ')}
        </p>
      )}
      {step.t === 'select' && <SelectStep view={view} send={send} />}
      {step.t === 'relocate' && <RelocateStep view={view} send={send} />}
      {step.t === 'relocate_tiebreak' && <RelocateTiebreak view={view} send={send} />}
      {/* Re-key per queue slot: my second card must not inherit the first's picks. */}
      {step.t === 'exchange' && <ExchangeStep key={step.index} view={view} send={send} />}
    </>
  )
}
