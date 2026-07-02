// Closing the stock, declaring 66, hand-end scoring, and match-level game
// point tracking for Sixty-Six. See Sections 3.5, 3.6, 3.7.

import { isClosedPhase } from "./rules";
import { otherPlayer } from "./state";
import type { GameState, PlayerId } from "./state";

export const GAME_POINTS_TO_WIN_MATCH = 7;

// Closes the stock (Section 3.5): only legal on lead with no cards in
// play, and only while the stock isn't already closed or exhausted.
export function closeStock(state: GameState, player: PlayerId): GameState {
  if (state.handOver) {
    throw new Error("Cannot close the stock: the hand is already over");
  }

  if (player !== state.turn || state.trick.length !== 0) {
    throw new Error(
      "Can only close the stock when on lead with no cards in play",
    );
  }

  if (isClosedPhase(state)) {
    throw new Error("The stock is already closed or exhausted");
  }

  return { ...state, earlyEndBy: player };
}

// Return total score from game state of player
function totalScore(state: GameState, player: PlayerId): number {
  return state.points[player] + state.bankedMarriagePoints[player];
}

// 3.7's success table: 1 point if the (losing) opponent has >=33 raw card
// points, 2 if they have fewer but won at least one trick, 3 if they
// took zero tricks at all.
function successTablePoints(
  opponentCardPoints: number,
  opponentTricksWon: number,
): number {
  if (opponentCardPoints >= 33) return 1;
  if (opponentTricksWon >= 1) return 2;
  return 3;
}

interface HandOutcome {
  readonly winner: PlayerId;
  readonly gamePoints: number;
}

// Resolves the hand's outcome given who is being evaluated as having
// reached 66 (the explicit declarer, or — for auto end-of-hand
// resolution — whichever player actually has >=66).
//
// Manual-close framing (Section 3.5) is a strict two-outcome bucket for
// the *closer* specifically: they either reach 66 first (full 3.7
// success table, scored to the closer) or they don't (flat closer-
// failure penalty to the opponent, "regardless of the opponent's own
// point total"). That second bucket covers the closer declaring wrongly
// and the opponent *correctly* declaring 66 before the closer does.
//
// It does NOT cover the opponent declaring *wrongly* while a close is in
// effect — a previous version of this function collapsed that into the
// same flat-penalty bucket too, which let the non-closer win outright
// with an obviously-false declare (e.g. 0 points) just by virtue of the
// stock being closed. A bad-faith/mistaken declare by the non-closer is
// an ordinary wrong declaration (Section 3.7's general rule, opponent —
// i.e. the closer — scores 2, or 3 if the wrong declarer took zero
// tricks), independent of the close. This was caught by Hard's search
// actually exploiting it in self-play (see the step-7/8 summary).
function resolveOutcome(state: GameState, declarer: PlayerId): HandOutcome {
  const correct = totalScore(state, declarer) >= 66;
  const opponent = otherPlayer(declarer);

  if (state.earlyEndBy !== null) {
    if (declarer === state.earlyEndBy) {
      if (correct) {
        return {
          winner: declarer,
          gamePoints: successTablePoints(
            state.points[opponent],
            state.tricksWon[opponent],
          ),
        };
      }

      return {
        winner: opponent,
        gamePoints: state.tricksWon[declarer] === 0 ? 3 : 2,
      };
    }

    // declarer is the non-closer.
    if (correct) {
      // They genuinely reached 66 first -> the closer failed (Section 3.5).
      const closer = state.earlyEndBy;
      return {
        winner: declarer,
        gamePoints: state.tricksWon[closer] === 0 ? 3 : 2,
      };
    }

    // Wrong declare by the non-closer: ordinary 3.7 rule, not the
    // closer-failure rule -- the close itself is irrelevant here.
    return {
      winner: opponent,
      gamePoints: state.tricksWon[declarer] === 0 ? 3 : 2,
    };
  }

  if (correct) {
    return {
      winner: declarer,
      gamePoints: successTablePoints(
        state.points[opponent],
        state.tricksWon[opponent],
      ),
    };
  }
  return {
    winner: opponent,
    gamePoints: state.tricksWon[declarer] === 0 ? 3 : 2,
  };
}

// Declares 66 (Section 3.7): `player` asserts their banked card +
// marriage points total >= 66. Resolves the hand immediately, whether
// the declaration turns out to be right or wrong. Available any time on
// lead — declaring without actually having reached 66 is a legal (if
// risky) action, not a precondition failure.
export function declareSixtySix(state: GameState, player: PlayerId): GameState {
  if (state.handOver) {
    throw new Error("Cannot declare: the hand is already over");
  }

  if (player !== state.turn || state.trick.length !== 0) {
    throw new Error("Can only declare 66 when on lead with no cards in play");
  }

  const outcome = resolveOutcome(state, player);
  return {
    ...state,
    handOver: true,
    winner: outcome.winner,
    gamePoints: outcome.gamePoints,
  };
}

// Auto-resolves the hand once both hands are empty and nobody has
// explicitly declared (Section 3.7: "don't require an explicit 'I have
// 66' action if it's the literal last trick and the totals are
// knowable"). A no-op if the hand isn't actually over yet, or is already
// resolved. Safe to call after every playCard.
export function checkHandEnd(state: GameState): GameState {
  if (state.handOver) return state;

  const handsEmpty = state.hands[0].length === 0 && state.hands[1].length === 0;
  if (!handsEmpty) return state;

  if (state.earlyEndBy !== null) {
    const outcome = resolveOutcome(state, state.earlyEndBy);
    return {
      ...state,
      handOver: true,
      winner: outcome.winner,
      gamePoints: outcome.gamePoints,
    };
  }

  // No manual close: whichever player (if either) actually reached 66.
  // Both can't simultaneously be >=66 since card + marriage totals can't
  // exceed 130 between them. If neither did (a rare exact-split edge
  // case our raw-random simulations can hit but real strategic play
  // essentially never does), the hand is void: no game points awarded.
  const declarer: PlayerId | null =
    totalScore(state, 0) >= 66 ? 0 : totalScore(state, 1) >= 66 ? 1 : null;
  if (declarer === null) {
    return { ...state, handOver: true, winner: null, gamePoints: 0 };
  }
  const outcome = resolveOutcome(state, declarer);
  return {
    ...state,
    handOver: true,
    winner: outcome.winner,
    gamePoints: outcome.gamePoints,
  };
}

export interface MatchState {
  readonly matchScore: readonly [number, number];
  // Who deals the *next* hand.
  readonly dealer: PlayerId;
  readonly matchWinner: PlayerId | null;
}

export function createInitialMatchState(firstDealer: PlayerId): MatchState {
  return { matchScore: [0, 0], dealer: firstDealer, matchWinner: null };
}

// Applies a finished hand's outcome to the match score and alternates
// the deal for the next hand (CLAUDE.md Section 3.7: "First player to 7
// game points wins the match. Track match score across hands; deal
// alternates after each hand.").
export function applyHandResult(
  match: MatchState,
  hand: GameState,
): MatchState {
  if (match.matchWinner !== null) {
    throw new Error("The match is already over");
  }
  if (!hand.handOver) {
    throw new Error("Cannot apply an unfinished hand's result to the match");
  }

  const matchScore: [number, number] = [
    match.matchScore[0],
    match.matchScore[1],
  ];
  if (hand.winner !== null) {
    matchScore[hand.winner] += hand.gamePoints;
  }

  const matchWinner: PlayerId | null =
    matchScore[0] >= GAME_POINTS_TO_WIN_MATCH
      ? 0
      : matchScore[1] >= GAME_POINTS_TO_WIN_MATCH
        ? 1
        : null;

  return {
    matchScore,
    dealer: otherPlayer(match.dealer),
    matchWinner,
  };
}
