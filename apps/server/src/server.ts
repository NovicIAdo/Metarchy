// WS gateway (architecture/Game-Server.md §3, §9): Fastify for HTTP endpoints,
// raw `ws` upgrade on /ws, per-socket serial message processing, token-bucket
// rate limiting, ws-level heartbeat. All game semantics live behind Hub.

import * as Sentry from '@sentry/node'
import Fastify from 'fastify'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import type { AvatarId, PlayerCard, ServerMessage, Wardrobe } from '@metarchy/protocol'
import {
  argSkinItemId,
  emptyModeRecord,
  avatarItemId,
  encodeServerMessage,
  isFreeAvatar,
  MAX_MESSAGE_BYTES,
  NICKNAME_ISSUE_MESSAGE,
  parseClientMessage,
  skinItemId,
  validateNickname
} from '@metarchy/protocol'
import type { WebSocket } from 'ws'
import { WebSocketServer } from 'ws'
import { achievementStateOf } from './achievements.js'
import { AuthError } from './auth.js'
import type { AuthedUser, TokenVerifier } from './auth.js'
import type { IdentityStore } from './identity.js'
import { IdentityError, MemoryIdentityStore, requireMfa } from './identity.js'
import { makeWalletAuth, registerSolanaAuth, verifiedUserHasMfa } from './solana-auth.js'
import type { WalletAuth } from './solana-auth.js'
import type { ChatStore } from './chat.js'
import { MemoryChatStore } from './chat.js'
import type { ServerConfig } from './config.js'
import { walletWithGrants } from './exclusives.js'
import type { Hub } from './hub.js'
import { GameHub } from './hub.js'
import type { Metrics } from './metrics.js'
import { createMetrics } from './metrics.js'
import type { PushService } from './push.js'
import { makePushService } from './push.js'
import type { ProfileStore } from './profiles.js'
import { CLOSE_AUTH_FAILED, CLOSE_HELLO_TIMEOUT, makeSession } from './session.js'
import type { Profile, Session } from './session.js'
import type { RatedMode } from './ratings.js'
import { RATED_MODES } from './ratings.js'
import type { GameStore } from './store.js'

export interface GatewayDeps {
  config: ServerConfig
  verifier: TokenVerifier
  profiles: ProfileStore
  identities?: IdentityStore
  /** Authoritative Supabase Auth lookup; injectable at the HTTP boundary in tests. */
  walletAuth?: WalletAuth
  store: GameStore
  /**
   * Persisted chat (global room + DMs). Default: an in-memory one, so a
   * gateway-only test does not have to build a database — index.ts passes the
   * real backend from makeStores().
   */
  chat?: ChatStore
  /** Default: a GameHub over `store`; injectable for gateway-only tests. */
  hub?: Hub
  /** Default: built from FCM_SERVICE_ACCOUNT_JSON; injectable for tests. */
  push?: PushService
}

export interface RunningServer {
  fastify: FastifyInstance
  hub: Hub
  /** ws://host:port/ws */
  url: string
  close(): Promise<void>
}

interface ConnState {
  socket: WebSocket
  session: Session | null
  tokens: number
  lastRefillMs: number
  rateBreaches: number
  /** Serializes async message handling per socket (hello await vs next frame). */
  pipeline: Promise<void>
  isAlive: boolean
}

interface ResolvedDeps {
  config: ServerConfig
  verifier: TokenVerifier
  profiles: ProfileStore
  identities: IdentityStore
  walletAuth?: WalletAuth
  /** The cosmetic-entitlement gate in profile.update reads the GATO wallet. */
  store: GameStore
  hub: Hub
  metrics: Metrics
}

export async function startServer(deps: GatewayDeps): Promise<RunningServer> {
  const { config } = deps
  const walletAuth =
    deps.walletAuth ??
    (config.auth.supabaseUrl && config.auth.anonKey ? makeWalletAuth(config.auth) : undefined)
  const fastify = Fastify({ logger: { level: config.logLevel } })
  const log = fastify.log

  // Route-handler failures reach Sentry too (no-op when the SDK is not
  // initialized — dev/tests run without a DSN). Pino keeps logging as before.
  fastify.addHook('onError', (_request, _reply, error, done) => {
    Sentry.captureException(error)
    done()
  })

  const metrics = createMetrics()
  const push = deps.push ?? makePushService(process.env.FCM_SERVICE_ACCOUNT_JSON, deps.store, log)
  if (!push) log.info({}, 'push notifications disabled (no FCM_SERVICE_ACCOUNT_JSON)')
  const chat = deps.chat ?? new MemoryChatStore()
  const hub =
    deps.hub ??
    new GameHub({ config, store: deps.store, chat, log, metrics, ...(push ? { push } : {}) })
  if (hub instanceof GameHub)
    metrics.bindSources({
      roomCount: () => hub.manager.roomCount,
      sessionCount: () => hub.sessionCount,
      queueWaiting: () => hub.queue.waitingByMode()
    })
  const resolved: ResolvedDeps = {
    config,
    verifier: deps.verifier,
    profiles: deps.profiles,
    identities: deps.identities ?? new MemoryIdentityStore(deps.profiles),
    ...(walletAuth ? { walletAuth } : {}),
    store: deps.store,
    hub,
    metrics
  }

  fastify.get('/healthz', async () => ({
    ok: true,
    rooms: hub instanceof GameHub ? hub.manager.roomCount : 0
  }))

  // Scraped by Fly into its managed Grafana (fly.toml [metrics]). The platform
  // scraper reaches the machine over private 6PN; requests that came through
  // the public edge carry Fly-Client-IP — those get a 404, not our internals.
  fastify.get('/metrics', async (request, reply) => {
    if (request.headers['fly-client-ip']) return reply.code(404).send({ error: 'not found' })
    reply.header('content-type', metrics.registry.contentType)
    return metrics.registry.metrics()
  })

  registerClientErrors(fastify, metrics)
  registerSolanaAuth(fastify, {
    config,
    verifier: deps.verifier,
    identities: resolved.identities,
    ...(walletAuth ? { walletAuth } : {})
  })

  // Same-origin client hosting (STATIC_DIR=client dist): assets + SPA fallback.
  if (config.staticDir) {
    const { default: fastifyStatic } = await import('@fastify/static')
    await fastify.register(fastifyStatic, { root: config.staticDir })
    fastify.setNotFoundHandler((request, reply) => {
      if (
        request.method === 'GET' &&
        !request.url.startsWith('/ws') &&
        !request.url.startsWith('/auth')
      )
        return reply.sendFile('index.html')
      return reply.code(404).send({ error: 'not found' })
    })
  }

  // Crash recovery before accepting connections (Game-Server.md §8).
  if (hub instanceof GameHub) {
    const outcome = await hub.manager.recoverFromStore(deps.profiles)
    if (outcome.recovered > 0 || outcome.aborted > 0) log.info(outcome, 'boot recovery')
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })

  fastify.server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://internal').pathname
    if (path !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
  })

  wss.on('connection', (socket: WebSocket) => handleConnection(socket, resolved, log))

  const heartbeat =
    config.heartbeatIntervalMs > 0
      ? setInterval(() => {
          for (const client of wss.clients) {
            const state = states.get(client)
            if (!state) continue
            if (!state.isAlive) {
              client.terminate()
              continue
            }
            state.isAlive = false
            client.ping()
          }
        }, config.heartbeatIntervalMs)
      : null
  heartbeat?.unref()

  await fastify.listen({ host: config.host, port: config.port })
  const address = fastify.server.address()
  const port = typeof address === 'object' && address ? address.port : config.port
  const host = config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host

  return {
    fastify,
    hub,
    url: `ws://${host}:${port}/ws`,
    async close() {
      if (heartbeat) clearInterval(heartbeat)
      hub.dispose?.()
      for (const client of wss.clients) client.terminate()
      wss.close()
      await fastify.close()
    }
  }
}

/** Connection states, keyed by socket for the heartbeat sweep. */
const states = new WeakMap<WebSocket, ConnState>()

function handleConnection(socket: WebSocket, deps: ResolvedDeps, log: FastifyBaseLogger): void {
  const { config, hub } = deps
  const state: ConnState = {
    socket,
    session: null,
    tokens: config.rate.capacity,
    lastRefillMs: Date.now(),
    rateBreaches: 0,
    pipeline: Promise.resolve(),
    isAlive: true
  }
  states.set(socket, state)

  const helloTimer = setTimeout(() => {
    if (!state.session) socket.close(CLOSE_HELLO_TIMEOUT, 'hello timeout')
  }, config.helloTimeoutMs)
  helloTimer.unref()

  socket.on('pong', () => {
    state.isAlive = true
  })

  socket.on('message', (data, isBinary) => {
    if (!takeToken(state, config)) return
    const text = isBinary ? null : data.toString('utf8')
    state.pipeline = state.pipeline
      .then(() => handleFrame(state, text, deps, helloTimer))
      .catch((error) => {
        log.error({ err: error }, 'unhandled frame error')
        state.session?.sendError('internal', 'internal error')
      })
  })

  socket.on('close', () => {
    clearTimeout(helloTimer)
    if (state.session) hub.detach(state.session)
  })

  socket.on('error', (error) => log.warn({ err: error }, 'socket error'))
}

function takeToken(state: ConnState, config: ServerConfig): boolean {
  const now = Date.now()
  const refill = ((now - state.lastRefillMs) / 1000) * config.rate.refillPerSec
  state.tokens = Math.min(config.rate.capacity, state.tokens + refill)
  state.lastRefillMs = now
  if (state.tokens >= 1) {
    state.tokens -= 1
    state.rateBreaches = 0
    return true
  }
  state.rateBreaches += 1
  if (state.rateBreaches === 1)
    sendRaw(state, { t: 'error', p: { code: 'rate_limited', message: 'slow down' } })
  if (state.rateBreaches > 3 * config.rate.capacity) state.socket.close(1008, 'rate limit')
  return false
}

async function handleFrame(
  state: ConnState,
  text: string | null,
  deps: ResolvedDeps,
  helloTimer: NodeJS.Timeout
): Promise<void> {
  const { socket } = state
  if (socket.readyState !== socket.OPEN) return

  if (text === null) {
    sendPreAuthError(state, 'bad_message', 'binary frames are not supported')
    return
  }
  const parsed = parseClientMessage(text)
  if (!parsed.ok) {
    sendPreAuthError(state, 'bad_message', parsed.error)
    return
  }
  const msg = parsed.msg
  deps.metrics.wsMessages.inc({ type: msg.t })

  if (msg.t === 'ping') {
    sendRaw(state, {
      t: 'pong',
      ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
      p: { time: Date.now() }
    })
    return
  }

  if (msg.t === 'hello') {
    if (state.session) {
      state.session.sendError('already_authenticated', 'hello already completed', {
        seq: msg.seq
      })
      return
    }
    let user: AuthedUser
    let profile: Profile
    let email: string | null
    try {
      user = await deps.verifier.verify(msg.p.accessToken)
      if (!(await deps.identities.hasMfaPolicy())) {
        const account = await deps.identities.account(user.userId)
        if (
          account.userId !== user.userId ||
          account.wallets.some((wallet) => wallet.authUserId !== user.userId)
        )
          throw new IdentityError(
            'Linked logins require an authoritative account-wide MFA policy.',
            503
          )
        if (deps.walletAuth) {
          const hasFactor = verifiedUserHasMfa(
            await deps.walletAuth.getUser(msg.p.accessToken),
            user.userId
          )
          requireMfa(user, hasFactor, hasFactor)
        } else if (deps.config.auth.supabaseUrl) {
          throw new IdentityError(
            'An authoritative MFA policy or Auth user lookup must be configured.',
            503
          )
        }
      }
      profile = await deps.identities.login(user)
      email = await deps.identities.canonicalEmail(user.userId)
    } catch (error) {
      const reason =
        error instanceof AuthError || error instanceof IdentityError
          ? error.message
          : 'verification failed'
      sendPreAuthError(state, 'auth_failed', reason, msg.seq)
      socket.close(CLOSE_AUTH_FAILED, 'auth failed')
      return
    }
    const session = makeSession(socket, profile, email)
    state.session = session
    clearTimeout(helloTimer)
    await deps.hub.attach(session, {
      ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
      ...(msg.p.resume ? { resume: msg.p.resume } : {})
    })
    return
  }

  if (!state.session) {
    sendPreAuthError(state, 'unauthenticated', 'hello first', msg.seq)
    return
  }

  if (msg.t === 'profile.update') {
    await updateProfile(state.session, msg.p, deps, msg.seq)
    return
  }

  // The Players directory lives here rather than in the hub because it reads the
  // ProfileStore, which the hub has no handle on.
  if (msg.t === 'players.list') {
    await listPlayers(state.session, msg.p ?? {}, deps, msg.seq)
    return
  }

  if (msg.t === 'player.get') {
    await sendPlayer(state.session, msg.p.nickname, deps, msg.seq)
    return
  }

  await deps.hub.handle(state.session, msg)
}

/** One screenful of the roster. Small on purpose — it is a browse, not an export. */
const PLAYERS_PAGE_SIZE = 20

/**
 * The Players directory (author backlog #2): "список игроков, которые
 * зарегистрировались в игре, с их аватарми и юзернэймами и их винрэйтом по
 * рэйтинговым играм", searchable by name.
 *
 * Public identity comes from the ProfileStore, the ranked record from the game
 * store in ONE batched query for the whole page, and the rating from the rated
 * ladders. Nothing seat-private is published: only the four numbers the author
 * asked for. This is why it is not a PostgREST view like the leaderboard —
 * win rates come from game_players, which RLS keeps private on purpose.
 */
async function listPlayers(
  session: Session,
  p: { query?: string; offset?: number },
  deps: ResolvedDeps,
  seq?: number
): Promise<void> {
  const query = p.query?.trim() ? p.query.trim() : null
  const { rows, total } = await deps.profiles.listProfiles({
    query,
    limit: PLAYERS_PAGE_SIZE,
    offset: p.offset ?? 0
  })
  const cards = await playerCards(rows, deps)
  session.send({
    t: 'players',
    ...(seq !== undefined ? { seq } : {}),
    p: { rows: cards, total }
  })
}

/** A public profile by nickname — what a shared link resolves to. */
async function sendPlayer(
  session: Session,
  nickname: string,
  deps: ResolvedDeps,
  seq?: number
): Promise<void> {
  const profile = await deps.profiles.findByNickname(nickname)
  if (!profile) {
    session.sendError('not_found', 'no player by that name', {
      ...(seq !== undefined ? { seq } : {})
    })
    return
  }
  const [card] = await playerCards([profile], deps)
  const record = await deps.store.loadModeRecord(profile.userId)
  // Achievements on the public profile: the author asked this screen to show what
  // a player has done (backlog #2), and it shipped without them — this fills the
  // hole. Same board the player sees on their own profile.
  const achievements = await achievementStateOf(deps.store, profile.userId)
  const ratings: { mode: RatedMode; rating: number; games: number }[] = []
  for (const mode of RATED_MODES) {
    const row = (await deps.store.loadRatings(mode, [profile.userId])).get(profile.userId)
    // A rating row with no games is a placeholder, not a standing.
    if (row && row.games > 0) ratings.push({ mode, rating: row.rating, games: row.games })
  }
  session.send({
    t: 'player',
    ...(seq !== undefined ? { seq } : {}),
    p: { card: card as PlayerCard, record, ratings, achievements }
  })
}

/** Profiles → directory cards: one record query for the page, one per ladder. */
async function playerCards(profiles: Profile[], deps: ResolvedDeps): Promise<PlayerCard[]> {
  const userIds = profiles.map((p) => p.userId)
  const records = await deps.store.loadModeRecords(userIds)
  const best = new Map<string, number>()
  for (const mode of RATED_MODES) {
    for (const [userId, row] of await deps.store.loadRatings(mode, userIds)) {
      // Unplayed ladders sit at the default rating; showing that as a standing
      // would rank a newcomer above someone who has actually lost games.
      if (row.games === 0) continue
      const current = best.get(userId)
      if (current === undefined || row.rating > current) best.set(userId, row.rating)
    }
  }
  return profiles.map((profile) => ({
    userId: profile.userId,
    nickname: profile.nickname,
    avatar: profile.avatar,
    ranked: (records.get(profile.userId) ?? emptyModeRecord()).ranked,
    rating: best.get(profile.userId) ?? null
  }))
}

/**
 * Patches in place: rooms already hold a copy of the old nickname/avatar, so a
 * game in flight keeps what it started with. Everything after this sees the new
 * one. The avatar id is already vetted by the zod enum on the wire.
 */
async function updateProfile(
  session: Session,
  patch: { nickname?: string; avatar?: string | null; wardrobe?: Wardrobe },
  deps: ResolvedDeps,
  seq?: number
): Promise<void> {
  if (patch.nickname !== undefined) {
    const check = validateNickname(patch.nickname)
    if (!check.ok) {
      session.sendError('invalid_input', check.reason, { ...(seq !== undefined ? { seq } : {}) })
      return
    }
    const result = await deps.profiles.rename(session.userId, check.value)
    if (result === 'taken') {
      // The shared string, not a literal: the client maps it back to a code and
      // shows the player a translated refusal (nicknameIssueOf). A Postgres
      // unique-violation text never reaches the wire — the store swallows it.
      session.sendError('conflict', NICKNAME_ISSUE_MESSAGE.taken, {
        ...(seq !== undefined ? { seq } : {})
      })
      return
    }
    session.profile.nickname = result.nickname
  }
  if (patch.avatar !== undefined) {
    // Paid avatars require the GATO entitlement (free launch faces pass).
    if (patch.avatar !== null && !isFreeAvatar(patch.avatar as AvatarId)) {
      const wallet = await walletWithGrants(deps.store, session.userId, session.email)
      if (!wallet.owned.includes(avatarItemId(patch.avatar as AvatarId))) {
        session.sendError('rule_violation', 'Avatar not owned — buy it in the Shop.', {
          ...(seq !== undefined ? { seq } : {})
        })
        return
      }
    }
    const result = await deps.profiles.setAvatar(session.userId, patch.avatar)
    session.profile.avatar = result.avatar
  }
  if (patch.wardrobe !== undefined) {
    // Whole-figure skins are shop goods — every equipped one needs its
    // entitlement (beta players were grandfathered by the wallet migration).
    const wantedSkins = Object.entries(patch.wardrobe.skins ?? {}).filter(
      (e): e is [string, string] => typeof e[1] === 'string'
    )
    // The free coin set is `arguments: null` — only a bought set needs the check.
    const wantedArgSkin = patch.wardrobe.arguments ?? null
    if (wantedSkins.length > 0 || wantedArgSkin !== null) {
      // Ownership includes the gifts: a personal skin is worn like any other.
      const wallet = await walletWithGrants(deps.store, session.userId, session.email)
      const missing = wantedSkins.find(
        ([actor, skin]) => !wallet.owned.includes(skinItemId(actor, skin))
      )
      if (missing) {
        session.sendError('rule_violation', 'Skin not owned — buy it in the Shop.', {
          ...(seq !== undefined ? { seq } : {})
        })
        return
      }
      if (wantedArgSkin !== null && !wallet.owned.includes(argSkinItemId(wantedArgSkin))) {
        session.sendError('rule_violation', 'Argument set not owned — buy it in the Shop.', {
          ...(seq !== undefined ? { seq } : {})
        })
        return
      }
      // What is on the market shelf cannot also be at the table: a buyer must not
      // pay for a look the seller is still wearing. Cancelling the lot is the way
      // back — that is the whole meaning of listing something.
      const locked = new Set(await deps.store.lockedItems(session.userId))
      const listed = [
        ...wantedSkins.map(([actor, skin]) => skinItemId(actor, skin)),
        ...(wantedArgSkin !== null ? [argSkinItemId(wantedArgSkin)] : [])
      ].find((id) => locked.has(id))
      if (listed) {
        session.sendError(
          'rule_violation',
          'That item is up for sale — cancel the lot to wear it.',
          {
            ...(seq !== undefined ? { seq } : {})
          }
        )
        return
      }
    }
    // Merge per actor: an explicit null clears that actor back to canonical art.
    const merged = { ...(session.profile.wardrobe ?? {}), ...patch.wardrobe }
    const cleaned = Object.fromEntries(Object.entries(merged).filter(([, v]) => v != null))
    const next = Object.keys(cleaned).length > 0 ? (cleaned as Wardrobe) : null
    const result = await deps.profiles.setWardrobe(session.userId, next)
    session.profile.wardrobe = result.wardrobe ?? null
  }
  session.send({
    t: 'profile.updated',
    ...(seq !== undefined ? { seq } : {}),
    p: { profile: { ...session.profile } }
  })
}

/** Browser crash reports: rate-limited, truncated, straight into the log stream. */
const CLIENT_ERROR_LIMITS = { perIpPerMin: 10, globalPerMin: 300 }
const CLIENT_ERROR_FIELDS: [key: string, max: number][] = [
  ['message', 500],
  ['stack', 4000],
  ['url', 300],
  ['source', 40],
  ['build', 80],
  ['gameId', 80]
]

function registerClientErrors(fastify: FastifyInstance, metrics: Metrics): void {
  // sendBeacon posts text/plain (a JSON string) — no CORS preflight in dev.
  fastify.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) =>
    done(null, body)
  )

  const perIp = new Map<string, { windowStart: number; count: number }>()
  let all = { windowStart: 0, count: 0 }

  fastify.post('/client-errors', { bodyLimit: 8 * 1024 }, async (request, reply) => {
    const now = Date.now()
    if (now - all.windowStart >= 60_000) all = { windowStart: now, count: 0 }
    if (++all.count > CLIENT_ERROR_LIMITS.globalPerMin) return reply.code(429).send()

    if (perIp.size > 10_000) perIp.clear()
    let bucket = perIp.get(request.ip)
    if (!bucket || now - bucket.windowStart >= 60_000) {
      bucket = { windowStart: now, count: 0 }
      perIp.set(request.ip, bucket)
    }
    if (++bucket.count > CLIENT_ERROR_LIMITS.perIpPerMin) return reply.code(429).send()

    let raw: unknown = request.body
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw)
      } catch {
        raw = { message: raw }
      }
    }
    const report: Record<string, string> = {}
    if (raw && typeof raw === 'object') {
      for (const [key, max] of CLIENT_ERROR_FIELDS) {
        const value = (raw as Record<string, unknown>)[key]
        if (typeof value === 'string' && value.length > 0) report[key] = value.slice(0, max)
      }
    }
    metrics.clientErrors.inc()
    request.log.error({ clientError: report }, 'client error')
    return reply.code(204).send()
  })
}

function sendRaw(state: ConnState, msg: ServerMessage): void {
  if (state.socket.readyState === state.socket.OPEN) state.socket.send(encodeServerMessage(msg))
}

function sendPreAuthError(
  state: ConnState,
  code: 'bad_message' | 'auth_failed' | 'unauthenticated',
  message: string,
  seq?: number
): void {
  sendRaw(state, {
    t: 'error',
    ...(seq !== undefined ? { seq } : {}),
    p: { code, message }
  })
}
