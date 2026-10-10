// Full-screen phase announcement between phases, straight from the prototype
// video (plan/Visual-Reference-2026-07-12.md): the screen is covered almost
// instantly by a near-opaque charcoal takeover — ghosted emblem in a ring,
// "TURN N PHASE M" in tracked caps, italic tagline — holds for a beat, then
// dissolves into the already-mounted phase content. Purely decorative:
// pointer-events pass through, so play (and the browser smokes) never block.
//
// Portals to <body>: .game-stage is position:fixed, which is a stacking
// context of its own in Chrome — rendered in place, the splash can never
// paint above body-portaled modals (the P1 event modal swallowed it).

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PlayerView } from '@metarchy/engine'
import { useT } from '../../i18n/index.js'
import { themeAsset } from '../../theme.js'

const PHASE_NUMBER: Record<string, number> = {
  p1_event: 1,
  p2_distribution: 2,
  p3_action: 3,
  p4_conflict: 4,
  p5_market: 5
}

/** Splash lifetime; keep in sync with the CSS animation length. */
export const PHASE_SPLASH_MS = 2600

/** How long phase content (event modal, arena, bottom panel) waits behind the
    opaque part of the splash before mounting — the announcement plays first,
    the phase appears under it, the fade-out reveals it. */
export const PHASE_INTRO_MS = 1000

/** One splash per announced moment: turn × tie-breaker flag × phase. */
function stampOf(view: PlayerView | null): string | null {
  if (!view || !(view.phase.kind in PHASE_NUMBER)) return null
  return `${view.turn}:${view.isTieBreakerTurn ? 'tb' : ''}:${view.phase.kind}`
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** True from the first committed render of a new stamp until `ms` later.
    The reset happens during render (React's derived-state-from-props form),
    so the very first paint of a new phase is already inside the window —
    gated content never flashes for a frame before the cover lands. */
function useStampWindow(stamp: string | null, ms: number): boolean {
  const [state, setState] = useState<{ stamp: string | null; done: boolean }>({
    stamp,
    done: false
  })
  if (state.stamp !== stamp) setState({ stamp, done: false })

  useEffect(() => {
    if (!stamp) return
    const timer = setTimeout(
      () => setState((s) => (s.stamp === stamp ? { stamp, done: true } : s)),
      ms
    )
    return () => clearTimeout(timer)
  }, [stamp, ms])

  return stamp !== null && state.stamp === stamp && !state.done
}

/** Gate for phase-specific UI: true while the splash still covers the screen.
    No-op for reduced-motion users — the splash is hidden for them, so there
    is nothing to wait behind. */
export function usePhaseIntroCover(view: PlayerView | null): boolean {
  const covering = useStampWindow(stampOf(view), PHASE_INTRO_MS)
  return covering && !prefersReducedMotion()
}

export function PhaseSplash({ view }: { view: PlayerView | null }) {
  const t = useT()
  const stamp = stampOf(view)
  const shown = useStampWindow(stamp, PHASE_SPLASH_MS)

  if (!view || !stamp || !shown) return null

  const phase = PHASE_NUMBER[view.phase.kind] ?? 0
  const title = view.isTieBreakerTurn
    ? t('game.splash.tiebreaker', { n: phase })
    : t('game.splash.turnPhase', { n: view.turn, m: phase })

  return createPortal(
    // Re-keyed per stamp so a new phase restarts the CSS animation from zero.
    <div className="phase-splash" key={stamp} aria-hidden="true">
      <div className="phase-splash-ring">
        <img src={themeAsset('logo')} alt="" />
      </div>
      <div className="phase-splash-lower">
        <h1>{title}</h1>
        <div className="phase-splash-rule">
          <i />
          <b />
          <i />
        </div>
        <p className="phase-splash-tag">{t(`game.splash.tag.${view.phase.kind}`)}</p>
      </div>
    </div>,
    document.body
  )
}
