// The replay story panel: every turn's events, Action Cards, conflict
// resolutions, purchases and draws, in play order, grouped by turn and phase.
// Each line jumps the board to the moment it describes.
//
// Wording is composed from the shared domain labels (i18n/domain.ts) plus the
// `replay.log.*` sentences, so the whole story is translated EN/RU/SI. The facts
// come from the engine event stream — see ./buildReplay.ts.

import type { SeatId } from '@metarchy/engine'
import type { PlayerSummary } from '@metarchy/protocol'
import { useEffect, useMemo, useRef } from 'react'
import { SEAT_COLORS } from '../../board/layout.js'
import type { DomainLabels } from '../../i18n/domain.js'
import { useDomain } from '../../i18n/domain.js'
import { useT, type TFunction } from '../../i18n/index.js'
import type { ReplayLogBody, ReplayLogItem, ReplayReward } from './buildReplay.js'
import { groupLog } from './buildReplay.js'

export interface FeedContext {
  t: TFunction
  d: DomainLabels
  nameOf(seat: SeatId): string
}

/** One feed line: a headline plus optional detail lines under it. */
export interface FeedLine {
  text: string
  sub: string[]
}

const PHASE_KIND = ['', 'p1_event', 'p2_distribution', 'p3_action', 'p4_conflict', 'p5_market']

export function seatColorCss(seat: SeatId): string {
  return `#${(SEAT_COLORS[seat] ?? 0x8a8f98).toString(16).padStart(6, '0')}`
}

/** Seats a line is about — rendered as colour dots in front of it. */
export function seatsOfBody(body: ReplayLogBody): SeatId[] {
  switch (body.t) {
    case 'eventWinner':
    case 'tiebreakWon':
      return body.seats
    case 'eventCard':
    case 'placements':
    case 'cards':
    case 'block':
    case 'exchange':
    case 'market':
    case 'eliminated':
      return [body.seat]
    case 'reloc':
      return [body.seat]
    case 'collision':
      return body.winner === null ? [] : [body.winner]
    case 'discards':
      return body.amounts.map((x) => x.seat)
    case 'tiebreak':
      return body.picks.map((x) => x.seat)
    case 'conflict':
      return body.sides.map((x) => x.seat)
    case 'round':
      return body.outcomes.map((x) => x.seat)
    case 'bets':
      return body.bets.map((x) => x.seat)
    case 'result':
      return body.results.map((x) => x.seat)
    case 'peaceful':
      return body.results.map((x) => x.seat)
    case 'closed':
      return body.actors.map((x) => x.seat)
    case 'finished':
      return body.winnerSeats
    default:
      return []
  }
}

function rewardText(reward: ReplayReward | null, ctx: FeedContext): string {
  if (!reward) return ctx.t('game.conflict.nothing')
  const what =
    reward.kind === 'value'
      ? ctx.d.value(reward.type as never)
      : ctx.d.resource(reward.type as never)
  return `+${reward.amount} ${what}`
}

/**
 * Render one log item into display text. Pure — it only needs a translator, the
 * domain labels and a seat→name lookup, which makes it directly testable and
 * re-renders in the new language the moment the user switches.
 */
export function describeLogItem(body: ReplayLogBody, ctx: FeedContext): FeedLine {
  const { t, d, nameOf } = ctx
  const outcomeWord = (outcome: string): string => t(`bet.${outcome}`)
  const betText = (bet: string): string => t('replay.log.betOn', { bet: d.bet(bet as never) })
  const names = (seats: SeatId[]): string => seats.map(nameOf).join(', ')

  switch (body.t) {
    case 'event': {
      const line: FeedLine = {
        text: `${d.eventCard(body.card)} — ${d.eventCardRule(body.card)}`,
        sub: []
      }
      if (body.standings) {
        const metric =
          body.metric === 'total' ? t('replay.log.totalValues') : d.value(body.metric as never)
        line.sub.push(
          t('replay.log.compare', {
            metric,
            list: body.standings.map((s) => `${nameOf(s.seat)} — ${s.amount}`).join(', ')
          })
        )
      }
      return line
    }
    case 'discards':
      return {
        text: t('replay.log.discards', {
          res: d.resource(body.resource),
          list: body.amounts.map((a) => `${nameOf(a.seat)} — ${a.amount}`).join(', ')
        }),
        sub: []
      }
    case 'eventWinner':
      return {
        text: t('replay.log.eventWinner', {
          who: names(body.seats),
          n: body.fame,
          fame: d.value('fame')
        }),
        sub: []
      }
    case 'eventDraw':
      return { text: t('game.event.noReward'), sub: [] }
    case 'eventCard':
      return {
        text: body.card
          ? t('replay.log.eventCardWon', {
              who: nameOf(body.seat),
              card: d.actionCard(body.card)
            })
          : t('replay.log.eventWonNoCard', { who: nameOf(body.seat) }),
        sub: []
      }
    case 'tiebreak':
      return {
        text: t('replay.log.tiebreak', {
          n: body.round,
          list: body.picks.map((p) => `${nameOf(p.seat)} — ${d.argument(p.rps)}`).join(', ')
        }),
        sub: []
      }
    case 'tiebreakWon':
      return { text: t('replay.log.tiebreakWon', { who: names(body.seats) }), sub: [] }
    case 'placements':
      return {
        text: nameOf(body.seat),
        sub: body.rows.map(
          (r) =>
            `${d.actor(r.actorType)} → ${d.location(r.locationId)} · ${d.argument(r.argument)}` +
            (r.bet ? ` · ${betText(r.bet)}` : '')
        )
      }
    case 'cards':
      return {
        text: t('replay.log.cards', {
          who: nameOf(body.seat),
          list: body.cards.map((c) => d.actionCard(c)).join(', ')
        }),
        sub: []
      }
    case 'block':
      return {
        text: t('replay.log.blocked', {
          who: nameOf(body.seat),
          card: d.actionCard(body.card),
          loc: d.location(body.locationId)
        }),
        sub: []
      }
    case 'reloc': {
      // Naming the owner only matters when someone moved a RIVAL's Actor.
      const owner = body.ownerSeat === body.seat ? '' : ` (${nameOf(body.ownerSeat)})`
      return {
        text:
          `${nameOf(body.seat)} · ${d.actionCard('relocation')} — ` +
          `${d.actor(body.actorType)}${owner}: ` +
          `${d.location(body.from)} → ${d.location(body.to)}`,
        sub: []
      }
    }
    case 'relocNone':
      return { text: t('game.results.relocNone'), sub: [] }
    case 'collision':
      return {
        text:
          body.winner === null
            ? t('replay.log.collisionNone', { actor: d.actor(body.actorType) })
            : t('replay.log.collision', {
                actor: d.actor(body.actorType),
                who: nameOf(body.winner)
              }),
        sub: []
      }
    case 'exchange':
      return {
        text: t('replay.log.exchanged', {
          who: nameOf(body.seat),
          card: d.actionCard('change_values'),
          give: d.value(body.give),
          take: d.value(body.take),
          whom: nameOf(body.from)
        }),
        sub: []
      }
    case 'conflict':
      return {
        text: t('replay.log.conflict', {
          n: body.n,
          where: t('game.conflict.actorsAt', {
            actor: d.actor(body.actorType),
            loc: d.location(body.locationId)
          })
        }),
        sub: body.sides.map(
          (s) =>
            `${nameOf(s.seat)} · ${d.argument(s.argument)}` +
            (s.bet ? ` · ${betText(s.bet)}` : '') +
            (s.outcome ? ` → ${outcomeWord(s.outcome)}` : '')
        )
      }
    case 'round':
      return {
        text: `${t('game.conflict.refight', { n: body.round })}`,
        sub: body.picks.map((p) => {
          const outcome = body.outcomes.find((o) => o.seat === p.seat)?.outcome
          return (
            `${nameOf(p.seat)} · ${d.argument(p.rps)}` +
            (outcome ? ` → ${outcomeWord(outcome)}` : '')
          )
        })
      }
    case 'bets':
      return {
        text: t('replay.log.bets'),
        sub: body.bets.map((b) =>
          t(b.success ? 'replay.log.betPlayed' : 'replay.log.betFailed', {
            who: nameOf(b.seat),
            bet: d.bet(b.bet)
          })
        )
      }
    case 'deadlock':
      return { text: t('replay.log.deadlock'), sub: [] }
    case 'result':
      return {
        text: t('replay.log.result'),
        sub: body.results.map(
          (r) =>
            `${nameOf(r.seat)} · ${d.actor(r.actorType)} · ${outcomeWord(r.outcome)} · ` +
            rewardText(r.reward, ctx)
        )
      }
    case 'peaceful':
      return {
        text: t('replay.log.peaceful'),
        sub: body.results.map(
          (r) =>
            `${nameOf(r.seat)} · ${d.actor(r.actorType)} · ${d.location(r.locationId)} · ` +
            rewardText(r.reward, ctx)
        )
      }
    case 'closed':
      return {
        text: t('replay.log.closed', {
          loc: d.location(body.locationId),
          list: body.actors.map((a) => `${nameOf(a.seat)} · ${d.actor(a.actorType)}`).join(', ')
        }),
        sub: []
      }
    case 'market': {
      const list = body.cards.map((c) => d.actionCard(c)).join(', ')
      return {
        text:
          body.bought < body.requested
            ? t('replay.log.boughtShort', {
                who: nameOf(body.seat),
                requested: body.requested,
                n: body.bought,
                list
              })
            : t('replay.log.bought', { who: nameOf(body.seat), n: body.bought, list }),
        sub: []
      }
    }
    case 'eliminated': {
      const key =
        body.reason === 'disconnect'
          ? 'replay.log.outDisconnect'
          : body.reason === 'forfeit'
            ? 'replay.log.outForfeit'
            : 'replay.log.outScoring'
      return { text: t(key, { who: nameOf(body.seat), n: body.vp ?? 0 }), sub: [] }
    }
    case 'scoring':
      return {
        text: t('replay.log.scoring', {
          list: body.sides.map((s) => `${names(s.seats)} — ${s.vp}`).join(', ')
        }),
        sub: []
      }
    case 'finished':
      return {
        text:
          body.winnerSeats.length === 0
            ? t('replay.log.finishedDraw')
            : t('replay.log.finished', { who: names(body.winnerSeats) }),
        sub: []
      }
  }
}

/** The line that describes the board frame currently on screen. */
export function itemForFrame(log: ReplayLogItem[], frame: number): ReplayLogItem | null {
  let found: ReplayLogItem | null = null
  for (const item of log) {
    if (item.frame > frame) break
    found = item
  }
  return found
}

export function useFeedContext(players: PlayerSummary[]): FeedContext {
  const t = useT()
  const d = useDomain()
  return useMemo(
    () => ({
      t,
      d,
      nameOf: (seat: SeatId) => {
        const p = players.find((x) => x.seat === seat)
        return p ? `${p.nickname}${p.bot ? ' 🤖' : ''}` : t('game.seat', { n: seat })
      }
    }),
    // t/d are fresh closures on every language change, which is exactly when
    // the whole feed must re-render.
    [t, d, players]
  )
}

export function ReplayFeed({
  log,
  tieBreakerTurns,
  frame,
  players,
  onJump
}: {
  log: ReplayLogItem[]
  tieBreakerTurns: number[]
  frame: number
  players: PlayerSummary[]
  onJump(frame: number): void
}) {
  const t = useT()
  const d = useDomain()
  const ctx = useFeedContext(players)
  const groups = useMemo(() => groupLog(log), [log])
  const currentId = itemForFrame(log, frame)?.id ?? null

  // Follow the playhead — scroll the PANEL only, never the page (a
  // scrollIntoView here would drag the board off screen).
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = scroller.current
    const line = container?.querySelector<HTMLElement>('.replay-feed-item.current')
    if (!container || !line) return
    const top = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2
    container.scrollTo?.({ top: Math.max(0, top), behavior: 'smooth' })
  }, [currentId])

  if (log.length === 0) return <p className="hint-text">{t('replay.feed.empty')}</p>

  return (
    <div className="replay-feed" ref={scroller}>
      {groups.map((group, i) => (
        <section key={i} className="replay-feed-group">
          <p className="replay-feed-head">
            {t(tieBreakerTurns.includes(group.turn) ? 'replay.turnTie' : 'replay.turn', {
              n: group.turn
            })}
            {group.phase > 0 ? ` · ${d.phase(PHASE_KIND[group.phase] as string)}` : ''}
          </p>
          <ul className="replay-feed-list">
            {group.items.map((item) => {
              const line = describeLogItem(item.body, ctx)
              const seats = seatsOfBody(item.body)
              return (
                <li
                  key={item.id}
                  className={`replay-feed-item${item.id === currentId ? ' current' : ''}`}
                >
                  <button
                    type="button"
                    className="replay-feed-line"
                    title={t('replay.feed.jump')}
                    onClick={() => onJump(item.frame)}
                  >
                    <span className="replay-feed-dots">
                      {seats.map((seat, k) => (
                        <span
                          key={`${seat}-${k}`}
                          className="hud-seat-dot"
                          style={{ background: seatColorCss(seat) }}
                        />
                      ))}
                    </span>
                    <span className="replay-feed-text">
                      {line.text && <span className="replay-feed-main">{line.text}</span>}
                      {line.sub.map((s, k) => (
                        <span key={k} className="replay-feed-sub">
                          {s}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
