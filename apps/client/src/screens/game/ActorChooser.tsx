// Placement the other way round (player feedback, 14 y/o beta reader): "если
// кликнуть на локацию, то можно выбрать актора, которого можно поставить в эту
// локацию". Tapping a Location with nothing in hand opens this plate on that
// Location with the Actors that may still go there — a Politician already in
// the University leaves only the Artist for the Square.
//
// Same manners as the ArgBetPicker it hands over to: a 0×0 anchor pinned to the
// location's screen center, no Cancel button (a pointer-down off the plate is
// the cancel), and the plate stays glued across resizes. Picking an Actor opens
// the argument/bet picker exactly as a drag onto the Location would.

import { useEffect, useRef, useState } from 'react'
import type { ActorType, LocationId } from '@metarchy/engine'
import { ActorHead } from '../../components/ActorHead.js'
import { useT } from '../../i18n/index.js'
import { useDomain } from '../../i18n/domain.js'
import { useActorWardrobe } from '../../lib/actorHead.js'
import { useUiStore } from '../../stores/ui.js'

/** Head spacing along the row, and the plate's extents for viewport clamping. */
const STEP_X = 78
const EDGE = { x: 150, top: 96, bottom: 130 }

export function ActorChooser({
  locationId,
  actors,
  locate
}: {
  locationId: LocationId
  actors: ActorType[]
  /** Board anchor: viewport center of a location (absent in unit tests). */
  locate?: (id: LocationId) => { x: number; y: number } | null
}) {
  const t = useT()
  const d = useDomain()
  const openPicker = useUiStore((s) => s.openPicker)
  const closeActorChooser = useUiStore((s) => s.closeActorChooser)
  const wardrobe = useActorWardrobe()
  const [anchor, setAnchor] = useState(() => locate?.(locationId) ?? null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!locate) return
    const relocate = (): number =>
      requestAnimationFrame(() => setAnchor(locate(locationId) ?? null))
    window.addEventListener('resize', relocate)
    return () => window.removeEventListener('resize', relocate)
  }, [locate, locationId])

  // The opening tap ends before this mounts, so it cannot self-cancel.
  // The tutorial card that explains this plate opens over it: dismissing the
  // card must leave the plate up, or the lesson closes what it teaches.
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return
      if (e.target instanceof Element && e.target.closest('.coach-scrim')) return
      closeActorChooser()
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [closeActorChooser])

  const pos = anchor ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const halfRow = ((actors.length - 1) * STEP_X) / 2
  const x = Math.min(
    Math.max(pos.x, EDGE.x + halfRow),
    Math.max(EDGE.x + halfRow, window.innerWidth - EDGE.x - halfRow)
  )
  const y = Math.min(
    Math.max(pos.y, EDGE.top),
    Math.max(EDGE.top, window.innerHeight - EDGE.bottom)
  )

  return (
    <div ref={rootRef} className="actor-chooser" style={{ left: x, top: y }}>
      <span className="chooser-title">
        {t('game.chooser.title', { loc: d.location(locationId) })}
      </span>
      <div className="chooser-row">
        {actors.map((actor) => (
          <button
            key={actor}
            className="chooser-head"
            title={d.actor(actor)}
            onClick={() => openPicker({ actorType: actor, locationId })}
          >
            <ActorHead type={actor} wardrobe={wardrobe} alt={d.actor(actor)} />
            <span className="chooser-name">{d.actor(actor)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
