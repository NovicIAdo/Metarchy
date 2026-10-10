import type { SolanaSignInRequest } from '@metarchy/chain-solana'
import type { AuthedUser } from './auth.js'
import type { ProfileStore } from './profiles.js'
import type { Profile } from './session.js'

/** Only verified factor metadata is needed; factor secrets never enter the game server. */
export interface MfaPolicy {
  hasVerifiedFactor(authUserId: string): Promise<boolean>
}
export interface LinkedWallet {
  address: string
  authUserId: string
  linkedAt: string
  loginEnabled: boolean
}
export interface WalletAccount {
  userId: string
  requiresMfa: boolean
  wallets: LinkedWallet[]
}
export interface WalletLinkChallenge {
  id: string
  primaryAuthUserId: string
  userId: string
  request: SolanaSignInRequest
  consumedAt?: string
}
export interface WalletLinkInput {
  challengeId: string
  primary: AuthedUser
  wallet: AuthedUser
  address: string
}
export interface IdentityStore {
  hasMfaPolicy(): Promise<boolean>
  resolve(authUserId: string): Promise<string>
  /** Internal cosmetic grant identity; never overwritten by an alias's email. */
  canonicalEmail(authUserId: string): Promise<string | null>
  /** Resolve identity, enforce account MFA, and create the profile under the same link lock. */
  login(user: AuthedUser): Promise<Profile>
  /** Metadata is safe at aal1, allowing clients to offer MFA verification/enrollment. */
  account(authUserId: string): Promise<WalletAccount>
  saveChallenge(challenge: WalletLinkChallenge): Promise<void>
  challenge(id: string, primaryAuthUserId: string): Promise<WalletLinkChallenge>
  /** Atomic consume + ownership/profile checks + unique alias and wallet insertion. */
  link(input: WalletLinkInput): Promise<WalletAccount>
}

export class IdentityError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409 | 503 = 409
  ) {
    super(message)
  }
}
export function requireMfa(user: AuthedUser, requiresMfa: boolean, hasFactor: boolean): void {
  if (!requiresMfa) return
  if (!hasFactor)
    throw new IdentityError(
      'MFA setup required: this login needs a verified authentication factor.',
      403
    )
  if (user.aal !== 'aal2')
    throw new IdentityError('MFA verification required for this account.', 403)
}
export function assertChallenge(
  challenge: WalletLinkChallenge | undefined,
  primaryAuthUserId: string
): asserts challenge is WalletLinkChallenge {
  if (!challenge || challenge.primaryAuthUserId !== primaryAuthUserId)
    throw new IdentityError('Wallet linking challenge does not belong to this session.', 400)
  if (challenge.consumedAt)
    throw new IdentityError('Wallet linking challenge has already been consumed.')
  if (Date.parse(challenge.request.expirationTime) <= Date.now())
    throw new IdentityError('Wallet linking challenge has expired.', 400)
}

const noMfa: MfaPolicy = { hasVerifiedFactor: async () => false }

export class MemoryIdentityStore implements IdentityStore {
  private readonly aliases = new Map<string, string>()
  private readonly wallets = new Map<string, LinkedWallet & { userId: string }>()
  private readonly challenges = new Map<string, WalletLinkChallenge>()
  private readonly emails = new Map<string, string | null>()
  // A single in-process lock keeps async policy/profile reads atomic with linking.
  private pending: Promise<void> = Promise.resolve()
  constructor(
    private readonly profiles: ProfileStore,
    private readonly mfa: MfaPolicy = noMfa
  ) {}

  async hasMfaPolicy(): Promise<boolean> {
    return this.mfa !== noMfa
  }
  async canonicalEmail(authUserId: string): Promise<string | null> {
    return this.emails.get(await this.resolve(authUserId)) ?? null
  }

  private async locked<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.pending
    let release!: () => void
    this.pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await action()
    } finally {
      release()
    }
  }

  async resolve(authUserId: string): Promise<string> {
    return this.aliases.get(authUserId) ?? authUserId
  }
  private async accountUnlocked(authUserId: string): Promise<WalletAccount> {
    const userId = await this.resolve(authUserId)
    const principals = new Set([
      userId,
      ...[...this.aliases].filter(([, id]) => id === userId).map(([id]) => id)
    ])
    const factors = await Promise.all([...principals].map((id) => this.mfa.hasVerifiedFactor(id)))
    const requiresMfa = factors.some(Boolean)
    const wallets = await Promise.all(
      [...this.wallets.values()]
        .filter((w) => w.userId === userId)
        .map(async (w) => ({
          address: w.address,
          authUserId: w.authUserId,
          linkedAt: w.linkedAt,
          loginEnabled: !requiresMfa || (await this.mfa.hasVerifiedFactor(w.authUserId))
        }))
    )
    return { userId, requiresMfa, wallets }
  }
  account(authUserId: string): Promise<WalletAccount> {
    return this.locked(() => this.accountUnlocked(authUserId))
  }
  login(user: AuthedUser): Promise<Profile> {
    return this.locked(async () => {
      const account = await this.accountUnlocked(user.userId)
      requireMfa(user, account.requiresMfa, await this.mfa.hasVerifiedFactor(user.userId))
      const profile = await this.profiles.getOrCreate(account.userId, user.email)
      if (user.userId === account.userId) this.emails.set(account.userId, user.email)
      return profile
    })
  }
  async saveChallenge(challenge: WalletLinkChallenge): Promise<void> {
    await this.locked(async () => {
      for (const [id, old] of this.challenges)
        if (Date.parse(old.request.expirationTime) < Date.now() - 86_400_000)
          this.challenges.delete(id)
      if (this.challenges.has(challenge.id)) throw new IdentityError('Duplicate wallet challenge.')
      this.challenges.set(challenge.id, structuredClone(challenge))
    })
  }
  challenge(id: string, primaryAuthUserId: string): Promise<WalletLinkChallenge> {
    return this.locked(async () => {
      const challenge = this.challenges.get(id)
      assertChallenge(challenge, primaryAuthUserId)
      return structuredClone(challenge)
    })
  }
  link(input: WalletLinkInput): Promise<WalletAccount> {
    return this.locked(async () => {
      if (!(await this.hasMfaPolicy()))
        throw new IdentityError('Wallet linking requires an authoritative MFA policy store.', 503)
      const challenge = this.challenges.get(input.challengeId)
      assertChallenge(challenge, input.primary.userId)
      const account = await this.accountUnlocked(input.primary.userId)
      if (account.userId !== challenge.userId)
        throw new IdentityError('Wallet challenge belongs to a different player.', 400)
      const walletFactor = await this.mfa.hasVerifiedFactor(input.wallet.userId)
      const requiresMfa = account.requiresMfa || walletFactor
      requireMfa(input.primary, requiresMfa, await this.mfa.hasVerifiedFactor(input.primary.userId))
      requireMfa(input.wallet, requiresMfa, walletFactor)
      const resolvedWallet = await this.resolve(input.wallet.userId)
      if (resolvedWallet !== input.wallet.userId && resolvedWallet !== account.userId)
        throw new IdentityError('Wallet belongs to another Metarchy account.')
      if (
        input.wallet.userId !== account.userId &&
        (await this.profiles.exists(input.wallet.userId))
      )
        throw new IdentityError(
          'This wallet already has an independent player profile. Account merging is unavailable.'
        )
      const existing = this.wallets.get(input.address)
      if (
        existing &&
        (existing.userId !== account.userId || existing.authUserId !== input.wallet.userId)
      )
        throw new IdentityError('Wallet address belongs to another Metarchy account.')
      if (!(await this.profiles.exists(account.userId)))
        throw new IdentityError('Canonical player profile is missing.')
      const previousAlias = this.aliases.get(input.wallet.userId)
      const hadEmail = this.emails.has(account.userId),
        previousEmail = this.emails.get(account.userId)
      try {
        this.aliases.set(input.wallet.userId, account.userId)
        if (input.primary.userId === account.userId)
          this.emails.set(account.userId, input.primary.email)
        this.wallets.set(input.address, {
          address: input.address,
          authUserId: input.wallet.userId,
          userId: account.userId,
          linkedAt: existing?.linkedAt ?? new Date().toISOString(),
          loginEnabled: true
        })
        challenge.consumedAt = new Date().toISOString()
        return await this.accountUnlocked(account.userId)
      } catch (error) {
        // Match SQL rollback semantics if a policy source fails during the final read.
        if (previousAlias === undefined) this.aliases.delete(input.wallet.userId)
        else this.aliases.set(input.wallet.userId, previousAlias)
        if (hadEmail) this.emails.set(account.userId, previousEmail ?? null)
        else this.emails.delete(account.userId)
        if (existing) this.wallets.set(input.address, existing)
        else this.wallets.delete(input.address)
        delete challenge.consumedAt
        throw error
      }
    })
  }
}
