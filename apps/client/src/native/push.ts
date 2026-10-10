// Native push registration (Stage 5): once the socket is authenticated, ask for
// notification permission, register with FCM and hand the token to the server
// over the socket (push.register). The web build never runs any of this.

import { PushNotifications } from '@capacitor/push-notifications'
import { gameSocket } from '../net/socket.js'
import { useSessionStore } from '../stores/session.js'
import { useSettingsStore } from '../stores/settings.js'
import { isNativePlatform } from './oauth.js'

let wired = false

async function register(): Promise<void> {
  let perm = await PushNotifications.checkPermissions()
  if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions()
  if (perm.receive !== 'granted') return
  await PushNotifications.register()
}

/** Idempotent app-boot hook; a no-op on the web. */
export function wireNativePush(): void {
  if (!isNativePlatform() || wired) return
  wired = true

  void PushNotifications.addListener('registration', ({ value }) => {
    gameSocket.registerPush(value, 'android')
  })
  void PushNotifications.addListener('registrationError', (err) => {
    console.warn('push registration failed', err)
  })

  // The token belongs to whoever is signed in — (re)register per online session.
  // The settings toggle gates it; turning it back on re-registers right away.
  let lastRegisteredFor: string | null = null
  const maybeRegister = (): void => {
    const s = useSessionStore.getState()
    const userId = s.profile?.userId ?? null
    if (!useSettingsStore.getState().notifications) return
    if (s.socketStatus !== 'online' || !userId || userId === lastRegisteredFor) return
    lastRegisteredFor = userId
    void register().catch((e) => console.warn('push setup failed', e))
  }
  useSessionStore.subscribe(maybeRegister)
  useSettingsStore.subscribe((s, prev) => {
    if (s.notifications && !prev.notifications) {
      lastRegisteredFor = null // deliberate re-opt-in — register again
      maybeRegister()
    }
  })
}
