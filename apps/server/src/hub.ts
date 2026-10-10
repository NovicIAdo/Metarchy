// GameHub — the authenticated side of the gateway: one live session per user,
// welcome with the user's active game, and routing of post-hello messages into
// the room manager. Also the SessionDirectory rooms use to reach sockets.

import { randomUUID } from 'node:crypto'
import type {
  ChatMessageEntry,
  ChatScope,
  ClientMessage,
  MarketCategory,
  MarketListing
} from '@metarchy/protocol'
import {
  CHAT_GLOBAL_COOLDOWN_MS,
  CHAT_PAGE_SIZE,
  MARKET_CATEGORY_PREFIX,
  MARKET_FEE_BPS,
  MARKET_LISTING_TTL_DAYS,
  MARKET_MAX_ACTIVE,
  MARKET_PAGE_SIZE,
  SHOP_ITEMS,
  categoryOfItem,
  isTradable
} from '@metarchy/protocol'
import { achievementStateOf } from './achievements.js'
import type { ChatMessageRef, ChatStore } from './chat.js'
import { canReadRoom, dmRoomKey, GLOBAL_ROOM } from './chat.js'
import type { ServerConfig } from './config.js'
import { walletWithGrants } from './exclusives.js'
import type { Metrics } from './metrics.js'
import type { PushService } from './push.js'
import { MatchmakingQueue } from './queue.js'
import { RoomError, RoomManager } from './rooms/manager.js'
import type { LoggerLike, SessionDirectory } from './rooms/room.js'
import type { Session } from './session.js'
import { CLOSE_SUPERSEDED } from './session.js'
import type { GameStore, MarketListingRow } from './store.js'
import { REPLAYABLE_MODES } from './store.js'

export interface ResumeRequest {
  gameId: string
  lastEventSeq: number
}

/** Replay gallery page size — the client pages with `offset` in replay.list. */
const REPLAY_PAGE_SIZE = 10

/** Everything the connection layer already consumed never reaches the hub. */
export type RoutedClientMessage = Exclude<
  ClientMessage,
  { t: 'hello' } | { t: 'ping' } | { t: 'profile.update' }
>

export interface Hub {
  attach(session: Session, opts: { seq?: number; resume?: ResumeRequest }): Promise<void>
  handle(session: Session, msg: RoutedClientMessage): Promise<void>
  detach(session: Session): void
  /** Release timers (the matchmaking ticker) so the process can exit. */
  dispose?(): void
}

export interface HubDeps {
  config: ServerConfig
  store: GameStore
  /** Persisted chat: the global room and DMs (author backlog #3). */
  chat: ChatStore
  log: LoggerLike
  metrics?: Metrics
  push?: PushService
}

export class GameHub implements Hub, SessionDirectory {
  private readonly sessions = new Map<string, Session>()
  readonly manager: RoomManager
  readonly queue: MatchmakingQueue

  constructor(private readonly deps: HubDeps) {
    this.manager = new RoomManager({
      config: deps.config,
      store: deps.store,
      sessions: this,
      log: deps.log,
      ...(deps.metrics ? { metrics: deps.metrics } : {}),
      ...(deps.push ? { push: deps.push } : {})
    })
    this.queue = new MatchmakingQueue({
      config: deps.config.matchmaking,
      manager: this.manager,
      store: deps.store,
      log: deps.log,
      ...(deps.metrics ? { metrics: deps.metrics } : {})
    })
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  dispose(): void {
    this.queue.dispose()
  }

  sessionOf(userId: string): Session | undefined {
    return this.sessions.get(userId)
  }

  async attach(session: Session, opts: { seq?: number; resume?: ResumeRequest }): Promise<void> {
    const previous = this.sessions.get(session.userId)
    this.sessions.set(session.userId, session)
    if (previous && previous.connId !== session.connId)
      previous.close(CLOSE_SUPERSEDED, 'superseded by a new connection')

    // Introduce the player to the chat backend: the SQL one already has
    // `profiles`, the memory one has no profile table and gets its names and
    // faces from here.
    this.deps.chat.remember({
      userId: session.userId,
      nickname: session.profile.nickname,
      avatar: session.profile.avatar
    })
    // Same reason, same contract: a lot needs a seller with a name (store.ts).
    this.deps.store.rememberParty({
      userId: session.userId,
      nickname: session.profile.nickname,
      avatar: session.profile.avatar
    })

    session.send({
      t: 'welcome',
      ...(opts.seq !== undefined ? { seq: opts.seq } : {}),
      p: { profile: session.profile, activeGame: this.manager.activeGameFor(session.userId) }
    })
    this.manager.onSessionAttach(session, opts.resume)
  }

  async handle(session: Session, msg: RoutedClientMessage): Promise<void> {
    try {
      switch (msg.t) {
        case 'queue.join':
          await this.queue.join(session, msg.p.mode, msg.seq)
          return
        case 'queue.leave':
          this.queue.leave(session.userId)
          return
        case 'game.create':
          await this.manager.create(session, msg.p, msg.seq)
          return
        case 'game.join':
          this.manager.join(session, msg.p.inviteCode, msg.seq)
          return
        case 'lobby.ready':
          this.manager.ready(session, msg.p.gameId, msg.seq)
          return
        case 'lobby.team':
          this.manager.pickTeam(session, msg.p.gameId, msg.p.team, msg.seq)
          return
        case 'lobby.leave':
          this.manager.leaveLobby(session, msg.p.gameId, msg.seq)
          return
        case 'intent':
          this.roomOrThrow(msg.p.gameId).submitIntent(session, msg.p.intent, msg.seq)
          return
        case 'game.forfeit':
          this.roomOrThrow(msg.p.gameId).forfeit(session, msg.seq)
          return
        case 'game.resync':
          this.roomOrThrow(msg.p.gameId).requestSync(session, msg.seq)
          return
        case 'spectate.list':
          session.send({
            t: 'spectate.games',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: { games: this.manager.listWatchable() }
          })
          return
        case 'spectate.join':
          this.manager.spectateJoin(session, msg.p.gameId, msg.seq)
          return
        case 'spectate.leave':
          this.manager.spectateLeave(session.userId, msg.p.gameId)
          return
        case 'replay.list': {
          // The store decides what is replayable (finished, public, a real
          // multiplayer mode — REPLAYABLE_MODES). Since c3a99d8 that includes
          // ranked games a bot was seated in, which is why this no longer
          // assumes an all-human table.
          const { rows, total } = await this.deps.store.listReplays({
            userId: session.userId,
            limit: REPLAY_PAGE_SIZE,
            offset: msg.p?.offset ?? 0,
            starredOnly: msg.p?.starredOnly ?? false,
            playerId: msg.p?.playerId ?? null
          })
          const games = rows.map((r) => ({
            gameId: r.gameId,
            mode: r.mode,
            players: r.players.map((p) => ({
              seat: p.seat,
              nickname: p.nickname,
              bot: p.bot,
              avatar: p.avatar,
              wardrobe: null
            })),
            winnerSeats: r.winnerSeats,
            finishedAt: r.finishedAt,
            turns: r.turns,
            starred: r.starred
          }))
          session.send({
            t: 'replay.games',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: { games, total }
          })
          return
        }
        case 'replay.star': {
          const ok = await this.deps.store.setReplayStar(
            session.userId,
            msg.p.gameId,
            msg.p.starred
          )
          if (!ok) throw new RoomError('not_found', 'no replay for this game')
          session.send({
            t: 'replay.starred',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: { gameId: msg.p.gameId, starred: msg.p.starred }
          })
          return
        }
        case 'replay.get': {
          const data = await this.deps.store.loadReplay(msg.p.gameId)
          // Mirror the list filter exactly. It used to be isRatedMode, which
          // refused to OPEN a 2v2 game the gallery happily LISTED — the store
          // has always counted public 2v2 as replayable.
          if (!data || !(REPLAYABLE_MODES as readonly string[]).includes(data.mode))
            throw new RoomError('not_found', 'no replay for this game')
          session.send({
            t: 'replay.data',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: {
              gameId: data.gameId,
              mode: data.mode,
              seed: data.seed,
              seatCount: data.seatCount,
              controllers: data.controllers,
              players: data.players.map((p) => ({
                seat: p.seat,
                nickname: p.nickname,
                bot: p.bot,
                avatar: p.avatar,
                wardrobe: null
              })),
              intents: data.intents
            }
          })
          return
        }
        case 'chat.team':
          this.roomOrThrow(msg.p.gameId).chatTeam(session, msg.p.text, msg.seq)
          return
        case 'team.staging':
          this.roomOrThrow(msg.p.gameId).teamStaging(session, msg.p.staging, msg.seq)
          return
        case 'wallet.get': {
          // Bought goods plus personal-skin gifts — the client reads its whole
          // entitlement from this one list (exclusives.ts).
          const wallet = await walletWithGrants(this.deps.store, session.userId, session.email)
          session.send({
            t: 'wallet',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: wallet
          })
          return
        }
        case 'shop.buy': {
          const item = SHOP_ITEMS.get(msg.p.itemId)
          if (!item) throw new RoomError('not_found', 'no such shop item')
          const result = await this.deps.store.purchase(session.userId, item.id, item.price)
          if (result === 'insufficient')
            throw new RoomError('insufficient_funds', 'not enough GATO')
          if (result === 'owned') throw new RoomError('conflict', 'already owned')
          const wallet = await walletWithGrants(this.deps.store, session.userId, session.email)
          session.send({
            t: 'wallet',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: wallet
          })
          return
        }
        // --- Player↔player market (plan/Market-Plan.md) ---------------------
        case 'market.browse': {
          await this.sendMarketPage(session, msg.p ?? {}, msg.seq)
          return
        }
        case 'market.list': {
          // Only Shop goods are tradable, which is exactly the two exclusions the
          // author asked for: personal skins are gifts, and the free default set
          // is not a good. isTradable reads the catalog, so there is no second
          // list to drift (protocol/market.ts).
          if (!isTradable(msg.p.itemId))
            throw new RoomError('rule_violation', 'this item cannot be traded')
          const result = await this.deps.store.createListing(
            session.userId,
            msg.p.itemId,
            msg.p.price,
            MARKET_LISTING_TTL_DAYS,
            MARKET_MAX_ACTIVE
          )
          if (!result.ok) {
            if (result.reason === 'not_owned')
              throw new RoomError('rule_violation', 'you do not own that item')
            if (result.reason === 'listed') throw new RoomError('conflict', 'already listed')
            throw new RoomError('rule_violation', `at most ${MARKET_MAX_ACTIVE} lots at once`)
          }
          session.send({
            t: 'market.listing',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: { listingId: result.row.id, listing: this.listingView(result.row, session, []) }
          })
          return
        }
        case 'market.cancel': {
          const ok = await this.deps.store.cancelListing(session.userId, msg.p.listingId)
          if (!ok) throw new RoomError('not_found', 'no such lot of yours')
          session.send({
            t: 'market.listing',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: { listingId: msg.p.listingId, listing: null }
          })
          return
        }
        case 'market.buy': {
          const result = await this.deps.store.buyListing(
            session.userId,
            msg.p.listingId,
            MARKET_FEE_BPS
          )
          if (!result.ok) {
            if (result.reason === 'insufficient')
              throw new RoomError('insufficient_funds', 'not enough GATO')
            if (result.reason === 'owned') throw new RoomError('conflict', 'already owned')
            if (result.reason === 'own')
              throw new RoomError('rule_violation', 'that is your own lot')
            throw new RoomError('not_found', 'lot is gone')
          }
          const wallet = await walletWithGrants(this.deps.store, session.userId, session.email)
          session.send({
            t: 'market.bought',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: {
              listingId: msg.p.listingId,
              itemId: result.itemId,
              price: result.price,
              balance: wallet.balance,
              owned: wallet.owned
            }
          })
          return
        }
        case 'market.comment': {
          const ok = await this.deps.store.addComment(
            session.userId,
            msg.p.listingId,
            msg.p.body.trim()
          )
          if (!ok) throw new RoomError('not_found', 'lot is gone')
          await this.sendComments(session, msg.p.listingId, msg.seq)
          return
        }
        case 'market.comments': {
          await this.sendComments(session, msg.p.listingId, msg.seq)
          return
        }
        case 'history.get': {
          // The profile screen needs all three at once: the newest games as a
          // list, the per-category record over the whole archive (the list is
          // capped at 20, so it cannot be counted client-side), and the
          // achievement board — earned badges plus counter progress.
          const [entries, record, achievements] = await Promise.all([
            this.deps.store.loadMatchHistory(session.userId, 20),
            this.deps.store.loadModeRecord(session.userId),
            achievementStateOf(this.deps.store, session.userId)
          ])
          session.send({
            t: 'history',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: { entries, record, achievements }
          })
          return
        }
        case 'push.register':
          await this.deps.store.savePushToken(session.userId, msg.p.token, msg.p.platform)
          return
        case 'push.unregister':
          await this.deps.store.deleteUserPushTokens(session.userId)
          return

        // --- Persisted chat: global room + DMs (author backlog #3) ----------------
        case 'chat.list': {
          const room = await this.chatRoomOf(session, msg.p.scope)
          const offset = msg.p.offset ?? 0
          const [page, cooldownMs] = await Promise.all([
            this.deps.chat.listTopLevel({
              room,
              viewerId: session.userId,
              sort: msg.p.sort,
              limit: CHAT_PAGE_SIZE,
              offset
            }),
            // Sent with every page so the compose box knows it is still in
            // cooldown after a reload — the rule lives in the data, not the tab.
            this.deps.chat.globalCooldownMs(session.userId)
          ])
          session.send({
            t: 'chat.messages',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: {
              scope: msg.p.scope,
              sort: msg.p.sort,
              offset,
              messages: page.rows,
              total: page.total,
              cooldownMs
            }
          })
          return
        }
        case 'chat.thread': {
          const ref = await this.chatRefOrThrow(session, msg.p.parentId)
          // Asking for the thread of a reply gives its parent's thread — the
          // author drew YouTube comments, which are exactly one level deep.
          const parentId = ref.parentId ?? ref.id
          session.send({
            t: 'chat.replies',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: { parentId, messages: await this.deps.chat.listReplies(parentId, session.userId) }
          })
          return
        }
        case 'chat.post': {
          const room = await this.chatRoomOf(session, msg.p.scope)
          let parentId: string | null = null
          if (msg.p.parentId !== undefined) {
            const ref = await this.chatRefOrThrow(session, msg.p.parentId)
            if (ref.room !== room)
              throw new RoomError('invalid_input', 'that message is in another conversation')
            // One level: a reply to a reply joins the same thread.
            parentId = ref.parentId ?? ref.id
          }
          const recipientId = msg.p.scope.kind === 'dm' ? msg.p.scope.peerId : null
          // A player who closed this conversation refuses its messages: the
          // writer is told at send time, the only moment that is honest — a
          // silent drop would read as delivered-and-ignored.
          if (recipientId !== null && (await this.deps.chat.isBlocked(recipientId, session.userId)))
            throw new RoomError('forbidden', 'this player closed the private conversation')
          const result = await this.deps.chat.post({
            id: randomUUID(),
            room,
            authorId: session.userId,
            recipientId,
            parentId,
            body: msg.p.body,
            // The author's rule is about the room everybody reads. DMs are not
            // limited, and a reply in the global room counts like any other
            // message there — it is just as visible.
            cooldownMs: room === GLOBAL_ROOM ? CHAT_GLOBAL_COOLDOWN_MS : 0
          })
          if (!result.ok)
            throw new RoomError(
              'rate_limited',
              `one message per minute in the global chat — ${Math.ceil(result.retryInMs / 1000)}s left`
            )
          this.deliverChat({
            entry: result.entry,
            authorId: session.userId,
            recipientId,
            ...(msg.seq !== undefined ? { authorSeq: msg.seq } : {})
          })
          return
        }
        case 'chat.react': {
          const ref = await this.chatRefOrThrow(session, msg.p.messageId)
          const counts = await this.deps.chat.react(ref.id, session.userId, msg.p.reaction)
          if (!counts) throw new RoomError('not_found', 'no such message')
          session.send({
            t: 'chat.stats',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: counts
          })
          return
        }
        case 'chat.flag': {
          const ref = await this.chatRefOrThrow(session, msg.p.messageId)
          const counts = await this.deps.chat.flag(ref.id, session.userId)
          if (!counts) throw new RoomError('not_found', 'no such message')
          session.send({
            t: 'chat.stats',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: counts
          })
          return
        }
        case 'chat.dms': {
          const items = await this.deps.chat.listConversations(session.userId)
          // A nickname search resolves the person to start a first DM with.
          // Your own name resolves to nobody: writing to yourself is not a
          // conversation (the DB has the same guard).
          const hit = msg.p ? await this.deps.chat.findPeer({ nickname: msg.p.nickname }) : null
          session.send({
            t: 'chat.conversations',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: { items, found: hit && hit.userId !== session.userId ? hit : null }
          })
          return
        }
        case 'chat.block': {
          // Refusing yourself a conversation is meaningless; the DB forbids it too.
          if (msg.p.peerId === session.userId)
            throw new RoomError('invalid_input', 'you cannot block yourself')
          const blocked = await this.deps.chat.setBlocked(
            session.userId,
            msg.p.peerId,
            msg.p.blocked
          )
          session.send({
            t: 'chat.blocked',
            ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
            p: { peerId: msg.p.peerId, blocked }
          })
          return
        }
      }
    } catch (error) {
      if (error instanceof RoomError) {
        session.sendError(error.code, error.message, { seq: msg.seq })
        return
      }
      this.deps.log.error({ err: error, msg: msg.t }, 'hub handler failed')
      session.sendError('internal', 'internal error', { seq: msg.seq })
    }
  }

  detach(session: Session): void {
    if (this.sessions.get(session.userId)?.connId !== session.connId) return
    this.sessions.delete(session.userId)
    this.queue.onSessionGone(session.userId)
    this.manager.onSessionDetach(session.userId)
  }

  private roomOrThrow(gameId: string) {
    const room = this.manager.roomOf(gameId)
    if (!room) throw new RoomError('not_found', 'no such game')
    return room
  }

  // --- Market helpers ----------------------------------------------------------------

  /**
   * A stored lot as the viewer sees it. `mine` and `owned` are computed here
   * rather than on the client so a lot cannot be mislabelled by a stale wallet:
   * both are read from the same entitlement list the equip gate uses.
   */
  private listingView(row: MarketListingRow, session: Session, owned: string[]): MarketListing {
    return {
      id: row.id,
      itemId: row.itemId,
      // A lot can only hold a tradable good, and every tradable id has a category
      // — the fallback exists so an unknown prefix degrades to a chip, not a crash.
      category: categoryOfItem(row.itemId) ?? 'actorItem',
      price: row.price,
      seller: row.seller,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      comments: row.comments,
      mine: row.seller.userId === session.userId,
      owned: owned.includes(row.itemId)
    }
  }

  private async sendMarketPage(
    session: Session,
    p: { category?: MarketCategory | null; mine?: boolean; offset?: number },
    seq?: number
  ): Promise<void> {
    const offset = p.offset ?? 0
    const [page, wallet] = await Promise.all([
      this.deps.store.browseMarket({
        viewerId: session.userId,
        prefix: p.category ? MARKET_CATEGORY_PREFIX[p.category] : null,
        mine: p.mine ?? false,
        limit: MARKET_PAGE_SIZE,
        offset
      }),
      walletWithGrants(this.deps.store, session.userId, session.email)
    ])
    session.send({
      t: 'market.listings',
      ...(seq !== undefined ? { seq } : {}),
      p: {
        rows: page.rows.map((r) => this.listingView(r, session, wallet.owned)),
        total: page.total,
        offset
      }
    })
  }

  private async sendComments(session: Session, listingId: string, seq?: number): Promise<void> {
    const rows = await this.deps.store.listComments(listingId)
    session.send({
      t: 'market.comments',
      ...(seq !== undefined ? { seq } : {}),
      p: { listingId, rows }
    })
  }

  // --- Persisted chat helpers --------------------------------------------------------

  /**
   * The conversation key behind a scope. Derived from the CALLER's own id plus
   * the peer they named — the client never sends a room, so a player cannot
   * address a private conversation they are not part of. DM privacy is
   * structural here, not a check somebody could forget to write.
   */
  private async chatRoomOf(session: Session, scope: ChatScope): Promise<string> {
    if (scope.kind === 'global') return GLOBAL_ROOM
    if (scope.peerId === session.userId)
      throw new RoomError('invalid_input', 'a private chat needs another player')
    const peer = await this.deps.chat.findPeer({ userId: scope.peerId })
    if (!peer) throw new RoomError('not_found', 'no such player')
    return dmRoomKey(session.userId, scope.peerId)
  }

  /**
   * Reading a message by id is the one way into a conversation without naming
   * it, so every by-id path goes through here. A message in somebody else's DM
   * answers exactly like one that never existed — "not found" must not confirm
   * that it does.
   */
  private async chatRefOrThrow(session: Session, messageId: string): Promise<ChatMessageRef> {
    const ref = await this.deps.chat.loadRef(messageId)
    if (!ref || !canReadRoom(session.userId, ref.room))
      throw new RoomError('not_found', 'no such message')
    return ref
  }

  /**
   * Push a new message to its readers: every live session for the global room,
   * exactly the two participants for a DM. Each recipient gets its own copy
   * because the author's layout is relative to the reader — `mine` decides left
   * or right, and a DM's `peerId` is "the other one" from where you sit. The
   * author's copy carries their request `seq`, so it doubles as the ack.
   */
  private deliverChat(opts: {
    entry: ChatMessageEntry
    authorId: string
    /** null in the global room. */
    recipientId: string | null
    authorSeq?: number
  }): void {
    const { entry, authorId, recipientId } = opts
    const targets: Session[] =
      recipientId === null
        ? [...this.sessions.values()]
        : [this.sessions.get(authorId), this.sessions.get(recipientId)].filter(
            (s): s is Session => s !== undefined
          )
    for (const target of targets) {
      const mine = target.userId === authorId
      const scope: ChatScope =
        recipientId === null
          ? { kind: 'global' }
          : { kind: 'dm', peerId: mine ? recipientId : authorId }
      target.send({
        t: 'chat.posted',
        ...(mine && opts.authorSeq !== undefined ? { seq: opts.authorSeq } : {}),
        // A brand-new message carries nobody's reaction yet, and only the
        // author can see it as theirs.
        p: { scope, message: { ...entry, mine, myReaction: null, flaggedByMe: false } }
      })
    }
  }
}
