// SQL-backed GameStore + ProfileStore over the minimal Sql boundary (pg or
// PGlite). Event appends are one multi-row INSERT (atomic, ordered); a per-game
// last-seq cache enforces gaplessness without an extra round trip.

import { randomBytes } from 'node:crypto'
import type { EngineEvent, GameState, Intent, Mode, SeatId } from '@metarchy/engine'
import type {
  CategoryRecord,
  EarnedAchievement,
  HistoryEntry,
  ModeRecord,
  PlayCategory,
  PlayCounts,
  RecordCategory,
  Wardrobe
} from '@metarchy/protocol'
import { GATO_START_BALANCE, emptyModeRecord, emptyPlayCounts } from '@metarchy/protocol'
import type { Sql } from './db.js'
import { defaultNickname } from './profiles.js'
import type { ProfileStore, RenameResult } from './profiles.js'
import type { Profile } from './session.js'
import type {
  BuyResult,
  CommitmentRow,
  GameResultRow,
  GameRow,
  GameStatus,
  GameStore,
  IntentOrigin,
  ListResult,
  LoadedGame,
  MarketBrowseQuery,
  MarketCommentRow,
  MarketListingRow,
  PlayerRow,
  RatingRow,
  RatingWrite,
  ReplayListQuery,
  ReplayListRow,
  ReplayLoad,
  ReplayPlayer,
  StoredIntent
} from './store.js'
import { REPLAYABLE_MODES } from './store.js'

/** Raw shape of LISTING_SELECT — bigints and dates arrive untyped from the driver. */
interface SqlListingRow {
  id: string
  item_id: string
  price: unknown
  created_at: string
  expires_at: string
  seller_id: string
  nickname: string
  avatar: string | null
  comments: unknown
}

export class SqlStore implements GameStore {
  private readonly lastSeq = new Map<string, number>()

  constructor(private readonly sql: Sql) {}

  async createGame(game: GameRow): Promise<void> {
    await this.sql.query(
      `insert into games (id, mode, status, is_private, invite_code, rules_version, rng_seed_hash)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        game.gameId,
        game.mode,
        game.status,
        game.isPrivate,
        game.inviteCode,
        game.rulesVersion,
        game.rngSeedHash
      ]
    )
    this.lastSeq.set(game.gameId, 0)
  }

  async markActive(gameId: string, players: PlayerRow[]): Promise<void> {
    await this.sql.query(`update games set status = 'active', started_at = now() where id = $1`, [
      gameId
    ])
    for (const p of players) {
      await this.sql.query(
        `insert into game_players (game_id, seat, user_id, bot_strategy) values ($1, $2, $3, $4)`,
        [gameId, p.seat, p.userId, p.botStrategy]
      )
    }
  }

  async appendEvents(
    gameId: string,
    events: EngineEvent[],
    origin?: IntentOrigin,
    commitment?: CommitmentRow
  ): Promise<void> {
    if (events.length === 0) return
    let last = this.lastSeq.get(gameId)
    if (last === undefined) {
      const r = await this.sql.query<{ max: unknown }>(
        `select coalesce(max(seq), 0) as max from game_events where game_id = $1`,
        [gameId]
      )
      last = Number(r.rows[0]?.max ?? 0)
    }
    const params: unknown[] = [gameId]
    const tuples: string[] = []
    for (const [i, event] of events.entries()) {
      if (event.seq !== last + 1)
        throw new Error(`store: event seq gap (${last} → ${event.seq}) in game ${gameId}`)
      last = event.seq
      const base = params.length
      params.push(
        event.seq,
        event.type,
        JSON.stringify(event),
        i === 0 && origin ? JSON.stringify(origin.intent) : null,
        i === 0 && origin ? origin.seat : null
      )
      tuples.push(
        `($1, $${base + 1}, $${base + 2}, $${base + 3}::jsonb, $${base + 4}::jsonb, $${base + 5})`
      )
    }
    const eventsInsert = `insert into game_events (game_id, seq, type, payload, intent, intent_seat) values ${tuples.join(', ')}`
    if (commitment) {
      // Proof trail rides the same statement: one round trip, atomic with the
      // events it commits to (a data-modifying CTE is a single transaction).
      const base = params.length
      params.push(
        commitment.seq,
        commitment.seat,
        commitment.turn,
        commitment.phase,
        commitment.hash,
        commitment.salt
      )
      await this.sql.query(
        `with ev as (${eventsInsert})
         insert into move_commitments (game_id, seq, seat, turn, phase, hash, salt)
         values ($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})
         on conflict (game_id, seq) do nothing`,
        params
      )
    } else {
      await this.sql.query(eventsInsert, params)
    }
    this.lastSeq.set(gameId, last)
  }

  async writeSnapshot(gameId: string, seq: number, state: GameState): Promise<void> {
    // Only the latest snapshot is ever read (loadLatestSnapshot); pruning in the
    // same statement keeps the table one row per game instead of one per phase.
    await this.sql.query(
      `with s as (
         insert into game_snapshots (game_id, seq, state) values ($1, $2, $3::jsonb)
         on conflict (game_id, seq) do update set state = excluded.state
       )
       delete from game_snapshots where game_id = $1 and seq < $2`,
      [gameId, seq, JSON.stringify(state)]
    )
  }

  async finishGame(
    gameId: string,
    opts: { status: 'finished' | 'aborted'; results: GameResultRow[]; rngSeed: string | null }
  ): Promise<void> {
    await this.sql.query(
      `update games set status = $2, rng_seed = $3, finished_at = now() where id = $1`,
      [gameId, opts.status, opts.rngSeed]
    )
    for (const r of opts.results) {
      await this.sql.query(
        `update game_players set result = $3, final_vp = $4 where game_id = $1 and seat = $2`,
        [gameId, r.seat, r.result, r.finalVp]
      )
    }
    this.lastSeq.delete(gameId)
  }

  async listGamesByStatus(status: GameStatus): Promise<string[]> {
    const r = await this.sql.query<{ id: string }>(`select id from games where status = $1`, [
      status
    ])
    return r.rows.map((row) => row.id)
  }

  async loadGame(gameId: string): Promise<LoadedGame | null> {
    const g = await this.sql.query<{
      id: string
      mode: Mode
      status: GameStatus
      is_private: boolean
      invite_code: string | null
      rules_version: string
      rng_seed_hash: string
    }>(`select * from games where id = $1`, [gameId])
    const row = g.rows[0]
    if (!row) return null
    const p = await this.sql.query<{
      seat: number
      user_id: string | null
      bot_strategy: string | null
    }>(`select seat, user_id, bot_strategy from game_players where game_id = $1 order by seat`, [
      gameId
    ])
    return {
      game: {
        gameId: row.id,
        mode: row.mode,
        status: row.status,
        isPrivate: row.is_private,
        inviteCode: row.invite_code,
        rulesVersion: row.rules_version,
        rngSeedHash: row.rng_seed_hash
      },
      players: p.rows.map((r) => ({
        seat: Number(r.seat) as SeatId,
        userId: r.user_id,
        botStrategy: r.bot_strategy
      }))
    }
  }

  async loadLatestSnapshot(gameId: string): Promise<{ seq: number; state: GameState } | null> {
    const r = await this.sql.query<{ seq: unknown; state: GameState }>(
      `select seq, state from game_snapshots where game_id = $1 order by seq desc limit 1`,
      [gameId]
    )
    const row = r.rows[0]
    return row ? { seq: Number(row.seq), state: row.state } : null
  }

  async loadEventsAfter(gameId: string, afterSeq: number): Promise<EngineEvent[]> {
    const r = await this.sql.query<{ payload: EngineEvent }>(
      `select payload from game_events where game_id = $1 and seq > $2 order by seq`,
      [gameId, afterSeq]
    )
    return r.rows.map((row) => row.payload)
  }

  async loadIntentsAfter(gameId: string, afterSeq: number): Promise<StoredIntent[]> {
    const r = await this.sql.query<{ seq: unknown; intent: Intent; intent_seat: number }>(
      `select seq, intent, intent_seat from game_events
       where game_id = $1 and seq > $2 and intent is not null order by seq`,
      [gameId, afterSeq]
    )
    return r.rows.map((row) => ({
      firstEventSeq: Number(row.seq),
      seat: Number(row.intent_seat) as SeatId,
      intent: row.intent
    }))
  }

  /** Replayable = finished, public, a real multiplayer mode — mirrors MemoryStore.isReplayable.
   *  Mode names are our own literals (REPLAYABLE_MODES), so inlining them is safe. */
  private static readonly REPLAYABLE_WHERE = `g.status = 'finished' and g.is_private = false
           and g.mode in (${REPLAYABLE_MODES.map((m) => `'${m}'`).join(', ')})`

  async listReplays(query: ReplayListQuery): Promise<{ rows: ReplayListRow[]; total: number }> {
    const starFilter = (flag: string, uid: string): string =>
      `(${flag} = false or exists (select 1 from replay_stars rs
                            where rs.user_id = ${uid} and rs.game_id = g.id))`
    // "Games this player sat in" — an EXISTS over the same game's seats, so it
    // composes with the star filter and the count without changing the join.
    const playerFilter = (pid: string): string =>
      `(${pid}::uuid is null or exists (select 1 from game_players gp2
                            where gp2.game_id = g.id and gp2.user_id = ${pid}::uuid))`
    const playerId = query.playerId ?? null
    const count = await this.sql.query<{ total: number }>(
      `select count(*)::int as total from games g
       where ${SqlStore.REPLAYABLE_WHERE} and ${starFilter('$1', '$2')}
         and ${playerFilter('$3')}`,
      [query.starredOnly, query.userId, playerId]
    )
    const total = count.rows[0]?.total ?? 0
    const r = await this.sql.query<{
      game_id: string
      mode: Mode
      finished_at: Date | string | null
      turns: number | null
      starred: boolean
      seat: number
      user_id: string | null
      bot_strategy: string | null
      result: string | null
      nickname: string | null
      avatar: string | null
    }>(
      `with ranked as (
         select g.id, g.mode, g.finished_at,
                (select (s.state->>'turn')::int from game_snapshots s
                 where s.game_id = g.id order by s.seq desc limit 1) as turns,
                exists (select 1 from replay_stars rs
                        where rs.user_id = $3 and rs.game_id = g.id) as starred
         from games g
         where ${SqlStore.REPLAYABLE_WHERE} and ${starFilter('$2', '$3')}
           and ${playerFilter('$5')}
         order by g.finished_at desc nulls last, g.id
         limit $1 offset $4
       )
       select ranked.id as game_id, ranked.mode, ranked.finished_at, ranked.turns, ranked.starred,
              gp.seat, gp.user_id, gp.bot_strategy, gp.result, p.nickname, p.avatar
       from ranked
       join game_players gp on gp.game_id = ranked.id
       left join profiles p on p.user_id = gp.user_id
       order by ranked.finished_at desc nulls last, ranked.id, gp.seat`,
      [query.limit, query.starredOnly, query.userId, query.offset, playerId]
    )
    const byGame = new Map<string, ReplayListRow>()
    for (const row of r.rows) {
      let entry = byGame.get(row.game_id)
      if (!entry) {
        const at = row.finished_at
        entry = {
          gameId: row.game_id,
          mode: row.mode,
          players: [],
          winnerSeats: [],
          finishedAt: at === null ? null : at instanceof Date ? at.toISOString() : String(at),
          turns: row.turns,
          starred: row.starred
        }
        byGame.set(row.game_id, entry)
      }
      entry.players.push({
        seat: row.seat as SeatId,
        userId: row.user_id,
        nickname: row.nickname ?? `Player ${row.seat + 1}`,
        avatar: row.avatar,
        bot: row.bot_strategy !== null
      })
      if (row.result === 'win') entry.winnerSeats.push(row.seat as SeatId)
    }
    return { rows: [...byGame.values()], total }
  }

  async setReplayStar(userId: string, gameId: string, starred: boolean): Promise<boolean> {
    const ok = await this.sql.query(
      `select 1 from games g where g.id = $1 and ${SqlStore.REPLAYABLE_WHERE}`,
      [gameId]
    )
    if (ok.rows.length === 0) return false
    if (starred)
      await this.sql.query(
        `insert into replay_stars (user_id, game_id) values ($1, $2) on conflict do nothing`,
        [userId, gameId]
      )
    else
      await this.sql.query(`delete from replay_stars where user_id = $1 and game_id = $2`, [
        userId,
        gameId
      ])
    return true
  }

  async getWallet(userId: string): Promise<{ balance: number; owned: string[] }> {
    await this.sql.query(
      `insert into wallets (user_id, balance) values ($1, $2) on conflict (user_id) do nothing`,
      [userId, GATO_START_BALANCE]
    )
    const bal = await this.sql.query<{ balance: unknown }>(
      `select balance from wallets where user_id = $1`,
      [userId]
    )
    const owned = await this.sql.query<{ item_id: string }>(
      `select item_id from purchases where user_id = $1 order by created_at, item_id`,
      [userId]
    )
    return {
      balance: Number(bal.rows[0]?.balance ?? 0),
      owned: owned.rows.map((r) => r.item_id)
    }
  }

  async creditRewards(
    gameId: string,
    credits: { seat: SeatId; userId: string; amount: number }[]
  ): Promise<{ seat: SeatId; userId: string; amount: number; balance: number }[]> {
    const landed: { seat: SeatId; userId: string; amount: number; balance: number }[] = []
    for (const c of credits) {
      await this.getWallet(c.userId) // ensure the wallet row (start grant) exists
      // One statement, and the ledger insert gates it: a second finish of the
      // same game conflicts on (game_id, seat), the CTE yields no row and the
      // wallet update touches nothing. A zero-amount credit still writes its
      // ledger row — "played, earned nothing" must stay distinguishable.
      const r = await this.sql.query<{ balance: unknown }>(
        `with paid as (
           insert into gato_rewards (game_id, seat, user_id, amount)
           values ($1, $2, $3, $4)
           on conflict (game_id, seat) do nothing
           returning user_id, amount
         )
         update wallets w set balance = w.balance + paid.amount, updated_at = now()
         from paid where w.user_id = paid.user_id
         returning w.balance`,
        [gameId, c.seat, c.userId, c.amount]
      )
      const balance = r.rows[0]?.balance
      if (balance !== undefined) landed.push({ ...c, balance: Number(balance) })
    }
    return landed
  }

  async purchase(
    userId: string,
    itemId: string,
    price: number
  ): Promise<'ok' | 'insufficient' | 'owned'> {
    await this.getWallet(userId) // ensure the wallet row (start grant) exists
    try {
      // One statement = atomic: the debit CTE only fires when funds suffice and
      // the item is not owned; the entitlement insert consumes it. A concurrent
      // duplicate buy hits the purchases PK and rolls the whole statement back,
      // debit included.
      const r = await this.sql.query(
        `with buy as (
           update wallets set balance = balance - $3, updated_at = now()
           where user_id = $1 and balance >= $3
             and not exists (select 1 from purchases pp
                             where pp.user_id = $1 and pp.item_id = $2)
           returning user_id
         )
         insert into purchases (user_id, item_id, price)
         select user_id, $2, $3 from buy
         returning item_id`,
        [userId, itemId, price]
      )
      if (r.rows.length > 0) return 'ok'
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return 'owned'
      throw e
    }
    const owned = await this.sql.query(
      `select 1 from purchases where user_id = $1 and item_id = $2`,
      [userId, itemId]
    )
    return owned.rows.length > 0 ? 'owned' : 'insufficient'
  }

  async loadReplay(gameId: string): Promise<ReplayLoad | null> {
    const meta = await this.sql.query<{
      mode: Mode
      rng_seed: string | null
      is_private: boolean
      status: string
      bots: number | string
    }>(
      `select g.mode, g.rng_seed, g.is_private, g.status,
              (select count(*) from game_players b
               where b.game_id = g.id and b.bot_strategy is not null) as bots
       from games g where g.id = $1`,
      [gameId]
    )
    const m = meta.rows[0]
    if (!m || m.status !== 'finished' || m.is_private || Number(m.bots) > 0 || m.rng_seed === null)
      return null

    const pr = await this.sql.query<{
      seat: number
      user_id: string | null
      bot_strategy: string | null
      nickname: string | null
      avatar: string | null
    }>(
      `select gp.seat, gp.user_id, gp.bot_strategy, p.nickname, p.avatar
       from game_players gp left join profiles p on p.user_id = gp.user_id
       where gp.game_id = $1 order by gp.seat`,
      [gameId]
    )
    const players: ReplayPlayer[] = pr.rows.map((row) => ({
      seat: row.seat as SeatId,
      userId: row.user_id,
      nickname: row.nickname ?? `Player ${row.seat + 1}`,
      avatar: row.avatar,
      bot: row.bot_strategy !== null
    }))
    const intents = await this.loadIntentsAfter(gameId, -1)
    return {
      gameId,
      mode: m.mode,
      seed: m.rng_seed,
      seatCount: players.length,
      controllers: players.map((p) => (p.bot ? 'bot' : 'human')),
      players,
      intents: intents.map((i) => ({ seat: i.seat, intent: i.intent }))
    }
  }

  // --- Player↔player market (plan/Market-Plan.md) ---------------------------

  /** The SQL backend joins `profiles` for names and faces; this is a no-op here. */
  rememberParty(): void {}

  /**
   * Lots past their day sweep back to the seller. Lazy on purpose: a timer would
   * be one more thing to run and to recover, and the only moments an expiry can
   * matter are exactly the ones that read or write the shelf.
   */
  private async expireStale(): Promise<void> {
    await this.sql.query(
      `update market_listings set status = 'expired'
       where status = 'active' and expires_at <= now()`
    )
  }

  private static readonly LISTING_SELECT = `
    select l.id, l.item_id, l.price, l.created_at, l.expires_at,
           p.user_id as seller_id, p.nickname, p.avatar,
           (select count(*) from market_comments c where c.listing_id = l.id) as comments
    from market_listings l
    join profiles p on p.user_id = l.seller`

  private static listingOf(r: SqlListingRow): MarketListingRow {
    return {
      id: r.id,
      itemId: r.item_id,
      price: Number(r.price),
      seller: { userId: r.seller_id, nickname: r.nickname, avatar: r.avatar },
      createdAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
      comments: Number(r.comments)
    }
  }

  async browseMarket(
    query: MarketBrowseQuery
  ): Promise<{ rows: MarketListingRow[]; total: number }> {
    await this.expireStale()
    // `$1 is null or …` keeps one prepared shape for all four filter combos; the
    // id tiebreak keeps paging stable when two lots share a created_at.
    const where = `where l.status = 'active'
        and ($1::uuid is null or l.seller = $1::uuid)
        and ($2::text is null or starts_with(l.item_id, $2::text))`
    const seller = query.mine ? query.viewerId : null
    const rows = await this.sql.query<SqlListingRow>(
      `${SqlStore.LISTING_SELECT} ${where}
       order by l.created_at desc, l.id
       limit $3 offset $4`,
      [seller, query.prefix, query.limit, query.offset]
    )
    const total = await this.sql.query<{ n: unknown }>(
      `select count(*) as n from market_listings l ${where}`,
      [seller, query.prefix]
    )
    return {
      rows: rows.rows.map(SqlStore.listingOf),
      total: Number(total.rows[0]?.n ?? 0)
    }
  }

  async createListing(
    userId: string,
    itemId: string,
    price: number,
    ttlDays: number,
    maxActive: number
  ): Promise<ListResult> {
    await this.expireStale()
    // One statement again: the guards live in the SELECT that feeds the INSERT,
    // so two tabs racing to list the same item cannot both win — and if they
    // somehow do, the partial unique index refuses the second.
    let inserted: { rows: { id: string }[] }
    try {
      inserted = await this.sql.query<{ id: string }>(
        `insert into market_listings (seller, item_id, price, status, expires_at)
         select $1, $2, $3, 'active', now() + ($4 || ' days')::interval
         where exists (select 1 from purchases p where p.user_id = $1 and p.item_id = $2)
           and not exists (select 1 from market_listings m
                           where m.seller = $1 and m.item_id = $2 and m.status = 'active')
           and (select count(*) from market_listings m
                where m.seller = $1 and m.status = 'active') < $5
         returning id`,
        [userId, itemId, price, String(ttlDays), maxActive]
      )
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return { ok: false, reason: 'listed' }
      throw e
    }
    const id = inserted.rows[0]?.id
    if (id === undefined) {
      // Nothing inserted — say which guard bit, in the order the player would ask.
      const owns = await this.sql.query(
        `select 1 from purchases where user_id = $1 and item_id = $2`,
        [userId, itemId]
      )
      if (owns.rows.length === 0) return { ok: false, reason: 'not_owned' }
      const dupe = await this.sql.query(
        `select 1 from market_listings where seller = $1 and item_id = $2 and status = 'active'`,
        [userId, itemId]
      )
      if (dupe.rows.length > 0) return { ok: false, reason: 'listed' }
      return { ok: false, reason: 'too_many' }
    }
    const row = await this.sql.query<SqlListingRow>(`${SqlStore.LISTING_SELECT} where l.id = $1`, [
      id
    ])
    const found = row.rows[0]
    if (!found) return { ok: false, reason: 'not_owned' }
    return { ok: true, row: SqlStore.listingOf(found) }
  }

  async cancelListing(userId: string, listingId: string): Promise<boolean> {
    const r = await this.sql.query(
      `update market_listings set status = 'cancelled'
       where id = $1 and seller = $2 and status = 'active'
       returning id`,
      [listingId, userId]
    )
    return r.rows.length > 0
  }

  async buyListing(buyerId: string, listingId: string, feeBps: number): Promise<BuyResult> {
    await this.expireStale()
    const pre = await this.sql.query<{ seller: string; status: string }>(
      `select seller, status from market_listings where id = $1`,
      [listingId]
    )
    const lot = pre.rows[0]
    if (!lot || lot.status !== 'active') return { ok: false, reason: 'not_found' }
    if (lot.seller === buyerId) return { ok: false, reason: 'own' }
    // Both wallet rows must exist before the transfer — the start grant is lazy,
    // and an UPDATE against a missing row would silently move nothing.
    await this.getWallet(buyerId)
    await this.getWallet(lot.seller)

    // The whole sale as ONE statement: the Sql boundary has no transaction API,
    // and a sale split across statements could debit a buyer and never deliver.
    // Data-modifying CTEs run exactly once, to completion, against one snapshot,
    // so either every branch below happens or none does. `lot` carries all the
    // guards; if it selects no row, nothing downstream fires.
    const done = await this.sql.query<{ item_id: string; price: unknown }>(
      `with lot as (
         select l.id, l.seller, l.item_id, l.price,
                (l.price * $3::bigint) / 10000 as fee
         from market_listings l
         where l.id = $2 and l.status = 'active' and l.expires_at > now()
           and l.seller <> $1
           and not exists (select 1 from purchases p
                           where p.user_id = $1 and p.item_id = l.item_id)
           and exists (select 1 from wallets w
                       where w.user_id = $1 and w.balance >= l.price)
       ),
       closed as (
         update market_listings m set status = 'sold', buyer = $1, sold_at = now()
         from lot where m.id = lot.id returning m.id
       ),
       debit as (
         update wallets w set balance = w.balance - lot.price, updated_at = now()
         from lot where w.user_id = $1 returning w.user_id
       ),
       credit as (
         update wallets w set balance = w.balance + (lot.price - lot.fee), updated_at = now()
         from lot where w.user_id = lot.seller returning w.user_id
       ),
       gave as (
         delete from purchases p using lot
         where p.user_id = lot.seller and p.item_id = lot.item_id returning p.item_id
       ),
       took as (
         insert into purchases (user_id, item_id, price)
         select $1, lot.item_id, lot.price from lot returning item_id
       ),
       traded as (
         insert into market_trades (listing_id, seller, buyer, item_id, price, fee)
         select lot.id, lot.seller, $1, lot.item_id, lot.price, lot.fee from lot
         returning listing_id
       )
       select lot.item_id, lot.price from lot`,
      [buyerId, listingId, feeBps]
    )
    const sold = done.rows[0]
    if (sold) return { ok: true, itemId: sold.item_id, price: Number(sold.price) }
    // No row = a guard refused. Ask which, in the order the player would.
    const item = await this.sql.query<{ item_id: string; price: unknown }>(
      `select item_id, price from market_listings where id = $1`,
      [listingId]
    )
    const wanted = item.rows[0]
    if (!wanted) return { ok: false, reason: 'not_found' }
    const has = await this.sql.query(
      `select 1 from purchases where user_id = $1 and item_id = $2`,
      [buyerId, wanted.item_id]
    )
    if (has.rows.length > 0) return { ok: false, reason: 'owned' }
    return { ok: false, reason: 'insufficient' }
  }

  async listComments(listingId: string): Promise<MarketCommentRow[]> {
    const r = await this.sql.query<{
      id: string
      body: string
      created_at: string
      user_id: string
      nickname: string
      avatar: string | null
    }>(
      `select c.id, c.body, c.created_at, p.user_id, p.nickname, p.avatar
       from market_comments c join profiles p on p.user_id = c.author
       where c.listing_id = $1 order by c.created_at, c.id`,
      [listingId]
    )
    return r.rows.map((c) => ({
      id: c.id,
      author: { userId: c.user_id, nickname: c.nickname, avatar: c.avatar },
      body: c.body,
      createdAt: new Date(c.created_at).toISOString()
    }))
  }

  async addComment(userId: string, listingId: string, body: string): Promise<boolean> {
    await this.expireStale()
    const r = await this.sql.query(
      `insert into market_comments (listing_id, author, body)
       select $1, $2, $3
       where exists (select 1 from market_listings l where l.id = $1 and l.status = 'active')
       returning id`,
      [listingId, userId, body]
    )
    return r.rows.length > 0
  }

  async lockedItems(userId: string): Promise<string[]> {
    await this.expireStale()
    const r = await this.sql.query<{ item_id: string }>(
      `select item_id from market_listings where seller = $1 and status = 'active'`,
      [userId]
    )
    return r.rows.map((x) => x.item_id)
  }

  async recordDrop(
    gameId: string,
    seat: SeatId,
    userId: string,
    itemId: string | null
  ): Promise<boolean> {
    // Same shape as creditRewards: the ledger insert gates the grant, so a
    // recovered game reaching `finished` twice cannot drop twice. price 0 marks
    // it earned rather than bought.
    const rolled = await this.sql.query<{ item_id: string | null }>(
      `insert into item_drops (game_id, seat, user_id, item_id)
       values ($1, $2, $3, $4)
       on conflict (game_id, seat) do nothing
       returning item_id`,
      [gameId, seat, userId, itemId]
    )
    if (rolled.rows.length === 0) return false
    if (itemId !== null)
      await this.sql.query(
        `insert into purchases (user_id, item_id, price) values ($1, $2, 0)
         on conflict do nothing`,
        [userId, itemId]
      )
    return true
  }

  async savePushToken(userId: string, token: string, platform: string): Promise<void> {
    await this.sql.query(
      `insert into push_tokens (token, user_id, platform, updated_at) values ($1, $2, $3, now())
       on conflict (token) do update set user_id = excluded.user_id,
         platform = excluded.platform, updated_at = now()`,
      [token, userId, platform]
    )
  }

  async deletePushToken(token: string): Promise<void> {
    await this.sql.query(`delete from push_tokens where token = $1`, [token])
  }

  async deleteUserPushTokens(userId: string): Promise<void> {
    await this.sql.query(`delete from push_tokens where user_id = $1`, [userId])
  }

  async loadPushTokens(userId: string): Promise<string[]> {
    const r = await this.sql.query<{ token: string }>(
      `select token from push_tokens where user_id = $1`,
      [userId]
    )
    return r.rows.map((row) => row.token)
  }

  async loadMatchHistory(userId: string, limit: number): Promise<HistoryEntry[]> {
    const r = await this.sql.query<{
      game_id: string
      mode: Mode
      status: 'finished' | 'aborted'
      seat: number
      result: 'win' | 'lose' | 'eliminated' | null
      final_vp: number | null
      rating_before: number | null
      rating_after: number | null
      finished_at: Date | string | null
      starred: boolean
    }>(
      `select mh.game_id, mh.mode, mh.status, mh.seat, mh.result, mh.final_vp,
              mh.rating_before, mh.rating_after, mh.finished_at,
              exists (select 1 from replay_stars rs
                      where rs.user_id = mh.user_id and rs.game_id = mh.game_id) as starred
       from match_history mh where mh.user_id = $1
       order by mh.finished_at desc nulls last limit $2`,
      [userId, limit]
    )
    return r.rows.map((row) => ({
      gameId: row.game_id,
      mode: row.mode,
      status: row.status,
      seat: row.seat as SeatId,
      result: row.result,
      finalVp: row.final_vp === null ? null : Number(row.final_vp),
      ratingBefore: row.rating_before === null ? null : Number(row.rating_before),
      ratingAfter: row.rating_after === null ? null : Number(row.rating_after),
      finishedAt:
        row.finished_at === null
          ? null
          : typeof row.finished_at === 'string'
            ? new Date(row.finished_at).toISOString()
            : row.finished_at.toISOString(),
      starred: row.starred
    }))
  }

  async loadModeRecord(userId: string): Promise<ModeRecord> {
    // One grouped scan of this user's seats (game_players_user_idx), so the
    // record stays cheap however long the archive gets. Not the match_history
    // view: that one has no is_private column, and the categories need it.
    //
    // The CASE mirrors recordCategoryOf() in store.ts — same order, same
    // meaning. The WHERE drops what counts nowhere: tutorial games (a lesson
    // that always ends in a forfeit) and seats with no verdict (result null or
    // 'aborted' = a lobby that died). 'eliminated' lands in `losses` with
    // 'lose', which is what makes played = wins + losses hold.
    const r = await this.sql.query<{ category: RecordCategory; wins: unknown; losses: unknown }>(
      `select case
                when g.mode = 'vs_bots'  then 'bots'
                when g.is_private        then 'private'
                when g.mode = '2v2'      then 'team'
                else 'ranked'
              end as category,
              count(*) filter (where gp.result = 'win') as wins,
              count(*) filter (where gp.result in ('lose', 'eliminated')) as losses
       from game_players gp
       join games g on g.id = gp.game_id
       where gp.user_id = $1
         and g.mode <> 'tutorial'
         and gp.result in ('win', 'lose', 'eliminated')
       group by 1`,
      [userId]
    )
    const record = emptyModeRecord()
    for (const row of r.rows) {
      const bucket: CategoryRecord | undefined = record[row.category]
      if (!bucket) continue // a mode we do not classify yet — never silently miscounted
      bucket.wins = Number(row.wins)
      bucket.losses = Number(row.losses)
      bucket.played = bucket.wins + bucket.losses
    }
    return record
  }

  async loadModeRecords(userIds: string[]): Promise<Map<string, ModeRecord>> {
    const out = new Map<string, ModeRecord>(userIds.map((id) => [id, emptyModeRecord()]))
    if (userIds.length === 0) return out
    // loadModeRecord's query with the user in the GROUP BY — same CASE, same
    // WHERE, same meaning; see the comment there for why each clause is present.
    const r = await this.sql.query<{
      user_id: string
      category: RecordCategory
      wins: unknown
      losses: unknown
    }>(
      `select gp.user_id,
              case
                when g.mode = 'vs_bots'  then 'bots'
                when g.is_private        then 'private'
                when g.mode = '2v2'      then 'team'
                else 'ranked'
              end as category,
              count(*) filter (where gp.result = 'win') as wins,
              count(*) filter (where gp.result in ('lose', 'eliminated')) as losses
       from game_players gp
       join games g on g.id = gp.game_id
       where gp.user_id = any($1::uuid[])
         and g.mode <> 'tutorial'
         and gp.result in ('win', 'lose', 'eliminated')
       group by 1, 2`,
      [userIds]
    )
    for (const row of r.rows) {
      const record = out.get(row.user_id)
      const bucket: CategoryRecord | undefined = record?.[row.category]
      if (!bucket) continue
      bucket.wins = Number(row.wins)
      bucket.losses = Number(row.losses)
      bucket.played = bucket.wins + bucket.losses
    }
    return out
  }

  async loadPlayCounts(userId: string): Promise<PlayCounts> {
    // loadModeRecord's scan at a finer grain: the CASE mirrors playCategoryOf()
    // in protocol achievements.ts — same order, same meaning; change one, change
    // both. The WHERE is loadModeRecord's, verbatim in meaning: tutorial games
    // count nowhere (a lesson, with its own badge), and a seat with no verdict
    // (null or 'aborted') was never a game played. Public 2v2 falls out as null
    // in the CASE and is dropped below, exactly as playCategoryOf returns null.
    const r = await this.sql.query<{
      category: PlayCategory | null
      played: unknown
      wins: unknown
    }>(
      `select case
                when g.mode = 'vs_bots' then 'bots'
                when g.is_private       then 'private.' || g.mode
                when g.mode = '2v2'     then null
                else 'ranked.' || g.mode
              end as category,
              count(*) as played,
              count(*) filter (where gp.result = 'win') as wins
       from game_players gp
       join games g on g.id = gp.game_id
       where gp.user_id = $1
         and g.mode <> 'tutorial'
         and gp.result in ('win', 'lose', 'eliminated')
       group by 1`,
      [userId]
    )
    const counts = emptyPlayCounts()
    for (const row of r.rows) {
      const bucket = row.category === null ? undefined : counts[row.category]
      if (!bucket) continue // a category we do not count yet — never miscounted
      bucket.played = Number(row.played)
      bucket.wins = Number(row.wins)
    }
    return counts
  }

  async loadAchievements(userId: string): Promise<EarnedAchievement[]> {
    const r = await this.sql.query<{ achievement_id: string; earned_at: Date | string }>(
      `select achievement_id, earned_at from achievements
       where user_id = $1 order by earned_at, achievement_id`,
      [userId]
    )
    return r.rows.map((row) => ({
      id: row.achievement_id,
      earnedAt:
        typeof row.earned_at === 'string'
          ? new Date(row.earned_at).toISOString()
          : row.earned_at.toISOString()
    }))
  }

  async awardAchievements(userId: string, ids: string[], gameId: string | null): Promise<string[]> {
    if (ids.length === 0) return []
    // One statement: the primary key decides. A badge the user already holds
    // conflicts and is skipped, so earned_at keeps pointing at the first time —
    // which is what makes "first win" correct while being granted on every win.
    // RETURNING therefore yields exactly the badges that are new.
    const r = await this.sql.query<{ achievement_id: string }>(
      `insert into achievements (user_id, achievement_id, game_id)
       select $1, id, $3 from unnest($2::text[]) as id
       on conflict (user_id, achievement_id) do nothing
       returning achievement_id`,
      [userId, ids, gameId]
    )
    return r.rows.map((row) => row.achievement_id)
  }

  async loadRatings(mode: string, userIds: string[]): Promise<Map<string, RatingRow>> {
    if (userIds.length === 0) return new Map()
    const r = await this.sql.query<{
      user_id: string
      rating: number
      rd: number
      volatility: number
      games: number
    }>(
      `select user_id, rating, rd, volatility, games from ratings
       where mode = $1 and user_id = any($2::uuid[])`,
      [mode, userIds]
    )
    return new Map(
      r.rows.map((row) => [
        row.user_id,
        {
          rating: Number(row.rating),
          rd: Number(row.rd),
          volatility: Number(row.volatility),
          games: Number(row.games)
        }
      ])
    )
  }

  async saveRatings(gameId: string, mode: string, writes: RatingWrite[]): Promise<void> {
    for (const w of writes) {
      await this.sql.query(
        `insert into ratings (user_id, mode, rating, rd, volatility, games, updated_at)
         values ($1, $2, $3, $4, $5, 1, now())
         on conflict (user_id, mode) do update
           set rating = excluded.rating, rd = excluded.rd, volatility = excluded.volatility,
               games = ratings.games + 1, updated_at = now()`,
        [w.userId, mode, w.after.rating, w.after.rd, w.after.volatility]
      )
      await this.sql.query(
        `update game_players set rating_before = $3, rating_after = $4
         where game_id = $1 and seat = $2`,
        [gameId, w.seat, w.ratingBefore, w.after.rating]
      )
    }
  }
}

/** Postgres `unique_violation`. node-postgres and PGlite both carry `code`;
 *  the message check is the belt to that braces. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  if (code === '23505') return true
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && /duplicate key value|unique constraint/i.test(message)
}

export class SqlProfileStore implements ProfileStore {
  constructor(private readonly sql: Sql) {}

  async exists(userId: string): Promise<boolean> {
    return (
      (await this.sql.query('select 1 from profiles where user_id = $1', [userId])).rows.length > 0
    )
  }

  async getOrCreate(userId: string, _email: string | null = null): Promise<Profile> {
    const existing = await this.load(userId)
    if (existing) return existing
    for (let attempt = 0; attempt < 4; attempt++) {
      const nickname =
        attempt === 0
          ? defaultNickname(userId)
          : `${defaultNickname(userId).slice(0, 13)}${randomBytes(2).toString('hex')}`
      try {
        await this.sql.query(
          `insert into profiles (user_id, nickname) values ($1, $2)
           on conflict (user_id) do nothing`,
          [userId, nickname]
        )
        const created = await this.load(userId)
        if (created) return created
      } catch {
        // nickname collision — retry with a random suffix
      }
    }
    throw new Error(`could not create a profile for ${userId}`)
  }

  async rename(userId: string, nickname: string): Promise<RenameResult> {
    const clash = await this.sql.query(
      `select 1 from profiles where lower(nickname) = lower($1) and user_id <> $2`,
      [nickname, userId]
    )
    if (clash.rows.length > 0) return 'taken'
    try {
      await this.sql.query(`update profiles set nickname = $2 where user_id = $1`, [
        userId,
        nickname
      ])
    } catch (error) {
      // Lost the race to profiles_nickname_lower_idx between the check and the
      // write — that, and only that, is a taken name. Anything else (a dropped
      // connection, a revoked grant) has to surface as an internal error rather
      // than as a lie about the name.
      if (!isUniqueViolation(error)) throw error
      return 'taken'
    }
    const updated = await this.load(userId)
    if (!updated) throw new Error(`profile vanished mid-rename: ${userId}`)
    return updated
  }

  async setAvatar(userId: string, avatar: string | null): Promise<Profile> {
    await this.sql.query(`update profiles set avatar = $2 where user_id = $1`, [userId, avatar])
    const updated = await this.load(userId)
    if (!updated) throw new Error(`profile vanished mid-avatar-update: ${userId}`)
    return updated
  }

  async setWardrobe(userId: string, wardrobe: Wardrobe | null): Promise<Profile> {
    await this.sql.query(`update profiles set wardrobe = $2::jsonb where user_id = $1`, [
      userId,
      wardrobe === null ? null : JSON.stringify(wardrobe)
    ])
    const updated = await this.load(userId)
    if (!updated) throw new Error(`profile vanished mid-wardrobe-update: ${userId}`)
    return updated
  }

  async listProfiles(q: {
    query: string | null
    limit: number
    offset: number
  }): Promise<{ rows: Profile[]; total: number }> {
    // The search is a case-insensitive substring. `%` and `_` in a nickname are
    // impossible (the charset is letters/digits/-_()[]<>, and `_` is escaped
    // below), but escaping is cheaper than trusting that to stay true.
    const like = q.query === null ? null : `%${q.query.replace(/[%_\\]/g, '\\$&')}%`
    const count = await this.sql.query<{ total: number }>(
      `select count(*)::int as total from profiles
       where $1::text is null or nickname ilike $1 escape '\\'`,
      [like]
    )
    const r = await this.sql.query<{
      user_id: string
      nickname: string
      avatar: string | null
      wardrobe: Wardrobe | null
    }>(
      `select user_id, nickname, avatar, wardrobe from profiles
       where $1::text is null or nickname ilike $1 escape '\\'
       order by created_at, user_id
       limit $2 offset $3`,
      [like, q.limit, q.offset]
    )
    return {
      rows: r.rows.map((row) => ({
        userId: row.user_id,
        nickname: row.nickname,
        avatar: row.avatar,
        wardrobe: row.wardrobe
      })),
      total: count.rows[0]?.total ?? 0
    }
  }

  async findByNickname(nickname: string): Promise<Profile | null> {
    const r = await this.sql.query<{
      user_id: string
      nickname: string
      avatar: string | null
      wardrobe: Wardrobe | null
    }>(
      `select user_id, nickname, avatar, wardrobe from profiles
       where lower(nickname) = lower($1)`,
      [nickname]
    )
    const row = r.rows[0]
    return row
      ? { userId: row.user_id, nickname: row.nickname, avatar: row.avatar, wardrobe: row.wardrobe }
      : null
  }

  private async load(userId: string): Promise<Profile | null> {
    const r = await this.sql.query<{
      user_id: string
      nickname: string
      avatar: string | null
      wardrobe: Wardrobe | null
    }>(`select user_id, nickname, avatar, wardrobe from profiles where user_id = $1`, [userId])
    const row = r.rows[0]
    return row
      ? { userId: row.user_id, nickname: row.nickname, avatar: row.avatar, wardrobe: row.wardrobe }
      : null
  }
}
