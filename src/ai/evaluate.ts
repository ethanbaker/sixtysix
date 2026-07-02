// Heuristic evaluation function for sixty-six. Scores a GameState from one player's perspective

import type { Rank, Card, Suit } from "../core/deck";
import { getAvailableMarriages, getMarriagePoints } from "../core/rules";
import type { GameState, PlayerId } from "../core/state";
import { otherPlayer } from "../core/state";

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
  closeRiskPenalty: -60,
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

// Only scores the *closing* decision itself (rewarding/penalizing having
// just closed the stock); irrelevant once the opponent is the closer, or
// nobody has closed.
function closeStockSafetyScore(state: GameState, player: PlayerId): number {
  if (state.activeCall !== null && state.activeCall.callingPlayer !== player) return 0;

  const total = likelyReachableTotal(state, player);
  if (total >= SIXTY_SIX) {
    return WEIGHTS.closeSafetyBonus;
  }

  const shortfall = (SIXTY_SIX - total) / SIXTY_SIX;
  return WEIGHTS.closeRiskPenalty * shortfall;
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
