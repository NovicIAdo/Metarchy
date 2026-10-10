// Test harness: local JWKS + signed test tokens (the real jose verification path,
// no auth bypass), a promise-based WS client, and a server factory on port 0.

import type { ServerMessage, ServerMessageOf } from '@metarchy/protocol'
import { ServerMessageSchema } from '@metarchy/protocol'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { WebSocket } from 'ws'
import { makeTokenVerifier } from '../src/auth.js'
import type { ServerConfig } from '../src/config.js'
import { DEFAULT_TIMEOUTS } from '../src/config.js'
import { DEFAULT_MATCHMAKING } from '../src/matchmaking.js'
import { MemoryProfileStore } from '../src/profiles.js'
import type { GatewayDeps, RunningServer } from '../src/server.js'
import { startServer } from '../src/server.js'
import type { GameStore } from '../src/store.js'
import { MemoryStore } from '../src/store.js'

export interface TestAuth {
  jwksJson: string
  issuer: string
  mint(
    userId: string,
    opts?: { role?: string; expiresIn?: string; aal?: 'aal1' | 'aal2'; email?: string | null }
  ): Promise<string>
}

export async function makeTestAuth(): Promise<TestAuth> {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const jwk = await exportJWK(publicKey)
  jwk.kid = 'test-key'
  jwk.alg = 'ES256'
  const issuer = 'https://test.metarchy.local/auth/v1'
  return {
    jwksJson: JSON.stringify({ keys: [jwk] }),
    issuer,
    async mint(userId, opts = {}) {
      return new SignJWT({
        email: opts.email === undefined ? 'player@test.local' : opts.email,
        role: opts.role ?? 'authenticated',
        aal: opts.aal ?? 'aal1'
      })
        .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
        .setSubject(userId)
        .setAudience('authenticated')
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime(opts.expiresIn ?? '1h')
        .sign(privateKey)
    }
  }
}

export function testConfig(auth: TestAuth, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    auth: { jwksJson: auth.jwksJson, issuer: auth.issuer },
    databaseUrl: 'memory:',
    timeouts: DEFAULT_TIMEOUTS,
    disconnectGraceMs: 60_000,
    helloTimeoutMs: 10_000,
    heartbeatIntervalMs: 0,
    rate: { capacity: 1000, refillPerSec: 1000 },
    bot: { minDelayMs: 0, maxDelayMs: 0 },
    // Fast ticks; no bot fallback unless a test asks for one.
    matchmaking: { ...DEFAULT_MATCHMAKING, tickMs: 20, botFallbackMs: 0 },
    logLevel: 'silent',
    ...overrides
  }
}

export interface TestServer {
  server: RunningServer
  auth: TestAuth
  store: GameStore
  wsUrl: string
  httpUrl: string
}

export async function startTestServer(
  overrides: Partial<ServerConfig> = {},
  deps: Partial<Omit<GatewayDeps, 'config'>> = {}
): Promise<TestServer> {
  const auth = await makeTestAuth()
  const config = testConfig(auth, overrides)
  const store = deps.store ?? new MemoryStore()
  const server = await startServer({
    config,
    verifier: deps.verifier ?? makeTokenVerifier(config.auth),
    profiles: deps.profiles ?? new MemoryProfileStore(),
    store,
    ...(deps.chat ? { chat: deps.chat } : {}),
    ...(deps.hub ? { hub: deps.hub } : {}),
    ...(deps.push ? { push: deps.push } : {}),
    ...(deps.identities ? { identities: deps.identities } : {}),
    ...(deps.walletAuth ? { walletAuth: deps.walletAuth } : {})
  })
  return {
    server,
    auth,
    store,
    wsUrl: server.url,
    httpUrl: server.url.replace(/^ws:/, 'http:').replace(/\/ws$/, '')
  }
}

interface Waiter {
  predicate: (msg: ServerMessage) => boolean
  resolve: (msg: ServerMessage) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export class TestClient {
  private readonly inbox: ServerMessage[] = []
  private readonly waiters = new Set<Waiter>()
  private closed: { code: number; reason: string } | null = null
  private closeWaiters: ((c: { code: number; reason: string }) => void)[] = []

  private constructor(private readonly ws: WebSocket) {}

  static async connect(url: string): Promise<TestClient> {
    const ws = new WebSocket(url)
    const client = new TestClient(ws)
    ws.on('message', (data) => {
      const parsed = ServerMessageSchema.safeParse(JSON.parse(data.toString('utf8')))
      if (!parsed.success) throw new Error(`server sent invalid message: ${data.toString()}`)
      client.deliver(parsed.data)
    })
    ws.on('close', (code, reason) => {
      client.closed = { code, reason: reason.toString() }
      for (const w of client.closeWaiters) w(client.closed)
      client.closeWaiters = []
      for (const w of client.waiters) {
        clearTimeout(w.timer)
        w.reject(new Error(`socket closed (${code}) while waiting`))
      }
      client.waiters.clear()
    })
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    return client
  }

  private deliver(msg: ServerMessage): void {
    for (const w of this.waiters) {
      if (w.predicate(msg)) {
        this.waiters.delete(w)
        clearTimeout(w.timer)
        w.resolve(msg)
        return
      }
    }
    this.inbox.push(msg)
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }

  async next(
    predicate: (msg: ServerMessage) => boolean = () => true,
    timeoutMs = 3000
  ): Promise<ServerMessage> {
    const idx = this.inbox.findIndex(predicate)
    if (idx >= 0) return this.inbox.splice(idx, 1)[0] as ServerMessage
    if (this.closed) throw new Error(`socket already closed (${this.closed.code})`)
    return new Promise<ServerMessage>((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          reject(
            new Error(
              `timed out waiting for message; inbox: ${this.inbox.map((m) => m.t).join(',') || 'empty'}`
            )
          )
        }, timeoutMs)
      }
      this.waiters.add(waiter)
    })
  }

  async expect<T extends ServerMessage['t']>(
    t: T,
    timeoutMs?: number
  ): Promise<ServerMessageOf<T>> {
    return (await this.next((m) => m.t === t, timeoutMs)) as ServerMessageOf<T>
  }

  async hello(accessToken: string, resume?: { gameId: string; lastEventSeq: number }) {
    this.send({ t: 'hello', p: { accessToken, ...(resume ? { resume } : {}) } })
    return this.next((m) => m.t === 'welcome' || m.t === 'error')
  }

  async waitClose(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    if (this.closed) return this.closed
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs)
      this.closeWaiters.push((c) => {
        clearTimeout(timer)
        resolve(c)
      })
    })
  }

  get isClosed(): boolean {
    return this.closed !== null
  }

  close(): void {
    this.ws.close()
  }
}

/** Connect + authenticate; returns the client with the welcome consumed. */
export async function connectAs(
  ts: TestServer,
  userId: string
): Promise<{ client: TestClient; welcome: ServerMessageOf<'welcome'> }> {
  const client = await TestClient.connect(ts.wsUrl)
  const token = await ts.auth.mint(userId)
  const reply = await client.hello(token)
  if (reply.t !== 'welcome') throw new Error(`hello failed: ${JSON.stringify(reply)}`)
  return { client, welcome: reply as ServerMessageOf<'welcome'> }
}
