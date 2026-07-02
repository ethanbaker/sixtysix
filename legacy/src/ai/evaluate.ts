// Heuristic evaluation function for Sixty-Six (CLAUDE.md Section 4.4).
// Scores a GameState from one player's perspective; higher is better for
// that player. Used by the Easy greedy player (player.ts) now, and will
// be reused by minimax/alpha-beta cutoff scoring once search lands.
//
// Note on "unseen" cards (judgment call): 4.4 asks for a "card-counting
// signal: high cards (A, 10) still unseen/in play". Our GameState is
// fully transparent (both hands, the stock, and the trick are all plain
// Card[] — there's no hidden-information layer yet; that arrives with
// determinization in a later step). So for now "unseen" is approximated
// as "not in my own hand and not yet banked into a finished trick" —
// i.e. still sitting in the opponent's hand, the stock, or the current
// trick. That's the closest analog available without peeking at
// information a real player wouldn't have *and* without the
// determinization machinery this step intentionally excludes.

import type { Card, Rank, Suit } from "../core/deck";
import { availableMarriages, marriagePointsForSuit } from "../core/marriages";
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
  //
  // Tuned up from an initial -10 (step 6) after step 7/8's Hard-vs-Easy
  // simulation caught it closing the stock the moment it won a single
  // early trick (~5 points): at low sample counts, "close now" freezes
  // the position and so has *zero* variance across determinized samples
  // (no more stock draws to vary), while "keep playing" is subject to
  // the sampled stock's randomness and so looks noisier — with few
  // samples, that noise can make a genuinely-better "keep playing" line
  // average out below a prematurely "safe-looking" close purely from
  // variance, not real merit. The old -10 cap wasn't steep enough to
  // reliably overpower that noise; -60 makes anything but a near-certain
  // close score clearly worse than playing on.
  closeRiskPenalty: -60,
} as const;

// A correct/incorrect declare-66 (or a manual-close failure resolving at
// hand-end) ends the hand and converts directly to game points — that
// dominates every heuristic signal below it, scaled large enough that no
// combination of the weights above could ever out-vote it.
const TERMINAL_GAME_POINT_VALUE = 1000;

const SIXTY_SIX = 66;

const TRUMP_RANK_WEIGHT: Readonly<Record<Rank, number>> = {
  "9": 1,
  J: 2,
  Q: 3,
  K: 4,
  "10": 5,
  A: 6,
};

const HIGH_RANKS: ReadonlySet<Rank> = new Set(["A", "10"]);

function trumpQuality(hand: readonly Card[], trumpSuit: Suit): number {
  return hand.reduce(
    (sum, card) => (card.suit === trumpSuit ? sum + TRUMP_RANK_WEIGHT[card.rank] : sum),
    0,
  );
}

// Sum of marriage points for suits `player` could still declare right
// now but hasn't — the "potential" (undeclared) half of 4.4's marriage
// signal, as opposed to pendingMarriagePoints (already declared).
function potentialMarriageValue(state: GameState, player: PlayerId): number {
  return availableMarriages(state, player).reduce(
    (sum, suit) => sum + marriagePointsForSuit(suit, state.trumpSuit),
    0,
  );
}

function unaccountedHighCards(state: GameState, player: PlayerId): number {
  const elsewhere: Card[] = [
    ...state.hands[otherPlayer(player)],
    ...state.stock,
    ...state.trick.map((played) => played.card),
    ...(state.trumpCard ? [state.trumpCard] : []),
  ];
  return elsewhere.filter((card) => HIGH_RANKS.has(card.rank)).length;
}

function currentTotal(state: GameState, player: PlayerId): number {
  return state.points[player] + state.bankedMarriagePoints[player];
}

// Card + banked marriage points, plus pending marriage points that will
// bank automatically on this player's next trick win — i.e. what's
// "realistically" theirs already, per 4.4.
function likelyReachableTotal(state: GameState, player: PlayerId): number {
  return currentTotal(state, player) + state.pendingMarriagePoints[player];
}

function proximityScore(state: GameState, player: PlayerId): number {
  return Math.min(likelyReachableTotal(state, player), SIXTY_SIX) / SIXTY_SIX;
}

// Only scores the *closing* decision itself (rewarding/penalizing having
// just closed the stock); irrelevant once the opponent is the closer, or
// nobody has closed.
function closeSafetyScore(state: GameState, player: PlayerId): number {
  if (state.earlyEndBy !== player) return 0;
  const total = likelyReachableTotal(state, player);
  if (total >= SIXTY_SIX) {
    return WEIGHTS.closeSafetyBonus;
  }
  const shortfall = (SIXTY_SIX - total) / SIXTY_SIX;
  return WEIGHTS.closeRiskPenalty * shortfall;
}

export function evaluate(state: GameState, player: PlayerId): number {
  const opponent = otherPlayer(player);

  if (state.handOver) {
    if (state.winner === player) return TERMINAL_GAME_POINT_VALUE * state.gamePoints;
    if (state.winner === opponent) return -TERMINAL_GAME_POINT_VALUE * state.gamePoints;
    return 0; // void hand: nobody reached 66 (see closing.ts)
  }

  let score = 0;
  score += WEIGHTS.netBankedPoints * (currentTotal(state, player) - currentTotal(state, opponent));
  score +=
    WEIGHTS.pendingMarriagePoints *
    (state.pendingMarriagePoints[player] - state.pendingMarriagePoints[opponent]);
  score +=
    WEIGHTS.potentialMarriagePoints *
    (potentialMarriageValue(state, player) - potentialMarriageValue(state, opponent));
  score +=
    WEIGHTS.trumpQuality *
    (trumpQuality(state.hands[player], state.trumpSuit) -
      trumpQuality(state.hands[opponent], state.trumpSuit));
  score += WEIGHTS.highCardRisk * unaccountedHighCards(state, player);
  score += WEIGHTS.proximityTo66 * proximityScore(state, player);
  score += closeSafetyScore(state, player);
  return score;
}
