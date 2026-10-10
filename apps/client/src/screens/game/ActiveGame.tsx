// The live board screen: Pixi scene + HUD + P2 placement flow. Owns the DOM side
// of drag-and-drop (window pointer listeners + hit-testing through the scene) and
// the commit bar; every committed fact renders from the server view, never from
// local state (sync wins).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActorId, ActorType, LocationId, PlayerView } from '@metarchy/engine'
import type { ClientIntent } from '@metarchy/protocol'
import { argSkinFor } from '@metarchy/protocol'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { deriveBoardProps, stagedTokenId } from '../../board/derive.js'
import { useT } from '../../i18n/index.js'
import { PixiBoard, type PixiBoardHandle } from '../../board/PixiBoard.js'
import { ActorHead } from '../../components/ActorHead.js'
import { useActorWardrobe } from '../../lib/actorHead.js'
import { gameSocket } from '../../net/socket.js'
import { useGameStore } from '../../stores/game.js'
import { useSessionStore } from '../../stores/session.js'
import {
  canCommit,
  isLegalPlacement,
  placeableActorsAt,
  toPlacementInputs,
  useUiStore
} from '../../stores/ui.js'
import { ActionPhasePanel } from './ActionPhasePanel.js'
import { ActionResultsModal } from './ActionResultsModal.js'
import { ActorChooser } from './ActorChooser.js'
import { ActorDock } from './ActorDock.js'
import { AllyPanel } from './AllyPanel.js'
import { ArgBetPicker } from './ArgBetPicker.js'
import { ChatPanel } from './ChatPanel.js'
import { ConflictArena, SpectatorBanner } from './conflict/ConflictArena.js'
import { ConflictSidebar } from './conflict/ConflictSidebar.js'
import { deriveConflictUi } from './conflict/derive.js'
import { EventModal } from './EventModal.js'
import { ForfeitButton } from './ForfeitButton.js'
import { GlobalStats } from './GlobalStats.js'
import { ErrorToast, HandStrip, TopBar } from './HudPanels.js'
import { MarketPanel } from './MarketPanel.js'
import { MarketSummary } from './MarketSummary.js'
import { PhaseSplash, usePhaseIntroCover } from './PhaseSplash.js'
import { TieBreakerAnnounce } from './TieBreakerAnnounce.js'
import { TurnSummary } from './TurnSummary.js'
import { TutorialCoach } from './TutorialCoach.js'
import { relocatableActors, relocationTargets } from './phase-helpers.js'

function inDistribution(view: PlayerView | null): view is PlayerView & {
  phase: Extract<PlayerView['phase'], { kind: 'p2_distribution' }>
} {
  return view?.phase.kind === 'p2_distribution'
}

export function ActiveGame({ gameId }: { gameId: string }) {
  const navigate = useNavigate()
  const t = useT()
  const view = useGameStore((s) => s.view)
  const staged = useUiStore((s) => s.staged)
  const dragging = useUiStore((s) => s.dragging)
  const dragMoved = useUiStore((s) => s.dragMoved)
  const dragPos = useUiStore((s) => s.dragPos)
  const selectedActor = useUiStore((s) => s.selectedActor)
  const hoverLocation = useUiStore((s) => s.hoverLocation)
  const picker = useUiStore((s) => s.picker)
  const actorChooser = useUiStore((s) => s.actorChooser)
  const relocateSource = useUiStore((s) => s.relocateSource)
  const relocateStaged = useUiStore((s) => s.relocateStaged)
  const sentMoves = useUiStore((s) => s.sentMoves)
  const socketStatus = useSessionStore((s) => s.socketStatus)
  const roster = useGameStore((s) => s.players)
  // A spectator receives a seatless, strictly-public view (view.spectator): every
  // interactive control is suppressed and the board renders read-only.
  const spectator = view?.spectator === true
  const watchers = useGameStore((s) => s.watchers)
  const allyStaging = useGameStore((s) => s.allyStaging)
  const [statsOpen, setStatsOpen] = useState(false)
  const boardRef = useRef<PixiBoardHandle>(null)

  const leaveSpectating = (): void => {
    gameSocket.spectateLeave(gameId)
    useUiStore.getState().reset()
    navigate('/watch')
  }

  const p2 = inDistribution(view)
  const committedMine = p2 && view.phase.committedSeats.includes(view.seat)
  // The board is revealed and the turn is holding so everyone can see where the
  // others went (author: "я не вижу куда бот расставил своих акторов"). The
  // placements are already on the board — this panel is the beat and the button.
  const reveal = p2 ? view.phase.revealed : undefined
  const revealAcked = !!reveal && !spectator && !!view && reveal.acked.includes(view.seat)
  const iAmActive = view ? view.activeSeats.includes(view.seat) : false
  // Eliminated: forfeit, a disconnect that ran out its grace, or the rules.
  const iAmOut = !spectator && !!view && view.eliminated.includes(view.seat)
  // The loud defeat banner shows for a beat, then unmounts so only the quiet
  // bottom "you are out / keep watching" tag remains. Reset if the game resets.
  const [defeatShown, setDefeatShown] = useState(true)
  useEffect(() => {
    if (!iAmOut) {
      setDefeatShown(true)
      return
    }
    const id = setTimeout(() => setDefeatShown(false), 4600)
    return () => clearTimeout(id)
  }, [iAmOut, gameId])
  const placing = p2 && !committedMine && iAmActive
  const relocating =
    !!view &&
    view.phase.kind === 'p3_action' &&
    view.phase.step.t === 'relocate' &&
    view.waitingOn.includes(view.seat)

  // New turn (or game) invalidates local staging.
  useEffect(() => {
    if (view) useUiStore.getState().ensureStagedKey(`${gameId}:${view.turn}`)
  }, [gameId, view])

  // A relocation source only makes sense while the relocate step waits on me.
  useEffect(() => {
    if (!relocating && useUiStore.getState().relocateSource !== null)
      useUiStore.getState().setRelocateSource(null)
  }, [relocating])

  // The placement window closed under an open picker (commit/deadline) — the
  // half-picked actor has nowhere to land, and the "who goes here?" plate has
  // nothing left to answer.
  useEffect(() => {
    if (placing) return
    if (useUiStore.getState().picker) useUiStore.getState().cancelPicker()
    if (useUiStore.getState().actorChooser) useUiStore.getState().closeActorChooser()
  }, [placing])

  // Sent relocations hold their tokens at the destination until the server
  // catches up: when the step resolves the board carries the applied moves
  // (voided ones snap back exactly when the ceremony explains why).
  useEffect(() => {
    if (!view) return
    const ui = useUiStore.getState()
    if (ui.sentMoves.length === 0) return
    const stillRelocating =
      view.phase.kind === 'p3_action' &&
      (view.phase.step.t === 'relocate' || view.phase.step.t === 'relocate_tiebreak')
    if (!stillRelocating) {
      ui.setSentMoves([])
      return
    }
    const pending = ui.sentMoves.filter((m) => {
      const p = view.board.placements.find((x) => x.actorId === m.actorId)
      return p !== undefined && p.locationId !== m.to
    })
    if (pending.length !== ui.sentMoves.length) ui.setSentMoves(pending)
  }, [view])

  // User rule: the deadline never auto-places. The client commits whatever is
  // staged just before the server deadline, so actors the player DID place
  // stay on the board; the rest sit the turn out. A dead tab commits nothing.
  const deadline = useGameStore((s) => s.deadline)
  useEffect(() => {
    if (!placing || !deadline?.endsAt) return
    const fireIn = deadline.endsAt - gameSocket.serverNow() - 1500
    if (fireIn <= 0) return
    const timer = setTimeout(() => {
      const v = useGameStore.getState().view
      if (!v || v.phase.kind !== 'p2_distribution') return
      if (v.phase.committedSeats.includes(v.seat)) return
      const stagedNow = useUiStore.getState().staged
      if (Object.keys(stagedNow).length === 0) return
      gameSocket.sendIntent(gameId, {
        type: 'distribution.commit',
        placements: toPlacementInputs(stagedNow)
      })
    }, fireIn)
    return () => clearTimeout(timer)
  }, [placing, deadline, gameId])

  // 2v2 team transparency: stream my pre-commit staging to the ally, debounced
  // (the server relays it ally-only). An emptied map retracts the ghosts; after
  // commit the ally renders the sealed placements from the server view instead.
  const allyLive = !spectator && !!view?.teams && (view?.allies.length ?? 0) > 0
  const p2Turn = placing && view ? view.turn : null
  useEffect(() => {
    if (!allyLive || p2Turn === null) return
    const timer = setTimeout(() => {
      gameSocket.sendTeamStaging(gameId, {
        kind: 'p2',
        turn: p2Turn,
        placements: toPlacementInputs(staged)
      })
    }, 200)
    return () => clearTimeout(timer)
  }, [staged, allyLive, p2Turn, gameId])

  // Window-level drag tracking: the chip lives in the DOM, the drop target in canvas.
  useEffect(() => {
    if (!dragging || !placing) return
    const disabled = view.board.disabledLocations
    const move = (e: PointerEvent): void => {
      const hit = boardRef.current?.hitTestLocation(e.clientX, e.clientY) ?? null
      useUiStore.getState().moveDrag({ x: e.clientX, y: e.clientY }, hit)
    }
    const up = (): void => {
      const ui = useUiStore.getState()
      const { dragging: actor, dragMoved: moved, hoverLocation: target } = ui
      ui.endDrag()
      if (!actor) return
      if (!moved) {
        ui.selectActor(ui.selectedActor === actor ? null : actor)
        return
      }
      if (target && isLegalPlacement(actor, target, disabled))
        ui.openPicker({ actorType: actor, locationId: target })
    }
    const cancel = (): void => useUiStore.getState().endDrag()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [dragging, placing, view])

  const activeActor = placing ? (dragging ?? selectedActor) : null
  // Coin sets are read off the roster so a rival's board badge wears their set,
  // never mine (lib/argCoins.ts holds the same rule for the DOM side).
  const argSkins = useMemo(
    () => Object.fromEntries(roster.map((p) => [p.seat, argSkinFor(p.wardrobe)])),
    [roster]
  )
  // Token heads wear the owner's wardrobe — same roster rule as the coin sets.
  const wardrobes = useMemo(
    () => Object.fromEntries(roster.map((p) => [p.seat, p.wardrobe ?? null])),
    [roster]
  )
  const myWardrobe = useActorWardrobe()
  const board = useMemo(() => {
    // The actor being picked lives in the DOM picker (big portrait on the
    // location) — its staged ghost would double it on the board underneath.
    let stagedForBoard = staged
    if (picker && staged[picker.actorType]) {
      stagedForBoard = { ...staged }
      delete stagedForBoard[picker.actorType]
    }
    return deriveBoardProps({
      view,
      staged: stagedForBoard,
      activeActor,
      hoverLocation: activeActor || relocateSource ? hoverLocation : null,
      relocateSource: relocating ? relocateSource : null,
      relocateStaged: relocating ? relocateStaged : null,
      sentMoves,
      allyStaging,
      argSkins,
      wardrobes
    })
  }, [
    view,
    staged,
    picker,
    activeActor,
    hoverLocation,
    relocateSource,
    relocateStaged,
    relocating,
    sentMoves,
    allyStaging,
    argSkins,
    wardrobes
  ])

  const conflictUi = useMemo(() => deriveConflictUi(view), [view])
  const p4 = view?.phase.kind === 'p4_conflict'

  // The announcement plays first: phase-specific UI (event modal, arena,
  // bottom panel) mounts under the opaque part of the splash and is revealed
  // by its fade-out — the video's rhythm, never content-then-splash.
  const introCovering = usePhaseIntroCover(view)

  // P3 results ceremonies (blocks/relocations/exchanges) replace the bottom
  // panel with a Get It! screen.
  const p3Ack =
    view?.phase.kind === 'p3_action' &&
    (view.phase.step.t === 'blocks_ack' ||
      view.phase.step.t === 'relocations_ack' ||
      view.phase.step.t === 'exchanges_ack')

  // The event modal and the arena cover the whole screen — pause the Pixi
  // ticker underneath (battery on phones, frames on software-GL machines).
  // Watchers see both as read-only observers; the board keeps rendering behind
  // their arena, since they are watching rather than playing.
  const fullscreenModal =
    view?.phase.kind === 'p1_event' || (!spectator && Boolean(conflictUi.arena?.involved))
  useEffect(() => {
    boardRef.current?.setRenderPaused(fullscreenModal)
  }, [fullscreenModal])

  const send = (intent: ClientIntent): void => gameSocket.sendIntent(gameId, intent)

  // Board geometry for the DOM overlays that anchor to a Location (the picker,
  // the "who goes here?" plate, the tutorial's arrows). Stable: the consumers
  // poll it, so a fresh identity every render would restart their timers.
  const locateLocation = useCallback(
    (id: LocationId) => boardRef.current?.locationToScreen(id) ?? null,
    []
  )

  const onLocationTap = (id: LocationId): void => {
    const ui = useUiStore.getState()
    if (placing) {
      // Tap-to-place: dock tap selected an actor, board tap drops it.
      if (ui.selectedActor) {
        if (isLegalPlacement(ui.selectedActor, id, view.board.disabledLocations))
          ui.openPicker({ actorType: ui.selectedActor, locationId: id })
        return
      }
      // Nothing in hand: the Location asks who should go there instead. One
      // candidate is not a choice — hand it straight to the argument picker.
      const candidates = placeableActorsAt(ui.staged, id, view.board.disabledLocations)
      if (candidates.length === 1)
        ui.openPicker({ actorType: candidates[0] as ActorType, locationId: id })
      else if (candidates.length > 1) ui.openActorChooser(id)
      return
    }
    if (relocating && ui.relocateSource) {
      const source = view.board.placements.find((p) => p.actorId === ui.relocateSource)
      if (source && relocationTargets(source.actorType, source.locationId).includes(id)) {
        // User rule: nothing is sent until Done — the player may re-pick
        // another actor or destination first, however many cards they play.
        ui.setRelocateStaged({ actorId: source.actorId, to: id })
      }
    }
  }

  const onTokenTap = (id: string): void => {
    const ui = useUiStore.getState()
    if (placing) {
      for (const [actorType, placement] of Object.entries(ui.staged)) {
        if (stagedTokenId(actorType as ActorType) === id)
          ui.openPicker({ actorType: actorType as ActorType, locationId: placement.locationId })
      }
      return
    }
    if (relocating) {
      // Any actor may be relocated (own or opponents'), once per my card.
      const movable = relocatableActors(view).some((p) => p.actorId === id)
      if (movable) ui.setRelocateSource(ui.relocateSource === id ? null : (id as ActorId))
    }
  }

  const onLocationHover = (id: LocationId | null): void => {
    const ui = useUiStore.getState()
    if (ui.dragging) return // drag path owns hover via hit-testing
    ui.setHoverLocation(id)
  }

  const stagedCount = Object.keys(staged).length
  // Emptied under an open plate (the last candidate got staged) ⇒ nothing to show.
  const chooserActors =
    placing && actorChooser
      ? placeableActorsAt(staged, actorChooser, view.board.disabledLocations)
      : []
  const commitReady = view ? canCommit(staged, view.me.resources) : false
  const waitingNames = view
    ? view.waitingOn.filter((s) => s !== view.seat).map((s) => t('game.seatLower', { n: s }))
    : []

  return (
    <div className="game-stage">
      <PixiBoard
        ref={boardRef}
        board={board}
        onLocationTap={onLocationTap}
        onLocationHover={onLocationHover}
        onTokenTap={onTokenTap}
      />
      <TopBar view={view} onStats={() => setStatsOpen(true)} />
      {!spectator && watchers && watchers.count > 0 && (
        <div className="watchers-chip" title={watchers.names.join(', ')}>
          👁 {watchers.names.join(', ')}
        </div>
      )}
      {view && !introCovering && !spectator && (
        <HandStrip view={view} onOpen={() => setStatsOpen(true)} />
      )}
      {view && p4 && (
        <div className="hud hud-right">
          <ConflictSidebar items={conflictUi.sidebar} />
        </div>
      )}
      {/* 2v2: own actors dock on the left, the ally's column on the right
          (their actors + hand + live staging). P4 hands the right edge to the
          conflict sidebar. */}
      {!introCovering && !spectator && !p4 && view && view.allies.length > 0 && (
        <AllyPanel view={view} />
      )}

      {!introCovering && placing && <ActorDock />}

      {/* P3 card picking sits on the LEFT: as a bottom sheet it covered the
          Theatre/Factory locations — with 3+ actors there you could not see who
          stood where while choosing a card. */}
      {!introCovering && !spectator && !p3Ack && view && view.phase.kind === 'p3_action' && (
        <div className="hud hud-p3">
          <div className="hud-panel p3-panel">
            <ActionPhasePanel view={view} send={send} />
          </div>
        </div>
      )}

      <div className="hud hud-bottom">
        {!introCovering && placing && (
          <div className="hud-panel bottom-panel">
            <div className="commit-bar">
              <span className="hint-text">{t('game.commitHint', { n: stagedCount })}</span>
              <button
                className="btn confirm"
                disabled={!commitReady}
                onClick={() =>
                  send({ type: 'distribution.commit', placements: toPlacementInputs(staged) })
                }
              >
                ✓ {t('game.commitPlacements')}
              </button>
            </div>
          </div>
        )}
        {!introCovering && p2 && committedMine && !reveal && (
          <div className="hud-panel bottom-panel waiting">
            <span className="waiting-pulse">{t('game.placementsSealed')}</span>
            {waitingNames.length > 0 && (
              <span className="hint-text">({waitingNames.join(', ')})</span>
            )}
          </div>
        )}
        {!introCovering && reveal && (
          <div className="hud-panel bottom-panel reveal-panel">
            <span className="reveal-title">{t('game.reveal.title')}</span>
            <span className="hint-text">{t('game.reveal.body')}</span>
            {spectator ? null : revealAcked ? (
              <span className="hint-text waiting-pulse">
                {waitingNames.length > 0
                  ? t('game.reveal.waiting', { names: waitingNames.join(', ') })
                  : t('game.waitingOthers')}
              </span>
            ) : (
              <button
                className="btn confirm"
                onClick={() => send({ type: 'distribution.reveal.ack' })}
              >
                {t('game.getIt')}
              </button>
            )}
          </div>
        )}
        {!introCovering && !spectator && iAmActive && view && view.phase.kind === 'p5_market' && (
          <div className="hud-panel bottom-panel">
            <MarketPanel view={view} send={send} />
          </div>
        )}
        {/* Out of the game. Beta report behind the forfeit gate: an eliminated
            player's Actors simply vanished and the match played on with nothing
            said, which reads as a bug even when the rules did it. The board
            stays watchable, so say that too. */}
        {!introCovering && iAmOut && (
          <div className="hud-panel bottom-panel waiting">
            <span className="eliminated-tag">{t('game.youAreOut')}</span>
            <span className="hint-text">{t('game.youAreOutWatch')}</span>
          </div>
        )}
        {!introCovering && spectator && view && (
          <div className="hud-panel bottom-panel waiting">
            <span className="spectator-tag">👁 {t('watch.spectating')}</span>
            <span className="hint-text">
              {t('phase.' + view.phase.kind)}
              {watchers && watchers.count > 0
                ? ' · ' + t('watch.watching', { n: watchers.count })
                : ''}
            </span>
          </div>
        )}
        {!introCovering && p4 && conflictUi.arena && !conflictUi.arena.involved && (
          <SpectatorBanner arena={conflictUi.arena} />
        )}
        {!view && <div className="hud-panel bottom-panel">{t('game.syncing')}</div>}
      </div>

      {/* Body-portaled like TopBar: the way out must stay tappable over the
          conflict arena and the P1 event, which are body-level overlays. */}
      {createPortal(
        spectator ? (
          <button className="btn secondary hud-forfeit" onClick={leaveSpectating}>
            {t('watch.leave')}
          </button>
        ) : view && view.eliminated.includes(view.seat) ? (
          // Eliminated: the server has already released us for new games — the
          // board stays watchable, but the way out is home, not another forfeit.
          <button
            className="btn secondary hud-forfeit"
            onClick={() => {
              useUiStore.getState().reset()
              useGameStore.getState().resetGame()
              navigate('/')
            }}
          >
            {t('game.leaveGame')}
          </button>
        ) : (
          // Guarded: the tap only opens a confirm (ForfeitButton explains why).
          <ForfeitButton mode={view?.mode ?? '1v1'} onForfeit={() => gameSocket.forfeit(gameId)} />
        ),
        document.body
      )}

      {view?.teams && <ChatPanel gameId={gameId} view={view} />}

      {/* A loud center-screen "You lost" before the quiet bottom line — beta
          players missed the small tag entirely and thought the game bugged.
          Sits over the board, dismisses itself into the watch view below. */}
      {!introCovering && iAmOut && defeatShown && (
        <div className="defeat-overlay" role="alert">
          <div className="defeat-banner">
            <span className="defeat-title">{t('game.youLost')}</span>
            <span className="hint-text">{t('game.youAreOutWatch')}</span>
          </div>
        </div>
      )}

      {(socketStatus === 'reconnecting' || socketStatus === 'connecting') && (
        <div className="reconnect-overlay">
          <div className="reconnect-box">
            <span className="waiting-pulse">{t('game.reconnecting')}</span>
            <p className="hint-text">{t('game.reconnectSafe')}</p>
          </div>
        </div>
      )}
      {/* Watchers get the event too (author request: which card is in play, who
          has sealed, and the tie-break as it resolves) — read-only, and only
          ever the data the engine has already made public. */}
      {!introCovering && view && view.phase.kind === 'p1_event' && (
        <EventModal view={view} send={send} />
      )}
      {!introCovering && !spectator && p3Ack && view && (
        <ActionResultsModal view={view} send={send} />
      )}
      {!introCovering && view && (conflictUi.arena?.involved || spectator) && conflictUi.arena && (
        // Watchers get the arena read-only (their sentinel seat makes every
        // control "not me", and the server never honors a spectator intent), so
        // they see the fight live instead of a bare result. The board behind a
        // spectator's arena keeps animating — they are an observer, not a player.
        <ConflictArena arena={conflictUi.arena} view={view} send={send} />
      )}
      {picker && view && (
        <ArgBetPicker
          key={`${picker.actorType}:${picker.locationId}`}
          target={picker}
          view={view}
          locate={locateLocation}
        />
      )}
      {/* Tapped a Location with nothing in hand: who can still go there? */}
      {chooserActors.length > 0 && actorChooser && (
        <ActorChooser
          key={actorChooser}
          locationId={actorChooser}
          actors={chooserActors}
          locate={locateLocation}
        />
      )}
      {/* Last of the overlays (plus z-index over .modal-overlay): the stats
          button works mid-conflict and mid-event, so the window must cover
          the arena and the P1 modal, not hide under them. */}
      {view && statsOpen && <GlobalStats view={view} onClose={() => setStatsOpen(false)} />}
      {dragging && dragMoved && dragPos && (
        <ActorHead
          className="drag-ghost"
          type={dragging}
          wardrobe={myWardrobe}
          style={{ left: dragPos.x, top: dragPos.y }}
        />
      )}
      <PhaseSplash view={view} />
      {/* End of Phase 4, every turn: the recap. Watchers see it too — it is the
          public story of the turn, and they have no button. */}
      {view && (
        <TurnSummary
          view={view}
          send={send}
          nameOf={(seat) =>
            roster.find((p) => p.seat === seat)?.nickname ?? t('gameshell.seat', { n: seat })
          }
        />
      )}
      {/* The market beat, every turn: who took home how many Action Cards, said
          for players and watchers before the next turn opens. */}
      {view && (
        <MarketSummary
          view={view}
          nameOf={(seat) =>
            roster.find((p) => p.seat === seat)?.nickname ?? t('gameshell.seat', { n: seat })
          }
        />
      )}
      {view && !spectator && <TieBreakerAnnounce view={view} />}
      {view && !spectator && view.mode === 'tutorial' && (
        <TutorialCoach view={view} locate={locateLocation} />
      )}
      <ErrorToast />
    </div>
  )
}
