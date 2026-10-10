// Server configuration. Timeout defaults follow architecture/Game-Server.md §5 —
// config, not rules; tune in playtesting.

import type { MatchmakingConfig } from './matchmaking.js'
import { DEFAULT_MATCHMAKING } from './matchmaking.js'

export interface TimeoutPolicy {
  /** Event ack / conflict reveal ack / result ack. */
  ackMs: number
  /** End-of-Phase-4 recap — longer, it is a whole screen to read. */
  summaryMs: number
  /** Discard amount commit. */
  discardMs: number
  /** Distribution commit. */
  distributionMs: number
  /** Action step inputs (select cards, relocations, exchanges). */
  actionStepMs: number
  /** Conflict RPS round and tie-break RPS rounds. */
  rpsMs: number
  /** Market. */
  marketMs: number
}

export const DEFAULT_TIMEOUTS: TimeoutPolicy = {
  // User rule: a Get It!/reveal confirmation gets at most 10 s — the game
  // never idles on someone who walked away from an acknowledgement.
  ackMs: 10_000,
  // Author: "давать 15 секунд ознакомиться с этим окошком. Ну или раньше его
  // закрывать, если все игроки кликнут на Get It." Longer than a plain ack
  // because it is the turn's whole outcome, not a one-line confirmation.
  summaryMs: 15_000,
  discardMs: 45_000,
  distributionMs: 120_000,
  actionStepMs: 45_000,
  rpsMs: 30_000,
  marketMs: 60_000
}

export interface AuthConfig {
  /** Base project URL, e.g. https://xyz.supabase.co — JWKS + issuer derive from it. */
  supabaseUrl?: string
  /** Public key used only with a player's bearer token for Auth user lookup. */
  anonKey?: string
  /** Inline JWKS JSON — test/ops escape hatch, takes precedence. */
  jwksJson?: string
  /** Legacy HS256 shared secret (older Supabase projects). */
  jwtSecret?: string
  /** Issuer override (tests). */
  issuer?: string
}

export interface ServerConfig {
  host: string
  port: number
  auth: AuthConfig
  /** Wallet linking is disabled until a public HTTPS identity URI is configured. */
  solana?: { uri?: string; chainId?: string; allowedOrigins: string[] }
  /** 'memory:' | 'pglite:<dir>' | postgres:// connection string. */
  databaseUrl: string
  timeouts: TimeoutPolicy
  /** Socket-drop grace before system.eliminate (Game-Server.md §6). */
  disconnectGraceMs: number
  /** Close sockets that never complete hello. */
  helloTimeoutMs: number
  /** ws-level ping sweep; 0 disables (tests). */
  heartbeatIntervalMs: number
  /** Per-connection token bucket. */
  rate: { capacity: number; refillPerSec: number }
  /** Humanized bot reaction delay; [0,0] in tests. */
  bot: { minDelayMs: number; maxDelayMs: number }
  /** Queue tick, rating-window widening, bot fallback. */
  matchmaking: MatchmakingConfig
  /** Serve the built client from this directory (same-origin hosting); unset = API only. */
  staticDir?: string
  logLevel: string
}

function intEnv(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function numEnv(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** TIMEOUT_SCALE stretches every stage deadline — slow CI runners need headroom. */
function scaleTimeouts(timeouts: TimeoutPolicy, scale: number): TimeoutPolicy {
  if (scale === 1) return timeouts
  return Object.fromEntries(
    Object.entries(timeouts).map(([k, v]) => [k, Math.round(v * scale)])
  ) as unknown as TimeoutPolicy
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: intEnv(env.PORT, 8080),
    auth: {
      ...(env.SUPABASE_URL ? { supabaseUrl: env.SUPABASE_URL } : {}),
      ...(env.SUPABASE_ANON_KEY ? { anonKey: env.SUPABASE_ANON_KEY } : {}),
      ...(env.SUPABASE_JWKS_JSON ? { jwksJson: env.SUPABASE_JWKS_JSON } : {}),
      ...(env.SUPABASE_JWT_SECRET ? { jwtSecret: env.SUPABASE_JWT_SECRET } : {}),
      ...(env.SUPABASE_JWT_ISSUER ? { issuer: env.SUPABASE_JWT_ISSUER } : {})
    },
    ...(env.SOLANA_AUTH_URL || env.SOLANA_AUTH_ALLOWED_ORIGINS
      ? {
          solana: {
            ...(env.SOLANA_AUTH_URL ? { uri: env.SOLANA_AUTH_URL } : {}),
            chainId: env.SOLANA_AUTH_CHAIN_ID ?? 'solana:devnet',
            allowedOrigins: (env.SOLANA_AUTH_ALLOWED_ORIGINS ?? '')
              .split(',')
              .map((origin) => origin.trim())
              .filter(Boolean)
          }
        }
      : {}),
    databaseUrl: env.DATABASE_URL ?? 'memory:',
    timeouts: scaleTimeouts(
      {
        ...DEFAULT_TIMEOUTS,
        ...(env.TIMEOUT_ACK_MS ? { ackMs: intEnv(env.TIMEOUT_ACK_MS, DEFAULT_TIMEOUTS.ackMs) } : {})
      },
      numEnv(env.TIMEOUT_SCALE, 1)
    ),
    disconnectGraceMs: intEnv(env.DISCONNECT_GRACE_MS, 60_000),
    helloTimeoutMs: intEnv(env.HELLO_TIMEOUT_MS, 10_000),
    heartbeatIntervalMs: intEnv(env.HEARTBEAT_INTERVAL_MS, 30_000),
    rate: {
      capacity: intEnv(env.RATE_CAPACITY, 20),
      refillPerSec: intEnv(env.RATE_REFILL_PER_SEC, 10)
    },
    bot: {
      minDelayMs: intEnv(env.BOT_MIN_DELAY_MS, 300),
      maxDelayMs: intEnv(env.BOT_MAX_DELAY_MS, 900)
    },
    matchmaking: {
      ...DEFAULT_MATCHMAKING,
      tickMs: intEnv(env.QUEUE_TICK_MS, DEFAULT_MATCHMAKING.tickMs),
      openWaitMs: intEnv(env.QUEUE_OPEN_WAIT_MS, DEFAULT_MATCHMAKING.openWaitMs),
      botFallbackMs: intEnv(env.QUEUE_BOT_FALLBACK_MS, DEFAULT_MATCHMAKING.botFallbackMs)
    },
    ...(env.STATIC_DIR ? { staticDir: env.STATIC_DIR } : {}),
    logLevel: env.LOG_LEVEL ?? 'info'
  }
}
