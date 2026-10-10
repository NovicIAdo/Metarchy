// Every modal must portal to <body>: position:fixed is resolved against the
// nearest transformed ancestor, and HUD containers use transforms (.hud-bottom
// centers with translateX) — a modal rendered in place there collapses into a
// strip inside the panel instead of covering the screen.

import type { MouseEventHandler, ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function ModalOverlay({
  children,
  onClick,
  className
}: {
  children: ReactNode
  onClick?: MouseEventHandler<HTMLDivElement>
  /** Extra overlay class — e.g. stats-over lifts Global Stats above the arena. */
  className?: string
}) {
  return createPortal(
    <div
      className={className ? `modal-overlay ${className}` : 'modal-overlay'}
      {...(onClick ? { onClick } : {})}
    >
      {children}
    </div>,
    document.body
  )
}
