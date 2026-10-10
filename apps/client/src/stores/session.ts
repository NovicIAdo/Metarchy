// Auth + connection status. Supabase owns the auth lifecycle; this store mirrors
// it for React and carries the profile the game server returns in `welcome`.

import type { Wardrobe } from '@metarchy/protocol'
import { create } from 'zustand'

/** `superseded`: another tab took the session over; this one waits, it does not retry. */
export type SocketStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'superseded'

export interface ServerProfile {
  userId: string
  nickname: string
  avatar: string | null
  wardrobe?: Wardrobe | null
}

interface SessionStore {
  authReady: boolean
  /** Supabase principal; userId below is the canonical game profile. */
  authUserId: string | null
  userId: string | null
  email: string | null
  profile: ServerProfile | null
  socketStatus: SocketStatus
  lastError: string | null
  /**
   * Somebody wrote a private message while this player was somewhere else.
   * Lives in the app-shell store rather than the chat screen because that is
   * exactly the case the screen cannot cover: it is not mounted. Without it an
   * incoming DM is dropped silently and the recipient never learns of it — which
   * is why the persisted chat sat at zero messages for the whole beta.
   */
  dmUnread: boolean

  setAuth(userId: string | null, email: string | null): void
  setProfile(profile: ServerProfile | null): void
  setSocketStatus(status: SocketStatus): void
  setError(message: string | null): void
  setDmUnread(unread: boolean): void
}

export const useSessionStore = create<SessionStore>((set) => ({
  authReady: false,
  authUserId: null,
  userId: null,
  email: null,
  profile: null,
  socketStatus: 'offline',
  lastError: null,
  dmUnread: false,

  setAuth: (authUserId, email) =>
    set((state) => ({
      authUserId,
      email,
      authReady: true,
      ...(state.authUserId === authUserId
        ? {}
        : { userId: authUserId, profile: null, dmUnread: false, lastError: null })
    })),
  setProfile: (profile) =>
    set((state) => ({ profile, userId: profile?.userId ?? state.authUserId })),
  setSocketStatus: (socketStatus) => set({ socketStatus }),
  setError: (lastError) => set({ lastError }),
  setDmUnread: (dmUnread) => set({ dmUnread })
}))
