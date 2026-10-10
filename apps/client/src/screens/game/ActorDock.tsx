// Actors awaiting placement (P2): a vertical column of round portraits on the
// left edge, the prototype way. Placed actors leave the column — their ghost
// tokens live on the board (tap one to re-open its picker). Drag an orb onto
// the board (pointer capture stays with the window — see ActiveGame's
// listeners) or tap to select, then tap a glowing location.

import type { ActorType } from '@metarchy/engine'
import { ACTOR_TYPES } from '@metarchy/engine'
import { ActorHead } from '../../components/ActorHead.js'
import { useT } from '../../i18n/index.js'
import { useDomain } from '../../i18n/domain.js'
import { useActorWardrobe } from '../../lib/actorHead.js'
import { useUiStore } from '../../stores/ui.js'

export function ActorDock() {
  const t = useT()
  const d = useDomain()
  const staged = useUiStore((s) => s.staged)
  const selected = useUiStore((s) => s.selectedActor)
  const dragging = useUiStore((s) => s.dragging)
  const picker = useUiStore((s) => s.picker)
  const startDrag = useUiStore((s) => s.startDrag)
  const wardrobe = useActorWardrobe()

  // An actor mid-pick is "in flight" — it shows big on the location, not here.
  const remaining = ACTOR_TYPES.filter((actor) => !staged[actor] && actor !== picker?.actorType)
  if (remaining.length === 0) return null

  const onPointerDown = (actor: ActorType) => (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    startDrag(actor, { x: e.clientX, y: e.clientY })
  }

  return (
    <div className="hud hud-actors">
      <div className="dock">
        {remaining.map((actor) => {
          const classes = [
            'dock-orb',
            selected === actor ? 'selected' : '',
            dragging === actor ? 'dragging' : ''
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div key={actor} className={classes} onPointerDown={onPointerDown(actor)}>
              <ActorHead type={actor} wardrobe={wardrobe} alt={d.actor(actor)} />
              <span className="dock-tip">{d.actor(actor)}</span>
            </div>
          )
        })}
        <span className="dock-count">{t('game.ready', { n: remaining.length })}</span>
      </div>
    </div>
  )
}
