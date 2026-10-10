// Real server child process for e2e: spawn apps/server via tsx, wait for
// /healthz, and expose kill -9 (the whole point — no graceful anything).

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

export interface SpawnedServer {
  url: string
  httpUrl: string
  child: ChildProcess
  logs(): string
  kill9(): void
  stop(): Promise<void>
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      if (typeof address === 'object' && address) {
        const port = address.port
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('no port')))
      }
    })
  })
}

export async function spawnServer(env: Record<string, string>): Promise<SpawnedServer> {
  const entry = new URL('../../apps/server/src/index.ts', import.meta.url).pathname
  const tsxBin = new URL('../node_modules/.bin/tsx', import.meta.url).pathname
  const port = await freePort()
  const child = spawn(tsxBin, [entry], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'warn',
      BOT_MIN_DELAY_MS: '0',
      BOT_MAX_DELAY_MS: '0',
      // Scripted clients legitimately burst far beyond human message rates.
      RATE_CAPACITY: '10000',
      RATE_REFILL_PER_SEC: '10000',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout?.on('data', (d: Buffer) => (output += d.toString()))
  child.stderr?.on('data', (d: Buffer) => (output += d.toString()))

  const httpUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 60_000
  for (;;) {
    if (child.exitCode !== null)
      throw new Error(`server exited early (${child.exitCode}):\n${output}`)
    try {
      const res = await fetch(`${httpUrl}/healthz`)
      if (res.ok) break
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL')
      throw new Error(`server did not become healthy:\n${output}`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }

  return {
    url: `ws://127.0.0.1:${port}/ws`,
    httpUrl,
    child,
    logs: () => output,
    kill9() {
      child.kill('SIGKILL')
    },
    async stop() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 5000)
        child.once('exit', () => {
          clearTimeout(force)
          resolve()
        })
      })
    }
  }
}
