// Heuristic evaluation function for sixty-six. Scores a GameState from one player's perspective

import { RANK_ORDER, type Rank, type Card, type Suit } from "../core/deck";
import { getAvailableMarriages, getMarriagePoints, isBigSmallCallBroken } from "../core/rules";
import type { GameState, PlayerId } from "../core/state";
import { otherPlayer } from "../core/state";

// Highest possible gap between two RANK_ORDER values (A=5 vs 9=0), used to
// normalize the worst-pairing margin in bigSmallCallScore.
const MAX_RANK_GAP = 5;

// Tunable weights. Keep every coefficient named here so later tuning
// (or AI difficulty variants) doesn't have to hunt for magic numbers
// scattered through the scoring logic below.
export const WEIGHTS = {
  // Card + banked-marriage points already locked in, net of the opponent's.
  netBankedPoints: 1,

  // Marriage points declared but pending (will bank on this player's next
  // trick win) — counted at high confidence since banking is automatic.
  pendingMarriagePoints: 0.9,

  // Marriages still undeclared in hand: real value, but contingent on
  // both declaring *and* later winning a trick, so discounted heavily.
  potentialMarriagePoints: 0.35,

  // Trump count/quality in hand, net of the opponent's.
  trumpQuality: 3,

  // Penalty per high card (A/10) still unaccounted for outside this
  // player's hand — more of those out there is more risk/uncertainty.
  highCardRisk: -4,

  // Reward for being close to (or past) 66 in card + realistically
  // bankable marriage points.
  proximityTo66: 2,

  // Bonus for having just closed the stock while already safely at 66+.
  closeSafetyBonus: 6,

  // Penalty (scaled by shortfall) for closing while still short of 66 —
  // closing is a one-way door, so this is deliberately steep; it's what
  // keeps Easy from closing proactively per Section 4.5's behavior table.
  closeRiskPenalty: -80,

  // Scales the confidence signal (-1..1) for an active big/small call —
  // see bigSmallCallScore. Large, since once such a call is active it's
  // effectively the whole game (a correct/incorrect big/small call is
  // worth 1-3 match points outright, same order of magnitude as reaching
  // or missing 66), and a shallow search won't play the hand out far
  // enough to see the true win/lose terminal itself.
  bigSmallCallConfidence: 40,
} as const;

// A correct/incorrect declare-66 (or a manual-close failure resolving at
// hand-end) ends the hand and converts directly to game points — that
// dominates every heuristic signal below it, scaled large enough that no
// combination of the weights above could ever out-vote it.
const TERMINAL_GAME_POINT_VALUE = 1000;

const SIXTY_SIX = 66;

// How valuable each trump card is
const TRUMP_RANK_WEIGHT: Readonly<Record<Rank, number>> = {
  "9": 1,
  J: 2,
  Q: 3,
  K: 4,
  "10": 5,
  A: 6,
};

// Cards that count as "high ranking"
const HIGH_RANKS: ReadonlySet<Rank> = new Set(["A", "10"]);

// Quality of trump cards in a given hand
function trumpQuality(hand: readonly Card[], trumpSuit: Suit): number {
  return hand.reduce((sum, card) => (card.suit === trumpSuit ? sum + TRUMP_RANK_WEIGHT[card.rank] : sum), 0);
}

// Sum of marriage points for suits `player` could still declare right
// now but hasn't
function potentialMarriageValue(state: GameState, player: PlayerId): number {
  return getAvailableMarriages(state, player).reduce((sum, card) => sum + getMarriagePoints(card.suit, state.trumpSuit), 0);
}

// Sum of high ranking cards that aren't in the player's hand
function unaccountedHighCards(state: GameState, player: PlayerId): number {
  const elsewhere: Card[] = [
    ...state.hands[otherPlayer(player)], // In other player's hand
    ...state.stock, // In stock
    ...state.currentTrick.map((played) => played.card), // Leading trick
    ...(state.trumpCard ? [state.trumpCard] : []), // Visible trump card
  ];

  return elsewhere.filter((card) => HIGH_RANKS.has(card.rank)).length;
}

// Total player points
function currentTotal(state: GameState, player: PlayerId): number {
  return state.points[player] + state.bankedMarriagePoints[player];
}

// Total player points plus pending marriage points (that will be banked on a single trick win)
function likelyReachableTotal(state: GameState, player: PlayerId): number {
  return currentTotal(state, player) + state.pendingMarriagePoints[player];
}

// How close the player is to reaching sixty six
function proximityScore(state: GameState, player: PlayerId): number {
  return Math.min(likelyReachableTotal(state, player), SIXTY_SIX) / SIXTY_SIX;
}

// Only scores the *closing*/*declaring-66* decision itself (rewarding/
// penalizing having just closed the stock or declared 66 while safely at
// 66+); irrelevant once the opponent made the call, nobody has, or the
// active call is a big/small (whose win condition isn't about reaching
// 66 at all -- see bigSmallCallScore).
function closeStockSafetyScore(state: GameState, player: PlayerId): number {
  const call = state.activeCall;
  if (call === null || call.callingPlayer !== player) return 0;
  if (call.callType !== "close-stock" && call.callType !== "sixtysix") return 0;

  const total = likelyReachableTotal(state, player);
  if (total >= SIXTY_SIX) {
    return WEIGHTS.closeSafetyBonus;
  }

  const shortfall = (SIXTY_SIX - total) / SIXTY_SIX;
  return WEIGHTS.closeRiskPenalty * shortfall;
}

// Proxy for how a "big"/"small" call is likely to resolve. A big/small call
// requires the caller to beat the opponent's card in *every* remaining
// trick (bigSmallValidator checks state.trickHistory.every(...)), so this
// is an all-or-nothing bet, not a majority vote -- one bad pairing sinks
// the whole call. Confidence is therefore driven by the *worst* pairing
// (in the best-case sorted matchup), not the average across pairings.
function bigSmallCallScore(state: GameState, player: PlayerId): number {
  const call = state.activeCall;
  if (call === null || (call.callType !== "big" && call.callType !== "small")) return 0;

  const caller = call.callingPlayer;
  const opponent = otherPlayer(caller);

  // A past trick already violated the call -- the outcome is locked in
  // regardless of what's left in hand, so don't let the remaining-cards
  // heuristic below paper over an already-lost call.
  if (isBigSmallCallBroken(state)) {
    return caller === player ? -TERMINAL_GAME_POINT_VALUE : TERMINAL_GAME_POINT_VALUE;
  }

  const callerRanks = state.hands[caller].map((c) => RANK_ORDER[c.rank]).sort((a, b) => b - a);
  const opponentRanks = state.hands[opponent].map((c) => RANK_ORDER[c.rank]).sort((a, b) => b - a);

  const cards = Math.min(callerRanks.length, opponentRanks.length);
  if (cards === 0) return 0;

  // Margin at each best-case paired position; positive means that pairing
  // favors the caller. The worst (minimum) margin across all pairings
  // determines whether a clean sweep is even reachable from here.
  let worstMargin = Infinity;
  for (let i = 0; i < cards; i++) {
    const margin = call.callType === "big" ? callerRanks[i] - opponentRanks[i] : opponentRanks[i] - callerRanks[i];
    worstMargin = Math.min(worstMargin, margin);
  }

  // -1 (worst pairing is a loss/tie by the full possible gap) .. 1 (every
  // pairing favors the caller by the maximum possible gap). worstMargin <= 0
  // means at least one pairing isn't strictly favorable, which already
  // rules out a clean sweep in the best case, so it maps to <= 0 confidence.
  const confidence = Math.max(-1, Math.min(1, worstMargin / MAX_RANK_GAP));
  const magnitude = WEIGHTS.bigSmallCallConfidence * confidence;
  return caller === player ? magnitude : -magnitude;
}

// Evaluate the game state based on provided weights and calculation methods
export function evaluate(state: GameState, player: PlayerId): number {
  const opponent = otherPlayer(player);

  const outcome = state.handOutcome;
  if (outcome !== null) {
    if (outcome.winner === player) return TERMINAL_GAME_POINT_VALUE * outcome.matchPoints;
    if (outcome.winner === opponent) return -TERMINAL_GAME_POINT_VALUE * outcome.matchPoints;
    return 0;
  }

  // If in big or small call, evaluation score changes
  if (state.activeCall !== null && (state.activeCall.callType === "big" || state.activeCall.callType === "small")) {
    return bigSmallCallScore(state, player);
  }

  let score = 0;
  score += WEIGHTS.netBankedPoints * (currentTotal(state, player) - currentTotal(state, opponent));
  score += WEIGHTS.pendingMarriagePoints * (state.pendingMarriagePoints[player] - state.pendingMarriagePoints[opponent]);
  score += WEIGHTS.potentialMarriagePoints * (potentialMarriageValue(state, player) - potentialMarriageValue(state, opponent));
  score += WEIGHTS.trumpQuality * (trumpQuality(state.hands[player], state.trumpSuit) - trumpQuality(state.hands[opponent], state.trumpSuit));
  score += WEIGHTS.highCardRisk * unaccountedHighCards(state, player);
  score += WEIGHTS.proximityTo66 * proximityScore(state, player);
  score += closeStockSafetyScore(state, player);
  return score;
}
