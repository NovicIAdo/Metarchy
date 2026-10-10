// Head icon that honors the owner's wardrobe. Canonical looks render the
// author's hand-drawn portrait exactly as before; a dressed look renders the
// measured crop of the full art (lib/actorHead.ts holds the precedence — the
// same rule ActorArt applies to full figures). Call sites keep sizing the box;
// the crop positions the art inside it.

import type { Wardrobe } from '@metarchy/protocol'
import { themeAsset } from '../theme.js'
import { headLook } from '../lib/actorHead.js'

export function ActorHead({
  type,
  wardrobe,
  className,
  style,
  alt = '',
  draggable = false
}: {
  type: string
  wardrobe?: Wardrobe | null
  className?: string
  style?: React.CSSProperties
  alt?: string
  draggable?: boolean
}) {
  const look = headLook(type, wardrobe)
  if (look.kind === 'canonical')
    return (
      <img
        className={`actor-head ${className ?? ''}`}
        style={style}
        src={themeAsset(look.key)}
        alt={alt}
        draggable={draggable}
      />
    )

  const keys = look.kind === 'skin' ? [look.key] : look.keys
  const { x, y, s, aspect } = look.crop
  return (
    <span
      className={`actor-head actor-head-crop ${className ?? ''}`}
      style={style}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
    >
      {keys.map((key) => (
        <img
          key={key}
          src={themeAsset(key)}
          alt=""
          draggable={false}
          style={{
            height: `${100 / s}%`,
            left: `${50 - (x * aspect * 100) / s}%`,
            top: `${50 - (y * 100) / s}%`
          }}
        />
      ))}
    </span>
  )
}
