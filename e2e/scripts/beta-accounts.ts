// Beta account provisioning (closed beta on staging). Creates Supabase Auth
// users already email-confirmed — no confirmation mail is sent, so the free-tier
// 2-mails/hour limit is irrelevant and the "email" is just a login label.
//
// The service_role key is fetched at runtime via the Management API PAT
// (~/.config/metarchy/supabase_access_token); nothing secret is stored here.
//
//   pnpm --filter @metarchy/e2e exec tsx scripts/beta-accounts.ts create --count 20
//   pnpm --filter @metarchy/e2e exec tsx scripts/beta-accounts.ts create --emails a@x.com,b@y.com
//   pnpm --filter @metarchy/e2e exec tsx scripts/beta-accounts.ts list
//   pnpm --filter @metarchy/e2e exec tsx scripts/beta-accounts.ts delete-all   # removes @beta.metarchy.local pool

import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'

const PROJECT = process.env.SUPABASE_PROJECT_REF ?? 'oakrtrjtihuxbjmmpfkg'
const URL = `https://${PROJECT}.supabase.co`
const POOL_DOMAIN = 'beta.metarchy.local'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function pat(): Promise<string> {
  return (await readFile(`${homedir()}/.config/metarchy/supabase_access_token`, 'utf8')).trim()
}

async function serviceRoleKey(): Promise<string> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${await pat()}` }
  })
  const keys = (await res.json()) as { name: string; api_key: string }[]
  const sr = keys.find((k) => k.name === 'service_role')?.api_key
  if (!sr) throw new Error('service_role key not found via Management API')
  return sr
}

/** Run SQL via the Management API (PAT) — used for a delete that always works. */
async function managementSql<T>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await pat()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  })
  if (!res.ok) throw new Error(`management SQL failed (${res.status}): ${await res.text()}`)
  return (await res.json()) as T[]
}

/** Readable-ish 10-char password that clears the 8-char minimum with complexity. */
function makePassword(): string {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const bytes = randomBytes(10)
  let out = ''
  for (let i = 0; i < 8; i++) out += alpha[(bytes[i] as number) % alpha.length]
  out += digits[(bytes[8] as number) % digits.length]
  return `${out}${digits[(bytes[9] as number) % digits.length]}!`
}

async function createOne(
  sr: string,
  email: string
): Promise<{ email: string; password: string } | { email: string; error: string }> {
  const password = makePassword()
  const res = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: sr, Authorization: `Bearer ${sr}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true })
  })
  if (res.ok) return { email, password }
  const body = (await res.json()) as { msg?: string; error_code?: string }
  return { email, error: body.error_code ?? body.msg ?? `HTTP ${res.status}` }
}

async function listBeta(sr: string): Promise<{ email: string; id: string }[]> {
  const out: { email: string; id: string }[] = []
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: sr, Authorization: `Bearer ${sr}` }
    })
    const { users } = (await res.json()) as { users: { id: string; email: string }[] }
    if (!users?.length) break
    for (const u of users)
      if (u.email?.endsWith(`@${POOL_DOMAIN}`)) out.push({ email: u.email, id: u.id })
    if (users.length < 200) break
  }
  return out
}

const cmd = process.argv[2]
const sr = await serviceRoleKey()

if (cmd === 'create') {
  const emailsArg = arg('emails')
  const emails = emailsArg
    ? emailsArg
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
    : Array.from(
        { length: Number(arg('count') ?? '0') },
        (_, i) => `beta-${String(i + 1).padStart(2, '0')}@${POOL_DOMAIN}`
      )
  if (emails.length === 0) {
    console.error('give --count N or --emails a@x,b@y')
    process.exit(2)
  }
  console.log(`Creating ${emails.length} confirmed beta accounts on ${PROJECT}…\n`)
  console.log('email,password')
  for (const email of emails) {
    const r = await createOne(sr, email)
    console.log('password' in r ? `${r.email},${r.password}` : `${r.email},(skipped: ${r.error})`)
  }
} else if (cmd === 'list') {
  const beta = await listBeta(sr)
  console.log(`${beta.length} pool accounts (@${POOL_DOMAIN}):`)
  for (const b of beta) console.log(`  ${b.email}`)
} else if (cmd === 'delete-all') {
  // SQL, not the admin API: game_players → profiles is RESTRICT, so a user who
  // has played blocks the API delete. Clear their games first, then the users.
  const rows = await managementSql<{ removed: number }>(
    `with pool as (select id from auth.users where email like '%@${POOL_DOMAIN}'),
          g as (delete from games where id in
                  (select game_id from game_players where user_id in (select id from pool)))
     delete from auth.users where id in (select id from pool)
     returning 1 as removed`
  )
  console.log(`removed ${rows.length} pool accounts (@${POOL_DOMAIN})`)
} else {
  console.error('usage: beta-accounts.ts <create|list|delete-all> [--count N | --emails a,b]')
  process.exit(2)
}
