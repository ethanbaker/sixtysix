import { shuffleDeck, type Card } from "../core/deck";
import type { Rng } from "../core/rng";
import { otherPlayer, type GameState, type PlayerId } from "../core/state";

// Return whether or not the game is determined (the opponent's hand is known)
export function isDetermined(state: GameState): boolean {
  return state.stock.length === 0;
}

// Returns a GameState consistent with everything the `observer` actually knows
// (their own hand, the current trick, trump card/suit, all scores), and with
// information they don't know as a random re-deal of all not-seen cards
export function determinize(trueState: GameState, observer: PlayerId, rng: Rng): GameState {
  // If state is determined, just return state
  if (isDetermined(trueState)) return trueState;

  const opponent = otherPlayer(observer);
  const opponentHandSize = trueState.hands[opponent].length;

  // Shuffle all cards the observer can't see
  const unseen: Card[] = [...trueState.stock, ...trueState.hands[opponent]];
  const shuffled = shuffleDeck(unseen, rng);

  const hands: [Card[], Card[]] = [[...trueState.hands[0]], [...trueState.hands[1]]];
  hands[opponent] = shuffled.slice(0, opponentHandSize);

  const stock = shuffled.slice(opponentHandSize);

  return { ...trueState, hands, stock };
}

// `n` independent determinizations for `observer`. Collapses to a single
// real-state sample once game state is fully determinizable, since every
// additional "sample" would just be an identical re-shuffle of nothing
export function sampleDeterminizations(state: GameState, observer: PlayerId, n: number, rng: Rng): GameState[] {
  if (isDetermined(state)) {
    return [state];
  }

  const samples: GameState[] = [];
  for (let i = 0; i < n; i++) {
    samples.push(determinize(state, observer, rng));
  }
  return samples;
}
