// Store selection by DATABASE_URL scheme:
//   'memory:'                — in-process, tests/dev without durability
//   'pglite:memory://'       — embedded Postgres, hermetic tests (auto-migrated)
//   'pglite:<dir>'           — embedded Postgres on disk, zero-setup dev (auto-migrated)
//   'postgres(ql)://…'       — real Postgres/Supabase; migrations are applied by
//                              deploy tooling unless MIGRATE_ON_BOOT=1.

import { SqlChatStore } from './chat-sql.js'
import type { ChatStore } from './chat.js'
import { MemoryChatStore } from './chat.js'
import { assertSchema, makePgliteSql, makePgSql, migrate } from './db.js'
import type { Sql } from './db.js'
import { startKeepAlive } from './keepalive.js'
import { MemoryIdentityStore } from './identity.js'
import type { IdentityStore } from './identity.js'
import { SqlIdentityStore } from './identity-sql.js'
import { MemoryProfileStore } from './profiles.js'
import type { ProfileStore } from './profiles.js'
import { SqlProfileStore, SqlStore } from './store-sql.js'
import type { GameStore } from './store.js'
import { MemoryStore } from './store.js'

export interface Stores {
  store: GameStore
  profiles: ProfileStore
  identities: IdentityStore
  /** Persisted chat: the global room and DMs (its own tables, its own interface). */
  chat: ChatStore
  close(): Promise<void>
}

export async function makeStores(
  databaseUrl: string,
  opts: { migrateOnBoot?: boolean; migrationsDir?: string; pgPoolMax?: number } = {}
): Promise<Stores> {
  if (databaseUrl === 'memory:') {
    const profiles = new MemoryProfileStore()
    return {
      store: new MemoryStore(),
      profiles,
      identities: new MemoryIdentityStore(profiles),
      chat: new MemoryChatStore(),
      close: async () => {}
    }
  }

  let sql: Sql
  let stopKeepAlive: (() => void) | null = null
  if (databaseUrl.startsWith('pglite:')) {
    sql = await makePgliteSql(databaseUrl.slice('pglite:'.length) || 'memory://')
    await migrate(sql, opts.migrationsDir)
  } else if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    sql = await makePgSql(databaseUrl, opts.pgPoolMax)
    if (opts.migrateOnBoot) await migrate(sql, opts.migrationsDir)
    else await assertSchema(sql)
    // Supabase free tier pauses inactive projects — see keepalive.ts.
    if (process.env.SUPABASE_KEEPALIVE !== '0')
      stopKeepAlive = startKeepAlive({
        sql,
        ...(process.env.SUPABASE_URL ? { supabaseUrl: process.env.SUPABASE_URL } : {}),
        ...(process.env.SUPABASE_ANON_KEY ? { anonKey: process.env.SUPABASE_ANON_KEY } : {})
      })
  } else {
    throw new Error(`unsupported DATABASE_URL scheme: ${databaseUrl.split(':')[0]}`)
  }

  return {
    store: new SqlStore(sql),
    profiles: new SqlProfileStore(sql),
    identities: new SqlIdentityStore(sql),
    chat: new SqlChatStore(sql),
    close: async () => {
      stopKeepAlive?.()
      await sql.close()
    }
  }
}
