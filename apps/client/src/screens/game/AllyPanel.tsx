// 2v2 team transparency (author request): the ally's column on the right edge,
// mirroring the own dock on the left. Shows the ally's actors with their live
// staging (pre-commit, relayed via team.staging) or sealed placements, and the
// ally's actual cards (the engine shares the hand inside a visibility group).

import type {
  ActorType,
  ArgumentType,
  BetType,
  LocationId,
  PlayerView,
  SeatId
} from '@metarchy/engine'
import { ACTOR_TYPES, BET_COST } from '@metarchy/engine'
import { useT } from '../../i18n/index.js'
import { useDomain } from '../../i18n/domain.js'
import { ActorHead } from '../../components/ActorHead.js'
import type { AllyStagingState } from '../../stores/game.js'
import { useArgCoins } from '../../lib/argCoins.js'
import { useGameStore } from '../../stores/game.js'
import { themeAsset } from '../../theme.js'

interface AllyPlan {
  locationId: LocationId
  argument?: ArgumentType
  bet?: BetType
  committed: boolean
}

/** The ally's plan per actor: sealed commit wins over live staging. */
function allyPlans(
  view: PlayerView,
  allySeat: SeatId,
  allyStaging: AllyStagingState | null
): Map<ActorType, AllyPlan> {
  const plans = new Map<ActorType, AllyPlan>()
  if (view.phase.kind !== 'p2_distribution') return plans
  if (
    allyStaging &&
    allyStaging.fromSeat === allySeat &&
    allyStaging.staging.kind === 'p2' &&
    allyStaging.staging.turn === view.turn &&
    !view.phase.committedSeats.includes(allySeat)
  ) {
    for (const p of allyStaging.staging.placements)
      plans.set(p.actorType, {
        locationId: p.locationId,
        argument: p.argument,
        ...(p.bet ? { bet: p.bet } : {}),
        committed: false
      })
  }
  const sealed = view.phase.sealed.find((s) => s.seat === allySeat)
  for (const p of sealed?.placements ?? [])
    plans.set(p.actorType, {
      locationId: p.locationId,
      argument: p.argument,
      ...(p.bet ? { bet: p.bet } : {}),
      committed: true
    })
  return plans
}

export function AllyPanel({ view }: { view: PlayerView }) {
  const t = useT()
  const d = useDomain()
  const argCoin = useArgCoins()
  const players = useGameStore((s) => s.players)
  const allyStaging = useGameStore((s) => s.allyStaging)

  const allySeat = view.allies[0]
  if (allySeat === undefined) return null
  const ally = players.find((p) => p.seat === allySeat)
  const allyWardrobe = ally?.wardrobe ?? null
  const gone = view.eliminated.includes(allySeat)
  const hand = view.others.find((o) => o.seat === allySeat)?.hand ?? []
  const p2 = view.phase.kind === 'p2_distribution'
  const plans = allyPlans(view, allySeat, allyStaging)

  return (
    <div className="hud hud-ally">
      <div className="ally-panel">
        <div className="ally-head" title={t('game.ally.label')}>
          <span className="ally-tag">🤝 {t('game.ally.label')}</span>
          <span className="ally-name">{ally?.nickname ?? t('game.seat', { n: allySeat })}</span>
          {gone && <span className="ally-gone">{t('game.ally.eliminated')}</span>}
        </div>
        {p2 && !gone && (
          <div className="ally-orbs">
            {ACTOR_TYPES.map((actor) => {
              const plan = plans.get(actor)
              const cls = ['ally-orb', plan ? (plan.committed ? 'placed' : 'staged') : 'idle'].join(
                ' '
              )
              return (
                <div key={actor} className={cls} title={d.actor(actor)}>
                  <ActorHead
                    className="ally-orb-head"
                    type={actor}
                    wardrobe={allyWardrobe}
                    alt={d.actor(actor)}
                  />
                  {plan && (
                    <span className="ally-orb-plan">
                      <span className="ally-orb-loc">
                        {d.location(plan.locationId)}
                        {plan.committed ? ' ✓' : '…'}
                      </span>
                      <span className="ally-orb-badges">
                        {plan.argument && (
                          <img
                            src={argCoin(plan.argument, allySeat)}
                            alt={d.argument(plan.argument)}
                            title={d.argument(plan.argument)}
                          />
                        )}
                        {plan.bet && (
                          <img
                            src={themeAsset(`resource.${BET_COST[plan.bet]}`)}
                            alt={t('game.ally.bet')}
                            title={t('game.ally.bet')}
                          />
                        )}
                      </span>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div className="ally-hand-label">{t('game.ally.hand', { n: hand.length })}</div>
        {hand.length > 0 && (
          <div className="ally-hand">
            {hand.map((c) => (
              <img
                key={c.instanceId}
                className="hud-hand-card ally-hand-card"
                src={themeAsset(`card.action.${c.card}`)}
                alt={d.actionCard(c.card)}
                title={d.actionCard(c.card)}
                draggable={false}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
