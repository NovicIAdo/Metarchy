// Persisted chat (author backlog #3): one global room every registered player
// can write to, plus player↔player private messages. This is NOT the in-game
// chat: `chat.team` / `chat.message` in messages.ts are per-room, relayed and
// never stored. Everything here lands in the database, is moderated by flags
// and is ranked by likes.
//
// The author's rules, verbatim in intent, are constants below so the server,
// the DB check and the client counter all read the same numbers.

import { z } from 'zod'

/** Author's rule: 255 characters max. Enforced here, and again as a DB check. */
export const CHAT_BODY_MAX = 255
/**
 * Author's rule: a player may not post to the GLOBAL room more than once per
 * minute. Private messages are deliberately NOT limited — the rule is about
 * flooding the room everybody reads. A reply counts: it is a global message.
 */
export const CHAT_GLOBAL_COOLDOWN_MS = 60_000
/** Author's rule: 10 flags from 10 DIFFERENT players remove the message. */
export const CHAT_FLAG_HIDE_THRESHOLD = 10
/** Top-level messages per page; threads come whole (they are short by design). */
export const CHAT_PAGE_SIZE = 30

/** Mirrors the private `seq` in messages.ts — direct replies echo it. */
const seq = z.number().int().nonnegative().optional()

/**
 * Which conversation. The client never names a room: it says "global" or "the
 * DM with this player", and the server derives the room key from that plus the
 * caller's own id. A player therefore cannot address a conversation they are
 * not in — see apps/server/src/chat.ts dmRoomKey().
 */
export const ChatScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('global') }),
  z.strictObject({ kind: z.literal('dm'), peerId: z.uuid() })
])
export type ChatScope = z.infer<typeof ChatScopeSchema>

/**
 * The author's sort switch: newest first, most-liked first, most-disliked
 * first. It applies to TOP-LEVEL messages only — a thread always stays
 * chronological under its parent, the way YouTube reads.
 */
export const ChatSortSchema = z.enum(['new', 'likes', 'dislikes'])
export type ChatSort = z.infer<typeof ChatSortSchema>

/** One reaction per player per message, switchable — never both, never stacked. */
export const ChatReactionSchema = z.enum(['like', 'dislike'])
export type ChatReaction = z.infer<typeof ChatReactionSchema>

/** Who wrote it: avatar + username go in front of every message (author's layout). */
export const ChatAuthorSchema = z.object({
  userId: z.uuid(),
  nickname: z.string(),
  /** AvatarId or null — the client renders an <img> only when it is set. */
  avatar: z.string().nullable()
})
export type ChatAuthorView = z.infer<typeof ChatAuthorSchema>

/**
 * One message as the client renders it. Counters are computed from the reaction
 * and flag rows on every read — there is no denormalized counter column that
 * could drift from the truth.
 *
 * `removed` is a flagged-away message kept as a tombstone: body and author are
 * blanked, but the row still anchors its thread so the replies underneath stay
 * readable and addressable.
 */
export const ChatMessageEntrySchema = z.object({
  id: z.uuid(),
  /** null = top-level. Threads are exactly one level deep. */
  parentId: z.uuid().nullable(),
  /** null only on a removed message. */
  author: ChatAuthorSchema.nullable(),
  /** '' only on a removed message. */
  body: z.string(),
  createdAt: z.string(),
  likes: z.number().int().min(0),
  dislikes: z.number().int().min(0),
  /** The caller's own reaction, so the client can show it pressed. */
  myReaction: ChatReactionSchema.nullable(),
  flags: z.number().int().min(0),
  flaggedByMe: z.boolean(),
  /** Visible replies hanging off this message; always 0 on a reply. */
  replyCount: z.number().int().min(0),
  /** Author's layout: own messages on the left, everyone else's on the right. */
  mine: z.boolean(),
  /** Flagged away by CHAT_FLAG_HIDE_THRESHOLD distinct players. */
  removed: z.boolean()
})
export type ChatMessageEntry = z.infer<typeof ChatMessageEntrySchema>

/** Reaction/flag counters after a write — the reply to chat.react and chat.flag. */
export const ChatCountsSchema = z.object({
  messageId: z.uuid(),
  likes: z.number().int().min(0),
  dislikes: z.number().int().min(0),
  myReaction: ChatReactionSchema.nullable(),
  flags: z.number().int().min(0),
  flaggedByMe: z.boolean(),
  /** True when this call was the flag that crossed the threshold. */
  removed: z.boolean()
})
export type ChatCounts = z.infer<typeof ChatCountsSchema>

/** One of my private conversations, for the DM picker. */
export const ChatConversationSchema = z.object({
  peer: ChatAuthorSchema,
  /** '' when the last message was flagged away. */
  lastBody: z.string(),
  lastAt: z.string(),
  /** True when I wrote the last message. */
  lastMine: z.boolean()
})
export type ChatConversation = z.infer<typeof ChatConversationSchema>

// --- Client → Server ---------------------------------------------------------------

/** One page of top-level messages in a conversation, under the chosen sort. */
export const ChatListMessageSchema = z.strictObject({
  t: z.literal('chat.list'),
  seq,
  p: z.strictObject({
    scope: ChatScopeSchema,
    sort: ChatSortSchema,
    offset: z.number().int().min(0).max(10_000).optional()
  })
})

/** The thread under one message — chronological, always. */
export const ChatThreadMessageSchema = z.strictObject({
  t: z.literal('chat.thread'),
  seq,
  p: z.strictObject({ parentId: z.uuid() })
})

/** Write a message, or a reply to one (`parentId`). */
export const ChatPostMessageSchema = z.strictObject({
  t: z.literal('chat.post'),
  seq,
  p: z.strictObject({
    scope: ChatScopeSchema,
    body: z.string().min(1).max(CHAT_BODY_MAX),
    /** Replying to a reply attaches to the same parent — one level, like YouTube. */
    parentId: z.uuid().optional()
  })
})

/** Like/dislike. Sending the reaction you already gave clears it. */
export const ChatReactMessageSchema = z.strictObject({
  t: z.literal('chat.react'),
  seq,
  p: z.strictObject({ messageId: z.uuid(), reaction: ChatReactionSchema })
})

/** Flag a message. Flagging twice is a no-op — the threshold counts players. */
export const ChatFlagMessageSchema = z.strictObject({
  t: z.literal('chat.flag'),
  seq,
  p: z.strictObject({ messageId: z.uuid() })
})

/**
 * The DM picker: my conversations, newest first. With `nickname` it also
 * resolves that exact name, so a first message to someone can be started
 * without an existing conversation.
 */
export const ChatDmsMessageSchema = z.strictObject({
  t: z.literal('chat.dms'),
  seq,
  p: z.strictObject({ nickname: z.string().min(1).max(64) }).optional()
})

/** Close (or reopen) a private conversation: a blocked peer's DMs stop reaching me. */
export const ChatBlockMessageSchema = z.strictObject({
  t: z.literal('chat.block'),
  seq,
  p: z.strictObject({ peerId: z.uuid(), blocked: z.boolean() })
})

// --- Server → Client ---------------------------------------------------------------

/** Reply to chat.list. */
export const ChatMessagesMessageSchema = z.object({
  t: z.literal('chat.messages'),
  seq,
  p: z.object({
    scope: ChatScopeSchema,
    sort: ChatSortSchema,
    offset: z.number().int().min(0),
    messages: z.array(ChatMessageEntrySchema),
    /** Servable top-level messages in this conversation (for "show more"). */
    total: z.number().int().min(0),
    /** ms until this player may post to the global room again; 0 = free now. */
    cooldownMs: z.number().int().min(0)
  })
})

/** Reply to chat.thread. */
export const ChatRepliesMessageSchema = z.object({
  t: z.literal('chat.replies'),
  seq,
  p: z.object({ parentId: z.uuid(), messages: z.array(ChatMessageEntrySchema) })
})

/**
 * A message landed. Pushed to every connected player for the global room, and
 * to exactly the two participants for a DM — including the author, so the
 * client renders its own message from the server's copy and never guesses.
 */
export const ChatPostedMessageSchema = z.object({
  t: z.literal('chat.posted'),
  seq,
  p: z.object({ scope: ChatScopeSchema, message: ChatMessageEntrySchema })
})

/** Reply to chat.react and chat.flag. */
export const ChatStatsMessageSchema = z.object({
  t: z.literal('chat.stats'),
  seq,
  p: ChatCountsSchema
})

/** Reply to chat.dms. `found` answers the nickname lookup, if one was asked. */
export const ChatConversationsMessageSchema = z.object({
  t: z.literal('chat.conversations'),
  seq,
  p: z.object({
    items: z.array(ChatConversationSchema),
    found: ChatAuthorSchema.nullable()
  })
})

/** Reply to chat.block — the conversation's new blocked state. */
export const ChatBlockedMessageSchema = z.object({
  t: z.literal('chat.blocked'),
  seq,
  p: z.object({ peerId: z.uuid(), blocked: z.boolean() })
})
