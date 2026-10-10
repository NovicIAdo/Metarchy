// deriveBoardProps: PlayerView + local staging → what the scene draws. Pure and
// unit-tested; the Pixi side stays dumb. Committed placements always come from the
// server view (sync wins); staged ghosts exist only before my P2 commit.

import type { ActorId, ActorType, LocationId, PlayerView, SeatId } from '@metarchy/engine'
import { ALLOWED_LOCATIONS, LOCATIONS } from '@metarchy/engine'
import type { Wardrobe } from '@metarchy/protocol'
import type { AllyStagingState } from '../stores/game.js'
import type { StagedPlacement } from '../stores/ui.js'
import { relocationTargets } from '../screens/game/phase-helpers.js'
import type { BoardProps, BoardToken, LocationVisual } from './scene.js'

export interface DeriveBoardInput {
  view: PlayerView | null
  staged: Partial<Record<ActorType, StagedPlacement>>
  /** Actor being dragged or selected in the dock — its legal targets glow. */
  activeActor: ActorType | null
  /** Location currently under the drag pointer. */
  hoverLocation: LocationId | null
  /** P3 relocate step: source token — its legal destinations glow. */
  relocateSource?: ActorId | null
  /**
   * Staged (not yet sent) relocation: the token is drawn at its destination so
   * the player sees the move land immediately; picking another actor snaps it
   * back. The game state only changes on Done (user rule).
   */
  relocateStaged?: { actorId: ActorId; to: LocationId } | null
  /**
   * Moves already sent with Done — the engine applies them only when the whole
   * relocate step resolves, so these hold the tokens at their destinations
   * until the server view catches up (no snap-back after Done, user rule).
   */
  sentMoves?: { actorId: ActorId; to: LocationId }[]
  /** 2v2: the ally's live pre-commit staging — drawn as their ghost tokens. */
  allyStaging?: AllyStagingState | null
  /** Bought argument-coin set per seat (from the roster); absent = free coins. */
  argSkins?: Partial<Record<SeatId, string | null>>
  /** Cosmetic wardrobe per seat (from the roster) — token heads wear it. */
  wardrobes?: Partial<Record<SeatId, Wardrobe | null>>
}

export function stagedTokenId(actorType: ActorType): string {
  return `staged:${actorType}`
}

export function deriveBoardProps(input: DeriveBoardInput): BoardProps {
  const { view, staged, activeActor, hoverLocation } = input
  const relocateSource = input.relocateSource ?? null
  const relocateStaged = input.relocateStaged ?? null
  const sentTo = new Map((input.sentMoves ?? []).map((m) => [m.actorId, m.to]))
  const disabled = new Set(view?.board.disabledLocations ?? [])
  const sourcePlacement = relocateSource
    ? (view?.board.placements.find((p) => p.actorId === relocateSource) ?? null)
    : null
  // Relocation into a disabled location is legal (engine I-6) — no disabled filter.
  const relocateGlow = new Set(
    sourcePlacement ? relocationTargets(sourcePlacement.actorType, sourcePlacement.locationId) : []
  )
  const inP2 = view?.phase.kind === 'p2_distribution'
  const committedMine =
    view && view.phase.kind === 'p2_distribution'
      ? view.phase.committedSeats.includes(view.seat)
      : false

  // The location fighting right now (P4) glows for everyone.
  const conflictLocation =
    view?.phase.kind === 'p4_conflict'
      ? (view.phase.conflicts[view.phase.index]?.locationId ?? null)
      : null

  const locations = {} as Record<LocationId, LocationVisual>
  for (const id of LOCATIONS) {
    let state: LocationVisual['state'] = 'normal'
    if (activeActor && !disabled.has(id) && ALLOWED_LOCATIONS[activeActor].includes(id))
      state = hoverLocation === id ? 'active' : 'hint'
    if (relocateGlow.has(id)) state = hoverLocation === id ? 'active' : 'hint'
    if (conflictLocation === id) state = 'active'
    locations[id] = { state, disabled: disabled.has(id) }
  }

  const tokens: BoardToken[] = []
  if (view) {
    // One token per actorId, always. After the distribution reveal the server
    // view can carry the same actor in board.placements (public) AND phase.sealed
    // (my group's commit) at once — rendering both doubled every own actor for
    // human players (#4). board.placements wins; sealed only fills what is absent.
    const drawn = new Set<ActorId>()
    for (const p of view.board.placements) {
      drawn.add(p.actorId)
      const movedHere = relocateStaged?.actorId === p.actorId
      const locationId = movedHere
        ? (relocateStaged as { to: LocationId }).to
        : (sentTo.get(p.actorId) ?? p.locationId)
      tokens.push({
        id: p.actorId,
        actorType: p.actorType,
        seat: p.seat,
        locationId,
        argument: p.argument ?? null,
        bet: p.bet ?? null,
        staged: false,
        selected: p.actorId === relocateSource || movedHere
      })
    }
    if (view.phase.kind === 'p2_distribution') {
      for (const sealed of view.phase.sealed) {
        for (const p of sealed.placements) {
          if (drawn.has(p.actorId)) continue
          drawn.add(p.actorId)
          tokens.push({
            id: p.actorId,
            actorType: p.actorType,
            seat: p.seat,
            locationId: p.locationId,
            argument: p.argument,
            bet: p.bet ?? null,
            staged: false
          })
        }
      }
    }
  }
  if (inP2 && !committedMine) {
    for (const [actorType, placement] of Object.entries(staged) as [ActorType, StagedPlacement][]) {
      tokens.push({
        id: stagedTokenId(actorType),
        actorType,
        seat: null,
        locationId: placement.locationId,
        argument: placement.argument,
        bet: placement.bet ?? null,
        staged: true
      })
    }
  }
  // 2v2 team transparency: the ally's live pre-commit staging renders as ghost
  // tokens (their seat pin, ally ring, argument+bet badges). The server view's
  // sealed placements take over the moment the ally commits.
  const ally = input.allyStaging ?? null
  if (
    view &&
    view.phase.kind === 'p2_distribution' &&
    ally &&
    ally.staging.kind === 'p2' &&
    ally.staging.turn === view.turn &&
    view.allies.includes(ally.fromSeat) &&
    !view.phase.committedSeats.includes(ally.fromSeat)
  ) {
    for (const p of ally.staging.placements) {
      tokens.push({
        id: `allystaged:${ally.fromSeat}:${p.actorType}`,
        actorType: p.actorType,
        seat: ally.fromSeat,
        locationId: p.locationId,
        argument: p.argument,
        bet: p.bet ?? null,
        staged: true
      })
    }
  }

  return {
    locations,
    tokens,
    viewerSeat: view?.seat ?? null,
    allySeats: view?.allies ?? [],
    argSkins: input.argSkins ?? {},
    wardrobes: input.wardrobes ?? {}
  }
}
