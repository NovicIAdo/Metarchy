// Player-level tie-break round logic — spec §11. Pure: one revealed round of
// rock/paper/scissors among tied parties; §8.2 logic with no dummy and no bets.

import type { Rps, SeatId } from './types.js'

/**
 * Survivors of one round. Exactly two distinct choices → the beating type survives;
 * one choice or all three (circular) → everyone replays.
 */
export function tiebreakSurvivors(
  participants: readonly SeatId[],
  choices: Readonly<Partial<Record<SeatId, Rps>>>
): SeatId[] {
  const types = new Set<Rps>()
  for (const seat of participants) {
    const choice = choices[seat]
    if (!choice) throw new Error(`tiebreakSurvivors: seat ${seat} has no choice`)
    types.add(choice)
  }
  if (types.size !== 2) return [...participants]
  const [a, b] = [...types] as [Rps, Rps]
  const winner = beatsRps(a, b) ? a : b
  return participants.filter((seat) => choices[seat] === winner)
}

function beatsRps(a: Rps, b: Rps): boolean {
  return (
    (a === 'rock' && b === 'scissors') ||
    (a === 'paper' && b === 'rock') ||
    (a === 'scissors' && b === 'paper')
  )
}
