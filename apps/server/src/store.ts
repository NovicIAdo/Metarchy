// Persistence boundary (architecture/Game-Server.md §8, Data-Model.md). The room
// awaits appendEvents BEFORE broadcasting — write-ahead by construction, so crash
// recovery (snapshot + replay) can never lose acknowledged state. MemoryStore
// backs tests; the Postgres store lands in plan step 2.4 behind this interface.

import { randomUUID } from 'node:crypto'
import type { EngineEvent, GameState, Intent, Mode, SeatId } from '@metarchy/engine'
import { deepClone } from '@metarchy/engine'
import type {
  EarnedAchievement,
  HistoryEntry,
  ModeRecord,
  PlayCounts,
  RecordCategory
} from '@metarchy/protocol'
import {
  GATO_START_BALANCE,
  emptyModeRecord,
  emptyPlayCounts,
  playCategoryOf
} from '@metarchy/protocol'

export type GameStatus = 'lobby' | 'active' | 'finished' | 'aborted'

export interface GameRow {
  gameId: string
  mode: Mode
  status: GameStatus
  isPrivate: boolean
  inviteCode: string | null
  rulesVersion: string
  rngSeedHash: string
}

export interface PlayerRow {
  seat: SeatId
  userId: string | null
  botStrategy: string | null
}

export interface GameResultRow {
  seat: SeatId
  result: 'win' | 'lose' | 'eliminated' | 'aborted'
  finalVp: number | null
}

export interface CommitmentRow {
  /** game_events seq of the first event emitted by the accepted intent. */
  seq: number
  seat: SeatId
  turn: number
  phase: number
  hash: string
  salt: string
}

export interface LoadedGame {
  game: GameRow
  players: PlayerRow[]
}

/** The accepted intent that produced an event batch — the replay unit. */
export interface IntentOrigin {
  seat: SeatId
  intent: Intent
}

export interface StoredIntent extends IntentOrigin {
  firstEventSeq: number
}

export interface ReplayPlayer {
  seat: SeatId
  userId: string | null
  nickname: string
  avatar: string | null
  bot: boolean
}

/** A browsable finished ranked game in the replay gallery. */
export interface ReplayListRow {
  gameId: string
  mode: Mode
  players: ReplayPlayer[]
  winnerSeats: SeatId[]
  finishedAt: string | null
  /** Final turn number the game reached (null if no snapshot). */
  turns: number | null
  /** Starred by the requesting user. */
  starred: boolean
}

/** One page of the replay gallery, plus the archive size under the same filter. */
export interface ReplayListQuery {
  /** Whose stars to project onto the rows (and to filter by). */
  userId: string
  limit: number
  offset: number
  starredOnly: boolean
  /** Narrow to games this user sat in (their public profile), or null for all. */
  playerId?: string | null
}

// --- Player↔player market (plan/Market-Plan.md; wire shapes in protocol/market.ts) ---

export interface MarketParty {
  userId: string
  nickname: string
  avatar: string | null
}

/** One lot as the store hands it up; the hub decorates it with `mine`/`owned`. */
export interface MarketListingRow {
  id: string
  itemId: string
  price: number
  seller: MarketParty
  createdAt: string
  expiresAt: string
  /** Comment count for the card — the thread itself is a separate read. */
  comments: number
}

export interface MarketBrowseQuery {
  /** Whose "my lots" view this is, when `mine` is set. */
  viewerId: string
  /** Item-id prefix filter, or null for the whole shelf. */
  prefix: string | null
  mine: boolean
  limit: number
  offset: number
}

export interface MarketCommentRow {
  id: string
  author: MarketParty
  body: string
  createdAt: string
}

/**
 * Why a listing attempt was refused. `not_owned` covers "never had it" and "sold
 * it already" alike — from the seller's side those are the same sentence.
 */
export type ListResult =
  { ok: true; row: MarketListingRow } | { ok: false; reason: 'not_owned' | 'listed' | 'too_many' }

/**
 * `own` = you cannot buy your own lot (it would be a free round trip through the
 * fee). `owned` = you already have this cosmetic; a second copy does nothing.
 */
export type BuyResult =
  | { ok: true; itemId: string; price: number }
  | { ok: false; reason: 'not_found' | 'own' | 'owned' | 'insufficient' }

/** Everything needed to deterministically reconstruct a finished game. */
export interface ReplayLoad {
  gameId: string
  mode: Mode
  seed: string
  seatCount: number
  controllers: ('human' | 'bot')[]
  players: ReplayPlayer[]
  intents: IntentOrigin[]
}

/** Glicko-2 state per (user, mode). A missing row means "never rated" — see UNRATED. */
export interface RatingRow {
  rating: number
  rd: number
  volatility: number
  games: number
}

export interface RatingWrite {
  seat: SeatId
  userId: string
  ratingBefore: number
  after: { rating: number; rd: number; volatility: number }
}

/**
 * Modes whose finished public games are replayable and publicly listed. A bot
 * seat no longer disqualifies a game: once a ranked queue fills an empty seat
 * with a bot, excluding those would hide most ranked play, and the author wants
 * a bot to be absent from the leaderboard but present in past games. vs_bots
 * and tutorial are practice and stay out of the gallery. Bot intents persist
 * with `origin` exactly like human ones, so a bot game replays deterministically.
 */
export const REPLAYABLE_MODES: readonly Mode[] = ['1v1', 'ffa3', '2v2']

/**
 * Which row of the profile record a finished game counts in (null = counts
 * nowhere). The order of these tests IS the contract, and SqlStore's CASE
 * mirrors it — change one, change both:
 *  1. `tutorial` counts nowhere. It is a lesson, not a match, and it always
 *     ends in a forfeit ('eliminated'), so counting it would hand every new
 *     player a loss on their first day.
 *  2. vs_bots → `bots` before the privacy test: you played a machine, and that
 *     stays true whatever the invite flag says.
 *  3. is_private → `private`: an invite game is unrated by design (room.ts
 *     applyRatings) whatever human mode it runs.
 *  4. what is left is public multiplayer: 2v2 → `team` (real, but unrated —
 *     see ModeRecordSchema), 1v1/ffa3 → `ranked` (ratings.ts RATED_MODES).
 * A bot filling a public ranked seat does NOT move that game to `bots`: the
 * player queued for ranked, and that is how the author counts it elsewhere too
 * (the replay gallery lists such games, and the reward table pays them as
 * ranked) — even though room.ts only moves a rating when every seat is human.
 * `bots` means the vs_bots practice mode.
 */
export function recordCategoryOf(mode: Mode, isPrivate: boolean): RecordCategory | null {
  if (mode === 'tutorial') return null
  if (mode === 'vs_bots') return 'bots'
  if (isPrivate) return 'private'
  return mode === '2v2' ? 'team' : 'ranked'
}

export interface GameStore {
  createGame(game: GameRow): Promise<void>
  /** Game leaves the lobby: seats are final, engine state exists. */
  markActive(gameId: string, players: PlayerRow[]): Promise<void>
  /**
   * Ordered, gapless append; `origin` is recorded on the batch's first event.
   * `commitment` (the move's proof-trail row) persists in the same write — one
   * round trip, atomic with its events.
   */
  appendEvents(
    gameId: string,
    events: EngineEvent[],
    origin?: IntentOrigin,
    commitment?: CommitmentRow
  ): Promise<void>
  /** Upserts the snapshot and prunes older ones — only the latest is ever read. */
  writeSnapshot(gameId: string, seq: number, state: GameState): Promise<void>
  finishGame(
    gameId: string,
    opts: { status: 'finished' | 'aborted'; results: GameResultRow[]; rngSeed: string | null }
  ): Promise<void>

  // Ratings (ranked modes only — see ratings.ts).
  loadRatings(mode: string, userIds: string[]): Promise<Map<string, RatingRow>>
  /** Upserts `ratings` and stamps rating_before/after onto game_players. */
  saveRatings(gameId: string, mode: string, writes: RatingWrite[]): Promise<void>

  // Recovery (rooms are rebuilt as snapshot + intent replay on boot).
  listGamesByStatus(status: GameStatus): Promise<string[]>
  loadGame(gameId: string): Promise<LoadedGame | null>
  loadLatestSnapshot(gameId: string): Promise<{ seq: number; state: GameState } | null>
  loadEventsAfter(gameId: string, afterSeq: number): Promise<EngineEvent[]>
  loadIntentsAfter(gameId: string, afterSeq: number): Promise<StoredIntent[]>

  // Replays (finished ranked games only — public, rated, all-human).
  listReplays(query: ReplayListQuery): Promise<{ rows: ReplayListRow[]; total: number }>
  loadReplay(gameId: string): Promise<ReplayLoad | null>
  /** Pin/unpin a past game in the user's favorites. False = game not replayable. */
  setReplayStar(userId: string, gameId: string, starred: boolean): Promise<boolean>

  // GATO wallet (soft currency; the catalog/prices live in protocol shop.ts).
  /** Lazily creates the wallet with the start-balance grant on first touch. */
  getWallet(userId: string): Promise<{ balance: number; owned: string[] }>
  /** Atomic buy: debit + entitlement row, or a reason why not. */
  purchase(userId: string, itemId: string, price: number): Promise<'ok' | 'insufficient' | 'owned'>
  /**
   * Ranked payout, once per (game, seat) — the ledger row IS the idempotency
   * key, so a recovered game that reaches `finished` twice cannot pay twice.
   * Returns only the credits that actually landed, with the post-credit
   * balance; a repeat call for the same game returns [].
   */
  creditRewards(
    gameId: string,
    credits: { seat: SeatId; userId: string; amount: number }[]
  ): Promise<{ seat: SeatId; userId: string; amount: number; balance: number }[]>

  // Player↔player market (plan/Market-Plan.md). Every one of these first sweeps
  // lots past their expiry back to the seller, so no caller has to remember to.
  browseMarket(query: MarketBrowseQuery): Promise<{ rows: MarketListingRow[]; total: number }>
  /** Put an owned, unlisted item up for `price`, expiring in `ttlDays`. */
  createListing(
    userId: string,
    itemId: string,
    price: number,
    ttlDays: number,
    maxActive: number
  ): Promise<ListResult>
  /** Pull your own lot; false = not yours, or no longer active. */
  cancelListing(userId: string, listingId: string): Promise<boolean>
  /**
   * The sale, atomically: debit buyer, credit seller net of the fee, MOVE the
   * entitlement row, close the lot, write the trade. Either all of it happens or
   * none of it does — a half-paid sale would either duplicate or destroy a good.
   */
  buyListing(buyerId: string, listingId: string, feeBps: number): Promise<BuyResult>
  listComments(listingId: string): Promise<MarketCommentRow[]>
  /** False = no such active lot to comment on. */
  addComment(userId: string, listingId: string, body: string): Promise<boolean>
  /**
   * Items this user has on the shelf right now. The cosmetic gate reads it: what
   * is up for sale cannot also be worn, or a buyer would pay for something the
   * seller is still using at the table.
   */
  lockedItems(userId: string): Promise<string[]>
  /**
   * A cosmetic fell out of a finished ranked game — one roll per (game, seat),
   * the row IS the idempotency key exactly as with creditRewards. `itemId` null
   * records "rolled, owned everything already". Returns false if already rolled.
   */
  recordDrop(gameId: string, seat: SeatId, userId: string, itemId: string | null): Promise<boolean>
  /**
   * Teach the backend who a player is — same contract as ChatStore.remember. The
   * SQL backend has `profiles` and ignores it; the memory backend has no profile
   * table, so a lot would otherwise have a seller with no name.
   */
  rememberParty(party: MarketParty): void

  /** The user's ended games, newest first (clients cannot read the view — RLS). */
  loadMatchHistory(userId: string, limit: number): Promise<HistoryEntry[]>
  /**
   * Games/wins/losses per category over the user's WHOLE archive — the profile
   * record. Aggregated here because loadMatchHistory is capped, so counting on
   * the client would understate anyone with more games than the page size.
   * Takes a userId rather than "me": the same aggregate serves another player's
   * public profile. An unknown user is an all-zero record, never a throw.
   */
  loadModeRecord(userId: string): Promise<ModeRecord>
  /**
   * The same record for a page of players at once — the Players directory needs
   * one row per name, and a per-user round trip would be twenty of them.
   * Missing users come back with an empty record, never absent.
   */
  loadModeRecords(userIds: string[]): Promise<Map<string, ModeRecord>>

  // Achievements (author's list, 2026-07-27; catalog in protocol achievements.ts).
  /**
   * Games played and won per achievement category over the user's WHOLE archive.
   * Deliberately NOT loadModeRecord: that one folds every private game into one
   * `private` bucket, and the author counts private 1v1, private 3-player and
   * private 2v2 as three separate badge families. Same "played" contract though
   * — a seat with a verdict in ('win','lose','eliminated').
   */
  loadPlayCounts(userId: string): Promise<PlayCounts>
  /** The user's earned badges, oldest first. Unknown user = []. */
  loadAchievements(userId: string): Promise<EarnedAchievement[]>
  /**
   * Grant these ids to this user, skipping the ones already held; returns only
   * the ids that actually landed. The (user_id, achievement_id) primary key is
   * the idempotency guarantee — the same finish replayed after a crash grants
   * nothing new, and a badge's earned_at never moves.
   * `gameId` = the game that earned them, or null for archive-wide counters.
   */
  awardAchievements(userId: string, ids: string[], gameId: string | null): Promise<string[]>

  // FCM device tokens ("your turn" pushes) — see push.ts.
  savePushToken(userId: string, token: string, platform: string): Promise<void>
  deletePushToken(token: string): Promise<void>
  /** Notifications toggled off — every device of this user stops. */
  deleteUserPushTokens(userId: string): Promise<void>
  loadPushTokens(userId: string): Promise<string[]>
}

/** In-memory row behind MarketListingRow — carries the fields the view hides. */
interface MemoryListing {
  id: string
  seller: string
  itemId: string
  price: number
  status: 'active' | 'sold' | 'cancelled' | 'expired'
  createdAt: string
  expiresAt: string
  buyer?: string
}

interface MemoryGame {
  game: GameRow
  players: PlayerRow[]
  events: EngineEvent[]
  intents: StoredIntent[]
  snapshots: { seq: number; state: GameState }[]
  commitments: CommitmentRow[]
  results: GameResultRow[]
  ratingWrites: RatingWrite[]
  rngSeed: string | null
  finishedAt?: string
}

export class MemoryStore implements GameStore {
  private readonly games = new Map<string, MemoryGame>()
  /** `${mode}:${userId}` → row. */
  private readonly ratings = new Map<string, RatingRow>()
  /** token → userId. */
  private readonly pushTokens = new Map<string, string>()
  /** userId → starred replay gameIds. */
  private readonly replayStars = new Map<string, Set<string>>()
  /** userId → GATO balance (created on first touch with the start grant). */
  private readonly wallets = new Map<string, number>()
  /** userId → itemId → paid price. */
  private readonly purchases = new Map<string, Map<string, number>>()
  /** gameId → seat → GATO already paid out (the reward ledger). */
  private readonly rewards = new Map<string, Map<SeatId, number>>()
  /** userId → achievementId → when it was first earned (the PK, in a Map). */
  private readonly achievements = new Map<
    string,
    Map<string, { earnedAt: string; gameId: string | null }>
  >()

  async getWallet(userId: string): Promise<{ balance: number; owned: string[] }> {
    if (!this.wallets.has(userId)) this.wallets.set(userId, GATO_START_BALANCE)
    return {
      balance: this.wallets.get(userId) as number,
      owned: [...(this.purchases.get(userId)?.keys() ?? [])]
    }
  }

  async purchase(
    userId: string,
    itemId: string,
    price: number
  ): Promise<'ok' | 'insufficient' | 'owned'> {
    await this.getWallet(userId)
    const owned = this.purchases.get(userId)
    if (owned?.has(itemId)) return 'owned'
    const balance = this.wallets.get(userId) as number
    if (balance < price) return 'insufficient'
    this.wallets.set(userId, balance - price)
    if (owned) owned.set(itemId, price)
    else this.purchases.set(userId, new Map([[itemId, price]]))
    return 'ok'
  }

  async creditRewards(
    gameId: string,
    credits: { seat: SeatId; userId: string; amount: number }[]
  ): Promise<{ seat: SeatId; userId: string; amount: number; balance: number }[]> {
    let paid = this.rewards.get(gameId)
    if (!paid) {
      paid = new Map()
      this.rewards.set(gameId, paid)
    }
    const landed: { seat: SeatId; userId: string; amount: number; balance: number }[] = []
    for (const c of credits) {
      if (paid.has(c.seat)) continue
      paid.set(c.seat, c.amount)
      await this.getWallet(c.userId) // the start grant must exist before we add
      const balance = (this.wallets.get(c.userId) as number) + c.amount
      this.wallets.set(c.userId, balance)
      landed.push({ ...c, balance })
    }
    return landed
  }

  // --- Player↔player market ------------------------------------------------

  private readonly parties = new Map<string, MarketParty>()
  private readonly listings = new Map<string, MemoryListing>()
  private readonly comments = new Map<string, MarketCommentRow[]>()
  /** gameId → seat → the drop already rolled (the ledger). */
  private readonly drops = new Map<string, Map<SeatId, string | null>>()

  rememberParty(party: MarketParty): void {
    this.parties.set(party.userId, { ...party })
  }

  private partyOf(userId: string): MarketParty {
    return this.parties.get(userId) ?? { userId, nickname: userId.slice(0, 8), avatar: null }
  }

  /** Lazy sweep, mirroring the SQL one: expiry is checked on read, not on a timer. */
  private expireStale(): void {
    const now = Date.now()
    for (const l of this.listings.values())
      if (l.status === 'active' && Date.parse(l.expiresAt) <= now) l.status = 'expired'
  }

  private viewOf(l: MemoryListing): MarketListingRow {
    return {
      id: l.id,
      itemId: l.itemId,
      price: l.price,
      seller: this.partyOf(l.seller),
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      comments: this.comments.get(l.id)?.length ?? 0
    }
  }

  async browseMarket(
    query: MarketBrowseQuery
  ): Promise<{ rows: MarketListingRow[]; total: number }> {
    this.expireStale()
    const all = [...this.listings.values()]
      .filter((l) => l.status === 'active')
      .filter((l) => (query.mine ? l.seller === query.viewerId : true))
      .filter((l) => (query.prefix ? l.itemId.startsWith(query.prefix) : true))
      // Newest first, id as the stable tiebreak — same order as the SQL index.
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    return {
      rows: all.slice(query.offset, query.offset + query.limit).map((l) => this.viewOf(l)),
      total: all.length
    }
  }

  async createListing(
    userId: string,
    itemId: string,
    price: number,
    ttlDays: number,
    maxActive: number
  ): Promise<ListResult> {
    this.expireStale()
    if (!this.purchases.get(userId)?.has(itemId)) return { ok: false, reason: 'not_owned' }
    const mine = [...this.listings.values()].filter(
      (l) => l.status === 'active' && l.seller === userId
    )
    if (mine.some((l) => l.itemId === itemId)) return { ok: false, reason: 'listed' }
    if (mine.length >= maxActive) return { ok: false, reason: 'too_many' }
    const now = new Date()
    const row: MemoryListing = {
      id: randomUUID(),
      seller: userId,
      itemId,
      price,
      status: 'active',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlDays * 86_400_000).toISOString()
    }
    this.listings.set(row.id, row)
    return { ok: true, row: this.viewOf(row) }
  }

  async cancelListing(userId: string, listingId: string): Promise<boolean> {
    const l = this.listings.get(listingId)
    if (!l || l.status !== 'active' || l.seller !== userId) return false
    l.status = 'cancelled'
    return true
  }

  async buyListing(buyerId: string, listingId: string, feeBps: number): Promise<BuyResult> {
    this.expireStale()
    const l = this.listings.get(listingId)
    if (!l || l.status !== 'active') return { ok: false, reason: 'not_found' }
    if (l.seller === buyerId) return { ok: false, reason: 'own' }
    await this.getWallet(buyerId)
    await this.getWallet(l.seller)
    if (this.purchases.get(buyerId)?.has(l.itemId)) return { ok: false, reason: 'owned' }
    const balance = this.wallets.get(buyerId) as number
    if (balance < l.price) return { ok: false, reason: 'insufficient' }
    // The entitlement MOVES: the seller stops owning what the buyer starts
    // owning, or the sale would mint a second copy out of nothing.
    this.purchases.get(l.seller)?.delete(l.itemId)
    const bought = this.purchases.get(buyerId)
    if (bought) bought.set(l.itemId, l.price)
    else this.purchases.set(buyerId, new Map([[l.itemId, l.price]]))
    this.wallets.set(buyerId, balance - l.price)
    const fee = Math.floor((l.price * feeBps) / 10_000)
    this.wallets.set(l.seller, (this.wallets.get(l.seller) as number) + (l.price - fee))
    l.status = 'sold'
    l.buyer = buyerId
    return { ok: true, itemId: l.itemId, price: l.price }
  }

  async listComments(listingId: string): Promise<MarketCommentRow[]> {
    return (this.comments.get(listingId) ?? []).map((c) => ({
      ...c,
      author: this.partyOf(c.author.userId)
    }))
  }

  async addComment(userId: string, listingId: string, body: string): Promise<boolean> {
    this.expireStale()
    if (this.listings.get(listingId)?.status !== 'active') return false
    const row: MarketCommentRow = {
      id: randomUUID(),
      author: this.partyOf(userId),
      body,
      createdAt: new Date().toISOString()
    }
    const thread = this.comments.get(listingId)
    if (thread) thread.push(row)
    else this.comments.set(listingId, [row])
    return true
  }

  async lockedItems(userId: string): Promise<string[]> {
    this.expireStale()
    return [...this.listings.values()]
      .filter((l) => l.status === 'active' && l.seller === userId)
      .map((l) => l.itemId)
  }

  async recordDrop(
    gameId: string,
    seat: SeatId,
    userId: string,
    itemId: string | null
  ): Promise<boolean> {
    let rolled = this.drops.get(gameId)
    if (!rolled) {
      rolled = new Map()
      this.drops.set(gameId, rolled)
    }
    if (rolled.has(seat)) return false
    rolled.set(seat, itemId)
    if (itemId === null) return true
    await this.getWallet(userId)
    const owned = this.purchases.get(userId)
    // price 0: a drop was earned, not bought — the ledger must not claim a sale.
    if (owned) owned.set(itemId, 0)
    else this.purchases.set(userId, new Map([[itemId, 0]]))
    return true
  }

  async savePushToken(userId: string, token: string, _platform: string): Promise<void> {
    this.pushTokens.set(token, userId)
  }

  async deletePushToken(token: string): Promise<void> {
    this.pushTokens.delete(token)
  }

  async deleteUserPushTokens(userId: string): Promise<void> {
    for (const [token, u] of this.pushTokens) if (u === userId) this.pushTokens.delete(token)
  }

  async loadPushTokens(userId: string): Promise<string[]> {
    return [...this.pushTokens.entries()].filter(([, u]) => u === userId).map(([t]) => t)
  }

  private need(gameId: string): MemoryGame {
    const g = this.games.get(gameId)
    if (!g) throw new Error(`store: unknown game ${gameId}`)
    return g
  }

  async createGame(game: GameRow): Promise<void> {
    if (this.games.has(game.gameId)) throw new Error(`store: game ${game.gameId} exists`)
    this.games.set(game.gameId, {
      game: { ...game },
      players: [],
      events: [],
      intents: [],
      snapshots: [],
      commitments: [],
      results: [],
      ratingWrites: [],
      rngSeed: null
    })
  }

  async markActive(gameId: string, players: PlayerRow[]): Promise<void> {
    const g = this.need(gameId)
    g.game.status = 'active'
    g.players = players.map((p) => ({ ...p }))
  }

  async appendEvents(
    gameId: string,
    events: EngineEvent[],
    origin?: IntentOrigin,
    commitment?: CommitmentRow
  ): Promise<void> {
    const g = this.need(gameId)
    if (events.length === 0) return
    for (const event of events) {
      const last = g.events[g.events.length - 1]
      if (last && event.seq !== last.seq + 1)
        throw new Error(`store: event seq gap (${last.seq} → ${event.seq})`)
      g.events.push(deepClone(event))
    }
    if (origin)
      g.intents.push({
        seat: origin.seat,
        intent: deepClone(origin.intent),
        firstEventSeq: (events[0] as EngineEvent).seq
      })
    if (commitment) g.commitments.push({ ...commitment })
  }

  async writeSnapshot(gameId: string, seq: number, state: GameState): Promise<void> {
    const g = this.need(gameId)
    g.snapshots = [{ seq, state: deepClone(state) }]
  }

  async finishGame(
    gameId: string,
    opts: { status: 'finished' | 'aborted'; results: GameResultRow[]; rngSeed: string | null }
  ): Promise<void> {
    const g = this.need(gameId)
    g.game.status = opts.status
    g.results = opts.results.map((r) => ({ ...r }))
    g.rngSeed = opts.rngSeed
    g.finishedAt = new Date().toISOString()
  }

  async loadMatchHistory(userId: string, limit: number): Promise<HistoryEntry[]> {
    const entries: HistoryEntry[] = []
    const stars = this.replayStars.get(userId)
    for (const g of this.games.values()) {
      if (g.game.status !== 'finished' && g.game.status !== 'aborted') continue
      const player = g.players.find((p) => p.userId === userId)
      if (!player) continue
      const result = g.results.find((r) => r.seat === player.seat)
      const rating = g.ratingWrites.find((w) => w.userId === userId)
      const verdict = result?.result
      entries.push({
        gameId: g.game.gameId,
        mode: g.game.mode,
        status: g.game.status,
        seat: player.seat,
        result:
          verdict === 'win' || verdict === 'lose' || verdict === 'eliminated' ? verdict : null,
        finalVp: result?.finalVp ?? null,
        ratingBefore: rating?.ratingBefore ?? null,
        ratingAfter: rating?.after.rating ?? null,
        finishedAt: g.finishedAt ?? null,
        starred: stars?.has(g.game.gameId) ?? false
      })
    }
    entries.sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
    return entries.slice(0, limit)
  }

  async loadModeRecord(userId: string): Promise<ModeRecord> {
    const record = emptyModeRecord()
    for (const g of this.games.values()) {
      const player = g.players.find((p) => p.userId === userId)
      if (!player) continue
      const verdict = g.results.find((r) => r.seat === player.seat)?.result
      // No verdict ('aborted', or no result row at all) = never played: an
      // aborted game is a lobby that died, not a match this player lost.
      if (verdict !== 'win' && verdict !== 'lose' && verdict !== 'eliminated') continue
      const category = recordCategoryOf(g.game.mode, g.game.isPrivate)
      if (category === null) continue
      const row = record[category]
      row.played++
      // 'eliminated' (forfeit, disconnect, knocked out) is not a win — so a loss.
      if (verdict === 'win') row.wins++
      else row.losses++
    }
    return record
  }

  async loadModeRecords(userIds: string[]): Promise<Map<string, ModeRecord>> {
    const out = new Map<string, ModeRecord>()
    for (const userId of userIds) out.set(userId, await this.loadModeRecord(userId))
    return out
  }

  async loadPlayCounts(userId: string): Promise<PlayCounts> {
    const counts = emptyPlayCounts()
    for (const g of this.games.values()) {
      const player = g.players.find((p) => p.userId === userId)
      if (!player) continue
      const verdict = g.results.find((r) => r.seat === player.seat)?.result
      // Exactly loadModeRecord's "played" test: no verdict ('aborted', or no
      // result row at all) = a lobby that died, never a game played.
      if (verdict !== 'win' && verdict !== 'lose' && verdict !== 'eliminated') continue
      const category = playCategoryOf(g.game.mode, g.game.isPrivate)
      if (category === null) continue
      counts[category].played++
      if (verdict === 'win') counts[category].wins++
    }
    return counts
  }

  async loadAchievements(userId: string): Promise<EarnedAchievement[]> {
    return [...(this.achievements.get(userId) ?? new Map()).entries()]
      .map(([id, row]) => ({ id, earnedAt: row.earnedAt }))
      .sort((a, b) => a.earnedAt.localeCompare(b.earnedAt) || a.id.localeCompare(b.id))
  }

  async awardAchievements(userId: string, ids: string[], gameId: string | null): Promise<string[]> {
    let held = this.achievements.get(userId)
    if (!held) {
      held = new Map()
      this.achievements.set(userId, held)
    }
    const landed: string[] = []
    for (const id of ids) {
      if (held.has(id)) continue // the PK's job in the SQL store
      held.set(id, { earnedAt: new Date().toISOString(), gameId })
      landed.push(id)
    }
    return landed
  }

  async listGamesByStatus(status: GameStatus): Promise<string[]> {
    return [...this.games.values()]
      .filter((g) => g.game.status === status)
      .map((g) => g.game.gameId)
  }

  async loadGame(gameId: string): Promise<LoadedGame | null> {
    const g = this.games.get(gameId)
    if (!g) return null
    return { game: { ...g.game }, players: g.players.map((p) => ({ ...p })) }
  }

  async loadLatestSnapshot(gameId: string): Promise<{ seq: number; state: GameState } | null> {
    const g = this.games.get(gameId)
    const last = g?.snapshots[g.snapshots.length - 1]
    return last ? { seq: last.seq, state: deepClone(last.state) } : null
  }

  async loadEventsAfter(gameId: string, afterSeq: number): Promise<EngineEvent[]> {
    const g = this.games.get(gameId)
    if (!g) return []
    return g.events.filter((e) => e.seq > afterSeq).map((e) => deepClone(e))
  }

  async loadIntentsAfter(gameId: string, afterSeq: number): Promise<StoredIntent[]> {
    const g = this.games.get(gameId)
    if (!g) return []
    return g.intents.filter((i) => i.firstEventSeq > afterSeq).map((i) => deepClone(i))
  }

  private isReplayable(g: MemoryGame): boolean {
    return (
      g.game.status === 'finished' &&
      !g.game.isPrivate &&
      (REPLAYABLE_MODES as readonly string[]).includes(g.game.mode) &&
      g.players.length > 0
    )
  }

  private replayPlayers(g: MemoryGame): ReplayPlayer[] {
    return [...g.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        seat: p.seat,
        userId: p.userId,
        nickname: p.userId ? `Player ${p.seat + 1}` : `Bot ${p.seat}`,
        avatar: null,
        bot: p.botStrategy !== null
      }))
  }

  async listReplays(query: ReplayListQuery): Promise<{ rows: ReplayListRow[]; total: number }> {
    const stars = this.replayStars.get(query.userId)
    const rows = [...this.games.values()]
      .filter((g) => this.isReplayable(g))
      .filter((g) => !query.starredOnly || stars?.has(g.game.gameId))
      .filter((g) => !query.playerId || g.players.some((pl) => pl.userId === query.playerId))
      .map((g) => ({
        gameId: g.game.gameId,
        mode: g.game.mode,
        players: this.replayPlayers(g),
        winnerSeats: g.results.filter((r) => r.result === 'win').map((r) => r.seat),
        finishedAt: g.finishedAt ?? null,
        turns: g.snapshots.at(-1)?.state.turn ?? null,
        starred: stars?.has(g.game.gameId) ?? false
      }))
    // gameId tiebreak: equal finish timestamps must still page deterministically.
    rows.sort(
      (a, b) =>
        (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '') || a.gameId.localeCompare(b.gameId)
    )
    return { rows: rows.slice(query.offset, query.offset + query.limit), total: rows.length }
  }

  async setReplayStar(userId: string, gameId: string, starred: boolean): Promise<boolean> {
    const g = this.games.get(gameId)
    if (!g || !this.isReplayable(g)) return false
    let stars = this.replayStars.get(userId)
    if (!stars) {
      stars = new Set()
      this.replayStars.set(userId, stars)
    }
    if (starred) stars.add(gameId)
    else stars.delete(gameId)
    return true
  }

  async loadReplay(gameId: string): Promise<ReplayLoad | null> {
    const g = this.games.get(gameId)
    if (!g || !this.isReplayable(g) || g.rngSeed === null) return null
    const players = this.replayPlayers(g)
    return {
      gameId,
      mode: g.game.mode,
      seed: g.rngSeed,
      seatCount: g.players.length,
      controllers: players.map((p) => (p.bot ? 'bot' : 'human')),
      players,
      intents: [...g.intents]
        .sort((a, b) => a.firstEventSeq - b.firstEventSeq)
        .map((i) => ({ seat: i.seat, intent: deepClone(i.intent) }))
    }
  }

  async loadRatings(mode: string, userIds: string[]): Promise<Map<string, RatingRow>> {
    const out = new Map<string, RatingRow>()
    for (const userId of userIds) {
      const row = this.ratings.get(`${mode}:${userId}`)
      if (row) out.set(userId, { ...row })
    }
    return out
  }

  async saveRatings(gameId: string, mode: string, writes: RatingWrite[]): Promise<void> {
    const game = this.need(gameId)
    for (const w of writes) {
      const key = `${mode}:${w.userId}`
      const previous = this.ratings.get(key)
      this.ratings.set(key, { ...w.after, games: (previous?.games ?? 0) + 1 })
      game.ratingWrites.push({ ...w })
    }
  }

  // --- test inspection helpers -----------------------------------------------------

  inspect(gameId: string): MemoryGame | undefined {
    return this.games.get(gameId)
  }

  inspectRating(mode: string, userId: string): RatingRow | undefined {
    return this.ratings.get(`${mode}:${userId}`)
  }
}
