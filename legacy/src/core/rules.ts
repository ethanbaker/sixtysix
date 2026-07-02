// Legal move generation and trick resolution for Sixty-Six.
//
// Covers both the open-stock phase (Section 3.2: no obligation to follow
// suit or trump) and the tightened closed-stock phase (Section 3.5,
// triggered either by a manual close or by natural stock exhaustion per
// Section 3.6 — see isClosedPhase). trickWinner is written generally
// (lead/follow + trump suit) and reused both for resolving tricks and for
// deciding which follow-up cards "beat" the card led.

import { RANKS, type Card, type Rank, type Suit } from "./deck";
import type { GameState, PlayerId } from "./state";

const RANK_ORDER: Readonly<Record<Rank, number>> = {
  "9": 0,
  J: 1,
  Q: 2,
  K: 3,
  "10": 4,
  A: 5,
};

// True once the tightened closed-stock rules are in effect: either a
// player manually closed the stock, or it has run out naturally (Section
// 3.6 — the trump card was the last card drawn).
export function isClosedPhase(state: GameState): boolean {
  return (
    state.earlyEndBy !== null ||
    (state.stock.length === 0 && state.trumpCard === null)
  );
}

// Determines the winner of a trick given the led card and the card played
// to follow it. Highest card of the suit led wins, unless a trump is
// played, in which case the highest trump played wins (Section 3.2).
export function trickWinner(
  ledCard: Card,
  followCard: Card,
  trumpSuit: Suit,
): "lead" | "follow" {
  const ledIsTrump = ledCard.suit === trumpSuit;
  const followIsTrump = followCard.suit === trumpSuit;

  // If one player led with a trump and the other did not, the player that
  // lead with a trump won
  if (followIsTrump && !ledIsTrump) {
    return "follow";
  }
  if (ledIsTrump && !followIsTrump) {
    return "lead";
  }

  // If cards aren't same suit, lead wins
  if (followCard.suit !== ledCard.suit) {
    return "lead";
  }

  // Cards are same suit, highest rank order wins
  return RANK_ORDER[followCard.rank] > RANK_ORDER[ledCard.rank]
    ? "follow"
    : "lead";
}

// Closed-phase follow legality (Section 3.5, clarified by 3.8): must
// follow suit; among same-suit cards, must play one that beats the card
// led if any do (else any same-suit card is legal); if unable to follow
// suit, must trump if holding any trump; if neither, anything is legal.
//
// This single set of rules also correctly covers a trump being led: in
// that case "follow suit" means "play a higher trump if able, else any
// trump", which falls out of the same logic without a separate branch.
function closedPhaseFollowMoves(
  hand: readonly Card[],
  ledCard: Card,
  trumpSuit: Suit,
): Card[] {
  // Must play of same suit
  const sameSuit = hand.filter((c) => c.suit === ledCard.suit);
  if (sameSuit.length > 0) {
    const beating = sameSuit.filter(
      (c) => trickWinner(ledCard, c, trumpSuit) === "follow",
    );
    return beating.length > 0 ? beating : [...sameSuit];
  }

  // Must play trumps if no suit matches
  const trumps = hand.filter((c) => c.suit === trumpSuit);
  if (trumps.length > 0) {
    return [...trumps];
  }

  // Can play anything
  return [...hand];
}

// Legal cards `player` may play right now. Leading is always a free
// choice. Following is unconstrained during the open-stock phase
// (Section 3.2) and constrained by closedPhaseFollowMoves once closed or
// exhausted (Section 3.5/3.8).
export function legalMoves(state: GameState, player: PlayerId): Card[] {
  if (state.handOver) return [];

  // Can play anything at the beginning of a trick or in the closed phase
  const hand = state.hands[player];
  if (state.trick.length === 0 || !isClosedPhase(state)) {
    return [...hand];
  }

  // Restrict to close phase moves
  const ledCard = state.trick[0].card;
  return closedPhaseFollowMoves(hand, ledCard, state.trumpSuit);
}

// Trump exchange (Section 3.3) is legal only when the player is on lead
// with no cards currently in play, the stock isn't closed/exhausted, has
// already won at least one trick, holds the trump 9, and there's still a
// face-up trump card to swap for.
export function canExchangeTrumpNine(
  state: GameState,
  player: PlayerId,
): boolean {
  if (state.handOver) return false;
  if (player !== state.turn || state.trick.length !== 0) return false;
  if (isClosedPhase(state)) return false;
  if (state.tricksWon[player] < 1) return false;
  if (state.trumpCard === null) return false;

  return state.hands[player].some(
    (c) => c.suit === state.trumpSuit && c.rank === RANKS[0],
  );
}

// Closing the stock (Section 3.5) is legal only when on lead, no cards in
// play, and the stock isn't already closed or naturally exhausted.
export function canCloseStock(state: GameState, player: PlayerId): boolean {
  if (state.handOver) return false;
  if (player !== state.turn || state.trick.length !== 0) return false;

  return !isClosedPhase(state);
}

// Declaring 66 (Section 3.7) is offered whenever it's legal to act on
// lead — the UX decision (Section 6) is that this is an explicit action
// available any time on lead, regardless of whether the player's actual
// total has reached 66 (a wrong declaration is a real, scoreable outcome).
export function canDeclareSixtySix(
  state: GameState,
  player: PlayerId,
): boolean {
  if (state.handOver) return false;

  return player === state.turn && state.trick.length === 0;
}
