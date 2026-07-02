// Marriage (Königspaar) detection and scoring for Sixty-Six.
//
// The actual state transition (leading the declared card and crediting
// points) lives in state.ts::declareMarriage; this module is pure
// detection/scoring logic, reused by both the transition and by
// legal-action queries (e.g. for the AI/UI to know what's offered).

import type { Card, Suit } from "./deck";
import { SUITS } from "./deck";
import { isClosedPhase } from "./rules";
import type { GameState, PlayerId } from "./state";

export const PLAIN_MARRIAGE_POINTS = 20;
export const TRUMP_MARRIAGE_POINTS = 40;

// Return associated marriage points based on suit
export function marriagePointsForSuit(suit: Suit, trumpSuit: Suit): number {
  return suit === trumpSuit ? TRUMP_MARRIAGE_POINTS : PLAIN_MARRIAGE_POINTS;
}

// Return true if a hand has both a king and queen for the provided suit
function holdsBothKingAndQueen(hand: readonly Card[], suit: Suit): boolean {
  let hasKing = false;
  let hasQueen = false;

  for (const card of hand) {
    if (card.suit !== suit) continue;
    if (card.rank === "K") hasKing = true;
    if (card.rank === "Q") hasQueen = true;
  }

  return hasKing && hasQueen;
}

// Suits for which `player` could declare a marriage right now: they must
// be on lead with no cards currently in play, hold both the King and
// Queen of that suit, and the stock must not be closed or exhausted yet
// — no new marriages once the closed-stock rules kick in (Section 3.5).
// Returns [] if a marriage isn't currently declarable at all (wrong turn,
// mid-trick, hand already over).
export function availableMarriages(state: GameState, player: PlayerId): Suit[] {
  if (state.handOver) return [];
  if (player !== state.turn || state.trick.length !== 0) return [];
  if (isClosedPhase(state)) return [];

  return SUITS.filter((suit) =>
    holdsBothKingAndQueen(state.hands[player], suit),
  );
}
