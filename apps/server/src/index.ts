// Authoritative game server entrypoint — architecture/Game-Server.md.

import * as Sentry from '@sentry/node'
import { makeTokenVerifier } from './auth.js'
import { configFromEnv } from './config.js'
import { startServer } from './server.js'
import { makeStores } from './store-factory.js'

// Errors only, opt-in by env (fly.toml carries the DSN; dev/tests stay silent).
// Default integrations also capture uncaught exceptions/rejections before the
// process dies. The pino → Fly-logs stream remains the operational view.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.FLY_APP_NAME ?? 'dev',
    ...(process.env.FLY_IMAGE_REF ? { release: process.env.FLY_IMAGE_REF } : {})
  })
}

const config = configFromEnv()
const stores = await makeStores(config.databaseUrl, {
  migrateOnBoot: process.env.MIGRATE_ON_BOOT === '1',
  ...(process.env.MIGRATIONS_DIR ? { migrationsDir: process.env.MIGRATIONS_DIR } : {}),
  // The pool all rooms share; the load test showed 5 lanes bound the write
  // path long before the machine does — raise on a DB tier that can take it.
  ...(Number(process.env.PG_POOL_SIZE) > 0 ? { pgPoolMax: Number(process.env.PG_POOL_SIZE) } : {})
})
const server = await startServer({
  config,
  verifier: makeTokenVerifier(config.auth),
  profiles: stores.profiles,
  identities: stores.identities,
  store: stores.store,
  chat: stores.chat
})

server.fastify.log.info({ url: server.url }, 'metarchy server up')

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.fastify.log.info({ signal }, 'shutting down')
    void server
      .close()
      .then(() => stores.close())
      .then(() => process.exit(0))
  })
}
