// Load-run statistics: fixed-bucket latency histograms (mergeable across
// workers over IPC) plus plain counters. Buckets are pseudo-logarithmic in ms;
// percentile answers the bucket's upper bound — good enough for a load report.

export const LATENCY_BUCKETS_MS = [
  1,
  2,
  3,
  5,
  8,
  13,
  20,
  30,
  50,
  80,
  130,
  200,
  300,
  500,
  800,
  1300,
  2000,
  3000,
  5000,
  8000,
  13000,
  Infinity
] as const

export interface HistogramData {
  counts: number[]
  total: number
  sum: number
  max: number
}

export function emptyHistogram(): HistogramData {
  return { counts: LATENCY_BUCKETS_MS.map(() => 0), total: 0, sum: 0, max: 0 }
}

export function recordLatency(h: HistogramData, ms: number): void {
  let i = 0
  while (ms > (LATENCY_BUCKETS_MS[i] as number)) i++
  ;(h.counts[i] as number)++
  h.total++
  h.sum += ms
  if (ms > h.max) h.max = ms
}

export function mergeHistogram(into: HistogramData, from: HistogramData): void {
  from.counts.forEach((c, i) => {
    into.counts[i] = (into.counts[i] ?? 0) + c
  })
  into.total += from.total
  into.sum += from.sum
  if (from.max > into.max) into.max = from.max
}

export function percentile(h: HistogramData, p: number): number {
  if (h.total === 0) return 0
  const target = Math.ceil((p / 100) * h.total)
  let seen = 0
  for (let i = 0; i < h.counts.length; i++) {
    seen += h.counts[i] as number
    if (seen >= target) {
      const bound = LATENCY_BUCKETS_MS[i] as number
      return Number.isFinite(bound) ? bound : h.max
    }
  }
  return h.max
}

export interface LoadCounters {
  gamesStarted: number
  gamesFinished: number
  gamesFailed: number
  gamesStuck: number
  intentsSent: number
  ruleViolations: number
  rateLimited: number
  resyncsSent: number
  otherErrors: Record<string, number>
  msgsIn: number
  msgsOut: number
  bytesIn: number
  socketDrops: number
}

export interface StatsSnapshot {
  counters: LoadCounters
  resyncRtt: HistogramData
  gameDurationS: HistogramData
}

export function emptySnapshot(): StatsSnapshot {
  return {
    counters: {
      gamesStarted: 0,
      gamesFinished: 0,
      gamesFailed: 0,
      gamesStuck: 0,
      intentsSent: 0,
      ruleViolations: 0,
      rateLimited: 0,
      resyncsSent: 0,
      otherErrors: {},
      msgsIn: 0,
      msgsOut: 0,
      bytesIn: 0,
      socketDrops: 0
    },
    resyncRtt: emptyHistogram(),
    gameDurationS: emptyHistogram()
  }
}

export function mergeSnapshot(into: StatsSnapshot, from: StatsSnapshot): void {
  const a = into.counters
  const b = from.counters
  a.gamesStarted += b.gamesStarted
  a.gamesFinished += b.gamesFinished
  a.gamesFailed += b.gamesFailed
  a.gamesStuck += b.gamesStuck
  a.intentsSent += b.intentsSent
  a.ruleViolations += b.ruleViolations
  a.rateLimited += b.rateLimited
  a.resyncsSent += b.resyncsSent
  a.msgsIn += b.msgsIn
  a.msgsOut += b.msgsOut
  a.bytesIn += b.bytesIn
  a.socketDrops += b.socketDrops
  for (const [code, n] of Object.entries(b.otherErrors))
    a.otherErrors[code] = (a.otherErrors[code] ?? 0) + n
  mergeHistogram(into.resyncRtt, from.resyncRtt)
  mergeHistogram(into.gameDurationS, from.gameDurationS)
}

export function formatSummary(s: StatsSnapshot): string {
  const c = s.counters
  const lat = s.resyncRtt
  const dur = s.gameDurationS
  const err = Object.entries(c.otherErrors)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ')
  return [
    `games: started=${c.gamesStarted} finished=${c.gamesFinished} failed=${c.gamesFailed} stuck=${c.gamesStuck}`,
    `intents=${c.intentsSent} ruleViolations=${c.ruleViolations} rateLimited=${c.rateLimited} resyncs=${c.resyncsSent} drops=${c.socketDrops}`,
    `resync RTT ms: p50=${percentile(lat, 50)} p95=${percentile(lat, 95)} p99=${percentile(lat, 99)} max=${Math.round(lat.max)} (n=${lat.total})`,
    `game duration s: p50=${percentile(dur, 50)} p95=${percentile(dur, 95)} (n=${dur.total})`,
    `wire: in=${c.msgsIn} msgs / ${(c.bytesIn / 1048576).toFixed(1)} MiB, out=${c.msgsOut} msgs`,
    err ? `other errors: ${err}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}
