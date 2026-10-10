// Team chat (2v2 only): bottom-left toggle with an unread badge, expanding into
// a message log + input. History is tab-local — the server relays chat.team to
// the ally and stores nothing, so a reload starts blank.

import { useEffect, useRef, useState } from 'react'
import type { PlayerView, SeatId } from '@metarchy/engine'
import { SEAT_COLORS } from '../../board/layout.js'
import { useT } from '../../i18n/index.js'
import { gameSocket } from '../../net/socket.js'
import { useGameStore } from '../../stores/game.js'

function seatColorCss(seat: SeatId): string {
  return `#${SEAT_COLORS[seat].toString(16).padStart(6, '0')}`
}

export function ChatPanel({ gameId, view }: { gameId: string; view: PlayerView }) {
  const t = useT()
  const chat = useGameStore((s) => s.chat)
  const chatOpen = useGameStore((s) => s.chatOpen)
  const chatUnread = useGameStore((s) => s.chatUnread)
  const setChatOpen = useGameStore((s) => s.setChatOpen)
  const players = useGameStore((s) => s.players)
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [chat, chatOpen])

  const nameOf = (seat: SeatId): string =>
    seat === view.seat
      ? t('game.youLower')
      : (players.find((p) => p.seat === seat)?.nickname ?? t('game.seat', { n: seat }))

  if (!chatOpen) {
    return (
      <button className="btn secondary chat-toggle" onClick={() => setChatOpen(true)}>
        {t('game.chat.team')}
        {chatUnread > 0 ? ` · ${chatUnread}` : ''}
      </button>
    )
  }

  return (
    <div className="hud-panel chat-panel">
      <div className="chat-head">
        <span className="hud-label" style={{ margin: 0 }}>
          {t('game.chat.team')}
        </span>
        <button
          className="chat-close"
          aria-label={t('game.chat.close')}
          onClick={() => setChatOpen(false)}
        >
          ✕
        </button>
      </div>
      <div className="chat-log" ref={logRef}>
        {chat.length === 0 && <p className="hint-text">{t('game.chat.onlyTeammate')}</p>}
        {chat.map((m) => (
          <p key={m.id} className="chat-line">
            <b style={{ color: seatColorCss(m.fromSeat) }}>{nameOf(m.fromSeat)}</b> {m.text}
          </p>
        ))}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          gameSocket.sendChat(gameId, draft)
          setDraft('')
        }}
      >
        <input
          type="text"
          value={draft}
          maxLength={280}
          placeholder={t('game.chat.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn" type="submit" disabled={draft.trim().length === 0}>
          {t('game.chat.send')}
        </button>
      </form>
    </div>
  )
}
