// P4 sidebar (rulebook): the viewer's own conflicts as a checklist plus their
// peaceful (unopposed win, already rewarded) and blocked actors.

import { useT } from '../../../i18n/index.js'
import { useDomain } from '../../../i18n/domain.js'
import { ActorHead } from '../../../components/ActorHead.js'
import { useActorWardrobe } from '../../../lib/actorHead.js'
import { rewardText } from './ConflictArena.js'
import type { SidebarItem } from './derive.js'

export function ConflictSidebar({ items }: { items: SidebarItem[] }) {
  const t = useT()
  const d = useDomain()
  const wardrobe = useActorWardrobe()
  if (items.length === 0) return null
  return (
    <div className="hud-panel" style={{ marginTop: 8 }}>
      <p className="hud-label">{t('game.conflict.yours')}</p>
      {items.map((item, i) => {
        if (item.t === 'conflict') {
          const mark = item.status === 'resolved' ? '✓' : item.status === 'current' ? '⚔' : '…'
          return (
            <div key={i} className={`hud-stat conflict-item ${item.status}`}>
              <span className="conflict-mark">{mark}</span>
              <span>
                {t('game.conflict.sideConflict', {
                  actor: d.actor(item.actorType),
                  loc: d.location(item.locationId)
                })}
              </span>
            </div>
          )
        }
        if (item.t === 'peaceful') {
          return (
            <div key={i} className="hud-stat conflict-item resolved">
              <span className="conflict-mark">✓</span>
              <span>
                {t('game.conflict.sidePeaceful', {
                  actor: d.actor(item.actorType),
                  reward: rewardText(item.reward, d, t)
                })}
              </span>
              <ActorHead type={item.actorType} wardrobe={wardrobe} />
            </div>
          )
        }
        return (
          <div key={i} className="hud-stat conflict-item blocked">
            <span className="conflict-mark">⛔</span>
            <span>
              {t('game.conflict.sideBlocked', {
                actor: d.actor(item.actorType),
                loc: d.location(item.locationId)
              })}
            </span>
          </div>
        )
      })}
    </div>
  )
}
