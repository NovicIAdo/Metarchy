// Client configuration from Vite env. All values here are public by design —
// the anon key is guarded by RLS, and the WS endpoint is, well, an endpoint.
// VITE_WS_URL may be omitted when the server hosts the client (same origin).

function defaultWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/ws`
}

export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  wsUrl: (import.meta.env.VITE_WS_URL as string | undefined) || defaultWsUrl(),
  /** Deploy stamp for error reports; 'dev' outside the Docker build. */
  buildSha: (import.meta.env.VITE_GIT_SHA as string | undefined) || 'dev'
}

/** The game server's HTTP base (error reports) — same host the socket talks to. */
export function serverHttpBase(): string {
  return config.wsUrl.replace(/^ws/, 'http').replace(/\/ws$/, '')
}

export const solanaChain = (import.meta.env.VITE_SOLANA_CHAIN || 'solana:devnet') as
  'solana:devnet' | 'solana:testnet' | 'solana:mainnet'
if (!['solana:devnet', 'solana:testnet', 'solana:mainnet'].includes(solanaChain))
  throw new Error('Invalid VITE_SOLANA_CHAIN')
/** Native WebViews need the public HTTPS identity; browsers sign for their actual origin. */
export const solanaAuthUrl =
  (import.meta.env.VITE_SOLANA_AUTH_URL as string | undefined) || `${serverHttpBase()}/`

/**
 * Sentry DSN — public by design (it ships in every browser bundle; Sentry auth
 * happens server-side per project). Production/mobile builds default to the
 * Metarchy project; dev and tests stay silent unless the env opts in.
 * Kept out of `config` so the required-env check below ignores it.
 */
export const sentryDsn: string =
  (import.meta.env.VITE_SENTRY_DSN as string | undefined) ??
  (import.meta.env.PROD
    ? 'https://3f801e2fcc00925628b19cf42f41cc7e@o4511751439908864.ingest.de.sentry.io/4511751882080336'
    : '')

for (const [key, value] of Object.entries(config)) {
  if (!value) throw new Error(`missing client env for ${key} — check apps/client/.env.*`)
}
