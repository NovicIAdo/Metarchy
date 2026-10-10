import type { AuthedUser } from './auth.js'
import type { Sql } from './db.js'
import type {
  IdentityStore,
  LinkedWallet,
  MfaPolicy,
  WalletAccount,
  WalletLinkChallenge,
  WalletLinkInput
} from './identity.js'
import { assertChallenge, IdentityError, requireMfa } from './identity.js'
import type { Profile } from './session.js'
import { SqlProfileStore } from './store-sql.js'

type StoredWallet = {
  address: string
  auth_user_id: string
  user_id: string
  linked_at: string | Date
}
type StoredChallenge = {
  id: string
  primary_auth_user_id: string
  user_id: string
  request: WalletLinkChallenge['request']
  consumed_at: string | Date | null
}
const iso = (value: string | Date): string => new Date(value).toISOString()

/** All alias resolution and link writes share transaction-scoped principal locks. */
export class SqlIdentityStore implements IdentityStore {
  constructor(
    private readonly sql: Sql,
    private readonly mfaOverride?: MfaPolicy
  ) {}

  async hasMfaPolicy(): Promise<boolean> {
    if (this.mfaOverride) return true
    const result = await this.sql.query<{ available: boolean }>(
      'select available from metarchy_private.auth_policy_status'
    )
    return result.rows[0]?.available === true
  }
  async canonicalEmail(authUserId: string): Promise<string | null> {
    const userId = await this.resolve(authUserId)
    const result = await this.sql.query<{ email: string | null }>(
      'select email from metarchy_private.canonical_auth_emails where user_id = $1',
      [userId]
    )
    return result.rows[0]?.email ?? null
  }
  private async rememberCanonicalEmail(sql: Sql, user: AuthedUser, userId: string): Promise<void> {
    if (user.userId !== userId) return
    await sql.query(
      'insert into metarchy_private.profile_auth_emails (user_id, email) values ($1, $2) on conflict (user_id) do update set email = excluded.email',
      [userId, user.email]
    )
  }

  private async locked<T>(principals: string[], action: (sql: Sql) => Promise<T>): Promise<T> {
    if (!this.sql.transaction) throw new Error('Identity storage needs transaction support')
    return this.sql.transaction(async (tx) => {
      // Stable order avoids deadlocks across simultaneous cross-principal operations.
      for (const id of [...new Set(principals)].sort())
        await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 91230))', [id])
      return action(tx)
    })
  }
  private policy(sql: Sql): MfaPolicy {
    return (
      this.mfaOverride ?? {
        hasVerifiedFactor: async (id) => {
          const result = await sql.query(
            'select 1 from metarchy_private.verified_mfa_users where user_id = $1 limit 1',
            [id]
          )
          return result.rows.length > 0
        }
      }
    )
  }
  private async resolveIn(sql: Sql, authUserId: string): Promise<string> {
    const result = await sql.query<{ user_id: string }>(
      'select user_id from metarchy_private.auth_principals where auth_user_id = $1',
      [authUserId]
    )
    return result.rows[0]?.user_id ?? authUserId
  }
  resolve(authUserId: string): Promise<string> {
    return this.resolveIn(this.sql, authUserId)
  }
  private async accountIn(sql: Sql, authUserId: string): Promise<WalletAccount> {
    const userId = await this.resolveIn(sql, authUserId)
    const aliases = await sql.query<{ auth_user_id: string }>(
      'select auth_user_id from metarchy_private.auth_principals where user_id = $1',
      [userId]
    )
    const mfa = this.policy(sql)
    const factors = await Promise.all(
      [...new Set([userId, ...aliases.rows.map((r) => r.auth_user_id)])].map((id) =>
        mfa.hasVerifiedFactor(id)
      )
    )
    const requiresMfa = factors.some(Boolean)
    const stored = await sql.query<StoredWallet>(
      'select address, auth_user_id, user_id, linked_at from metarchy_private.solana_wallets where user_id = $1 order by linked_at, address',
      [userId]
    )
    const wallets: LinkedWallet[] = await Promise.all(
      stored.rows.map(async (w) => ({
        address: w.address,
        authUserId: w.auth_user_id,
        linkedAt: iso(w.linked_at),
        loginEnabled: !requiresMfa || (await mfa.hasVerifiedFactor(w.auth_user_id))
      }))
    )
    return { userId, requiresMfa, wallets }
  }
  account(authUserId: string): Promise<WalletAccount> {
    return this.accountIn(this.sql, authUserId)
  }
  login(user: AuthedUser): Promise<Profile> {
    return this.locked([user.userId], async (sql) => {
      const account = await this.accountIn(sql, user.userId)
      requireMfa(user, account.requiresMfa, await this.policy(sql).hasVerifiedFactor(user.userId))
      // Profile creation participates in the lock, so a first login cannot race a link.
      const profile = await new SqlProfileStore(sql).getOrCreate(account.userId, user.email)
      await this.rememberCanonicalEmail(sql, user, account.userId)
      return profile
    })
  }
  async saveChallenge(challenge: WalletLinkChallenge): Promise<void> {
    await this.sql.query(
      "delete from metarchy_private.wallet_link_challenges where expires_at < now() - interval '1 day'"
    )
    await this.sql.query(
      'insert into metarchy_private.wallet_link_challenges (id, primary_auth_user_id, user_id, request, expires_at) values ($1, $2, $3, $4, $5)',
      [
        challenge.id,
        challenge.primaryAuthUserId,
        challenge.userId,
        JSON.stringify(challenge.request),
        challenge.request.expirationTime
      ]
    )
  }
  private async challengeIn(
    sql: Sql,
    id: string,
    primaryAuthUserId: string,
    lock = false
  ): Promise<WalletLinkChallenge> {
    const rows = await sql.query<StoredChallenge>(
      `select id, primary_auth_user_id, user_id, request, consumed_at from metarchy_private.wallet_link_challenges where id = $1${lock ? ' for update' : ''}`,
      [id]
    )
    const row = rows.rows[0]
    const challenge = row
      ? {
          id: row.id,
          primaryAuthUserId: row.primary_auth_user_id,
          userId: row.user_id,
          request: row.request,
          ...(row.consumed_at ? { consumedAt: iso(row.consumed_at) } : {})
        }
      : undefined
    assertChallenge(challenge, primaryAuthUserId)
    return challenge
  }
  challenge(id: string, primaryAuthUserId: string): Promise<WalletLinkChallenge> {
    return this.challengeIn(this.sql, id, primaryAuthUserId)
  }
  async link(input: WalletLinkInput): Promise<WalletAccount> {
    // Read is just for lock selection; ownership and expiry are checked again under lock.
    const issued = await this.challenge(input.challengeId, input.primary.userId)
    try {
      return await this.locked(
        [input.primary.userId, input.wallet.userId, issued.userId],
        async (sql) => {
          const challenge = await this.challengeIn(
            sql,
            input.challengeId,
            input.primary.userId,
            true
          )
          const account = await this.accountIn(sql, input.primary.userId)
          if (challenge.userId !== account.userId)
            throw new IdentityError('Wallet challenge belongs to a different player.', 400)
          const policy = this.policy(sql)
          const walletFactor = await policy.hasVerifiedFactor(input.wallet.userId)
          const requiresMfa = account.requiresMfa || walletFactor
          requireMfa(
            input.primary,
            requiresMfa,
            await policy.hasVerifiedFactor(input.primary.userId)
          )
          requireMfa(input.wallet, requiresMfa, walletFactor)
          const walletCanonical = await this.resolveIn(sql, input.wallet.userId)
          if (walletCanonical !== input.wallet.userId && walletCanonical !== account.userId)
            throw new IdentityError('Wallet belongs to another Metarchy account.')
          if (input.wallet.userId !== account.userId) {
            const profile = await sql.query('select 1 from profiles where user_id = $1', [
              input.wallet.userId
            ])
            if (profile.rows.length)
              throw new IdentityError(
                'This wallet already has an independent player profile. Account merging is unavailable.'
              )
          }
          const existing = await sql.query<StoredWallet>(
            'select address, auth_user_id, user_id, linked_at from metarchy_private.solana_wallets where address = $1',
            [input.address]
          )
          const owned = existing.rows[0]
          if (
            owned &&
            (owned.user_id !== account.userId || owned.auth_user_id !== input.wallet.userId)
          )
            throw new IdentityError('Wallet address belongs to another Metarchy account.')
          await sql.query(
            'insert into metarchy_private.auth_principals (auth_user_id, user_id) values ($1, $2) on conflict (auth_user_id) do nothing',
            [input.wallet.userId, account.userId]
          )
          await sql.query(
            'insert into metarchy_private.solana_wallets (address, auth_user_id, user_id) values ($1, $2, $3) on conflict (address) do nothing',
            [input.address, input.wallet.userId, account.userId]
          )
          // The address can be presented by different Auth principals concurrently; read
          // its unique winner after INSERT's conflict wait rather than trusting no-op.
          const winner = await sql.query<StoredWallet>(
            'select address, auth_user_id, user_id, linked_at from metarchy_private.solana_wallets where address = $1',
            [input.address]
          )
          if (
            winner.rows[0]?.user_id !== account.userId ||
            winner.rows[0]?.auth_user_id !== input.wallet.userId
          )
            throw new IdentityError('Wallet address belongs to another Metarchy account.')
          await sql.query(
            'update metarchy_private.wallet_link_challenges set consumed_at = now() where id = $1',
            [input.challengeId]
          )
          await this.rememberCanonicalEmail(sql, input.primary, account.userId)
          return this.accountIn(sql, account.userId)
        }
      )
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new IdentityError('Wallet belongs to another Metarchy account.')
      throw error
    }
  }
}
