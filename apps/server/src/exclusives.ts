// Who owns a personal skin. These are the one-off looks a beta tester designed
// for themselves (protocol EXCLUSIVE_SKINS): never sold, granted to exactly one
// account, and worn like any other skin once granted.
//
// The table is keyed by the account's email — the address on the verified JWT,
// so a grant follows the person rather than a row id, and it works the first
// time they sign in without anybody touching the database. Keys are SHA-256 of
// the trimmed, lower-cased address: the repository is public and testers'
// emails must not be.
//
// It lives in code on purpose: a grant is a decision, and this way it is
// reviewed, versioned and deployed like one. The table never reaches a client —
// the client only ever learns that one of these ids is in its own `owned` list.
// (If a grant ever needs to land without a deploy, the natural next step is a
// price-0 row in `purchases`, which the wallet already treats as ownership.)

import { createHash } from 'node:crypto'

/** Grant-table key for an email: hex SHA-256 of the trimmed, lower-cased address. */
export function emailKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

/** Store surface this module needs — the real store satisfies it structurally. */
interface WalletSource {
  getWallet(userId: string): Promise<{ balance: number; owned: string[] }>
}

export type GrantTable = Record<string, readonly string[]>

/**
 * emailKey(email) → item ids (`skin.<actor>.<id>`, the same ids the Shop would use).
 * Ann (beta, wave 1) designed a set across all four Actors — see protocol
 * EXCLUSIVE_SKINS and plan/AI-Skins-Prompts.md for the brief she wrote.
 */
export const EXCLUSIVE_GRANTS: GrantTable = {
  '33f22d595b794abbd89a34151a97e31b9a68c36c68b34989f68174dcf8287ed5': [
    'skin.politician.ann',
    'skin.scientist.ann',
    'skin.artist.ann',
    'skin.robot.ann'
  ],
  c0d0ab0fe6a9e2a06b30bedfc398c0a8aa466279fcc8eba386b00e48798e8284: [
    'skin.politician.asa',
    'skin.scientist.asa',
    'skin.artist.asa',
    'skin.robot.asa'
  ],
  '2ffc33c0cfae4718d832a23d44cb5e89ccff0a0838970832f9eadcb8897d4f3f': [
    'skin.politician.okeesha',
    'skin.scientist.okeesha',
    'skin.artist.okeesha',
    'skin.robot.okeesha'
  ]
}

/** The item ids this account was gifted. Unknown/absent email ⇒ nothing. */
export function exclusiveGrantsFor(
  email: string | null,
  table: GrantTable = EXCLUSIVE_GRANTS
): readonly string[] {
  if (!email) return []
  return table[emailKey(email)] ?? []
}

/**
 * The wallet as the player should see it: what they bought, plus what they were
 * given. Everything downstream — the fitting-room locks, the equip gate in
 * updateProfile — reads ownership from this one list, so a gift needs no
 * special case anywhere else.
 */
export async function walletWithGrants(
  store: WalletSource,
  userId: string,
  email: string | null,
  table: GrantTable = EXCLUSIVE_GRANTS
): Promise<{ balance: number; owned: string[] }> {
  const wallet = await store.getWallet(userId)
  const gifts = exclusiveGrantsFor(email, table).filter((id) => !wallet.owned.includes(id))
  return gifts.length === 0 ? wallet : { ...wallet, owned: [...wallet.owned, ...gifts] }
}
