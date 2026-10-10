// The persisted chat (author backlog #3): one global room every player reads,
// and private messages between two players. Threads open under a message the way
// YouTube comments do, one level deep. Own messages sit on the LEFT and everyone
// else's on the RIGHT, each with the author's avatar and username in front of it
// — the author's layout, verbatim.
//
// Every rule that matters is the server's: the one-message-per-minute window,
// the ten-distinct-flaggers removal, one reaction per player. This screen shows
// them and never re-implements them; the cooldown countdown is the server's own
// `cooldownMs`, so a reload cannot talk it away.

import type {
  ChatAuthorView,
  ChatConversation,
  ChatCounts,
  ChatMessageEntry,
  ChatReaction,
  ChatScope,
  ChatSort
} from '@metarchy/protocol'
import { CHAT_BODY_MAX, CHAT_GLOBAL_COOLDOWN_MS } from '@metarchy/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar.js'
import { useCountdown } from '../hooks/useCountdown.js'
import { useT, type TFunction } from '../i18n/index.js'
import { gameSocket } from '../net/socket.js'
import { useSessionStore } from '../stores/session.js'
import { themeAsset } from '../theme.js'

const SORTS: ChatSort[] = ['new', 'likes', 'dislikes']

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** Avatar + username in front of the message; never a fake default face. */
function Byline({ author, t }: { author: ChatAuthorView | null; t: TFunction }) {
  return (
    <span className="chat-byline">
      {author?.avatar && (
        <img className="avatar-chip" src={themeAsset(`avatar.${author.avatar}`)} alt="" />
      )}
      <span className="nickname">{author?.nickname ?? t('chat.removed')}</span>
    </span>
  )
}

interface RowProps {
  message: ChatMessageEntry
  t: TFunction
  busy: boolean
  onReact(reaction: ChatReaction): void
  onFlag(): void
  onReply?: () => void
  onToggleThread?: () => void
  threadOpen?: boolean
  /** Which side the bubble sits on — a reply inherits its parent's side. */
  side?: 'mine' | 'theirs'
}

function MessageRow({
  message: m,
  t,
  busy,
  onReact,
  onFlag,
  onReply,
  onToggleThread,
  threadOpen,
  side
}: RowProps) {
  // A reply sits on the SAME side as the message it answers (author: a reply to
  // my message hangs on the left under mine, even when I wrote the reply). `side`
  // overrides the default own-left/others-right for exactly that case.
  const mine = side !== undefined ? side === 'mine' : m.mine
  return (
    <div className={mine ? 'chat-msg mine' : 'chat-msg'}>
      <div className="chat-msg-head">
        <Byline author={m.author} t={t} />
        <span className="chat-time hint-text">{timeOf(m.createdAt)}</span>
      </div>
      <p className={m.removed ? 'chat-body removed' : 'chat-body'}>
        {m.removed ? t('chat.removed') : m.body}
      </p>
      <div className="chat-actions">
        {!m.removed && (
          <>
            <button
              type="button"
              className={m.myReaction === 'like' ? 'chat-chip active' : 'chat-chip'}
              aria-pressed={m.myReaction === 'like'}
              title={t('chat.like')}
              disabled={busy}
              onClick={() => onReact('like')}
            >
              👍 {m.likes}
            </button>
            <button
              type="button"
              className={m.myReaction === 'dislike' ? 'chat-chip active' : 'chat-chip'}
              aria-pressed={m.myReaction === 'dislike'}
              title={t('chat.dislike')}
              disabled={busy}
              onClick={() => onReact('dislike')}
            >
              👎 {m.dislikes}
            </button>
            <button
              type="button"
              className={m.flaggedByMe ? 'chat-chip active' : 'chat-chip'}
              aria-pressed={m.flaggedByMe}
              title={t('chat.flagHint')}
              disabled={busy || m.flaggedByMe}
              onClick={onFlag}
            >
              ⚑ {m.flaggedByMe ? t('chat.flagged') : t('chat.flag')}
            </button>
            {onReply && (
              <button type="button" className="chat-chip" onClick={onReply}>
                {t('chat.reply')}
              </button>
            )}
          </>
        )}
        {onToggleThread && m.replyCount > 0 && (
          <button type="button" className="chat-chip thread" onClick={onToggleThread}>
            {threadOpen ? t('chat.hideReplies') : t('chat.replies', { n: m.replyCount })}
          </button>
        )}
      </div>
    </div>
  )
}

export function ChatScreen() {
  const t = useT()
  const navigate = useNavigate()
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const setDmUnread = useSessionStore((s) => s.setDmUnread)
  const dmUnread = useSessionStore((s) => s.dmUnread)
  // `/chat?to=<nickname>` opens straight into that conversation. This is how a
  // Market lot and a public profile reach a player: without a door from the place
  // you want to talk about, nobody ever finds the chat at all.
  const [search_, setSearchParams] = useSearchParams()
  const writeTo = search_.get('to')

  const [tab, setTab] = useState<'global' | 'direct'>(writeTo ? 'direct' : 'global')
  /** The open private conversation; null in the global room or on the DM list. */
  const [peer, setPeer] = useState<ChatAuthorView | null>(null)
  const [sort, setSort] = useState<ChatSort>('new')
  const [messages, setMessages] = useState<ChatMessageEntry[] | null>(null)
  const [total, setTotal] = useState(0)
  /** Open threads by parent id — a message's replies, chronological. */
  const [threads, setThreads] = useState<Record<string, ChatMessageEntry[]>>({})
  const [replyTo, setReplyTo] = useState<ChatMessageEntry | null>(null)
  const [draft, setDraft] = useState('')
  /** Absolute server instant the global room reopens for me; null = free now. */
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [conversations, setConversations] = useState<ChatConversation[] | null>(null)
  const [search, setSearch] = useState('')
  const [searchMiss, setSearchMiss] = useState(false)
  /** Whether I have closed the open private conversation. */
  const [peerBlocked, setPeerBlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scope: ChatScope | null =
    tab === 'global' ? { kind: 'global' } : peer ? { kind: 'dm', peerId: peer.userId } : null
  const scopeKey = scope === null ? 'none' : scope.kind === 'global' ? 'global' : scope.peerId
  const cooldown = useCountdown(cooldownUntil)
  /** The author's rule bites in the global room only. */
  const blocked = tab === 'global' && cooldown !== null && cooldown > 0

  const applyCooldown = useCallback((ms: number) => {
    setCooldownUntil(ms > 0 ? gameSocket.serverNow() + ms : null)
  }, [])

  const load = useCallback(
    async (offset: number) => {
      if (scope === null) return
      setBusy(true)
      setError(null)
      try {
        const page = await gameSocket.chatList({ scope, sort, offset })
        setTotal(page.total)
        applyCooldown(page.cooldownMs)
        setMessages((prev) =>
          offset === 0 || !prev
            ? page.messages
            : [...prev, ...page.messages.filter((m) => !prev.some((p) => p.id === m.id))]
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    // scopeKey stands in for `scope` (a fresh object every render, same value).
    [scopeKey, sort, applyCooldown]
  )

  useEffect(() => {
    if (!online || scope === null) return
    setMessages(null)
    setThreads({})
    setReplyTo(null)
    setPeerBlocked(false)
    void load(0)
  }, [online, scopeKey, sort])

  const loadConversations = useCallback(async () => {
    try {
      setConversations((await gameSocket.chatDms()).items)
    } catch {
      // Offline; the list stays as it is and the next mount retries.
    }
  }, [])

  useEffect(() => {
    if (online && tab === 'direct') void loadConversations()
  }, [online, tab, loadConversations])

  // Standing on the chat IS reading it: the badge on the way in goes out here.
  useEffect(() => {
    setDmUnread(false)
  }, [setDmUnread, tab, peer])

  // Resolve `?to=<nickname>` once, then drop it from the URL so a later Back to
  // the DM list does not bounce the player straight back into this conversation.
  useEffect(() => {
    if (!online || !writeTo) return
    let cancelled = false
    void gameSocket
      .chatDms(writeTo)
      .then((res) => {
        if (cancelled) return
        setConversations(res.items)
        if (res.found) setPeer(res.found)
        else setSearchMiss(true)
        setSearchParams({}, { replace: true })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [online, writeTo, setSearchParams])

  // Live pushes. A message for the conversation on screen lands in place; one
  // for another private conversation only refreshes the DM list, so an incoming
  // message is visible without polling.
  useEffect(() => {
    return gameSocket.onChatPosted((p) => {
      // `scopeKey` is 'global', the peer's id, or 'none' — the same shape the
      // push carries, so one comparison covers both kinds of conversation.
      const here = (p.scope.kind === 'global' ? 'global' : p.scope.peerId) === scopeKey
      if (!here) {
        if (p.scope.kind === 'dm') void loadConversations()
        return
      }
      const m = p.message
      if (m.parentId !== null) {
        // A reply: into the open thread if it is open, and the parent's counter
        // moves either way so the "N replies" button tells the truth.
        setThreads((prev) =>
          prev[m.parentId as string]
            ? {
                ...prev,
                [m.parentId as string]: [
                  ...(prev[m.parentId as string] as ChatMessageEntry[]).filter(
                    (r) => r.id !== m.id
                  ),
                  m
                ]
              }
            : prev
        )
        setMessages(
          (prev) =>
            prev?.map((row) =>
              row.id === m.parentId ? { ...row, replyCount: row.replyCount + 1 } : row
            ) ?? prev
        )
        return
      }
      // Bottom of the list: the stream reads top-to-bottom with the newest at
      // the end. (Under a like/dislike sort a fresh post has no reactions, so it
      // still lands at the bottom — which is where the eye already is.)
      setMessages((prev) => (prev ? [...prev.filter((r) => r.id !== m.id), m] : [m]))
      setTotal((n) => n + 1)
      if (p.scope.kind === 'dm') void loadConversations()
    })
  }, [scopeKey, loadConversations])

  /** Reactions and flags answer with the counters; merge them wherever the row is. */
  function mergeCounts(c: ChatCounts): void {
    const patch = (m: ChatMessageEntry): ChatMessageEntry =>
      m.id !== c.messageId
        ? m
        : {
            ...m,
            likes: c.likes,
            dislikes: c.dislikes,
            myReaction: c.myReaction,
            flags: c.flags,
            flaggedByMe: c.flaggedByMe,
            removed: c.removed,
            ...(c.removed ? { body: '', author: null, mine: false } : {})
          }
    setMessages((prev) => prev?.map(patch) ?? prev)
    setThreads((prev) => {
      const next: Record<string, ChatMessageEntry[]> = {}
      for (const [parentId, rows] of Object.entries(prev)) next[parentId] = rows.map(patch)
      return next
    })
  }

  function act(run: () => Promise<ChatCounts>): void {
    setError(null)
    run()
      .then(mergeCounts)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  async function toggleThread(m: ChatMessageEntry): Promise<void> {
    if (threads[m.id]) {
      setThreads((prev) => {
        const next = { ...prev }
        delete next[m.id]
        return next
      })
      return
    }
    try {
      const replies = await gameSocket.chatThread(m.id)
      setThreads((prev) => ({ ...prev, [m.id]: replies }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function send(): Promise<void> {
    const body = draft.trim()
    if (!body || scope === null) return
    if (blocked) {
      setError(t('chat.rateLimited'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await gameSocket.chatPost({
        scope,
        body,
        ...(replyTo ? { parentId: replyTo.id } : {})
      })
      setDraft('')
      setReplyTo(null)
      // Close the composer for the full minute right away. The server's own
      // `cooldownMs` corrects this on the next page load — it is the authority,
      // this is only so the button does not invite a refusal.
      if (tab === 'global') applyCooldown(CHAT_GLOBAL_COOLDOWN_MS)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      // A refusal means the server knows something this tab did not — most
      // likely the window. Re-read it from the source, and only then put the
      // reason back on screen (load() clears the banner on its way in).
      await load(0)
      // "forbidden" here is the peer having closed the conversation — show that,
      // not the raw code.
      setError(/closed the private conversation/i.test(reason) ? t('chat.dm.blockedYou') : reason)
    } finally {
      setBusy(false)
    }
  }

  async function findPeer(): Promise<void> {
    const nickname = search.trim()
    if (!nickname) return
    setSearchMiss(false)
    try {
      const res = await gameSocket.chatDms(nickname)
      setConversations(res.items)
      if (res.found) {
        setPeer(res.found)
        setSearch('')
      } else setSearchMiss(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  /** The scrolling stream; kept pinned to the newest message at the bottom. */
  const streamRef = useRef<HTMLDivElement | null>(null)
  function startReply(m: ChatMessageEntry): void {
    setReplyTo(m)
    void toggleThread(m).then(() => composerRef.current?.focus())
  }

  // Newest sits at the bottom, so a fresh page or a new message scrolls the
  // stream to it — the player should never have to scroll up to read the latest.
  useEffect(() => {
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, scopeKey])

  const showList = scope !== null

  return (
    <div className="screen">
      <TopBar />
      <img className="logo" src={themeAsset('logo')} alt="Metarchy" />

      <div className="panel chat-panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{t('chat.title')}</h2>
          <button
            className="btn secondary"
            disabled={busy || !online || !showList}
            onClick={() => void load(0)}
          >
            {t('chat.refresh')}
          </button>
        </div>

        <div className="chat-tabs">
          <button
            type="button"
            className={tab === 'global' ? 'chip-toggle active' : 'chip-toggle'}
            aria-pressed={tab === 'global'}
            onClick={() => {
              setTab('global')
              setPeer(null)
            }}
          >
            {t('chat.tab.global')}
          </button>
          <button
            type="button"
            className={tab === 'direct' ? 'chip-toggle active' : 'chip-toggle'}
            aria-pressed={tab === 'direct'}
            onClick={() => setTab('direct')}
          >
            {t('chat.tab.direct')}
            {/* The unread dot follows you INTO the chat: the Home button lit up,
                and this is where the message actually lives. */}
            {dmUnread && <span className="chat-dot" aria-label={t('chat.tab.direct')} />}
          </button>
        </div>

        {tab === 'global' && <p className="hint-text">{t('chat.subtitle')}</p>}

        {tab === 'direct' && peer === null && (
          <div className="chat-dm-picker">
            <h3 style={{ margin: '4px 0' }}>{t('chat.dm.title')}</h3>
            <div className="row">
              <input
                type="text"
                value={search}
                placeholder={t('chat.dm.search')}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void findPeer()
                }}
              />
              <button className="btn" disabled={!online || !search.trim()} onClick={findPeer}>
                {t('chat.dm.find')}
              </button>
            </div>
            {searchMiss && <p className="error-text">{t('chat.dm.notFound')}</p>}
            {conversations?.length === 0 && <p className="hint-text">{t('chat.dm.none')}</p>}
            {conversations && conversations.length > 0 && (
              <ul className="watch-list">
                {conversations.map((c) => (
                  <li key={c.peer.userId} className="watch-item">
                    <div className="watch-item-main">
                      <Byline author={c.peer} t={t} />
                      <div className="chat-dm-last hint-text">
                        {c.lastMine ? `${t('chat.dm.you')} ` : ''}
                        {c.lastBody || t('chat.dm.removedLast')}
                      </div>
                    </div>
                    <button className="btn" onClick={() => setPeer(c.peer)}>
                      {t('chat.reply')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'direct' && peer !== null && (
          <div className="chat-dm-head">
            <Byline author={peer} t={t} />
            <span className="hint-text">{t('chat.dm.write', { who: peer.nickname })}</span>
            {/* Any player may close a private conversation: the peer's messages
                stop arriving, and they are told so when they try to write. */}
            <button
              className="btn secondary"
              disabled={busy || !online}
              onClick={() => {
                setBusy(true)
                setError(null)
                gameSocket
                  .chatBlock(peer.userId, !peerBlocked)
                  .then((b) => setPeerBlocked(b))
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBusy(false))
              }}
            >
              {t(peerBlocked ? 'chat.dm.unblock' : 'chat.dm.block')}
            </button>
            <button className="btn secondary" onClick={() => setPeer(null)}>
              {t('chat.dm.back')}
            </button>
          </div>
        )}

        {tab === 'direct' && peer !== null && peerBlocked && (
          <p className="hint-text">{t('chat.dm.blocked')}</p>
        )}

        {showList && (
          <>
            {/* The sort switch ranks TOP-LEVEL messages; a thread under one of
                them always stays chronological. */}
            <div className="chat-sorts">
              {SORTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={sort === s ? 'chip-toggle active' : 'chip-toggle'}
                  aria-pressed={sort === s}
                  onClick={() => setSort(s)}
                >
                  {t(`chat.sort.${s}`)}
                </button>
              ))}
            </div>

            {messages === null && <p className="hint-text">{t('chat.loading')}</p>}
            {messages?.length === 0 && <p className="hint-text">{t('chat.empty')}</p>}

            {messages && messages.length > 0 && (
              <div className="chat-stream" ref={streamRef}>
                {messages.map((m) => (
                  <div key={m.id} className="chat-block">
                    <MessageRow
                      message={m}
                      t={t}
                      busy={busy}
                      onReact={(r) => act(() => gameSocket.chatReact(m.id, r))}
                      onFlag={() => act(() => gameSocket.chatFlag(m.id))}
                      onReply={() => startReply(m)}
                      onToggleThread={() => void toggleThread(m)}
                      threadOpen={threads[m.id] !== undefined}
                    />
                    {threads[m.id] && (
                      <div className="chat-thread">
                        {(threads[m.id] as ChatMessageEntry[]).map((r) => (
                          <MessageRow
                            key={r.id}
                            message={r}
                            t={t}
                            busy={busy}
                            side={m.mine ? 'mine' : 'theirs'}
                            onReact={(x) => act(() => gameSocket.chatReact(r.id, x))}
                            onFlag={() => act(() => gameSocket.chatFlag(r.id))}
                            onReply={() => startReply(m)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {messages && messages.length < total && (
              <button
                className="btn secondary"
                disabled={busy || !online}
                onClick={() => void load(messages.length)}
              >
                {t('chat.more', { shown: messages.length, total })}
              </button>
            )}

            <div className="chat-composer">
              {replyTo && (
                <div className="chat-replying hint-text">
                  {t('chat.replyPlaceholder', { who: replyTo.author?.nickname ?? '—' })}
                  <button type="button" className="chat-chip" onClick={() => setReplyTo(null)}>
                    {t('chat.cancel')}
                  </button>
                </div>
              )}
              <textarea
                ref={composerRef}
                className="chat-input"
                rows={2}
                maxLength={CHAT_BODY_MAX}
                value={draft}
                placeholder={
                  replyTo
                    ? t('chat.replyPlaceholder', { who: replyTo.author?.nickname ?? '—' })
                    : t('chat.placeholder')
                }
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="chat-composer-foot">
                {/* The author's 255 — the same number the schema and the DB check. */}
                <span className={draft.length >= CHAT_BODY_MAX ? 'chat-count full' : 'chat-count'}>
                  {t('chat.counter', { n: draft.length, max: CHAT_BODY_MAX })}
                </span>
                <button
                  className="btn"
                  disabled={busy || !online || !draft.trim() || blocked}
                  onClick={send}
                >
                  {blocked ? t('chat.cooldown', { n: cooldown ?? 0 }) : t('chat.send')}
                </button>
              </div>
            </div>
          </>
        )}

        {error && <p className="error-text">{error}</p>}
        <button className="btn secondary" onClick={() => navigate('/')}>
          {t('common.back')}
        </button>
      </div>
    </div>
  )
}
