// Load worker (forked by load-test.ts): owns LOAD_SLOTS player slots, each an
// independent user playing vs_bots games back-to-back until the deadline.
// Config over env, cumulative stats to the parent over IPC every 5s.

import { mulberry32 } from '../src/autoplayer.js'
import { loadLoadKeys, makeMinter } from '../src/load/keys.js'
import { LoadPlayer } from '../src/load/player.js'
import { emptySnapshot } from '../src/load/stats.js'
import { loadUserId } from '../src/load/users.js'

const env = process.env
const url = env.LOAD_URL as string
const keysPath = env.LOAD_KEYS as string
const slots = Number(env.LOAD_SLOTS ?? '10')
const rampMs = Number(env.LOAD_RAMP_MS ?? '200')
const startDelayMs = Number(env.LOAD_START_DELAY_MS ?? '0')
const deadlineEpochMs = Number(env.LOAD_DEADLINE_EPOCH_MS ?? '0')
const seats3Frac = Number(env.LOAD_SEATS3_FRAC ?? '0.2')
const thinkMinMs = Number(env.LOAD_THINK_MIN_MS ?? '150')
const thinkMaxMs = Number(env.LOAD_THINK_MAX_MS ?? '500')
const workerId = Number(env.LOAD_WORKER_ID ?? '0')
/** Global index of this worker's first slot — keys the seeded auth.users rows. */
const slotOffset = Number(env.LOAD_SLOT_OFFSET ?? '0')

if (!url || !keysPath) {
  console.error('LOAD_URL and LOAD_KEYS are required')
  process.exit(2)
}

const keys = await loadLoadKeys(keysPath)
const mint = await makeMinter(keys)
const stats = emptySnapshot()
const players = new Set<LoadPlayer>()
let stopping = false
let slotsDone = 0
let debugBudget = 25

interface Slot {
  index: number
  userId: string
  token: string
  respawns: number
}

function send(msg: unknown): void {
  if (process.send) process.send(msg)
}

function debug(line: string): void {
  if (debugBudget > 0) {
    debugBudget--
    send({ type: 'log', line: `w${workerId} ${line}` })
  }
}

function spawnPlayer(slot: Slot): void {
  if (stopping) return
  const rng = mulberry32((workerId + 1) * 1_000_003 + slot.index * 1009 + slot.respawns)
  const seatCount: 2 | 3 = rng() < seats3Frac ? 3 : 2
  const player = new LoadPlayer({
    url,
    token: slot.token,
    userId: slot.userId,
    seatCount,
    rng,
    stats,
    thinkMinMs,
    thinkMaxMs,
    resyncDebounceMs: 80,
    debug,
    onDone(outcome, detail) {
      players.delete(player)
      if (outcome === 'failed' && detail) debug(`slot ${slot.index} failed: ${detail}`)
      if (stopping) return
      if (deadlineEpochMs > 0 && Date.now() < deadlineEpochMs) {
        slot.respawns++
        const jitter = 1_500 + Math.floor(rng() * 1_500)
        setTimeout(() => spawnPlayer(slot), jitter).unref()
      } else {
        slotsDone++
        if (slotsDone >= slots) allDone()
      }
    }
  })
  players.add(player)
  player.start()
}

function allDone(): void {
  send({ type: 'stats', snapshot: stats })
  send({ type: 'done' })
  clearInterval(reporter)
  setTimeout(() => process.exit(0), 200)
}

process.on('message', (msg: { type?: string }) => {
  if (msg?.type === 'stop') {
    stopping = true
    for (const p of players) p.stop()
    players.clear()
    send({ type: 'stats', snapshot: stats })
    send({ type: 'done' })
    clearInterval(reporter)
    setTimeout(() => process.exit(0), 200)
  }
})

const reporter = setInterval(() => send({ type: 'stats', snapshot: stats }), 5_000)

setTimeout(() => {
  const slotList: Slot[] = []
  for (let i = 0; i < slots; i++)
    slotList.push({ index: i, userId: loadUserId(slotOffset + i), token: '', respawns: 0 })
  void (async () => {
    for (const slot of slotList) {
      if (stopping) break
      slot.token = await mint(slot.userId)
      spawnPlayer(slot)
      await new Promise((r) => setTimeout(r, rampMs))
    }
  })()
}, startDelayMs)
