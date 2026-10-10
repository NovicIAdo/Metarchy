// The achievement board (author's list, 2026-07-27), shared by the player's own
// profile and by the public profile of another player — the author asked for
// achievements on the public profile in backlog #2 and that screen shipped
// without them.
//
// Earned AND unearned are both drawn: an unearned achievement is a goal, and the
// requirement is written on every tile, so the panel doubles as the list of
// things there are to do. The catalog is static protocol data (the client always
// knows every badge); the server only says which ones are earned and how far the
// counters have got.
//
// The six "play N games" families are drawn as one row per category with three
// tier chips instead of eighteen separate tiles — the tiers ARE a progression,
// and eighteen tiles would bury the fourteen one-off feats underneath them.

import type { Achievement, AchievementState, PlayCategory } from '@metarchy/protocol'
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  ACHIEVEMENT_GROUPS,
  PLAY_CATEGORIES,
  PLAY_TIERS
} from '@metarchy/protocol'
import { useT, type TFunction } from '../i18n/index.js'

/** Counter badges compose their name from category + tier; feats have their own. */
function nameOf(a: Achievement, t: TFunction): string {
  if (a.threshold === undefined) return t(a.nameKey)
  return `${t(a.nameKey)} · ${t(`achv.tier.${a.threshold}`)}`
}

function hintOf(a: Achievement, t: TFunction): string {
  if (a.category === undefined || a.threshold === undefined) return t(a.hintKey)
  return t(a.hintKey, { n: a.threshold, cat: t(`achv.catGen.${a.category}`) })
}

function Tile({ a, earnedAt, t }: { a: Achievement; earnedAt: string | undefined; t: TFunction }) {
  const date = earnedAt
    ? new Date(earnedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    : ''
  return (
    <li className={`achv-tile ${earnedAt ? 'earned' : 'locked'}`}>
      <span className="achv-mark" aria-hidden="true">
        {earnedAt ? '✓' : '🔒'}
      </span>
      <span className="achv-body">
        <span className="achv-name">{nameOf(a, t)}</span>
        <span className="achv-hint">{hintOf(a, t)}</span>
        {earnedAt && <span className="achv-when">{t('achv.earnedOn', { date })}</span>}
      </span>
    </li>
  )
}

/** One category's three tiers: earned shows a tick, unearned shows how far along. */
function TierRow({
  category,
  played,
  earned,
  t
}: {
  category: PlayCategory
  played: number
  earned: Set<string>
  t: TFunction
}) {
  return (
    <li className="achv-tier-row">
      <span className="achv-tier-cat">{t(`achv.cat.${category}`)}</span>
      <span className="achv-tier-chips">
        {PLAY_TIERS.map((threshold) => {
          const id = `play.${category}.${threshold}`
          const has = earned.has(id)
          const hint = t('achv.play.hint', {
            n: threshold,
            cat: t(`achv.catGen.${category}`)
          })
          return (
            <span
              key={threshold}
              className={`achv-chip ${has ? 'earned' : 'locked'}`}
              title={hint}
              aria-label={`${hint}${has ? ' ✓' : ` — ${played}/${threshold}`}`}
            >
              {has ? `✓ ${threshold}` : t('achv.progress', { n: played, total: threshold })}
            </span>
          )
        })}
      </span>
    </li>
  )
}

export function AchievementsPanel({ state }: { state: AchievementState | null | undefined }) {
  const t = useT()
  if (!state) return <p className="hint-text">{t('common.loading')}</p>

  // A row for an id the catalog no longer lists is ignored rather than rendered
  // blank: ids are never removed on purpose, but a stale row must not break a
  // profile screen.
  const earnedAt = new Map(
    state.earned.filter((e) => ACHIEVEMENTS_BY_ID.has(e.id)).map((e) => [e.id, e.earnedAt])
  )
  const earnedIds = new Set(earnedAt.keys())

  return (
    <>
      <p className="hint-text">
        {t('achv.earnedOf', { n: earnedAt.size, total: ACHIEVEMENTS.length })} · {t('achv.blurb')}
      </p>

      {ACHIEVEMENT_GROUPS.map((group) => {
        // Counter tiers are drawn by TierRow, so they are not tiles.
        const tiles = ACHIEVEMENTS.filter((a) => a.group === group && a.threshold === undefined)
        const hasTiers = group === 'play'
        if (tiles.length === 0 && !hasTiers) return null
        return (
          <div key={group} className="achv-group">
            <h3 className="achv-group-title">{t(`achv.group.${group}`)}</h3>
            {hasTiers && (
              <ul className="achv-tiers">
                {PLAY_CATEGORIES.map((category) => (
                  <TierRow
                    key={category}
                    category={category}
                    played={state.counts[category].played}
                    earned={earnedIds}
                    t={t}
                  />
                ))}
              </ul>
            )}
            {tiles.length > 0 && (
              <ul className="achv-grid">
                {tiles.map((a) => (
                  <Tile key={a.id} a={a} earnedAt={earnedAt.get(a.id)} t={t} />
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </>
  )
}
