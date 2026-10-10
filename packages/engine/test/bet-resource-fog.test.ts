// Hidden bets must not leak through public resources. A bet is paid at P2 commit
// but only revealed in P4 — so an opponent's resource drop is masked (added back)
// during P2 (the sealed phase) and P3 (revealing it there would sway how Action
// Cards are played), and shown to everyone at P4. Own resources and a finished
// replay are never masked.

import { describe, expect, it } from 'vitest'
import { projectReplayView, projectSpectatorView, projectView } from '../src/index.js'
import {
  customPlacements,
  newGame,
  passReveal,
  playPeacefulTurn,
  playThroughP1
} from './helpers.js'

describe('bet spend stays hidden in public resources until P4', () => {
  it('an opponent cannot see a bettor’s resource drop before P4', () => {
    const g = newGame() // 1v1; turn 1 opens at P2, everyone starts with 1/1/1.
    // Seat 1 commits a WIN bet (costs 1 product) and clashes politicians at the
    // square so a P4 conflict actually happens. Seat 0 has not committed yet.
    g.apply(1, {
      type: 'distribution.commit',
      placements: customPlacements(1, { politician: { locationId: 'square', bet: 'win' } })
    })
    passReveal(g)
    expect(g.state.phase.kind).toBe('p2_distribution')

    const oppSeesSeat1Product = (): number =>
      projectView(g.state, 0).others.find((o) => o.seat === 1)!.resources!.product
    const watcherSeesSeat1Product = (): number =>
      projectSpectatorView(g.state).others.find((o) => o.seat === 1)!.resources!.product

    // The real state is already spent…
    expect(g.state.inventories[1]!.resources.product).toBe(0)
    // …but the opponent and a live watcher still see the pre-bet count (masked).
    expect(oppSeesSeat1Product()).toBe(1)
    expect(watcherSeesSeat1Product()).toBe(1)
    // Seat 1 sees its own true (spent) resources — it knows its own bet.
    expect(projectView(g.state, 1).me.resources.product).toBe(0)

    // A finished-game replay is omniscient — it shows the real count.
    expect(projectReplayView(g.state).others.find((o) => o.seat === 1)!.resources!.product).toBe(0)

    // P4: the bet becomes public — the real count now shows to everyone. Turn 1
    // has no P3 (rulebook §Turn Structure), so the last commit lands straight here.
    g.apply(0, { type: 'distribution.commit', placements: customPlacements(0, {}) })
    passReveal(g)
    expect(g.state.phase.kind).toBe('p4_conflict')
    expect(oppSeesSeat1Product()).toBe(0)
    expect(watcherSeesSeat1Product()).toBe(0)
  })

  it('stays masked through P3 on a turn that has one', () => {
    const g = newGame()
    playPeacefulTurn(g) // turn 1 (no P3 at all)
    playThroughP1(g) // turn 2 opens on its Event, then P2
    expect(g.state.phase.kind).toBe('p2_distribution')

    const before = g.state.inventories[1]!.resources.product
    g.apply(1, {
      type: 'distribution.commit',
      placements: customPlacements(1, { politician: { locationId: 'square', bet: 'win' } })
    })
    g.apply(0, { type: 'distribution.commit', placements: customPlacements(0, {}) })
    passReveal(g)
    // From turn 2 on, the commit lands in P3 — the drop must stay masked there,
    // because seeing it would sway how Action Cards are played.
    expect(g.state.phase.kind).toBe('p3_action')
    expect(g.state.inventories[1]!.resources.product).toBe(before - 1)
    expect(projectView(g.state, 0).others.find((o) => o.seat === 1)!.resources!.product).toBe(
      before
    )
    expect(projectSpectatorView(g.state).others.find((o) => o.seat === 1)!.resources!.product).toBe(
      before
    )
  })
})
