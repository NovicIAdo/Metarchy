// Seconds left until a server timestamp, ticking once a second.
//
// Lives here rather than in the HUD because the queue panel on Home needs it
// too, and Home must not import from screens/game — that chunk pulls in PixiJS
// (see the lazy ActiveGame import in GameScreen).

import { useEffect, useState } from 'react'
import { gameSocket } from '../net/socket.js'

/** null while there is no deadline; never negative. */
export function useCountdown(endsAt: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    if (endsAt === null) {
      setRemaining(null)
      return
    }
    // Deadlines are server timestamps — compare against the server clock, which
    // pong keeps corrected for this tab's drift.
    const update = (): void =>
      setRemaining(Math.max(0, Math.ceil((endsAt - gameSocket.serverNow()) / 1000)))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [endsAt])
  return remaining
}
