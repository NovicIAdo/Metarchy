// SQL-backed ChatStore over the minimal Sql boundary (pg or PGlite), mirroring
// MemoryChatStore in chat.ts method for method — test/chat.test.ts runs one
// contract against both, the SQL one on the real supabase/migrations schema
// under the restricted `metarchy_server` role.
//
// Counters are never stored. Every read counts the reaction and flag rows it
// needs, so a like can neither be lost nor double-counted, and the author's
// "10 flags from 10 different players" is literally `count(*)` over a table
// whose primary key is (message, flagger).

import type {
  ChatAuthorView,
  ChatConversation,
  ChatCounts,
  ChatMessageEntry,
  ChatReaction,
  ChatSort
} from '@metarchy/protocol'
import { CHAT_FLAG_HIDE_THRESHOLD, CHAT_GLOBAL_COOLDOWN_MS } from '@metarchy/protocol'
import type {
  ChatMessageRef,
  ChatPageQuery,
  ChatPostInput,
  ChatPostResult,
  ChatStore
} from './chat.js'
import { GLOBAL_ROOM, tombstone } from './chat.js'
import type { Sql } from './db.js'

interface MessageRow {
  id: string
  parent_id: string | null
  author_id: string
  nickname: string
  avatar: string | null
  body: string
  created_at: Date | string
  hidden: boolean
  likes: unknown
  dislikes: unknown
  flags: unknown
  replies: unknown
  my_reaction: ChatReaction | null
  flagged_by_me: boolean
}

/**
 * Everything a message needs to render, counted per row. Correlated subqueries
 * rather than a grouped join: a page is 30 rows, each count is an index probe,
 * and this keeps `order by likes` able to name the output column.
 */
const MESSAGE_COLUMNS = `
  m.id, m.parent_id, m.author_id, p.nickname, p.avatar, m.body, m.created_at,
  (m.hidden_at is not null) as hidden,
  (select count(*) from chat_reactions x where x.message_id = m.id and x.reaction = 'like') as likes,
  (select count(*) from chat_reactions x where x.message_id = m.id and x.reaction = 'dislike') as dislikes,
  (select count(*) from chat_flags x where x.message_id = m.id) as flags,
  (select count(*) from chat_messages c where c.parent_id = m.id and c.hidden_at is null) as replies,
  (select x.reaction from chat_reactions x where x.message_id = m.id and x.user_id = $2::uuid) as my_reaction,
  exists (select 1 from chat_flags x where x.message_id = m.id and x.user_id = $2::uuid) as flagged_by_me
`

/** See chat.ts: a flagged-away parent stays servable while a visible reply hangs off it. */
const SERVABLE = `(
  m.hidden_at is null
  or exists (select 1 from chat_messages c where c.parent_id = m.id and c.hidden_at is null)
)`

/** The author's sort switch — top-level only; threads are chronological. Newest
    sits at the BOTTOM (the stream reads top-to-bottom like a chat, not a feed),
    so every order ends with the oldest first. */
function orderBy(sort: ChatSort): string {
  if (sort === 'likes') return 'likes desc, m.created_at asc'
  if (sort === 'dislikes') return 'dislikes desc, m.created_at asc'
  return 'm.created_at asc'
}

const iso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString()

export class SqlChatStore implements ChatStore {
  constructor(private readonly sql: Sql) {}

  /** `profiles` is the directory here — nothing to remember. */
  remember(): void {}

  async post(input: ChatPostInput): Promise<ChatPostResult> {
    // One statement: the rolling-window test rides inside the INSERT, so a
    // second message cannot slip past between a check and a write. Deriving the
    // window from the persisted rows is the whole point — a reconnect or a
    // restart leaves the same rows behind, so it cannot buy a fresh minute.
    const written = await this.sql.query<{ created_at: Date | string }>(
      `insert into chat_messages (id, room, author_id, recipient_id, parent_id, body)
       select $1::uuid, $2::text, $3::uuid, $4::uuid, $5::uuid, $6::text
       where $7::double precision = 0
          or not exists (
               select 1 from chat_messages m
               where m.room = $2::text and m.author_id = $3::uuid
                 and m.created_at > now() - ($7::double precision * interval '1 millisecond')
             )
       returning created_at`,
      [
        input.id,
        input.room,
        input.authorId,
        input.recipientId,
        input.parentId,
        input.body,
        input.cooldownMs
      ]
    )
    const createdAt = written.rows[0]?.created_at
    if (createdAt === undefined) {
      const remaining = await this.cooldownMs(input.authorId, input.room, input.cooldownMs)
      // Never report "0 ms, try again" for a refusal — round up to a second.
      return { ok: false, retryInMs: Math.max(1000, remaining) }
    }
    const row = await this.loadOne(input.id, input.authorId)
    if (!row) throw new Error(`chat message vanished right after insert: ${input.id}`)
    return { ok: true, entry: row }
  }

  async listTopLevel(query: ChatPageQuery): Promise<{ rows: ChatMessageEntry[]; total: number }> {
    const page = await this.sql.query<MessageRow>(
      `select ${MESSAGE_COLUMNS}
       from chat_messages m
       join profiles p on p.user_id = m.author_id
       where m.room = $1::text and m.parent_id is null and ${SERVABLE}
       order by ${orderBy(query.sort)}
       limit $3 offset $4`,
      [query.room, query.viewerId, query.limit, query.offset]
    )
    // Counted with the same SERVABLE predicate as the page, so "show more" can
    // never promise a message the page would refuse to serve.
    const total = await this.sql.query<{ n: unknown }>(
      `select count(*) as n from chat_messages m
       where m.room = $1::text and m.parent_id is null and ${SERVABLE}`,
      [query.room]
    )
    return {
      rows: page.rows.map((r) => shape(r, query.viewerId)),
      total: Number(total.rows[0]?.n ?? 0)
    }
  }

  async listReplies(parentId: string, viewerId: string): Promise<ChatMessageEntry[]> {
    // Chronological, always — the sort switch ranks the room, not a thread.
    // A flagged-away reply is simply gone: nothing hangs off it.
    const r = await this.sql.query<MessageRow>(
      `select ${MESSAGE_COLUMNS}
       from chat_messages m
       join profiles p on p.user_id = m.author_id
       where m.parent_id = $1::uuid and m.hidden_at is null
       order by m.created_at asc`,
      [parentId, viewerId]
    )
    return r.rows.map((row) => shape(row, viewerId))
  }

  async loadRef(messageId: string): Promise<ChatMessageRef | null> {
    const r = await this.sql.query<{
      id: string
      room: string
      parent_id: string | null
      hidden: boolean
    }>(
      `select id, room, parent_id, (hidden_at is not null) as hidden
       from chat_messages where id = $1::uuid`,
      [messageId]
    )
    const row = r.rows[0]
    return row ? { id: row.id, room: row.room, parentId: row.parent_id, hidden: row.hidden } : null
  }

  async react(
    messageId: string,
    userId: string,
    reaction: ChatReaction
  ): Promise<ChatCounts | null> {
    const ref = await this.loadRef(messageId)
    if (!ref || ref.hidden) return null
    // The same reaction again clears it (a like is a toggle); the other one
    // switches. The primary key (message_id, user_id) is what forbids holding
    // both and forbids stacking either.
    const cleared = await this.sql.query(
      `delete from chat_reactions
       where message_id = $1::uuid and user_id = $2::uuid and reaction = $3
       returning user_id`,
      [messageId, userId, reaction]
    )
    if (cleared.rows.length === 0)
      await this.sql.query(
        `insert into chat_reactions (message_id, user_id, reaction) values ($1::uuid, $2::uuid, $3)
         on conflict (message_id, user_id)
         do update set reaction = excluded.reaction, created_at = now()`,
        [messageId, userId, reaction]
      )
    return this.counts(messageId, userId)
  }

  async flag(messageId: string, userId: string): Promise<ChatCounts | null> {
    const ref = await this.loadRef(messageId)
    if (!ref || ref.hidden) return null
    // A repeat flag from the same player hits the primary key and does nothing:
    // the author's threshold counts PLAYERS, so ten flags from one are one.
    await this.sql.query(
      `insert into chat_flags (message_id, user_id) values ($1::uuid, $2::uuid)
       on conflict do nothing`,
      [messageId, userId]
    )
    // Soft removal: the row stays (moderation trail) and keeps anchoring its
    // thread; listTopLevel serves it as a tombstone, listReplies drops it.
    await this.sql.query(
      `update chat_messages set hidden_at = now()
       where id = $1::uuid and hidden_at is null
         and (select count(*) from chat_flags x where x.message_id = $1::uuid) >= $2`,
      [messageId, CHAT_FLAG_HIDE_THRESHOLD]
    )
    return this.counts(messageId, userId)
  }

  async listConversations(userId: string): Promise<ChatConversation[]> {
    const r = await this.sql.query<{
      peer_id: string
      nickname: string
      avatar: string | null
      body: string
      created_at: Date | string
      hidden: boolean
      mine: boolean
    }>(
      `select last.peer_id, p.nickname, p.avatar, last.body, last.created_at,
              last.hidden, last.mine
       from (
         select distinct on (m.room)
                m.room,
                case when m.author_id = $1::uuid then m.recipient_id else m.author_id end as peer_id,
                m.body, m.created_at,
                (m.hidden_at is not null) as hidden,
                (m.author_id = $1::uuid) as mine
         from chat_messages m
         where m.recipient_id is not null
           and (m.author_id = $1::uuid or m.recipient_id = $1::uuid)
         order by m.room, m.created_at desc
       ) as last
       join profiles p on p.user_id = last.peer_id
       order by last.created_at desc`,
      [userId]
    )
    return r.rows.map((row) => ({
      peer: { userId: row.peer_id, nickname: row.nickname, avatar: row.avatar },
      lastBody: row.hidden ? '' : row.body,
      lastAt: iso(row.created_at),
      lastMine: row.mine
    }))
  }

  async findPeer(by: { userId: string } | { nickname: string }): Promise<ChatAuthorView | null> {
    const r =
      'userId' in by
        ? await this.sql.query<{ user_id: string; nickname: string; avatar: string | null }>(
            `select user_id, nickname, avatar from profiles where user_id = $1::uuid`,
            [by.userId]
          )
        : await this.sql.query<{ user_id: string; nickname: string; avatar: string | null }>(
            // Nicknames are unique case-insensitively (profiles_nickname_lower_idx).
            `select user_id, nickname, avatar from profiles where lower(nickname) = lower($1)`,
            [by.nickname]
          )
    const row = r.rows[0]
    return row ? { userId: row.user_id, nickname: row.nickname, avatar: row.avatar } : null
  }

  async globalCooldownMs(userId: string): Promise<number> {
    return this.cooldownMs(userId, GLOBAL_ROOM, CHAT_GLOBAL_COOLDOWN_MS)
  }

  async isBlocked(userId: string, peerId: string): Promise<boolean> {
    const r = await this.sql.query<{ n: unknown }>(
      `select 1 as n from chat_blocks where blocker = $1::uuid and blocked = $2::uuid`,
      [userId, peerId]
    )
    return r.rows.length > 0
  }

  async setBlocked(userId: string, peerId: string, blocked: boolean): Promise<boolean> {
    if (blocked)
      await this.sql.query(
        `insert into chat_blocks (blocker, blocked) values ($1::uuid, $2::uuid) on conflict do nothing`,
        [userId, peerId]
      )
    else
      await this.sql.query(
        `delete from chat_blocks where blocker = $1::uuid and blocked = $2::uuid`,
        [userId, peerId]
      )
    return blocked
  }

  async hasUnreadDm(userId: string): Promise<boolean> {
    // A DM is unread when the newest message addressed TO me is newer than my
    // latest read cursor. One aggregate; no cursor yet means everything unread.
    const r = await this.sql.query<{ unread: boolean }>(
      `select coalesce((
         select max(m.created_at) from chat_messages m
         where m.recipient_id = $1::uuid and m.hidden_at is null
       ) > coalesce((
         select max(r.read_at) from chat_reads r where r.user_id = $1::uuid
       ), '-infinity'::timestamptz), false) as unread`,
      [userId]
    )
    return r.rows[0]?.unread ?? false
  }

  async markAllDmRead(userId: string): Promise<void> {
    // One cursor per DM room I participate in, bumped to now.
    await this.sql.query(
      `insert into chat_reads (user_id, room, read_at)
       select distinct $1::uuid, m.room, now()
       from chat_messages m
       where m.recipient_id = $1::uuid
       on conflict (user_id, room) do update set read_at = excluded.read_at`,
      [userId]
    )
  }

  /** Read off the persisted rows, using the DB clock for both ends. */
  private async cooldownMs(userId: string, room: string, windowMs: number): Promise<number> {
    if (windowMs <= 0) return 0
    const r = await this.sql.query<{ ms: unknown }>(
      `select coalesce(
                extract(epoch from (
                  max(m.created_at) + ($3::double precision * interval '1 millisecond') - now()
                )) * 1000,
                0) as ms
       from chat_messages m
       where m.author_id = $1::uuid and m.room = $2::text`,
      [userId, room, windowMs]
    )
    return Math.max(0, Math.ceil(Number(r.rows[0]?.ms ?? 0)))
  }

  private async loadOne(messageId: string, viewerId: string): Promise<ChatMessageEntry | null> {
    const r = await this.sql.query<MessageRow>(
      `select ${MESSAGE_COLUMNS}
       from chat_messages m
       join profiles p on p.user_id = m.author_id
       where m.id = $1::uuid`,
      [messageId, viewerId]
    )
    const row = r.rows[0]
    return row ? shape(row, viewerId) : null
  }

  private async counts(messageId: string, viewerId: string): Promise<ChatCounts | null> {
    const entry = await this.loadOne(messageId, viewerId)
    if (!entry) return null
    return {
      messageId,
      likes: entry.likes,
      dislikes: entry.dislikes,
      myReaction: entry.myReaction,
      flags: entry.flags,
      flaggedByMe: entry.flaggedByMe,
      removed: entry.removed
    }
  }
}

function shape(row: MessageRow, viewerId: string): ChatMessageEntry {
  const entry: ChatMessageEntry = {
    id: row.id,
    parentId: row.parent_id,
    author: { userId: row.author_id, nickname: row.nickname, avatar: row.avatar },
    body: row.body,
    createdAt: iso(row.created_at),
    likes: Number(row.likes ?? 0),
    dislikes: Number(row.dislikes ?? 0),
    myReaction: row.my_reaction,
    flags: Number(row.flags ?? 0),
    flaggedByMe: row.flagged_by_me,
    replyCount: row.parent_id === null ? Number(row.replies ?? 0) : 0,
    mine: row.author_id === viewerId,
    removed: false
  }
  return row.hidden ? tombstone(entry) : entry
}
