// Argument + bet picker, the prototype's radial way (RSPRadialMenu →
// BidRadialMenu) — anchored to the target location on the board, not a modal:
// the actor's portrait lands big on the location, available argument coins
// fan on its left; picking one swaps the fan for the bet coins (WIN/LOSE/DRAW
// at their resource cost) plus SKIP for no bet. There are no buttons — a
// pointer-down anywhere off the plate cancels, and the actor returns to the
// hand (any staged placement it had is dropped). Opens when an actor is
// dropped on a location (or a staged token is tapped). Enforces the P2 rules
// the engine will check — four distinct arguments per player, bets paid from
// the resource budget — so commit never bounces. Mount with a key per target
// so state resets when the target changes.

import { useEffect, useRef, useState } from 'react'
import type { ArgumentType, BetType, LocationId, PlayerView } from '@metarchy/engine'
import { ARGUMENT_TYPES, BET_COST } from '@metarchy/engine'
import { useT } from '../../i18n/index.js'
import { useDomain } from '../../i18n/domain.js'
import { ActorHead } from '../../components/ActorHead.js'
import { useActorWardrobe } from '../../lib/actorHead.js'
import { useArgCoins } from '../../lib/argCoins.js'
import { betAffordable, usedArguments, useUiStore, type PickerTarget } from '../../stores/ui.js'
import { themeAsset } from '../../theme.js'

const BETS: readonly BetType[] = ['win', 'lose', 'draw']

/** Prototype fan geometry, avatar-centered: coin centers arc down the left. */
const FAN: readonly { x: number; y: number }[] = [
  { x: -89, y: -63 },
  { x: -107, y: -4 },
  { x: -95, y: 58 },
  { x: -45, y: 98 }
]

/** Plate extents around the avatar center — keeps the fan/skip/label on-screen. */
const EDGE = { left: 140, right: 98, top: 118, bottom: 162 }

export function ArgBetPicker({
  target,
  view,
  locate
}: {
  target: PickerTarget
  view: PlayerView
  /** Board anchor: viewport center of a location (absent in unit tests). */
  locate?: (id: LocationId) => { x: number; y: number } | null
}) {
  const t = useT()
  const d = useDomain()
  const argCoin = useArgCoins()
  const wardrobe = useActorWardrobe()
  const staged = useUiStore((s) => s.staged)
  const stagePlacement = useUiStore((s) => s.stagePlacement)
  const cancelPicker = useUiStore((s) => s.cancelPicker)

  const taken = usedArguments(staged, target.actorType)
  const [argument, setArgument] = useState<ArgumentType | null>(null)
  const [anchor, setAnchor] = useState(() => locate?.(target.locationId) ?? null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Keep the plate glued to the location across resizes/orientation changes
  // (the Pixi camera refits first — read it a frame later).
  useEffect(() => {
    if (!locate) return
    const relocate = (): number =>
      requestAnimationFrame(() => setAnchor(locate(target.locationId) ?? null))
    window.addEventListener('resize', relocate)
    return () => window.removeEventListener('resize', relocate)
  }, [locate, target.locationId])

  // No Cancel button: any pointer-down outside the plate is the cancel. The
  // opening gesture ends before this mounts, so it can't self-cancel.
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return
      cancelPicker()
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [cancelPicker])

  const args = ARGUMENT_TYPES.filter((a) => !taken.has(a))
  const stage = (bet: BetType | null): void => {
    if (!argument) return
    stagePlacement(target.actorType, {
      locationId: target.locationId,
      argument,
      ...(bet ? { bet } : {})
    })
  }
  // No affordable bet → the bet fan would only offer Skip; don't make the
  // player press it (user rule) — the argument alone stages the placement.
  const anyBetAffordable = BETS.some((b) =>
    betAffordable(b, staged, view.me.resources, target.actorType)
  )
  const pickArgument = (arg: ArgumentType): void => {
    if (anyBetAffordable) setArgument(arg)
    else stagePlacement(target.actorType, { locationId: target.locationId, argument: arg })
  }

  const pos = anchor ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const x = Math.min(
    Math.max(pos.x, EDGE.left),
    Math.max(EDGE.left, window.innerWidth - EDGE.right)
  )
  const y = Math.min(
    Math.max(pos.y, EDGE.top),
    Math.max(EDGE.top, window.innerHeight - EDGE.bottom)
  )

  return (
    <div ref={rootRef} className="board-picker" style={{ left: x, top: y }}>
      <span className="radial-ring outer" />
      <span className="radial-ring inner" />
      <div className="radial-avatar">
        <ActorHead type={target.actorType} wardrobe={wardrobe} />
      </div>

      {argument === null
        ? args.map((arg, i) => (
            <button
              key={arg}
              className="radial-coin"
              style={{ left: FAN[i]?.x, top: FAN[i]?.y }}
              title={d.argument(arg)}
              onClick={() => pickArgument(arg)}
            >
              <img src={argCoin(arg)} alt={d.argument(arg)} />
            </button>
          ))
        : BETS.map((bet, i) => {
            const affordable = betAffordable(bet, staged, view.me.resources, target.actorType)
            return (
              <button
                key={bet}
                className="radial-coin"
                style={{ left: FAN[i]?.x, top: FAN[i]?.y }}
                disabled={!affordable}
                title={
                  affordable
                    ? t('game.picker.betCost', { bet: d.bet(bet), res: d.resource(BET_COST[bet]) })
                    : t('game.picker.betNoRes', { bet: d.bet(bet), res: d.resource(BET_COST[bet]) })
                }
                onClick={() => stage(bet)}
              >
                <img src={themeAsset(`resource.${BET_COST[bet]}`)} alt="" />
                <span className="radial-coin-label">{d.bet(bet)}</span>
              </button>
            )
          })}

      {argument !== null && (
        <button
          className="radial-skip"
          title={t('game.picker.noBet')}
          aria-label={t('game.picker.noBet')}
          onClick={() => stage(null)}
        >
          ✕
        </button>
      )}
      {argument !== null && (
        <span className="radial-chosen-arg">
          <img src={argCoin(argument)} alt={d.argument(argument)} />
        </span>
      )}

      <span className="board-picker-step">
        {argument === null ? t('game.picker.chooseArg') : t('game.picker.placeBet')}
      </span>
    </div>
  )
}
