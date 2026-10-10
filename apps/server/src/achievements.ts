// Achievements: evaluation and award (author's list, 2026-07-27). The catalog —
// ids, thresholds, i18n keys — lives in packages/protocol/src/achievements.ts,
// because the client renders unearned badges too.
//
// Two families, and they are genuinely different things:
//
//  - `feat.*` is decided ONCE, here, from the FINAL engine state plus that
//    seat's verdict. `featsEarned` is pure so it can be unit-tested without a
//    server, a socket or a database (see test/achievements.test.ts).
//  - `play.*` is a COUNTER over the whole archive, so it is a store aggregate
//    (loadPlayCounts) fed through the pure countAchievements() in the protocol.
//    Re-deriving every tier on every finish costs one ignored INSERT per badge
//    already held, and is immune to a miscounted "next threshold" pointer.
//
// Awarding is idempotent by primary key, exactly like the GATO ledger: the same
// finish replayed after a crash recovery grants nothing new, and earned_at never
// moves. That property is load-bearing for `feat.win.first` — it is granted on
// EVERY win and only the first insert lands.
//
// NO GATO IS PAID for an achievement. That is deliberate, not an oversight: the
// author has been asked whether badges should pay and has not answered, so there
// is no reward hook here and no amount column in the table. When the answer
// arrives, the hook belongs next to creditRewards, not inside this file.
//
// Nothing here is pushed to the client mid-session either: badges surface on the
// profile (own and public) on the next fetch. A live "achievement unlocked" toast
// would need a new server→client message and the room's broadcast path.

import type { GameState, SeatId } from '@metarchy/engine'
import { RANKED_BOT_STRATEGY, actionCardKind } from '@metarchy/engine'
import type { AchievementState, EarnedAchievement, PlayCounts } from '@metarchy/protocol'
import { countAchievements } from '@metarchy/protocol'
import type { LoggerLike } from './rooms/room.js'
import type { GameResultRow } from './store.js'

/** A seat's verdict as finishGame records it. */
type Verdict = GameResultRow['result']

export interface FeatInput {
  /** The FINAL engine state — phase.kind must be 'finished'. */
  state: GameState
  seat: SeatId
  result: Verdict
  /** game_players.bot_strategy of every bot seat in this game ([] if all human). */
  botStrategies: string[]
}

/** How many Action Cards of each kind one seat played on one turn. */
interface KindCounts {
  block: number
  relocation: number
  exchange: number
}

/**
 * Every `feat.*` id this seat earned in this game. Pure: no store, no clock, no
 * randomness — the same final state always yields the same badges.
 */
export function featsEarned({ state, seat, result, botStrategies }: FeatInput): string[] {
  const phase = state.phase
  // Not a finished game = no verdicts to reason about. Never throws: this runs
  // on the finish path and must not be able to lose a finished game.
  if (phase.kind !== 'finished') return []

  const earned: string[] = []
  const won = result === 'win'

  // --- "Пройти Туториал" -----------------------------------------------------
  //
  // The predicate is "the seat produced a verdict other than 'eliminated'".
  // Quitting the tutorial (or dropping out of it) forfeits the seat, which the
  // engine records as an elimination (room.ts → system.eliminate), so
  // 'eliminated' is exactly "did not finish it".
  //
  // Evidence, beta archive read 2026-07-27 — 25 tutorial seats for humans:
  //   21 × result 'eliminated', final turn 1..3   → the player quit
  //    4 × result 'win',        final turn 3..5   → the player played it out
  // which also rules out the obvious alternative: the final turn CANNOT be the
  // test. Quits at turn 3 (= TUTORIAL_MAX_TURNS) exist, and a tie-breaker pushed
  // completed runs to turn 5, past the tutorial's own limit. A "completed the
  // tutorial" badge that unlocks on quitting is worse than no badge at all.
  //
  // 'lose' counts as completed too — the author asked for "пройти", not "выиграть".
  if (state.meta.mode === 'tutorial') {
    if (won || result === 'lose') earned.push('feat.tutorial.complete')
    // And nothing else: turn 1 is a scripted lesson the bot is built to lose, so
    // any victory badge would be half-free the first time anyone finished one.
    return earned
  }

  // --- "Сыграть 3 Релокации / 3 Смены ценности / Отключить 3 локации за ход" --
  //
  // state.played is the WHOLE game's action-card log ({seat, card, turn}), so the
  // per-turn feats are a group-by. It is also the only source: board.
  // disabledLocations is cleared at the start of every turn (flow.ts), so the
  // final state holds no record of which Locations were ever switched off.
  // Blocks are the cards that disable a Location — BLOCK_CARD_LOCATION maps each
  // one to its Location, and actionCardKind calls them 'block'.
  //
  // These are earned by DOING it, win or lose: the author's wording is "сыграть"
  // / "отключить", with no result attached. A seat that was later eliminated
  // still played the cards it played.
  const byTurn = new Map<number, KindCounts>()
  for (const play of state.played) {
    if (play.seat !== seat) continue
    let counts = byTurn.get(play.turn)
    if (!counts) {
      counts = { block: 0, relocation: 0, exchange: 0 }
      byTurn.set(play.turn, counts)
    }
    counts[actionCardKind(play.card)]++
  }
  let relocation3 = false
  let exchange3 = false
  let block3 = false
  let allKinds = false
  for (const counts of byTurn.values()) {
    // Three ON ONE TURN — three spread across three turns is not the feat.
    if (counts.relocation >= 3) relocation3 = true
    if (counts.exchange >= 3) exchange3 = true
    if (counts.block >= 3) block3 = true
    if (counts.block > 0 && counts.relocation > 0 && counts.exchange > 0) allKinds = true
  }
  if (relocation3) earned.push('feat.turn.relocation3')
  if (exchange3) earned.push('feat.turn.exchange3')
  if (block3) earned.push('feat.turn.block3')
  // Proposed: the other shape of the same skill — one of each kind in a turn.
  if (allKinds) earned.push('feat.turn.allKinds')

  if (!won) return earned

  // --- "Победить за 5 / 6 / 7 / 8 ходов" -------------------------------------
  //
  // MAX_TURNS is 5, so a 6th, 7th or 8th turn only happens when the game is tied
  // on victory points at the end and the engine adds a tie-breaker turn
  // (state.isTieBreakerTurn). The author's ladder is therefore "won on schedule"
  // plus three rungs of "won a game that would not end".
  //
  // A win before turn 5 (everyone else eliminated early) is on no rung of the
  // author's ladder and gets no turn badge. Nor is any mode excluded: the
  // author's list is unqualified, and their counter families count vs_bots games
  // as real play, so a win against a bot earns the same rung.
  if (state.turn >= 5 && state.turn <= 8) earned.push(`feat.win.turn${state.turn}`)

  // Proposed: the catch-all past the author's rung 8 — a game that needed
  // tie-breaker turns at all. Otherwise a 9-turn marathon would be the one
  // victory in the game that is recognised nowhere.
  if (state.isTieBreakerTurn) earned.push('feat.win.tiebreak')

  // Proposed: the first win. Granted on every win — the primary key keeps the
  // first one, which is the whole point of writing it this way.
  earned.push('feat.win.first')

  // Proposed: won without spending a single Action Card — on Arguments alone.
  if (!state.played.some((play) => play.seat === seat)) earned.push('feat.win.noCards')

  // Proposed: a thrashing — at least double the best other side's victory
  // points. `ranking` holds only the sides that were still standing at scoring,
  // so a 1v1 the opponent forfeited has no runner-up and cannot qualify; and the
  // runner-up must have scored at least 1 VP, or "double" would be free.
  const mine = phase.ranking.find((entry) => entry.seats.includes(seat))
  const others = phase.ranking.filter((entry) => !entry.seats.includes(seat))
  const runnerUp = others.length > 0 ? Math.max(...others.map((entry) => entry.vp)) : 0
  if (mine && runnerUp > 0 && mine.vp >= 2 * runnerUp) earned.push('feat.win.landslide')

  // Proposed: beat the hard bot — the one that plays to win, and the only
  // opponent in the game the author asked to be made harder on purpose.
  if (botStrategies.includes(RANKED_BOT_STRATEGY)) earned.push('feat.win.vsHardBot')

  return earned
}

/** The slice of GameStore this module needs — keeps the unit tests tiny. */
export interface AchievementStore {
  loadPlayCounts(userId: string): Promise<PlayCounts>
  awardAchievements(userId: string, ids: string[], gameId: string | null): Promise<string[]>
}

export interface AchievementSeat {
  seat: SeatId
  /** null = a bot sat here: it has no profile and earns nothing. */
  userId: string | null
  /** game_players.bot_strategy; null for a human seat. */
  botStrategy: string | null
  result: Verdict
}

export interface GrantAchievementsInput {
  store: AchievementStore
  log: LoggerLike
  gameId: string
  /** The FINAL engine state (phase.kind === 'finished'). */
  state: GameState
  /** EVERY seat of the finished game, bots included — bots set the difficulty. */
  seats: AchievementSeat[]
}

/**
 * Award every badge this finished game earned, for every human seat in it.
 *
 * Call it on the finish path, AFTER finishGame has persisted the results — the
 * counters are read back out of the archive, so this game has to be in it. A
 * failure here must never lose a finished game, so every seat is wrapped
 * separately and nothing propagates: one seat's database hiccup cannot cost the
 * other players their badges, and it cannot cost anyone the game.
 */
export async function grantAchievements(input: GrantAchievementsInput): Promise<void> {
  const botStrategies = input.seats.map((s) => s.botStrategy).filter((s): s is string => s !== null)

  for (const seat of input.seats) {
    const userId = seat.userId
    if (!userId) continue
    try {
      const feats = featsEarned({
        state: input.state,
        seat: seat.seat,
        result: seat.result,
        botStrategies
      })
      // Counters carry no game_id: they are facts about the archive, not about
      // this match, so they are awarded in their own call.
      const counters = countAchievements(await input.store.loadPlayCounts(userId))
      const landed = [
        ...(await input.store.awardAchievements(userId, feats, input.gameId)),
        ...(await input.store.awardAchievements(userId, counters, null))
      ]
      if (landed.length > 0)
        input.log.info(
          { gameId: input.gameId, seat: seat.seat, achievements: landed },
          'achievements earned'
        )
    } catch (error) {
      input.log.error(
        { err: error, gameId: input.gameId, seat: seat.seat },
        'achievement grant failed'
      )
    }
  }
}

export interface AchievementReader {
  loadAchievements(userId: string): Promise<EarnedAchievement[]>
  loadPlayCounts(userId: string): Promise<PlayCounts>
}

/**
 * What a profile screen needs: the earned badges plus how far along the unearned
 * counters are. The counts ride along because an unearned achievement is a goal
 * — "37 / 100" on a locked tier is the whole reason to show it.
 *
 * Published on BOTH profiles (own via `history`, another player's via `player`).
 * Nothing here is private: a badge is a fact about finished games, and the
 * per-category game counts are already public in the record table.
 */
export async function achievementStateOf(
  store: AchievementReader,
  userId: string
): Promise<AchievementState> {
  const [earned, counts] = await Promise.all([
    store.loadAchievements(userId),
    store.loadPlayCounts(userId)
  ])
  return { earned, counts }
}
