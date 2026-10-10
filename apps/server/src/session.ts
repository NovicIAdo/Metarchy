// One authenticated WebSocket. The hub and rooms talk to this interface only —
// nothing below the session sees raw sockets.

import type { ErrorCode, ServerMessage, Wardrobe } from '@metarchy/protocol'
import { encodeServerMessage } from '@metarchy/protocol'
import type { WebSocket } from 'ws'

export interface Profile {
  userId: string
  nickname: string
  avatar: string | null
  /** Actor cosmetic loadouts; null/absent = canonical looks. */
  wardrobe?: Wardrobe | null
}

export interface Session {
  /** Unique per connection (a user reconnecting gets a new session). */
  readonly connId: number
  readonly userId: string
  /** From the verified JWT. Personal-skin grants are keyed by it (exclusives.ts);
      null when the token carries no address. Never sent to any client. */
  readonly email: string | null
  readonly profile: Profile
  send(msg: ServerMessage): void
  sendError(code: ErrorCode, message: string, opts?: { seq?: number; details?: unknown }): void
  close(code: number, reason: string): void
}

/** Slow consumers get disconnected rather than buffered without bound. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024

let nextConnId = 1

export function makeSession(
  socket: WebSocket,
  profile: Profile,
  email: string | null = null
): Session {
  const connId = nextConnId++
  return {
    connId,
    userId: profile.userId,
    email,
    profile,
    send(msg) {
      if (socket.readyState !== socket.OPEN) return
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        socket.terminate()
        return
      }
      socket.send(encodeServerMessage(msg))
    },
    sendError(code, message, opts) {
      this.send({
        t: 'error',
        ...(opts?.seq !== undefined ? { seq: opts.seq } : {}),
        p: { code, message, ...(opts?.details !== undefined ? { details: opts.details } : {}) }
      })
    },
    close(code, reason) {
      if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING)
        socket.close(code, reason)
    }
  }
}

/** App close codes (4000–4999) — defined in the protocol, the client reads them too. */
export { CLOSE_AUTH_FAILED, CLOSE_HELLO_TIMEOUT, CLOSE_SUPERSEDED } from '@metarchy/protocol'
