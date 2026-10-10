// Persisted chat (author backlog #3). Two halves:
//  - the ChatStore contract, run against BOTH backends — MemoryChatStore and the
//    SQL one over embedded Postgres with the real supabase/migrations schema
//    under the restricted `metarchy_server` role (that is what catches a missing
//    GRANT);
//  - the gateway, over a real socket, for the two things only the wire can prove:
//    that the one-per-minute rule survives a reconnect, and that a third player
//    cannot reach into somebody else's private conversation.

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { CHAT_BODY_MAX, CHAT_FLAG_HIDE_THRESHOLD } from '@metarchy/protocol'
import type { ChatStore } from '../src/chat.js'
import { dmRoomKey, GLOBAL_ROOM, MemoryChatStore } from '../src/chat.js'
import { SqlChatStore } from '../src/chat-sql.js'
import { makePgliteSql, migrate } from '../src/db.js'
import { SqlProfileStore } from '../src/store-sql.js'
import { connectAs, startTestServer, type TestClient, type TestServer } from './helpers.js'

const MINUTE = 60_000

interface Backend {
  chat: ChatStore
  /** A player the backend can attribute messages to (SQL needs a profiles row). */
  seed(nickname: string): Promise<string>
  /**
   * A fresh store over the same data — stands in for a reconnect or a restart.
   * The memory backend IS its own persistence, so it returns itself.
   */
  reopen(): ChatStore
  close(): Promise<void>
}

const backends: [string, () => Promise<Backend>][] = [
  [
    'MemoryChatStore',
    async () => {
      const chat = new MemoryChatStore()
      return {
        chat,
        async seed(nickname) {
          const userId = randomUUID()
          chat.remember({ userId, nickname, avatar: null })
          return userId
        },
        reopen: () => chat,
        close: async () => {}
      }
    }
  ],
  [
    'SqlChatStore over PGlite',
    async () => {
      const sql = await makePgliteSql('memory://')
      await migrate(sql)
      // The production role, not the superuser — a missing grant fails here.
      await sql.exec('set role metarchy_server')
      const profiles = new SqlProfileStore(sql)
      return {
        chat: new SqlChatStore(sql),
        async seed(nickname) {
          const userId = randomUUID()
          await profiles.getOrCreate(userId, null)
          await profiles.rename(userId, nickname)
          return userId
        },
        reopen: () => new SqlChatStore(sql),
        close: () => sql.close()
      }
    }
  ]
]

/** Post to the global room with the author's one-per-minute window in force. */
const globalPost = (authorId: string, body: string, parentId: string | null = null) => ({
  id: randomUUID(),
  room: GLOBAL_ROOM,
  authorId,
  recipientId: null,
  parentId,
  body,
  cooldownMs: MINUTE
})

describe.each(backends)('ChatStore contract: %s', (_name, make) => {
  it('threads are exactly one level deep and read chronologically', async () => {
    const { chat, seed, close } = await make()
    try {
      const asa = await seed('Asa')
      const ann = await seed('Ann')
      const root = await chat.post(globalPost(asa, 'the Politician deadlock is a trap'))
      if (!root.ok) throw new Error('root refused')
      // Ann replies, then Asa replies TO THE REPLY. The hub re-parents that to
      // the same top-level message, so the store only ever sees one level.
      const first = await chat.post({
        ...globalPost(ann, 'only if both stand still'),
        parentId: root.entry.id,
        cooldownMs: 0
      })
      if (!first.ok) throw new Error('reply refused')
      const ref = await chat.loadRef(first.entry.id)
      expect(ref?.parentId).toBe(root.entry.id)
      const second = await chat.post({
        ...globalPost(asa, 'that is the trap'),
        // What the hub computes for "reply to a reply": ref.parentId ?? ref.id.
        parentId: ref?.parentId ?? first.entry.id,
        cooldownMs: 0
      })
      if (!second.ok) throw new Error('second reply refused')

      const thread = await chat.listReplies(root.entry.id, asa)
      expect(thread.map((m) => m.body)).toEqual(['only if both stand still', 'that is the trap'])
      expect(thread.every((m) => m.parentId === root.entry.id)).toBe(true)
      // Replies never carry a reply count of their own — there is no level 2.
      expect(thread.map((m) => m.replyCount)).toEqual([0, 0])
      // Own on the left, others on the right: `mine` is per reader.
      expect(thread.map((m) => m.mine)).toEqual([false, true])

      const page = await chat.listTopLevel({
        room: GLOBAL_ROOM,
        viewerId: ann,
        sort: 'new',
        limit: 30,
        offset: 0
      })
      // A thread hangs off its parent; it does not litter the room page.
      expect(page.rows).toHaveLength(1)
      expect(page.total).toBe(1)
      expect(page.rows[0]?.replyCount).toBe(2)
      expect(page.rows[0]?.author?.nickname).toBe('Asa')
    } finally {
      await close()
    }
  })

  it('the one-per-minute global rule is read from the rows, so a restart cannot reset it', async () => {
    const { chat, seed, reopen, close } = await make()
    try {
      const asa = await seed('Asa')
      expect(await chat.globalCooldownMs(asa)).toBe(0)
      const first = await chat.post(globalPost(asa, 'first'))
      expect(first.ok).toBe(true)

      const second = await chat.post(globalPost(asa, 'second, too soon'))
      expect(second.ok).toBe(false)
      if (second.ok) throw new Error('unreachable')
      expect(second.retryInMs).toBeGreaterThan(0)
      expect(second.retryInMs).toBeLessThanOrEqual(MINUTE)

      // A brand-new store over the same data — the shape of a server restart or
      // a reconnect. An in-memory per-session timestamp would have vanished; the
      // messages did not.
      const reopened = reopen()
      const third = await reopened.post(globalPost(asa, 'after a restart'))
      expect(third.ok).toBe(false)
      expect(await reopened.globalCooldownMs(asa)).toBeGreaterThan(0)

      // Somebody else is not held back by my minute…
      const ann = await seed('Ann')
      expect((await chat.post(globalPost(ann, 'my turn'))).ok).toBe(true)
      // …and a DM is not rate-limited at all (the rule is about the room
      // everybody reads).
      const dm = await chat.post({
        id: randomUUID(),
        room: dmRoomKey(asa, ann),
        authorId: asa,
        recipientId: ann,
        parentId: null,
        body: 'private, unlimited',
        cooldownMs: 0
      })
      expect(dm.ok).toBe(true)
    } finally {
      await close()
    }
  })

  it('ten DIFFERENT flaggers remove a message; ten flags from one player do not', async () => {
    const { chat, seed, close } = await make()
    try {
      const asa = await seed('Asa')
      const posted = await chat.post(globalPost(asa, 'something worth flagging'))
      if (!posted.ok) throw new Error('post refused')
      const id = posted.entry.id

      const zealot = await seed('Zealot')
      for (let i = 0; i < CHAT_FLAG_HIDE_THRESHOLD; i++) {
        const counts = await chat.flag(id, zealot)
        // The (message, flagger) key makes every repeat a no-op.
        expect(counts?.flags).toBe(1)
        expect(counts?.removed).toBe(false)
      }

      // Nine more distinct players: one flag short, still visible.
      const flaggers = [zealot]
      for (let i = 1; i < CHAT_FLAG_HIDE_THRESHOLD; i++) flaggers.push(await seed(`flagger${i}`))
      for (const f of flaggers.slice(1, -1)) await chat.flag(id, f)
      expect((await chat.loadRef(id))?.hidden).toBe(false)

      const last = await chat.flag(id, flaggers[flaggers.length - 1] as string)
      expect(last?.flags).toBe(CHAT_FLAG_HIDE_THRESHOLD)
      expect(last?.removed).toBe(true)
      expect((await chat.loadRef(id))?.hidden).toBe(true)

      // Removed means unservable, not deleted: with no replies underneath it,
      // the room page drops it entirely.
      const page = await chat.listTopLevel({
        room: GLOBAL_ROOM,
        viewerId: asa,
        sort: 'new',
        limit: 30,
        offset: 0
      })
      expect(page.rows).toHaveLength(0)
      expect(page.total).toBe(0)
      // And it is no longer interactive.
      expect(await chat.flag(id, await seed('late'))).toBeNull()
      expect(await chat.react(id, asa, 'like')).toBeNull()
    } finally {
      await close()
    }
  })

  it('a flagged-away parent survives as a tombstone so its thread stays readable', async () => {
    const { chat, seed, close } = await make()
    try {
      const asa = await seed('Asa')
      const ann = await seed('Ann')
      const root = await chat.post(globalPost(asa, 'the message that gets removed'))
      if (!root.ok) throw new Error('post refused')
      const reply = await chat.post({
        ...globalPost(ann, 'a reply worth keeping'),
        parentId: root.entry.id,
        cooldownMs: 0
      })
      if (!reply.ok) throw new Error('reply refused')

      for (let i = 0; i < CHAT_FLAG_HIDE_THRESHOLD; i++)
        await chat.flag(root.entry.id, await seed(`mod${i}`))

      const page = await chat.listTopLevel({
        room: GLOBAL_ROOM,
        viewerId: ann,
        sort: 'new',
        limit: 30,
        offset: 0
      })
      expect(page.total).toBe(1)
      const shown = page.rows[0]
      expect(shown?.removed).toBe(true)
      expect(shown?.body).toBe('')
      expect(shown?.author).toBeNull()
      // The anchor is intact, so the reply is still reachable.
      expect(shown?.replyCount).toBe(1)
      const thread = await chat.listReplies(root.entry.id, ann)
      expect(thread.map((m) => m.body)).toEqual(['a reply worth keeping'])
    } finally {
      await close()
    }
  })

  it('one reaction per player — switchable, clearable — and the sort follows the counts', async () => {
    const { chat, seed, close } = await make()
    try {
      const asa = await seed('Asa')
      const ann = await seed('Ann')
      const liked = await chat.post(globalPost(asa, 'the well-liked one'))
      const hated = await chat.post(globalPost(ann, 'the badly-received one'))
      if (!liked.ok || !hated.ok) throw new Error('post refused')

      // A like, then a dislike from the same player: a switch, never both.
      expect((await chat.react(liked.entry.id, ann, 'like'))?.likes).toBe(1)
      const switched = await chat.react(liked.entry.id, ann, 'dislike')
      expect(switched).toMatchObject({ likes: 0, dislikes: 1, myReaction: 'dislike' })
      // The same reaction again clears it; it never stacks.
      const cleared = await chat.react(liked.entry.id, ann, 'dislike')
      expect(cleared).toMatchObject({ likes: 0, dislikes: 0, myReaction: null })

      expect((await chat.react(liked.entry.id, asa, 'like'))?.likes).toBe(1)
      expect((await chat.react(liked.entry.id, ann, 'like'))?.likes).toBe(2)
      expect((await chat.react(hated.entry.id, asa, 'dislike'))?.dislikes).toBe(1)

      const page = (sort: 'new' | 'likes' | 'dislikes') =>
        chat.listTopLevel({ room: GLOBAL_ROOM, viewerId: asa, sort, limit: 30, offset: 0 })
      expect((await page('likes')).rows.map((m) => m.body)).toEqual([
        'the well-liked one',
        'the badly-received one'
      ])
      expect((await page('dislikes')).rows.map((m) => m.body)).toEqual([
        'the badly-received one',
        'the well-liked one'
      ])
      // Oldest first, whatever the reactions say — the newest sits at the bottom
      // of the stream, so rows[0] is the EARLIER post.
      expect((await page('new')).rows[0]?.body).toBe('the well-liked one')
      // Counters come from the rows, so my own reaction rides along.
      expect((await page('likes')).rows[0]?.myReaction).toBe('like')
    } finally {
      await close()
    }
  })

  it('a pair of players share one DM room whoever writes first', async () => {
    const { chat, seed, close } = await make()
    try {
      const asa = await seed('Asa')
      const ann = await seed('Ann')
      const room = dmRoomKey(asa, ann)
      expect(room).toBe(dmRoomKey(ann, asa))

      for (const [author, recipient, body] of [
        [asa, ann, 'want a 2v2?'],
        [ann, asa, 'give me ten minutes']
      ] as const)
        await chat.post({
          id: randomUUID(),
          room,
          authorId: author,
          recipientId: recipient,
          parentId: null,
          body,
          cooldownMs: 0
        })

      const page = await chat.listTopLevel({
        room,
        viewerId: asa,
        sort: 'new',
        limit: 30,
        offset: 0
      })
      // Oldest first: 'want a 2v2?' was written before 'give me ten minutes', so
      // it now reads on top, the reply below it — the newest is at the bottom.
      expect(page.rows.map((m) => m.body)).toEqual(['want a 2v2?', 'give me ten minutes'])
      // Nothing of it leaks into the global room.
      const globalPage = await chat.listTopLevel({
        room: GLOBAL_ROOM,
        viewerId: asa,
        sort: 'new',
        limit: 30,
        offset: 0
      })
      expect(globalPage.total).toBe(0)

      const conversations = await chat.listConversations(asa)
      expect(conversations).toHaveLength(1)
      expect(conversations[0]?.peer.nickname).toBe('Ann')
      expect(conversations[0]).toMatchObject({ lastBody: 'give me ten minutes', lastMine: false })
      expect(await chat.findPeer({ nickname: 'ann' })).toMatchObject({ userId: ann })
    } finally {
      await close()
    }
  })

  it('a closed conversation blocks incoming DMs and the unread dot follows writes', async () => {
    const { chat, seed, close } = await make()
    try {
      const asa = await seed('Asa')
      const ann = await seed('Ann')
      const room = dmRoomKey(asa, ann)

      // Nobody is blocked to start.
      expect(await chat.isBlocked(ann, asa)).toBe(false)

      // Ann writes to Asa → Asa has an unread DM until she reads everything.
      await chat.post({
        id: randomUUID(),
        room,
        authorId: ann,
        recipientId: asa,
        parentId: null,
        body: 'hello',
        cooldownMs: 0
      })
      expect(await chat.hasUnreadDm(asa)).toBe(true)
      await chat.markAllDmRead(asa)
      expect(await chat.hasUnreadDm(asa)).toBe(false)

      // Asa closes the conversation: Ann's messages stop reaching her.
      expect(await chat.setBlocked(asa, ann, true)).toBe(true)
      expect(await chat.isBlocked(asa, ann)).toBe(true)
      // ...and reopening restores it.
      expect(await chat.setBlocked(asa, ann, false)).toBe(false)
      expect(await chat.isBlocked(asa, ann)).toBe(false)
    } finally {
      await close()
    }
  })
})

// --- Over the wire -------------------------------------------------------------------

describe('chat over the socket', () => {
  let ts: TestServer | null = null
  const clients: TestClient[] = []

  afterEach(async () => {
    for (const c of clients) c.close()
    clients.length = 0
    await ts?.server.close()
    ts = null
  })

  const connect = async (userId: string) => {
    const { client } = await connectAs(ts as TestServer, userId)
    clients.push(client)
    return client
  }

  it('broadcasts the global room, and the minute survives a reconnect', async () => {
    ts = await startTestServer()
    const asaId = randomUUID()
    const asa = await connect(asaId)
    const ann = await connect(randomUUID())

    asa.send({ t: 'chat.post', seq: 1, p: { scope: { kind: 'global' }, body: 'hello world' } })
    // The author's own copy carries the request seq (it is the ack) and reads as
    // theirs; everybody else gets it unsolicited and reads it as somebody else's.
    const own = await asa.expect('chat.posted')
    expect(own.seq).toBe(1)
    expect(own.p.message).toMatchObject({ body: 'hello world', mine: true })
    const seen = await ann.expect('chat.posted')
    expect(seen.p.message).toMatchObject({ body: 'hello world', mine: false })
    expect(seen.p.message.author?.userId).toBe(asaId)

    // Author's rule: one global message per minute.
    asa.send({ t: 'chat.post', seq: 2, p: { scope: { kind: 'global' }, body: 'and again' } })
    const refused = await asa.expect('error')
    expect(refused.p.code).toBe('rate_limited')

    // Reconnect — a new socket, a new session, the same persisted messages.
    asa.close()
    const asaAgain = await connect(asaId)
    asaAgain.send({ t: 'chat.post', seq: 3, p: { scope: { kind: 'global' }, body: 'fresh tab' } })
    const stillRefused = await asaAgain.expect('error')
    expect(stillRefused.p.code).toBe('rate_limited')

    // The reply to chat.list tells the compose box how long is left.
    asaAgain.send({ t: 'chat.list', seq: 4, p: { scope: { kind: 'global' }, sort: 'new' } })
    const page = await asaAgain.expect('chat.messages')
    expect(page.p.cooldownMs).toBeGreaterThan(0)
    expect(page.p.messages).toHaveLength(1)
  })

  it('keeps 255 characters and refuses 256', async () => {
    ts = await startTestServer()
    const asa = await connect(randomUUID())

    asa.send({ t: 'chat.post', seq: 1, p: { scope: { kind: 'global' }, body: 'x'.repeat(256) } })
    const refused = await asa.expect('error')
    expect(refused.p.code).toBe('bad_message')

    // Exactly at the limit is a legal message — 255, the author's number.
    asa.send({
      t: 'chat.post',
      seq: 2,
      p: { scope: { kind: 'global' }, body: 'y'.repeat(CHAT_BODY_MAX) }
    })
    const posted = await asa.expect('chat.posted')
    expect(posted.p.message.body).toHaveLength(255)
  })

  it('a third player can neither read nor react to a private conversation', async () => {
    ts = await startTestServer()
    const asaId = randomUUID()
    const annId = randomUUID()
    const asa = await connect(asaId)
    const ann = await connect(annId)
    const okeesha = await connect(randomUUID())

    asa.send({ t: 'chat.post', seq: 1, p: { scope: { kind: 'dm', peerId: annId }, body: 'psst' } })
    const sent = await asa.expect('chat.posted')
    const messageId = sent.p.message.id
    // The addressee gets it, with the scope pointing back at the sender.
    const received = await ann.expect('chat.posted')
    expect(received.p.scope).toEqual({ kind: 'dm', peerId: asaId })

    // The outsider knows the message id — and it does not help. Reading it,
    // reacting to it and flagging it all answer like it never existed.
    for (const [seq, msg] of [
      [10, { t: 'chat.thread', p: { parentId: messageId } }],
      [11, { t: 'chat.react', p: { messageId, reaction: 'like' } }],
      [12, { t: 'chat.flag', p: { messageId } }]
    ] as const) {
      okeesha.send({ ...msg, seq })
      const denied = await okeesha.expect('error')
      expect(denied.p.code).toBe('not_found')
    }

    // Naming the pair does not help either: a room key is built from the
    // caller's own id, so the outsider only ever reaches its OWN DM with Ann.
    okeesha.send({
      t: 'chat.list',
      seq: 13,
      p: { scope: { kind: 'dm', peerId: annId }, sort: 'new' }
    })
    const page = await okeesha.expect('chat.messages')
    expect(page.p.messages).toHaveLength(0)

    // Writing to yourself is not a conversation.
    asa.send({
      t: 'chat.post',
      seq: 14,
      p: { scope: { kind: 'dm', peerId: asaId }, body: 'hi me' }
    })
    expect((await asa.expect('error')).p.code).toBe('invalid_input')
  })
})
