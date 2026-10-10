// Minimal SQL boundary shared by node-postgres (production) and PGlite
// (hermetic tests / zero-setup dev), plus the migration runner over
// supabase/migrations/*.sql — the single schema source of truth.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Sql {
  query<R = unknown>(text: string, params?: unknown[]): Promise<{ rows: R[] }>
  /** Multi-statement script (migration files). */
  exec(text: string): Promise<void>
  /** Pinned connection, atomic commit/rollback (optional for read-only test doubles). */
  transaction?<T>(action: (sql: Sql) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export async function makePgSql(connectionString: string, poolMax = 5): Promise<Sql> {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, max: poolMax })
  return {
    async query<R>(text: string, params: unknown[] = []) {
      const result = await pool.query(text, params)
      return { rows: result.rows as R[] }
    },
    async exec(text: string) {
      await pool.query(text)
    },
    async transaction<T>(action: (sql: Sql) => Promise<T>): Promise<T> {
      const client = await pool.connect()
      try {
        await client.query('begin')
        const result = await action({
          async query<R>(text: string, params: unknown[] = []) {
            const result = await client.query(text, params)
            return { rows: result.rows as R[] }
          },
          async exec(text: string) {
            await client.query(text)
          },
          async close() {}
        })
        await client.query('commit')
        return result
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async close() {
      await pool.end()
    }
  }
}

/** dataDir: 'memory://' for in-memory, or a filesystem path for durability. */
export async function makePgliteSql(dataDir: string): Promise<Sql> {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = dataDir === 'memory://' ? new PGlite() : new PGlite(dataDir)
  await db.waitReady
  return {
    async query<R>(text: string, params: unknown[] = []) {
      const result = await db.query(text, params)
      return { rows: result.rows as R[] }
    },
    async exec(text: string) {
      await db.exec(text)
    },
    async transaction<T>(action: (sql: Sql) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) =>
        action({
          async query<R>(text: string, params: unknown[] = []) {
            const result = await tx.query<R>(text, params)
            return { rows: result.rows }
          },
          async exec(text: string) {
            await tx.exec(text)
          },
          async close() {}
        })
      )
    },
    async close() {
      await db.close()
    }
  }
}

/** Repo-relative default; Docker images set MIGRATIONS_DIR explicitly. */
export function defaultMigrationsDir(): string {
  return new URL('../../../supabase/migrations', import.meta.url).pathname
}

/**
 * Apply pending .sql files in name order, tracked in schema_migrations.
 * Concurrency-safe via an advisory lock (single-writer boot).
 */
export async function migrate(sql: Sql, dir = defaultMigrationsDir()): Promise<string[]> {
  await sql.query('select pg_advisory_lock(727001)')
  try {
    await sql.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())'
    )
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
    const done = new Set(
      (await sql.query<{ name: string }>('select name from schema_migrations')).rows.map(
        (r) => r.name
      )
    )
    const applied: string[] = []
    for (const file of files) {
      if (done.has(file)) continue
      const body = await readFile(join(dir, file), 'utf8')
      await sql.exec(body)
      await sql.query('insert into schema_migrations (name) values ($1)', [file])
      applied.push(file)
    }
    return applied
  } finally {
    await sql.query('select pg_advisory_unlock(727001)')
  }
}

/** Fail fast with a clear message when the schema is missing (prod path). */
export async function assertSchema(sql: Sql): Promise<void> {
  try {
    await sql.query('select 1 from games limit 0')
    await sql.query('select 1 from metarchy_private.auth_principals limit 0')
    await sql.query('select 1 from metarchy_private.wallet_link_challenges limit 0')
    await sql.query('select 1 from metarchy_private.verified_mfa_users limit 0')
    await sql.query('select 1 from metarchy_private.auth_policy_status limit 0')
    await sql.query('select 1 from metarchy_private.canonical_auth_emails limit 0')
  } catch {
    throw new Error(
      'database schema missing — apply supabase/migrations (supabase MCP/CLI or MIGRATE_ON_BOOT=1)'
    )
  }
}
