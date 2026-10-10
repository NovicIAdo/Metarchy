// Economy over time: every player's resources and Values turn by turn, with the
// change from the turn before and the reason for it (bets, market purchases,
// discards, conflict rewards). Author backlog #7: a replay must make the money
// legible, not just the board.
//
// Numbers come from the locally reconstructed engine states (./buildReplay.ts);
// the annotations are aggregated from the same event stream.

import type {
  PlayerView,
  ResourceType,
  Resources,
  SeatId,
  ValueType,
  Values
} from '@metarchy/engine'
import type { PlayerSummary } from '@metarchy/protocol'
import { useDomain } from '../../i18n/domain.js'
import { useT } from '../../i18n/index.js'
import { themeAsset } from '../../theme.js'
import { poolOfSeat } from '../game/phase-helpers.js'
import type { ReplayEconomyRow, ReplayEconomySeat } from './buildReplay.js'
import { seatColorCss, useFeedContext } from './ReplayFeed.js'

const RESOURCES: readonly ResourceType[] = ['product', 'electricity', 'recycling']
const VALUES: readonly ValueType[] = ['power', 'art', 'knowledge', 'fame']

function fmtDelta(n: number): string {
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`
}

/** icon + amount, with the turn's change beside it when there is one. */
function Stat({
  icon,
  label,
  amount,
  delta
}: {
  icon: string
  label: string
  amount: number
  delta?: number
}) {
  return (
    <span className="hud-mini-stat replay-eco-stat" title={label}>
      <img src={themeAsset(icon)} alt={label} />
      {amount}
      {delta !== undefined && delta !== 0 && (
        <em className={delta > 0 ? 'eco-up' : 'eco-down'}>{fmtDelta(delta)}</em>
      )}
    </span>
  )
}

function whyLine(
  seat: ReplayEconomySeat,
  t: ReturnType<typeof useT>,
  d: ReturnType<typeof useDomain>
): string[] {
  const parts: string[] = []
  if (seat.bets.length > 0)
    parts.push(t('replay.eco.bets', { list: seat.bets.map((b) => d.bet(b)).join(', ') }))
  if (seat.discarded)
    parts.push(
      t('replay.eco.discarded', {
        n: seat.discarded.amount,
        res: d.resource(seat.discarded.resource)
      })
    )
  if (seat.bought > 0) parts.push(t('replay.eco.bought', { n: seat.bought }))
  if (seat.drew.length > 0)
    parts.push(t('replay.eco.drew', { list: seat.drew.map((c) => d.actionCard(c)).join(', ') }))
  if (seat.rewards.length > 0) {
    // Fold repeats: three +1 Power reads worse than +3 Power.
    const folded = new Map<string, { label: string; amount: number }>()
    for (const r of seat.rewards) {
      const label =
        r.kind === 'value' ? d.value(r.type as ValueType) : d.resource(r.type as ResourceType)
      const known = folded.get(label)
      if (known) known.amount += r.amount
      else folded.set(label, { label, amount: r.amount })
    }
    parts.push(
      t('replay.eco.gained', {
        list: [...folded.values()].map((x) => `+${x.amount} ${x.label}`).join(', ')
      })
    )
  }
  return parts
}

export function ReplayEconomy({
  economy,
  tieBreakerTurns,
  players
}: {
  economy: ReplayEconomyRow[]
  tieBreakerTurns: number[]
  players: PlayerSummary[]
}) {
  const t = useT()
  const d = useDomain()
  const { nameOf } = useFeedContext(players)

  return (
    <div className="replay-eco">
      <p className="hint-text replay-eco-hint">{t('replay.eco.hint')}</p>
      {economy.map((row) => (
        <section key={row.turn} className="replay-eco-turn">
          <p className="replay-feed-head">
            {row.turn === 0
              ? t('replay.eco.start')
              : tieBreakerTurns.includes(row.turn)
                ? `${t('replay.eco.turnEnd', { n: row.turn })} · ${t('replay.turnTie', { n: row.turn })}`
                : t('replay.eco.turnEnd', { n: row.turn })}
          </p>
          {row.seats.map((seat) => {
            const why = whyLine(seat, t, d)
            return (
              <div key={seat.seat} className="replay-eco-seat">
                <div className="replay-eco-name">
                  <span className="hud-seat-dot" style={{ background: seatColorCss(seat.seat) }} />
                  <span>{nameOf(seat.seat)}</span>
                  {seat.eliminated && <em className="eco-down">{t('replay.eco.out')}</em>}
                </div>
                <div className="hud-player-stats">
                  {RESOURCES.map((r) => (
                    <Stat
                      key={r}
                      icon={`resource.${r}`}
                      label={d.resource(r)}
                      amount={seat.resources[r]}
                      delta={seat.eliminated ? 0 : seat.dResources[r]}
                    />
                  ))}
                </div>
                <div className="hud-player-stats">
                  {VALUES.map((v) => (
                    <Stat
                      key={v}
                      icon={`value.${v}`}
                      label={d.value(v)}
                      amount={seat.values[v]}
                      delta={seat.eliminated ? 0 : seat.dValues[v]}
                    />
                  ))}
                </div>
                <p className="replay-eco-why">
                  {why.length > 0 ? why.join(' · ') : t('replay.eco.noChange')}
                </p>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

/**
 * The live strip under the board: where every player stands at the frame on
 * screen. The replay view is omniscient, so `others` carries every seat's real
 * resources (`me` is the seatless spectator sentinel and stays empty).
 */
export function ReplayScoreboard({
  view,
  players
}: {
  view: PlayerView
  players: PlayerSummary[]
}) {
  const d = useDomain()
  const { nameOf } = useFeedContext(players)
  const seats = [...view.others.map((o) => o.seat)].sort((a, b) => a - b)

  const resourcesOf = (seat: SeatId): Resources | null =>
    view.others.find((o) => o.seat === seat)?.resources ?? null
  const valuesOfSeat = (seat: SeatId): Values | null => poolOfSeat(view, seat)

  return (
    <div className="replay-score">
      {seats.map((seat) => {
        const resources = resourcesOf(seat)
        const values = valuesOfSeat(seat)
        const gone = view.eliminated.includes(seat)
        return (
          <div key={seat} className={`replay-score-seat${gone ? ' eliminated' : ''}`}>
            <span className="hud-seat-dot" style={{ background: seatColorCss(seat) }} />
            <span className="replay-score-name">{nameOf(seat)}</span>
            {RESOURCES.map((r) => (
              <Stat
                key={r}
                icon={`resource.${r}`}
                label={d.resource(r)}
                amount={resources?.[r] ?? 0}
              />
            ))}
            {VALUES.map((v) => (
              <Stat key={v} icon={`value.${v}`} label={d.value(v)} amount={values?.[v] ?? 0} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
