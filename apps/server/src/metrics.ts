// Prometheus metrics (Stage 6 observability). Fly scrapes /metrics into its
// managed Grafana (fly-metrics.net) — no extra infra. One Registry per server
// instance: the default global registry would collide across test servers.

import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client'

/** Live values polled at scrape time; wired to the hub after construction. */
export interface MetricsSources {
  roomCount(): number
  sessionCount(): number
  queueWaiting(): { mode: string; waiting: number }[]
}

export interface Metrics {
  registry: Registry
  gamesStarted: Counter<'mode'>
  gamesFinished: Counter<'mode' | 'outcome'>
  intents: Counter<'result'>
  wsMessages: Counter<'type'>
  matches: Counter<'mode' | 'fill'>
  clientErrors: Counter<string>
  bindSources(sources: MetricsSources): void
}

export function createMetrics(): Metrics {
  const registry = new Registry()
  collectDefaultMetrics({ register: registry })

  let sources: MetricsSources | null = null

  new Gauge({
    name: 'metarchy_rooms',
    help: 'Live game rooms (lobby + active)',
    registers: [registry],
    collect() {
      if (sources) this.set(sources.roomCount())
    }
  })
  new Gauge({
    name: 'metarchy_sessions',
    help: 'Authenticated WebSocket sessions',
    registers: [registry],
    collect() {
      if (sources) this.set(sources.sessionCount())
    }
  })
  const queueGauge = new Gauge({
    name: 'metarchy_queue_waiting',
    help: 'Players waiting in the matchmaking queue',
    labelNames: ['mode'] as const,
    registers: [registry],
    collect() {
      if (!sources) return
      this.reset()
      for (const { mode, waiting } of sources.queueWaiting()) this.set({ mode }, waiting)
    }
  })
  void queueGauge

  return {
    registry,
    gamesStarted: new Counter({
      name: 'metarchy_games_started_total',
      help: 'Games that left the lobby',
      labelNames: ['mode'] as const,
      registers: [registry]
    }),
    gamesFinished: new Counter({
      name: 'metarchy_games_finished_total',
      help: 'Games that ended, by outcome',
      labelNames: ['mode', 'outcome'] as const,
      registers: [registry]
    }),
    intents: new Counter({
      name: 'metarchy_intents_total',
      help: 'Engine intents processed',
      labelNames: ['result'] as const,
      registers: [registry]
    }),
    wsMessages: new Counter({
      name: 'metarchy_ws_messages_total',
      help: 'Parsed client frames by type',
      labelNames: ['type'] as const,
      registers: [registry]
    }),
    matches: new Counter({
      name: 'metarchy_matches_total',
      help: 'Matchmaking outcomes (humans paired vs bot fallback)',
      labelNames: ['mode', 'fill'] as const,
      registers: [registry]
    }),
    clientErrors: new Counter({
      name: 'metarchy_client_errors_total',
      help: 'Error reports posted by browsers',
      registers: [registry]
    }),
    bindSources(next) {
      sources = next
    }
  }
}
