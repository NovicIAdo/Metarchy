// uiStore: staged-but-uncommitted choices and pointer interaction state.
// Sealed-bid UX (architecture/Client.md §3): staged placements live ONLY here
// until distribution.commit; the server view takes over after commit. Staging is
// keyed by game+turn so a sync to a new turn drops stale drafts.

import type {
  ActorId,
  ActorType,
  ArgumentType,
  BetType,
  LocationId,
  PlacementInput,
  PlayerView,
  ResourceType,
  Resources
} from '@metarchy/engine'
import { ACTOR_TYPES, ALLOWED_LOCATIONS, ARGUMENT_TYPES, BET_COST } from '@metarchy/engine'
import { create } from 'zustand'

export interface StagedPlacement {
  locationId: LocationId
  argument: ArgumentType
  bet?: BetType
}

export type StagedMap = Partial<Record<ActorType, StagedPlacement>>

export interface PickerTarget {
  actorType: ActorType
  locationId: LocationId
}

interface UiStore {
  /** `${gameId}:${turn}` the staged map belongs to. */
  stagedKey: string | null
  staged: StagedMap
  dragging: ActorType | null
  /** Becomes true once the pointer travels far enough to count as a drag. */
  dragMoved: boolean
  dragPos: { x: number; y: number } | null
  selectedActor: ActorType | null
  hoverLocation: LocationId | null
  picker: PickerTarget | null
  /**
   * Placement the other way round (player feedback): a tap on a Location with
   * nothing in hand asks WHO goes there, listing the actors still unplaced that
   * this Location accepts. Picking one hands over to `picker` as usual.
   */
  actorChooser: LocationId | null
  /** P3 relocate step: the board token picked as the move's source. */
  relocateSource: ActorId | null
  /** Multi-card relocation: the move staged for the current card until Done. */
  relocateStaged: { actorId: ActorId; to: LocationId } | null
  /**
   * Moves already sent with Done. The engine applies relocations only when the
   * whole step resolves — until then these keep the token drawn at its
   * destination so it never snaps back after Done (user rule). Pruned when the
   * server view reflects (or voids) them.
   */
  sentMoves: { actorId: ActorId; to: LocationId }[]

  ensureStagedKey(key: string): void
  setRelocateSource(actorId: ActorId | null): void
  setRelocateStaged(staged: { actorId: ActorId; to: LocationId } | null): void
  pushSentMove(move: { actorId: ActorId; to: LocationId }): void
  setSentMoves(moves: { actorId: ActorId; to: LocationId }[]): void
  startDrag(actor: ActorType, pos: { x: number; y: number }): void
  moveDrag(pos: { x: number; y: number }, hover: LocationId | null): void
  endDrag(): void
  setHoverLocation(id: LocationId | null): void
  selectActor(actor: ActorType | null): void
  openActorChooser(locationId: LocationId): void
  closeActorChooser(): void
  openPicker(target: PickerTarget): void
  /**
   * Tap-away cancel: closes the picker AND drops any staged placement for its
   * actor — the actor "returns to the hand" (there is no Cancel button).
   */
  cancelPicker(): void
  stagePlacement(actorType: ActorType, placement: StagedPlacement): void
  reset(): void
}

const DRAG_THRESHOLD_PX = 6

export const useUiStore = create<UiStore>((set) => ({
  stagedKey: null,
  staged: {},
  dragging: null,
  dragMoved: false,
  dragPos: null,
  selectedActor: null,
  hoverLocation: null,
  picker: null,
  actorChooser: null,
  relocateSource: null,
  relocateStaged: null,
  sentMoves: [],

  ensureStagedKey: (key) =>
    set((s) =>
      s.stagedKey === key
        ? s
        : {
            stagedKey: key,
            staged: {},
            picker: null,
            actorChooser: null,
            selectedActor: null,
            hoverLocation: null,
            relocateSource: null,
            relocateStaged: null,
            sentMoves: []
          }
    ),
  // Changing the source discards the staged move — the player is re-deciding.
  setRelocateSource: (relocateSource) => set({ relocateSource, relocateStaged: null }),
  setRelocateStaged: (relocateStaged) => set({ relocateStaged }),
  // A later card may re-move the same actor — the newest destination wins.
  pushSentMove: (move) =>
    set((s) => ({
      sentMoves: [...s.sentMoves.filter((m) => m.actorId !== move.actorId), move]
    })),
  setSentMoves: (sentMoves) => set({ sentMoves }),
  startDrag: (actor, pos) =>
    set({ dragging: actor, dragMoved: false, dragPos: pos, hoverLocation: null }),
  moveDrag: (pos, hover) =>
    set((s) => {
      if (!s.dragging || !s.dragPos) return s
      const moved =
        s.dragMoved || Math.hypot(pos.x - s.dragPos.x, pos.y - s.dragPos.y) > DRAG_THRESHOLD_PX
      return { dragPos: moved ? pos : s.dragPos, dragMoved: moved, hoverLocation: hover }
    }),
  endDrag: () => set({ dragging: null, dragMoved: false, dragPos: null, hoverLocation: null }),
  setHoverLocation: (hoverLocation) => set({ hoverLocation }),
  selectActor: (actor) => set({ selectedActor: actor, actorChooser: null }),
  openActorChooser: (locationId) => set({ actorChooser: locationId, selectedActor: null }),
  closeActorChooser: () => set({ actorChooser: null }),
  openPicker: (target) => set({ picker: target, selectedActor: null, actorChooser: null }),
  cancelPicker: () =>
    set((s) => {
      if (!s.picker) return s
      const staged = { ...s.staged }
      delete staged[s.picker.actorType]
      return { staged, picker: null }
    }),
  stagePlacement: (actorType, placement) =>
    set((s) => ({ staged: { ...s.staged, [actorType]: placement }, picker: null })),
  reset: () =>
    set({
      stagedKey: null,
      staged: {},
      dragging: null,
      dragMoved: false,
      dragPos: null,
      selectedActor: null,
      hoverLocation: null,
      picker: null,
      actorChooser: null,
      relocateSource: null,
      relocateStaged: null,
      sentMoves: []
    })
}))

// --- Pure staging rules (unit-tested) ------------------------------------------------

/** Arguments already taken by staged actors other than `except`. */
export function usedArguments(staged: StagedMap, except?: ActorType): Set<ArgumentType> {
  const used = new Set<ArgumentType>()
  for (const [actorType, placement] of Object.entries(staged) as [ActorType, StagedPlacement][])
    if (actorType !== except) used.add(placement.argument)
  return used
}

/** Resource spend of staged bets, excluding `except`'s bet. */
export function stagedBetSpend(
  staged: StagedMap,
  except?: ActorType
): Record<ResourceType, number> {
  const spend: Record<ResourceType, number> = { product: 0, electricity: 0, recycling: 0 }
  for (const [actorType, placement] of Object.entries(staged) as [ActorType, StagedPlacement][]) {
    if (actorType === except || !placement.bet) continue
    spend[BET_COST[placement.bet]] += 1
  }
  return spend
}

/** Can this actor still afford `bet` given the other staged bets? */
export function betAffordable(
  bet: BetType,
  staged: StagedMap,
  resources: Resources,
  except?: ActorType
): boolean {
  const spend = stagedBetSpend(staged, except)
  const resource = BET_COST[bet]
  return resources[resource] - spend[resource] >= 1
}

export function isLegalPlacement(
  actorType: ActorType,
  locationId: LocationId,
  disabledLocations: readonly LocationId[]
): boolean {
  return (
    ALLOWED_LOCATIONS[actorType].includes(locationId) && !disabledLocations.includes(locationId)
  )
}

/**
 * Who could still go to this Location — the answer to a tap on the board with
 * nothing in hand (player feedback: "если я кликну на Площадь, то у меня
 * появится выбор Политик или Артист"). Already-placed actors drop out, so a
 * Politician sitting in the University leaves only the Artist for the Square.
 * Order follows ACTOR_TYPES so the plate never reshuffles under the finger.
 */
export function placeableActorsAt(
  staged: StagedMap,
  locationId: LocationId,
  disabledLocations: readonly LocationId[]
): ActorType[] {
  return ACTOR_TYPES.filter(
    (actor) => !staged[actor] && isLegalPlacement(actor, locationId, disabledLocations)
  )
}

/** Mirrors the engine's distribution.commit validation for instant affordance. */
export function canCommit(staged: StagedMap, resources: Resources): boolean {
  const entries = Object.entries(staged) as [ActorType, StagedPlacement][]
  if (entries.length !== ACTOR_TYPES.length) return false
  const args = new Set(entries.map(([, p]) => p.argument))
  if (args.size !== ARGUMENT_TYPES.length) return false
  for (const [actorType, p] of entries)
    if (!ALLOWED_LOCATIONS[actorType].includes(p.locationId)) return false
  const spend = stagedBetSpend(staged)
  return (Object.entries(spend) as [ResourceType, number][]).every(
    ([resource, cost]) => resources[resource] >= cost
  )
}

export function toPlacementInputs(staged: StagedMap): PlacementInput[] {
  return (Object.entries(staged) as [ActorType, StagedPlacement][]).map(([actorType, p]) => ({
    actorType,
    locationId: p.locationId,
    argument: p.argument,
    ...(p.bet ? { bet: p.bet } : {})
  }))
}

/** My values pool: teams share a pool (index = team), otherwise index = seat. */
export function valuesPoolIndex(view: PlayerView): number {
  if (!view.teams) return view.seat
  return view.teams[0].includes(view.seat) ? 0 : 1
}
