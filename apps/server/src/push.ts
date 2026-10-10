// FCM HTTP v1 push sender ("your turn", Stage 5). No firebase-admin — the whole
// exchange is a jose-signed service-account JWT for an OAuth token plus one POST
// per message. Absent FCM_SERVICE_ACCOUNT_JSON, the server runs pushless.

import { importPKCS8, SignJWT } from 'jose'
import type { LoggerLike } from './rooms/room.js'
import type { GameStore } from './store.js'

export interface PushNote {
  title: string
  body: string
  /** Small string map delivered to the app (e.g. { gameId }). */
  data?: Record<string, string>
}

export interface PushService {
  /** Fire-and-forget fan-out to every device the user registered. */
  notifyUser(userId: string, note: PushNote): Promise<void>
}

interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
  token_uri: string
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

export function makePushService(
  serviceAccountJson: string | undefined,
  store: GameStore,
  log: LoggerLike
): PushService | null {
  if (!serviceAccountJson) return null
  let account: ServiceAccount
  try {
    account = JSON.parse(serviceAccountJson) as ServiceAccount
  } catch {
    log.error({}, 'FCM_SERVICE_ACCOUNT_JSON is not valid JSON — pushes disabled')
    return null
  }

  let cached: { token: string; expiresAt: number } | null = null
  async function accessToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token
    const key = await importPKCS8(account.private_key, 'RS256')
    const now = Math.floor(Date.now() / 1000)
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(account.client_email)
      .setAudience(account.token_uri)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key)
    const res = await fetch(account.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      })
    })
    const json = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token) throw new Error(`FCM token grant failed (${res.status})`)
    cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 }
    return cached.token
  }

  /** 'gone' = FCM says the token is dead — the caller unregisters it. */
  async function sendTo(token: string, note: PushNote): Promise<'ok' | 'gone' | 'error'> {
    const bearer = await accessToken()
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: note.title, body: note.body },
            ...(note.data ? { data: note.data } : {}),
            android: { priority: 'HIGH', collapse_key: note.data?.gameId ?? 'metarchy' }
          }
        })
      }
    )
    if (res.ok) return 'ok'
    const text = await res.text()
    if (res.status === 404 || text.includes('UNREGISTERED') || text.includes('INVALID_ARGUMENT'))
      return 'gone'
    log.warn({ status: res.status, body: text.slice(0, 300) }, 'FCM send failed')
    return 'error'
  }

  return {
    async notifyUser(userId, note) {
      try {
        const tokens = await store.loadPushTokens(userId)
        for (const token of tokens) {
          const outcome = await sendTo(token, note)
          if (outcome === 'gone') await store.deletePushToken(token)
        }
      } catch (error) {
        log.warn({ err: error, userId }, 'push delivery failed')
      }
    }
  }
}
