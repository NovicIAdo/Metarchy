// Profile lookup/creation on hello, plus renames. Stage 2 keeps a memory
// implementation for tests; the SQL-backed store lives in store-sql.ts behind
// the same interface.

import type { Wardrobe } from '@metarchy/protocol'
import type { Profile } from './session.js'

/** `'taken'` when another profile already holds the nickname (case-insensitively). */
export type RenameResult = Profile | 'taken'

export interface ProfileStore {
  /** Read without creating a profile, used to reject independent-account merges. */
  exists(userId: string): Promise<boolean>
  /** Fetch the profile, creating a minimal one on first sight of this user. */
  getOrCreate(userId: string, email: string | null): Promise<Profile>
  /** Callers run validateNickname() first; this only enforces uniqueness. */
  rename(userId: string, nickname: string): Promise<RenameResult>
  /** Callers validate the id against AVATAR_IDS (the zod schema already does). */
  setAvatar(userId: string, avatar: string | null): Promise<Profile>
  /** Whole-object replace; WardrobeSchema on the wire is the validation gate. */
  setWardrobe(userId: string, wardrobe: Wardrobe | null): Promise<Profile>
  /**
   * A page of the roster for the Players directory, newest registration last so
   * the list is stable while somebody joins. `query` is a case-insensitive
   * substring of the nickname (author: "надо сделать чтобы в Players был поиск
   * по Юзернэйму"); null lists everyone. `total` is the size under the same
   * search, which is what the page control needs.
   */
  listProfiles(q: {
    query: string | null
    limit: number
    offset: number
  }): Promise<{ rows: Profile[]; total: number }>
  /** Exact lookup for a shared link. Case-insensitive: nicknames are unique that way. */
  findByNickname(nickname: string): Promise<Profile | null>
}

/** Deterministic placeholder nickname until the player picks one. */
export function defaultNickname(userId: string): string {
  return `p_${userId.replace(/-/g, '').slice(0, 10)}`
}

export class MemoryProfileStore implements ProfileStore {
  private readonly profiles = new Map<string, Profile>()

  async exists(userId: string): Promise<boolean> {
    return this.profiles.has(userId)
  }

  async getOrCreate(userId: string): Promise<Profile> {
    let profile = this.profiles.get(userId)
    if (!profile) {
      profile = { userId, nickname: defaultNickname(userId), avatar: null }
      this.profiles.set(userId, profile)
    }
    return profile
  }

  async rename(userId: string, nickname: string): Promise<RenameResult> {
    for (const [otherId, other] of this.profiles)
      if (otherId !== userId && other.nickname.toLowerCase() === nickname.toLowerCase())
        return 'taken'
    const profile = await this.getOrCreate(userId)
    profile.nickname = nickname
    return profile
  }

  async setAvatar(userId: string, avatar: string | null): Promise<Profile> {
    const profile = await this.getOrCreate(userId)
    profile.avatar = avatar
    return profile
  }

  async setWardrobe(userId: string, wardrobe: Wardrobe | null): Promise<Profile> {
    const profile = await this.getOrCreate(userId)
    profile.wardrobe = wardrobe
    return profile
  }

  async listProfiles(q: {
    query: string | null
    limit: number
    offset: number
  }): Promise<{ rows: Profile[]; total: number }> {
    const needle = q.query?.toLowerCase() ?? null
    const all = [...this.profiles.values()].filter(
      (p) => needle === null || p.nickname.toLowerCase().includes(needle)
    )
    // Insertion order is registration order here, which is what the SQL store
    // gets from created_at.
    return { rows: all.slice(q.offset, q.offset + q.limit), total: all.length }
  }

  async findByNickname(nickname: string): Promise<Profile | null> {
    const wanted = nickname.toLowerCase()
    return [...this.profiles.values()].find((p) => p.nickname.toLowerCase() === wanted) ?? null
  }
}
