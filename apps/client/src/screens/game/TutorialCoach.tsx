// The coached Tutorial overlay (mode: 'tutorial'). It sits on top of a real
// game vs a bot and, every turn, tells the player exactly what to do:
//
//   1. a per-concept intro "window" (dim scrim + card) the player dismisses,
//   2. then a pulsing spotlight ring + one-line hint over the thing to touch —
//      the actor dock, the argument picker, the commit bar, the action/market
//      panel. Fullscreen moments (the event, a conflict, card results) get a
//      top banner instead of a ring.
//
// `coachStep` is a pure function of (server view + local staging) so the coach
// always reflects the true game state — it advances the moment the player acts,
// never on a script. Body-portaled above every modal (like the phase splash).
//
// Cards read both ways: NEXT walks the pages forward, PREVIOUS walks back and,
// from a card's first page, into the cards already shown IN THIS PHASE of this
// turn — never further (a Conflict should not walk you back into Phase 2).
// Those past cards are *remembered* (see `history`), never re-derived —
// `coachStep` only knows the live state — and a re-read is read-only: it
// dismisses nothing and lights up nothing, since its target may be long gone
// from the DOM.
//
// The intro card is shown once per concept-key, so later turns keep the light
// spotlight but stop blocking. One deliberate exception: the "choose Argument"
// step never uses a scrim — the picker cancels itself on any outside pointer,
// so a scrim tap would drop the half-placed actor. It gets a ring only.

import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ActorType, BetType, LocationId, PlayerView } from '@metarchy/engine'
import { ALLOWED_LOCATIONS } from '@metarchy/engine'
import { useT } from '../../i18n/index.js'
import { useUiStore } from '../../stores/ui.js'
import { usePhaseIntroCover } from './PhaseSplash.js'

const PHASE_NUMBER: Record<string, number> = {
  p1_event: 1,
  p2_distribution: 2,
  p3_action: 3,
  p4_conflict: 4,
  p5_market: 5
}

export interface CoachDescriptor {
  /** Stable per-concept key (no turn) — the intro card shows once, then hints. */
  key: string
  titleKey: string
  /** Present ⇒ an intro card is shown the first time this key appears. */
  bodyKey?: string
  /** A multi-page narrative intro (Next → … → Got it), shown before the hint.
      Overrides bodyKey for the card; the chip/banner still uses titleKey. */
  pages?: { titleKey: string; bodyKey?: string }[]
  /** One line of WHY this step matters (player feedback: "и объяснение почему").
      Rides under the hint and under the card's body — never on its own. */
  whyKey?: string
  /** CSS selector to spotlight; absent ⇒ a floating banner (see placement). */
  target?: string
  /** Board Locations to point at. The board is a canvas with no DOM nodes, so
      these are resolved through the `locate` prop instead of a selector — and
      when `target` is present too, the arrows get a dashed guide line from it:
      "pick it up HERE, put it down THERE". */
  targetLocations?: LocationId[]
  placement?: 'top' | 'bottom'
}

/** A card the player has already seen, stamped with the moment it was shown —
    the stamp keeps the card's "Turn n · Phase m" line honest while re-reading. */
export interface SeenCard {
  card: CoachDescriptor
  turn: number
  phase: number
}

/** The cards a PREVIOUS walk may reach: the ones shown earlier in the phase the
    player is in right now, the live card excluded. Scoped to the phase on author
    feedback — mid-Conflict, PREVIOUS should walk the Conflict's own tips and not
    wander back into Phase 2. The live card is history's tail once the recording
    effect has flushed; dropping it is guarded rather than assumed, so the frame
    before that flush stays correct. */
export function coachHistoryHere(
  history: SeenCard[],
  at: { turn: number; phase: number },
  liveKey: string
): SeenCard[] {
  const here = history.filter((s) => s.turn === at.turn && s.phase === at.phase)
  return here.at(-1)?.card.key === liveKey ? here.slice(0, -1) : here
}

/** Where the reader is: a page of the live card (`index: null`) or of a card kept
    in the history (its index there). */
export interface CoachCursor {
  index: number | null
  page: number
}

/** How much of the game a player may walk back through. Trimming the head is
    safe because a re-read always ends when the live card changes (see below), so
    no cursor outlives a trim. */
const HISTORY_MAX = 12

interface UiSnapshot {
  picker: boolean
  stagedCount: number
  /** The Actor in hand (dock tap or drag) — the arrows' "put it down there". */
  activeActor: ActorType | null
  /** A Location was tapped with nothing in hand and asked who should go there. */
  chooserAt: LocationId | null
}

/** The pages a descriptor puts on a card: an explicit narrative, a single body,
    or none at all — hint-only steps get a chip/banner instead of a card. */
export function coachCardPages(d: CoachDescriptor): CoachDescriptor['pages'] | null {
  if (d.pages) return d.pages
  return d.bodyKey ? [{ titleKey: d.titleKey, bodyKey: d.bodyKey }] : null
}

/** One PREVIOUS/NEXT step across [cards already seen … the live card]: pages
    inside the current card first, then over card boundaries. Needs only the page
    counts, so it stays pure and testable. `null` = nowhere to go — PREVIOUS on
    the very first page (⇒ no button), or NEXT off the live card's last page
    (⇒ "Got it"). A re-read can never produce that null: walking forward out of
    the history lands on the live card, so it never dismisses anything. */
export function coachWalk(
  dir: -1 | 1,
  cursor: CoachCursor,
  seenPages: number[],
  livePages: number
): CoachCursor | null {
  const { index, page } = cursor
  const pages = index === null ? livePages : (seenPages[index] ?? 1)
  if (dir === 1) {
    if (page + 1 < pages) return { index, page: page + 1 }
    if (index === null) return null
    return index + 1 < seenPages.length ? { index: index + 1, page: 0 } : { index: null, page: 0 }
  }
  if (page > 0) return { index, page: page - 1 }
  // First page: step into the card before this one, at its last page.
  const prev = (index ?? seenPages.length) - 1
  return prev >= 0 ? { index: prev, page: Math.max((seenPages[prev] ?? 1) - 1, 0) } : null
}

/** Where this Actor may still go: its own Locations, minus the ones a card
    switched off this turn. These are the Locations the board is already glowing
    — the arrows just say it out loud. */
function openLocationsFor(view: PlayerView, actor: ActorType): LocationId[] {
  return ALLOWED_LOCATIONS[actor].filter((l) => !view.board.disabledLocations.includes(l))
}

/** What should the player do right now? Pure, so it is unit-testable. */
export function coachStep(view: PlayerView, ui: UiSnapshot): CoachDescriptor | null {
  const mySeat = view.seat
  const myTurn = view.waitingOn.includes(mySeat)
  const phase = view.phase

  switch (phase.kind) {
    case 'p1_event': {
      if (!myTurn) return null
      const stage = phase.stage
      if (stage.t === 'discard_commit')
        return {
          key: 'p1.discard',
          titleKey: 'coach.p1.discard.title',
          bodyKey: 'coach.p1.discard.body',
          whyKey: 'coach.p1.discard.why',
          placement: 'top'
        }
      // A tied comparison heads into the player-vs-player resolution — announce it.
      if (stage.t === 'compare_standoff')
        return {
          key: 'p1.standoff',
          titleKey: 'coach.p1.standoff.title',
          bodyKey: 'coach.p1.standoff.body',
          placement: 'top'
        }
      if (stage.t === 'compare_tiebreak' || stage.t === 'discard_tiebreak') {
        // Round 2+ = the throws matched (the mirror bot guarantees it once):
        // teach that a draw always leads to another round.
        return stage.tiebreak.round <= 1
          ? {
              key: 'p1.tiebreak',
              titleKey: 'coach.p1.tiebreak.title',
              bodyKey: 'coach.p1.tiebreak.body',
              placement: 'top'
            }
          : {
              key: 'p1.tiebreak.again',
              titleKey: 'coach.p1.tiebreak.again.title',
              bodyKey: 'coach.p1.tiebreak.again.body',
              placement: 'top'
            }
      }
      return {
        key: 'p1.event',
        titleKey: 'coach.p1.event.title',
        bodyKey: 'coach.p1.event.body',
        placement: 'top'
      }
    }
    case 'p2_distribution': {
      // The board is open: this is the beat where the player finally sees where
      // the bot went, which is the whole reason the gate exists.
      if (phase.revealed)
        return {
          key: 'p2.revealed',
          titleKey: 'coach.p2.revealed.title',
          bodyKey: 'coach.p2.revealed.body',
          placement: 'bottom'
        }
      if (phase.committedSeats.includes(mySeat))
        return { key: 'p2.sealed', titleKey: 'coach.p2.sealed.title', placement: 'bottom' }
      if (!myTurn) return null
      // The picker cancels on any outside pointer — ring only, never a scrim.
      if (ui.picker)
        return {
          key: 'p2.arg',
          titleKey: 'coach.p2.arg.title',
          whyKey: 'coach.p2.arg.why',
          target: '.board-picker'
        }
      // An Actor is in hand: arrow every Location it is allowed to enter, with
      // the guide line running from the dock it came from.
      if (ui.activeActor)
        return {
          key: 'p2.place',
          titleKey: 'coach.p2.place.title',
          whyKey: 'coach.p2.place.why',
          target: '.hud-actors',
          targetLocations: openLocationsFor(view, ui.activeActor),
          placement: 'bottom'
        }
      // The other way round: a Location was tapped and is asking who goes there.
      if (ui.chooserAt)
        return {
          key: 'p2.chooseActor',
          titleKey: 'coach.p2.chooseActor.title',
          bodyKey: 'coach.p2.chooseActor.body',
          whyKey: 'coach.p2.chooseActor.why',
          target: '.actor-chooser'
        }
      if (ui.stagedCount === 0)
        // Turn 1: a short narrative intro sets the context (the goal, secret
        // placement with Arguments, and the Conflict it can trigger) before the
        // first hint. Later turns just point at the dock.
        return view.turn === 1
          ? {
              key: 'p2.pick',
              titleKey: 'coach.p2.pick.title',
              whyKey: 'coach.p2.pick.why',
              target: '.hud-actors',
              pages: [
                { titleKey: 'coach.intro.welcome.title', bodyKey: 'coach.intro.welcome.body' },
                { titleKey: 'coach.intro.place.title', bodyKey: 'coach.intro.place.body' },
                { titleKey: 'coach.intro.conflict.title', bodyKey: 'coach.intro.conflict.body' },
                { titleKey: 'coach.p2.pick.title', bodyKey: 'coach.p2.pick.body' }
              ]
            }
          : {
              key: 'p2.pick',
              titleKey: 'coach.p2.pick.title',
              bodyKey: 'coach.p2.pick.body',
              whyKey: 'coach.p2.pick.why',
              target: '.hud-actors'
            }
      if (ui.stagedCount < 4)
        return {
          key: 'p2.more',
          titleKey: 'coach.p2.more.title',
          whyKey: 'coach.p2.more.why',
          target: '.hud-actors'
        }
      return {
        key: 'p2.commit',
        titleKey: 'coach.p2.commit.title',
        whyKey: 'coach.p2.commit.why',
        target: '.commit-bar'
      }
    }
    case 'p3_action': {
      const step = phase.step
      if (step.t === 'select') {
        if (step.committedSeats.includes(mySeat))
          return { key: 'p3.sealed', titleKey: 'coach.p3.sealed.title', placement: 'bottom' }
        // No turn-1 case: turn 1 has no P3 at all (rulebook §Turn Structure), so the
        // player meets this phase on turn 2, already holding the Market's first card.
        return {
          key: 'p3.select',
          titleKey: 'coach.p3.select.title',
          bodyKey: 'coach.p3.select.body',
          whyKey: 'coach.p3.select.why',
          target: '.p3-panel'
        }
      }
      if (step.t === 'relocate') {
        if (!myTurn) return { key: 'p3.wait', titleKey: 'coach.wait', placement: 'bottom' }
        return {
          key: 'p3.relocate',
          titleKey: 'coach.p3.relocate.title',
          bodyKey: 'coach.p3.relocate.body',
          placement: 'bottom'
        }
      }
      if (step.t === 'blocks_ack' || step.t === 'relocations_ack' || step.t === 'exchanges_ack') {
        if (!myTurn) return null
        // The bot's turn-2 card demo (author spec): when a RIVAL's card is in
        // the ceremony, teach that opponents bend the rules too.
        const entries =
          step.t === 'blocks_ack'
            ? step.blocks
            : step.t === 'relocations_ack'
              ? step.moves
              : step.exchanges
        if (entries.some((e) => e.seat !== mySeat))
          return {
            key: 'p3.opponent',
            titleKey: 'coach.p3.opponent.title',
            bodyKey: 'coach.p3.opponent.body',
            placement: 'top'
          }
        return { key: 'p3.results', titleKey: 'coach.p3.results.title', placement: 'top' }
      }
      if (!myTurn) return { key: 'p3.wait', titleKey: 'coach.wait', placement: 'bottom' }
      return null
    }
    case 'p4_conflict': {
      if (!myTurn) return null
      const stage = phase.stage
      const conflict = phase.conflicts[phase.index]
      const res = phase.resolution
      // The end-of-phase recap: the turn's whole production, Location by Location.
      if (stage.t === 'summary_ack')
        return {
          key: 'p4.summary',
          titleKey: 'coach.p4.summary.title',
          bodyKey: 'coach.p4.summary.body',
          placement: 'top'
        }
      /** Did one of MY bets on this conflict come true? (Round-1 verdicts.) */
      const myBet = (bet: BetType): boolean =>
        res?.betResults.some((b) => b.seat === mySeat && b.bet === bet && b.success) ?? false
      const outcomes = conflict ? conflict.actorIds.map((id) => res?.outcomes[id]) : []
      const allDrew = outcomes.length > 0 && outcomes.every((o) => o === 'draw')
      // The re-fight gate — reached three ways, each its own lesson: a politician
      // draw (politicians never stand one), a Lose bet that came true (it buys a
      // rematch), or any other unsettled round.
      if (stage.t === 'refight_ack') {
        if (myBet('lose'))
          return {
            key: 'p4.bet.lose',
            titleKey: 'coach.p4.bet.lose.title',
            bodyKey: 'coach.p4.bet.lose.body',
            placement: 'top'
          }
        if (conflict?.actorType === 'politician' && allDrew)
          return {
            key: 'p4.draw.politician',
            titleKey: 'coach.p4.draw.politician.title',
            bodyKey: 'coach.p4.draw.politician.body',
            placement: 'top'
          }
        return {
          key: 'p4.refight',
          titleKey: 'coach.p4.refight.title',
          bodyKey: 'coach.p4.refight.body',
          placement: 'top'
        }
      }
      if (stage.t === 'rps' || stage.t === 'deadlock_tiebreak') {
        // Round 1 of a re-fight asks for a fresh throw; round 2+ means the
        // throws matched again — teach that a draw leads to yet another round.
        const round = stage.t === 'rps' ? (res?.round ?? 1) : 2
        return round <= 1
          ? {
              key: 'p4.rps',
              titleKey: 'coach.p4.rps.title',
              bodyKey: 'coach.p4.rps.body',
              placement: 'top'
            }
          : {
              key: 'p4.rps.again',
              titleKey: 'coach.p4.rps.again.title',
              bodyKey: 'coach.p4.rps.again.body',
              placement: 'top'
            }
      }
      // The outcome is in: teach what it MEANS, bets first (they rewrote it),
      // then the draw rules, then plain win/lose. Each card shows once, so a
      // tutorial full of unscripted results still explains every result it lands.
      if (stage.t === 'result_ack' && res && conflict) {
        // A draw bet that came true converted its holder's draw into a win.
        if (myBet('draw'))
          return {
            key: 'p4.bet.draw',
            titleKey: 'coach.p4.bet.draw.title',
            bodyKey: 'coach.p4.bet.draw.body',
            placement: 'top'
          }
        if (myBet('win'))
          return {
            key: 'p4.bet.win',
            titleKey: 'coach.p4.bet.win.title',
            bodyKey: 'coach.p4.bet.win.body',
            placement: 'top'
          }
        // A standing draw settles by actor type — each gets its own lesson.
        if (allDrew)
          return {
            key: `p4.draw.${conflict.actorType}`,
            titleKey: `coach.p4.draw.${conflict.actorType}.title`,
            bodyKey: `coach.p4.draw.${conflict.actorType}.body`,
            placement: 'top'
          }
        const mine = conflict.actorIds.find((id) => id.startsWith(`${mySeat}:`))
        const outcome = mine ? res.outcomes[mine] : undefined
        if (outcome === 'win' || outcome === 'lose')
          return {
            key: `p4.result.${outcome}`,
            titleKey: `coach.p4.result.${outcome}.title`,
            bodyKey: `coach.p4.result.${outcome}.body`,
            placement: 'top'
          }
        return { key: 'p4.result', titleKey: 'coach.p4.result.title', placement: 'top' }
      }
      return {
        key: 'p4.conflict',
        titleKey: 'coach.p4.conflict.title',
        bodyKey: 'coach.p4.conflict.body',
        placement: 'top'
      }
    }
    case 'p5_market': {
      if (phase.doneSeats.includes(mySeat))
        return { key: 'p5.sealed', titleKey: 'coach.p5.sealed.title', placement: 'bottom' }
      return {
        key: 'p5.market',
        titleKey: 'coach.p5.market.title',
        bodyKey: 'coach.p5.market.body',
        whyKey: 'coach.p5.market.why',
        target: '.bottom-panel'
      }
    }
    default:
      return null // 'finished' is handled by the game-over screen
  }
}

/** An element's own box, or — for a 0×0 anchor like the "who goes here?"
    plate, whose title and heads hang around a point — the box of what it
    draws. Measuring the bare anchor put the hint chip on top of the heads. */
function visibleRect(el: Element): DOMRect {
  const own = el.getBoundingClientRect()
  if (own.width > 0 || own.height > 0) return own
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const child of el.querySelectorAll('*')) {
    const r = child.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    left = Math.min(left, r.left)
    top = Math.min(top, r.top)
    right = Math.max(right, r.right)
    bottom = Math.max(bottom, r.bottom)
  }
  return left === Infinity ? own : new DOMRect(left, top, right - left, bottom - top)
}

/** Viewport rect of the spotlight target, kept glued as the board reflows.
    Polls because the target (dock / bottom panel) can mount a frame or two
    after the coach un-gates — a one-shot measure would miss it and fall back to
    a banner. Skips setState when the rect is unchanged to avoid render churn. */
function useTargetRect(selector: string | undefined, deps: unknown[]): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    if (!selector) {
      setRect(null)
      return
    }
    const measure = (): void => {
      const el = document.querySelector(selector)
      const r = el ? visibleRect(el) : null
      setRect((prev) => {
        if (!prev && !r) return prev
        if (
          prev &&
          r &&
          prev.left === r.left &&
          prev.top === r.top &&
          prev.width === r.width &&
          prev.height === r.height
        )
          return prev
        return r
      })
    }
    measure()
    const raf = requestAnimationFrame(measure)
    const interval = setInterval(measure, 250)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(interval)
      window.removeEventListener('resize', measure)
    }
  }, deps)
  return rect
}

export interface ScreenPoint {
  x: number
  y: number
}

/** Viewport centers of board Locations, polled like useTargetRect: the Pixi
    camera refits on resize and the scene mounts a frame late, so a one-shot
    read would pin an arrow to where a Location used to be. */
function useLocationPoints(
  ids: LocationId[] | undefined,
  locate: ((id: LocationId) => ScreenPoint | null) | undefined
): ScreenPoint[] {
  const key = ids?.join() ?? ''
  const [points, setPoints] = useState<ScreenPoint[]>([])
  useEffect(() => {
    if (!ids || ids.length === 0 || !locate) {
      setPoints((prev) => (prev.length === 0 ? prev : []))
      return
    }
    const measure = (): void => {
      const next = ids.map((id) => locate(id)).filter((p): p is ScreenPoint => p !== null)
      setPoints((prev) =>
        prev.length === next.length &&
        prev.every((p, i) => p.x === next[i]?.x && p.y === next[i]?.y)
          ? prev
          : next
      )
    }
    measure()
    const raf = requestAnimationFrame(measure)
    const interval = setInterval(measure, 250)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(interval)
      window.removeEventListener('resize', measure)
    }
  }, [key, locate])
  return points
}

/**
 * The pointing layer (player feedback: "пусть появляются стрелочки указывающие
 * на что кликать и куда потом ставить, перетаскивать"). One bobbing arrowhead
 * per destination, plus — when the step also has a DOM source — a marching
 * dashed line from that source to each destination, which is the drag drawn out.
 *
 * An arrow sits ABOVE its destination pointing down, unless the destination is
 * too near the top of the viewport to fit one, in which case it goes below
 * pointing up. Everything is fixed-position and pointer-transparent: the real
 * UI underneath stays completely live.
 */
function CoachArrows({ from, to }: { from: DOMRect | null; to: ScreenPoint[] }) {
  if (to.length === 0) return null
  const source = from ? { x: from.left + from.width / 2, y: from.top + from.height / 2 } : null
  const GAP = 14 // clear of the token/panel the arrow points at
  const LEN = 30
  return (
    <svg className="coach-arrows" aria-hidden="true">
      {to.map((p, i) => {
        const down = p.y > LEN + GAP + 8
        const tipY = down ? p.y - GAP : p.y + GAP
        const tailY = down ? tipY - LEN : tipY + LEN
        return (
          <g key={i}>
            {source && (
              <line
                className="coach-guide"
                x1={source.x}
                y1={source.y}
                x2={p.x}
                y2={tailY}
                // Each line starts its march a beat apart so several
                // destinations read as separate routes, not one moving comb.
                style={{ animationDelay: `${i * 0.25}s` }}
              />
            )}
            <path
              className={`coach-arrow ${down ? 'down' : 'up'}`}
              d={`M ${p.x} ${tipY} L ${p.x - 13} ${tailY} L ${p.x + 13} ${tailY} Z`}
            />
          </g>
        )
      })}
    </svg>
  )
}

export function TutorialCoach({
  view,
  locate
}: {
  view: PlayerView
  /** Board anchor for the arrows: viewport center of a Location. */
  locate?: (id: LocationId) => ScreenPoint | null
}) {
  const t = useT()
  const picker = useUiStore((s) => s.picker !== null)
  const activeActor = useUiStore((s) => s.dragging ?? s.selectedActor)
  const chooserAt = useUiStore((s) => s.actorChooser)
  const stagedCount = useUiStore((s) => Object.keys(s.staged).length)
  const covering = usePhaseIntroCover(view)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [reopened, setReopened] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  /** Cards shown this game, oldest first — the only way back to one, since
      `coachStep` can describe the live state and nothing else. */
  const [history, setHistory] = useState<SeenCard[]>([])
  /** Non-null ⇒ the player is re-reading a card out of `history`. */
  const [reread, setReread] = useState<CoachCursor | null>(null)

  const step = useMemo(
    () => coachStep(view, { picker, stagedCount, activeActor, chooserAt }),
    [view, picker, stagedCount, activeActor, chooserAt]
  )
  const nowPhase = PHASE_NUMBER[view.phase.kind] ?? 0
  // A re-read blanks the spotlight AND the arrows: the past card's target may no
  // longer be on screen, and a ring around a stale element points at nothing.
  const rect = useTargetRect(reread ? undefined : step?.target, [
    reread,
    step?.target,
    step?.key,
    view.seq,
    stagedCount,
    picker
  ])
  const arrowPoints = useLocationPoints(reread ? undefined : step?.targetLocations, locate)
  // A new concept restarts its intro at page 1 — and ends any re-read, because
  // the live game has moved past what the player was looking back at.
  useEffect(() => {
    setPage(0)
    setReread(null)
  }, [step?.key])
  // Remember each card as it comes up (dismissed or not — it is still the tip for
  // the step the player just walked through). Guarded against a re-record of the
  // same key so a remount cannot double it.
  useEffect(() => {
    if (!step || !coachCardPages(step)) return
    const seen: SeenCard = { card: step, turn: view.turn, phase: nowPhase }
    setHistory((prev) =>
      prev.at(-1)?.card.key === step.key ? prev : [...prev, seen].slice(-HISTORY_MAX)
    )
  }, [step?.key])

  if (covering || !step) return null

  const title = t(step.titleKey)
  const livePages = coachCardPages(step)
  const canReopen = livePages !== null
  // What a re-read can reach: the cards shown earlier in THIS phase (see
  // coachHistoryHere) — each one carries the turn/phase it was shown in.
  const past = coachHistoryHere(history, { turn: view.turn, phase: nowPhase }, step.key)
  const rereading = reread && reread.index !== null ? past[reread.index] : undefined
  const cursor: CoachCursor = rereading && reread ? reread : { index: null, page }
  const shown: SeenCard = rereading ?? { card: step, turn: view.turn, phase: nowPhase }
  const pages = coachCardPages(shown.card)
  const showCard =
    pages !== null && (rereading !== undefined || reopened === step.key || !dismissed.has(step.key))

  const gotIt = (): void => {
    setDismissed((prev) => new Set(prev).add(step.key))
    setReopened(null)
  }

  if (showCard && pages) {
    const idx = Math.min(cursor.page, pages.length - 1)
    const pg = pages[idx]!
    const seenPages = past.map((s) => coachCardPages(s.card)?.length ?? 1)
    const at = { index: cursor.index, page: idx }
    const forward = coachWalk(1, at, seenPages, livePages?.length ?? 1)
    const back = coachWalk(-1, at, seenPages, livePages?.length ?? 1)
    const goto = (to: CoachCursor): void => {
      if (to.index === null) {
        setReread(null)
        setPage(to.page)
      } else setReread(to)
    }
    // Only the live card's last page dismisses; forward out of a re-read just
    // returns to it.
    const advance = (): void => (forward ? goto(forward) : gotIt())
    return createPortal(
      <div className="coach-scrim" onPointerDown={advance}>
        <div
          className={`coach-card ${rereading ? 'past' : ''}`}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="coach-card-phase">
            {t('coach.turnPhase', { n: shown.turn, m: shown.phase })}
          </span>
          <h3 className="coach-card-title">{t(pg.titleKey)}</h3>
          {pg.bodyKey && <p className="coach-card-body">{t(pg.bodyKey)}</p>}
          {/* The reason, on the card's last page only: it explains the step the
              card ends on, not the narrative pages leading up to it. */}
          {shown.card.whyKey && idx === pages.length - 1 && (
            <p className="coach-why card">
              <span className="coach-why-tag">{t('coach.why')}</span> {t(shown.card.whyKey)}
            </p>
          )}
          {pages.length > 1 && (
            <div className="coach-dots">
              {pages.map((_, i) => (
                <button
                  key={i}
                  className={`coach-dot ${i === idx ? 'active' : ''}`}
                  aria-label={t('coach.page', { n: i + 1 })}
                  onClick={() => goto({ index: cursor.index, page: i })}
                />
              ))}
            </div>
          )}
          <div className="coach-card-nav">
            {back && (
              <button className="btn secondary coach-card-back" onClick={() => goto(back)}>
                {t('coach.prev')}
              </button>
            )}
            <button className="btn coach-card-btn" onClick={advance}>
              {forward ? t('coach.next') : t('coach.dismiss')}
            </button>
          </div>
        </div>
      </div>,
      document.body
    )
  }

  const reopenBtn = canReopen ? (
    <button
      className="coach-q"
      onClick={() => {
        setPage(0)
        setReopened(step.key)
      }}
      title={t('coach.reopen')}
    >
      ?
    </button>
  ) : null

  // The hint's text: what to do, and under it why it matters.
  const said = (
    <span className="coach-said">
      <span>{title}</span>
      {step.whyKey && <span className="coach-why">{t(step.whyKey)}</span>}
    </span>
  )
  const arrows = <CoachArrows from={rect} to={arrowPoints} />

  // Spotlight a concrete element… The chip is left-anchored to the target and
  // clamped to the viewport, so a left-edge target (the dock) never pushes it
  // off-screen.
  if (step.target && rect) {
    const margin = 12
    const vw = window.innerWidth
    const maxW = Math.min(460, vw - margin * 2)
    const left = Math.max(margin, Math.min(rect.left, vw - margin - maxW))
    const above = rect.top > 150
    return createPortal(
      <>
        <div
          className="coach-ring"
          style={{
            left: rect.left - 8,
            top: rect.top - 8,
            width: rect.width + 16,
            height: rect.height + 16
          }}
        />
        {arrows}
        <div
          className="coach-chip"
          style={{
            left,
            maxWidth: maxW,
            top: above ? rect.top - 14 : rect.bottom + 14,
            transform: above ? 'translateY(-100%)' : 'none'
          }}
        >
          {said}
          {reopenBtn}
        </div>
      </>,
      document.body
    )
  }

  // …or float a non-blocking banner (fullscreen moments, waiting, target missing).
  const bottom = step.placement === 'bottom'
  return createPortal(
    <>
      {arrows}
      <div className={`coach-banner ${bottom ? 'bottom' : 'top'}`}>
        {said}
        {reopenBtn}
      </div>
    </>,
    document.body
  )
}
