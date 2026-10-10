// Load-test orchestrator (plan Stage 6: 1 000 concurrent games on one Fly
// machine). Forks load-worker.ts processes that each run a share of the player
// slots, aggregates their cumulative stats, scrapes the target's /metrics on an
// interval, and writes a machine-readable run log + a human summary.
//
// Usage (against a deployed server):
//   pnpm exec tsx scripts/load-test.ts --url https://metarchy-loadtest.fly.dev \
//     --games 1000 --duration 900 --ramp-rate 25
//
// Single-shot shakeout (every slot plays exactly one game, then the run ends):
//   pnpm exec tsx scripts/load-test.ts --url http://127.0.0.1:8080 --games 30 --duration 0

import { fork } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { loadOrCreateKeys } from '../src/load/keys.js'
import type { StatsSnapshot } from '../src/load/stats.js'
import { emptySnapshot, formatSummary, mergeSnapshot, percentile } from '../src/load/stats.js'

// --- args ------------------------------------------------------------------------

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

const httpUrl = (arg('url') ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const wsUrl = httpUrl.replace(/^http/, 'ws') + '/ws'
const games = Number(arg('games', '100'))
const durationS = Number(arg('duration', '600'))
const rampRate = Number(arg('ramp-rate', '25'))
const workerCount = Number(arg('workers', String(Math.min(10, Math.max(2, cpus().length - 2)))))
const seats3 = arg('seats3', '0.2') as string
const keysPath = arg('keys', new URL('../.loadtest/keys.json', import.meta.url).pathname) as string
const metricsIntervalMs = Number(arg('metrics-interval', '10')) * 1000
const thinkMin = arg('think-min', '150') as string
const thinkMax = arg('think-max', '500') as string
const maxFailPct = Number(arg('max-fail-pct', '20'))
const outDir =
  arg('out') ??
  new URL(
    `../load-results/${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}/`,
    import.meta.url
  ).pathname

// --- prometheus text parsing -----------------------------------------------------

type PromSample = { labels: Record<string, string>; value: number }
type PromDump = Map<string, PromSample[]>

function parseProm(text: string): PromDump {
  const out: PromDump = new Map()
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(-?[0-9.eE+]+|NaN)/.exec(line)
    if (!m) continue
    const [, name, labelStr, valueStr] = m as unknown as [
      string,
      string,
      string | undefined,
      string
    ]
    const labels: Record<string, string> = {}
    if (labelStr)
      for (const part of labelStr.split(',')) {
        const eq = part.indexOf('=')
        if (eq > 0) labels[part.slice(0, eq)] = part.slice(eq + 1).replace(/^"|"$/g, '')
      }
    const value = Number(valueStr)
    const list = out.get(name as string) ?? []
    list.push({ labels, value })
    out.set(name as string, list)
  }
  return out
}

function promValue(dump: PromDump, name: string, labels?: Record<string, string>): number | null {
  const list = dump.get(name)
  if (!list) return null
  let sum = 0
  let hit = false
  for (const s of list) {
    if (labels && !Object.entries(labels).every(([k, v]) => s.labels[k] === v)) continue
    sum += s.value
    hit = true
  }
  return hit ? sum : null
}

async function scrape(): Promise<PromDump | null> {
  try {
    const res = await fetch(`${httpUrl}/metrics`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return parseProm(await res.text())
  } catch {
    return null
  }
}

// --- run -------------------------------------------------------------------------

await mkdir(outDir, { recursive: true })
// Ensure key material exists before any worker tries to read it.
await loadOrCreateKeys(keysPath)

const runConfig = {
  httpUrl,
  games,
  durationS,
  rampRate,
  workerCount,
  seats3: Number(seats3),
  thinkMinMs: Number(thinkMin),
  thinkMaxMs: Number(thinkMax),
  startedAt: new Date().toISOString()
}
await writeFile(join(outDir, 'run-config.json'), JSON.stringify(runConfig, null, 2))
console.log(`load-test: ${games} concurrent games → ${httpUrl}`)
console.log(
  `  workers=${workerCount} ramp=${rampRate}/s steady=${durationS}s out=${outDir.replace(process.cwd(), '.')}`
)

const health = await fetch(`${httpUrl}/healthz`, { signal: AbortSignal.timeout(8000) })
if (!health.ok) throw new Error(`healthz ${health.status} — target not reachable`)
const initialProm = await scrape()

const perWorker = Math.floor(games / workerCount)
const remainder = games - perWorker * workerCount
const rampSpacingMs = 1000 / rampRate
const rampEndsAt = Date.now() + (games / rampRate) * 1000 + 5_000
const deadlineEpochMs = durationS > 0 ? rampEndsAt + durationS * 1000 : 0

const workers: ChildProcess[] = []
const latestByWorker = new Map<number, StatsSnapshot>()
let doneWorkers = 0
let stopping = false

const workerPath = new URL('./load-worker.ts', import.meta.url).pathname
let slotCursor = 0
for (let i = 0; i < workerCount; i++) {
  const slots = perWorker + (i < remainder ? 1 : 0)
  if (slots === 0) continue
  const slotOffset = slotCursor
  slotCursor += slots
  const child = fork(workerPath, [], {
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      LOAD_URL: wsUrl,
      LOAD_KEYS: keysPath,
      LOAD_SLOTS: String(slots),
      LOAD_RAMP_MS: String(Math.round(rampSpacingMs * workerCount)),
      LOAD_START_DELAY_MS: String(Math.round(i * rampSpacingMs)),
      LOAD_DEADLINE_EPOCH_MS: String(deadlineEpochMs),
      LOAD_SEATS3_FRAC: seats3,
      LOAD_THINK_MIN_MS: thinkMin,
      LOAD_THINK_MAX_MS: thinkMax,
      LOAD_WORKER_ID: String(i),
      LOAD_SLOT_OFFSET: String(slotOffset)
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  })
  child.on('message', (msg: { type?: string; snapshot?: StatsSnapshot; line?: string }) => {
    if (msg.type === 'stats' && msg.snapshot) latestByWorker.set(i, msg.snapshot)
    if (msg.type === 'log' && msg.line) console.log(`  ! ${msg.line}`)
    if (msg.type === 'done') {
      doneWorkers++
    }
  })
  child.on('exit', (code) => {
    if (code !== 0 && !stopping) console.log(`  ! worker ${i} exited with code ${code}`)
  })
  workers.push(child)
}

function mergedStats(): StatsSnapshot {
  const merged = emptySnapshot()
  for (const snap of latestByWorker.values()) mergeSnapshot(merged, snap)
  return merged
}

function broadcastStop(): void {
  if (stopping) return
  stopping = true
  for (const w of workers) {
    try {
      w.send({ type: 'stop' })
    } catch {
      // already gone
    }
  }
}

process.on('SIGINT', () => {
  console.log('\nSIGINT — stopping workers')
  broadcastStop()
})

// --- monitoring loop ----------------------------------------------------------------

const t0 = Date.now()
let lastCpu: { t: number; v: number } | null = null
let missedScrapes = 0
const series: object[] = []

async function tick(): Promise<void> {
  const stats = mergedStats()
  const c = stats.counters
  const prom = await scrape()
  const now = Date.now()
  let server = ''
  if (prom) {
    missedScrapes = 0
    const rooms = promValue(prom, 'metarchy_rooms')
    const sessions = promValue(prom, 'metarchy_sessions')
    const rss = promValue(prom, 'process_resident_memory_bytes')
    const heap = promValue(prom, 'nodejs_heap_size_used_bytes')
    const lagP99 = promValue(prom, 'nodejs_eventloop_lag_p99_seconds')
    const cpuTotal = promValue(prom, 'process_cpu_seconds_total')
    const applied = promValue(prom, 'metarchy_intents_total', { result: 'applied' })
    const rejected = promValue(prom, 'metarchy_intents_total', { result: 'rejected' })
    let cpuPct: number | null = null
    if (cpuTotal !== null) {
      if (lastCpu) cpuPct = ((cpuTotal - lastCpu.v) / ((now - lastCpu.t) / 1000)) * 100
      lastCpu = { t: now, v: cpuTotal }
    }
    server =
      ` | srv rooms=${rooms} sess=${sessions}` +
      ` rss=${rss !== null ? (rss / 1048576).toFixed(0) : '?'}MiB` +
      ` heap=${heap !== null ? (heap / 1048576).toFixed(0) : '?'}MiB` +
      ` cpu=${cpuPct !== null ? cpuPct.toFixed(0) : '?'}%` +
      ` lag99=${lagP99 !== null ? (lagP99 * 1000).toFixed(0) : '?'}ms`
    series.push({
      t: Math.round((now - t0) / 1000),
      rooms,
      sessions,
      rss,
      heap,
      lagP99,
      cpuPct,
      intentsApplied: applied,
      intentsRejected: rejected,
      client: {
        started: c.gamesStarted,
        finished: c.gamesFinished,
        failed: c.gamesFailed,
        stuck: c.gamesStuck,
        rateLimited: c.rateLimited,
        rttP50: percentile(stats.resyncRtt, 50),
        rttP95: percentile(stats.resyncRtt, 95),
        rttP99: percentile(stats.resyncRtt, 99)
      }
    })
    await appendFile(
      join(outDir, 'metrics.jsonl'),
      JSON.stringify(series[series.length - 1]) + '\n'
    )
  } else {
    missedScrapes++
    server = ` | srv UNREACHABLE (${missedScrapes})`
  }
  const active = c.gamesStarted - c.gamesFinished - c.gamesFailed
  console.log(
    `[+${String(Math.round((now - t0) / 1000)).padStart(4)}s]` +
      ` act=${active} fin=${c.gamesFinished} fail=${c.gamesFailed}` +
      ` rtt95=${percentile(stats.resyncRtt, 95)}ms rl=${c.rateLimited}` +
      server
  )
  if (c.gamesStarted > 100 && (c.gamesFailed / c.gamesStarted) * 100 > maxFailPct) {
    console.log(`fail rate above ${maxFailPct}% — aborting run`)
    broadcastStop()
  }
  if (missedScrapes >= 6) {
    console.log('target unreachable for 6 scrapes — aborting run (this IS a finding)')
    broadcastStop()
  }
}

const monitor = setInterval(() => void tick(), metricsIntervalMs)

// End condition: single-shot → all workers done; steady-state → deadline.
await new Promise<void>((resolve) => {
  const check = setInterval(() => {
    if (doneWorkers >= workers.length) {
      clearInterval(check)
      resolve()
      return
    }
    if (deadlineEpochMs > 0 && Date.now() > deadlineEpochMs + 30_000) {
      broadcastStop()
    }
    if (stopping && doneWorkers >= workers.length) {
      clearInterval(check)
      resolve()
    }
  }, 1000)
})
clearInterval(monitor)
// Give the last stats messages a beat to arrive, then snapshot everything.
await new Promise((r) => setTimeout(r, 1500))

const final = mergedStats()
const finalProm = await scrape()
const report = {
  config: runConfig,
  finishedAt: new Date().toISOString(),
  client: {
    ...final.counters,
    resyncRtt: {
      p50: percentile(final.resyncRtt, 50),
      p95: percentile(final.resyncRtt, 95),
      p99: percentile(final.resyncRtt, 99),
      max: final.resyncRtt.max,
      count: final.resyncRtt.total
    },
    gameDurationS: {
      p50: percentile(final.gameDurationS, 50),
      p95: percentile(final.gameDurationS, 95),
      count: final.gameDurationS.total
    }
  },
  server:
    finalProm && initialProm
      ? {
          intentsApplied:
            (promValue(finalProm, 'metarchy_intents_total', { result: 'applied' }) ?? 0) -
            (promValue(initialProm, 'metarchy_intents_total', { result: 'applied' }) ?? 0),
          intentsRejected:
            (promValue(finalProm, 'metarchy_intents_total', { result: 'rejected' }) ?? 0) -
            (promValue(initialProm, 'metarchy_intents_total', { result: 'rejected' }) ?? 0),
          gamesStartedTotal:
            (promValue(finalProm, 'metarchy_games_started_total') ?? 0) -
            (promValue(initialProm, 'metarchy_games_started_total') ?? 0),
          gamesFinishedTotal:
            (promValue(finalProm, 'metarchy_games_finished_total') ?? 0) -
            (promValue(initialProm, 'metarchy_games_finished_total') ?? 0),
          finalRss: promValue(finalProm, 'process_resident_memory_bytes'),
          finalRooms: promValue(finalProm, 'metarchy_rooms')
        }
      : null
}
await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))

console.log('\n=== load-test summary ===')
console.log(formatSummary(final))
if (report.server) {
  console.log(
    `server: intents applied=${report.server.intentsApplied} rejected=${report.server.intentsRejected}` +
      ` games started=${report.server.gamesStartedTotal} finished=${report.server.gamesFinishedTotal}` +
      ` rss=${report.server.finalRss !== null ? ((report.server.finalRss as number) / 1048576).toFixed(0) + 'MiB' : '?'}`
  )
}
console.log(`results: ${outDir}`)

const failPct =
  final.counters.gamesStarted > 0
    ? (final.counters.gamesFailed / final.counters.gamesStarted) * 100
    : 0
process.exit(failPct > maxFailPct ? 1 : 0)
