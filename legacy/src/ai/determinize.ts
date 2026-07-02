// Determinization (Perfect Information Monte Carlo) for Sixty-Six.
// CLAUDE.md Section 4.2: sample plausible, consistent deals of the cards
// `observer` can't see into "opponent hand" + "remaining stock", so a
// perfect-information search (search.ts) can run on each sample.
//
// Judgment call: CLAUDE.md frames the endgame shortcut as triggering once
// the opponent's hand is "fully determined by elimination (closed/
// exhausted stock + tracked played cards)". Our GameState doesn't retain
// trick history (played cards are discarded into point totals only, see
// evaluate.ts's note on the same issue in step 6) — but it turns out we
// don't need history for this: GameState is a fully transparent
// perfect-information structure (both hands are plain Card[], not a
// redacted per-player view), so the unseen pool is exactly
// `state.hands[opponent] ∪ state.stock`. The moment `state.stock` is
// empty, that pool *is* the opponent's hand — one possible assignment,
// not a guess — regardless of how it got that way. No play-history
// tracking required.

import type { Card } from "../core/deck";
import { shuffleDeck } from "../core/deck";
import type { Rng } from "../core/rng";
import type { GameState, PlayerId } from "../core/state";
import { otherPlayer } from "../core/state";

// True once the opponent's exact hand is pinned down (nothing left
// concealed to sample) — see the judgment-call note above.
export function isFullyDetermined(state: GameState): boolean {
  return state.stock.length === 0;
}

// Returns a GameState consistent with everything `observer` actually
// knows (their own hand, the trick, the trump card/suit, all scores) but
// with the opponent's hand and the stock replaced by a random
// re-deal of the cards observer can't see. `observer`'s own hand, the
// trick, and the trump card are never touched.
//
// A no-op (returns `state` itself) once isFullyDetermined — there's
// nothing left to sample, the "unseen" cards are unambiguously the
// opponent's hand already.
export function determinize(
  state: GameState,
  observer: PlayerId,
  rng: Rng,
): GameState {
  if (isFullyDetermined(state)) {
    return state;
  }

  const opponent = otherPlayer(observer);
  const opponentHandSize = state.hands[opponent].length;

  const unseen: Card[] = [...state.hands[opponent], ...state.stock];
  const shuffled = shuffleDeck(unseen, rng);

  const hands: [Card[], Card[]] = [[...state.hands[0]], [...state.hands[1]]];
  hands[opponent] = shuffled.slice(0, opponentHandSize);
  const stock = shuffled.slice(opponentHandSize);

  return { ...state, hands, stock };
}

// `n` independent determinizations for `observer`. Collapses to a single
// real-state sample once isFullyDetermined, since every additional
// "sample" would just be an identical re-shuffle of nothing.
export function sampleDeterminizations(
  state: GameState,
  observer: PlayerId,
  n: number,
  rng: Rng,
): GameState[] {
  if (isFullyDetermined(state)) {
    return [state];
  }
  const samples: GameState[] = [];
  for (let i = 0; i < n; i++) {
    samples.push(determinize(state, observer, rng));
  }
  return samples;
}
