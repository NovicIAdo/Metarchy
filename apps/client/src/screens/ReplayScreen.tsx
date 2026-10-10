// Step-through replay of a finished ranked game. The server sends the seed + the
// move log; we reconstruct every state locally through the engine (see
// replay/buildReplay.ts), then show three synchronised views of the same match:
// the omniscient board scrubber, the per-turn story (events, Action Cards,
// conflict resolutions, purchases and draws) and the economy turn by turn.
// Lazy-loaded (App.tsx) so the engine only ships to the /replay chunk.

import type { PlayerSummary } from '@metarchy/protocol'
import { toNotation } from '@metarchy/engine'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { deriveBoardProps } from '../board/derive.js'
import { PixiBoard } from '../board/PixiBoard.js'
import { useT } from '../i18n/index.js'
import { gameSocket } from '../net/socket.js'
import type { ReplayBuild } from './replay/buildReplay.js'
import { buildReplay, notationHeader } from './replay/buildReplay.js'
import { ReplayEconomy, ReplayScoreboard } from './replay/ReplayEconomy.js'
import { ReplayFeed, describeLogItem, itemForFrame, useFeedContext } from './replay/ReplayFeed.js'

type Tab = 'story' | 'economy' | 'record'

export function ReplayScreen() {
  const { gameId } = useParams<{ gameId: string }>()
  const navigate = useNavigate()
  const t = useT()
  const [build, setBuild] = useState<ReplayBuild | null>(null)
  const [players, setPlayers] = useState<PlayerSummary[]>([])
  const [notation, setNotation] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const [tab, setTab] = useState<Tab>('story')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    if (!gameId) return
    let cancelled = false
    setBuild(null)
    setError(null)
    void (async () => {
      try {
        const data = await gameSocket.replayGet(gameId)
        if (cancelled) return
        const config = {
          gameId: data.gameId,
          mode: data.mode,
          seed: data.seed,
          seatCount: data.seatCount,
          controllers: data.controllers
        }
        const built = buildReplay(config, data.intents)
        if (cancelled) return
        setPlayers(data.players)
        setBuild(built)
        try {
          setNotation(toNotation(config, data.intents))
        } catch {
          setNotation([]) // a notation glitch must never break the visual replay
        }
        setIdx(0)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gameId])

  const frames = build?.frames ?? null
  const frame = frames?.[idx] ?? null
  const board = useMemo(
    () =>
      frame
        ? deriveBoardProps({ view: frame.view, staged: {}, activeActor: null, hoverLocation: null })
        : null,
    [frame]
  )
  const currentHeader = frame ? notationHeader(frame.turn, frame.phaseKind) : null

  // What the frame on screen actually shows, in words — the same story line the
  // feed highlights, printed under the board.
  const feedCtx = useFeedContext(players)
  const caption = useMemo(() => {
    if (!build) return null
    const item = itemForFrame(build.log, idx)
    if (!item) return null
    const line = describeLogItem(item.body, feedCtx)
    return [line.text, ...line.sub].filter(Boolean).join(' · ')
  }, [build, idx, feedCtx])

  // Keep the record scrolled to the current turn/phase — scroll ONLY the record
  // panel, never the page (scrollIntoView would drag the whole viewport down and
  // push the board off-screen).
  const recordRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const container = recordRef.current
    const line = container?.querySelector<HTMLElement>('.record-line.current')
    if (!container || !line) return
    const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [idx, notation, tab])

  // Auto-play: advance one frame on a timer until the end, then stop.
  useEffect(() => {
    if (!playing || !frames) return
    if (idx >= frames.length - 1) {
      setPlaying(false)
      return
    }
    const id = setTimeout(() => setIdx((i) => i + 1), 1100 / speed)
    return () => clearTimeout(id)
  }, [playing, idx, speed, frames])

  const copy = (): void => {
    void navigator.clipboard?.writeText(notation.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  if (error) {
    return (
      <div className="screen">
        <div className="panel">
          <p className="error-text">{t('replay.notFound')}</p>
          <button className="btn secondary" onClick={() => navigate('/replays')}>
            {t('replay.back')}
          </button>
        </div>
      </div>
    )
  }
  if (!build || !frames || !frame || !board) {
    return (
      <div className="screen">
        <div className="panel">
          <p className="waiting-pulse">{t('replay.building')}</p>
          <button className="btn secondary" onClick={() => navigate('/replays')}>
            {t('common.back')}
          </button>
        </div>
      </div>
    )
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'story', label: t('replay.tab.story') },
    { id: 'economy', label: t('replay.tab.economy') },
    { id: 'record', label: t('replay.record') }
  ]

  return (
    <div className="replay-stage">
      <div className="replay-board">
        <div className="replay-canvas">
          <PixiBoard
            board={board}
            onLocationTap={() => {}}
            onLocationHover={() => {}}
            onTokenTap={() => {}}
          />
        </div>
        <ReplayScoreboard view={frame.view} players={players} />
        <div className="replay-controls">
          <button
            className="btn"
            aria-label={playing ? t('replay.pause') : t('replay.play')}
            onClick={() => {
              if (playing) {
                setPlaying(false)
                return
              }
              if (idx >= frames.length - 1) setIdx(0)
              setPlaying(true)
            }}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button
            className="btn secondary"
            disabled={idx <= 0}
            onClick={() => {
              setPlaying(false)
              setIdx((i) => Math.max(0, i - 1))
            }}
          >
            {t('replay.prev')}
          </button>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={idx}
            onChange={(e) => {
              setPlaying(false)
              setIdx(Number(e.target.value))
            }}
            style={{ flex: 1 }}
          />
          <button
            className="btn secondary"
            disabled={idx >= frames.length - 1}
            onClick={() => {
              setPlaying(false)
              setIdx((i) => Math.min(frames.length - 1, i + 1))
            }}
          >
            {t('replay.next')}
          </button>
          <button
            className="btn secondary"
            aria-label={t('replay.speed', { n: speed })}
            onClick={() => setSpeed((s) => (s >= 4 ? 1 : s * 2))}
          >
            {speed}×
          </button>
        </div>
        {/* A rejected intent mid-log means the engine no longer agrees with the
            game as it was played — almost always a rules change since. Saying so
            beats a replay that just stops with no explanation. */}
        {build.truncated && <p className="replay-truncated">{t('replay.truncated')}</p>}
        <p className="replay-caption">
          <span className="hint-text">
            {currentHeader} · {t('replay.step', { n: idx + 1, total: frames.length })}
          </span>
          {caption && <span className="replay-caption-text">{caption}</span>}
        </p>
      </div>

      <div className="replay-record">
        <div className="replay-tabs">
          {TABS.map((x) => (
            <button
              key={x.id}
              type="button"
              className={tab === x.id ? 'chip-toggle active' : 'chip-toggle'}
              aria-pressed={tab === x.id}
              onClick={() => setTab(x.id)}
            >
              {x.label}
            </button>
          ))}
        </div>

        {tab === 'story' && (
          <ReplayFeed
            log={build.log}
            tieBreakerTurns={build.tieBreakerTurns}
            frame={idx}
            players={players}
            onJump={(f) => {
              setPlaying(false)
              setIdx(f)
            }}
          />
        )}

        {tab === 'economy' && (
          <ReplayEconomy
            economy={build.economy}
            tieBreakerTurns={build.tieBreakerTurns}
            players={players}
          />
        )}

        {tab === 'record' && (
          <>
            <pre ref={recordRef} className="replay-notation">
              {notation.map((line, i) => (
                <span
                  key={i}
                  className={
                    currentHeader && line.startsWith(currentHeader)
                      ? 'record-line current'
                      : 'record-line'
                  }
                >
                  {line}
                  {'\n'}
                </span>
              ))}
            </pre>
            <button className="btn secondary" onClick={copy}>
              {copied ? t('replay.copied') : t('replay.copy')}
            </button>
          </>
        )}

        <button className="btn secondary" onClick={() => navigate('/replays')}>
          {t('replay.back')}
        </button>
      </div>
    </div>
  )
}
