// Legal move validator and trick resolution

import { cardsEqual, RANK_ORDER, type Card, type Suit } from "./deck";
import { otherPlayer, type GameState, type PlayedCard, type PlayerId } from "./state";

// Return true if the game is in the closed phase
//  - Game was ended early by a big/small/66 call
//  - Stock (and trump card) is depleted
export function isClosedPhase(state: GameState): boolean {
  return state.activeCall !== null || (state.stock.length === 0 && state.trumpCard === null);
}

// Determine the winner of a trick
export function isTrickWinner(ledCard: Card, followCard: Card, trumpSuit: Suit): "lead" | "follow" {
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
  return RANK_ORDER[followCard.rank] > RANK_ORDER[ledCard.rank] ? "follow" : "lead";
}

// Determine if the hand is over
export function isHandOver(state: GameState): boolean {
  return state.handOutcome !== null;
}

// Determine whether or not the player can draw a card
//  - If not in the closed phase
//  - If the stock and trump card remain
//  - If the player has 5 cards
export function canDrawCard(state: GameState, player: PlayerId): boolean {
  if (isClosedPhase(state)) return false;
  if (state.stock.length === 0 && state.trumpCard === null) return false;
  return state.hands[player].length === 5;
}

// Players can play a card if not in the opening call phase
export function canPlayCard(state: GameState, player: PlayerId): boolean {
  return !state.openingCall && state.currentPlayer === player;
}

/** Move rules */

// Return legal moves for a hand during the closed phase. A player must play:
//  - Higher cards of same suit
//  - Trump card on non-trump suit
//  - Higher trump card on trump suit
// If none of the criteria are met, the player can "play" anything but will lose the trick
function getClosedPhaseCardMoves(hand: readonly Card[], ledCard: Card, trumpSuit: Suit): Card[] {
  // Must play same suit
  const sameSuit = hand.filter((c) => c.suit === ledCard.suit);
  if (sameSuit.length > 0) {
    // Must play a high
    const beating = sameSuit.filter((c) => isTrickWinner(ledCard, c, trumpSuit) === "follow");
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

// Return legal moves the player can play right now
export function getLegalCardMoves(state: GameState, player: PlayerId): Card[] {
  const hand = state.hands[player];

  // Can only make call or pass in beginning
  if (state.openingCall) {
    return [];
  }

  // Can play anything if
  //  - Not in closed phase
  //  - Or leading player in closed phase
  //  - Made big or small call
  if (!isClosedPhase(state)) {
    return [...hand];
  }
  if (state.activeCall !== null && (state.activeCall.callType === "small" || state.activeCall.callType === "big")) {
    return [...hand];
  }

  if (state.leadingPlayer === player) {
    return [...hand];
  }

  if (state.currentTrick.length !== 1) {
    console.log("bad state: ", state);
  }

  const leadCard = state.currentTrick[0].card;
  if (!leadCard) {
    throw new Error("Trick missing card when lead player is set");
  }
  return getClosedPhaseCardMoves(hand, leadCard, state.trumpSuit);
}

/** Special rules (trump exchange) */

// Whether or not a player can exchange for the lowest trump card under the stock
//  - Player needs to be leading and on their turn
//  - Cannot be in the closed phase or opening call
//  - Player must have won one trick
//  - Stock + trump card are empty
//  - Player has the lowest trump card
export function canExchangeLowestTrump(state: GameState, player: PlayerId): boolean {
  if (player !== state.leadingPlayer || player !== state.currentPlayer) return false;
  if (isClosedPhase(state) || state.openingCall) return false;
  if (state.tricksWon[player] < state.options.trickRequirementForTrumpSwap) return false;
  if (state.trumpCard === null) return false;
  return state.hands[player].some((c) => cardsEqual(c, { suit: state.trumpSuit, rank: state.options.deckType.ranks[0] }));
}

/** Declarations/calls */

export type Call = "big" | "small" | "sixtysix" | "close-stock";
const CALLS: Call[] = ["big", "small", "sixtysix", "close-stock"];

// Calls the user can make according to game options
export function getCalls(state: GameState, player: PlayerId): Call[] {
  let availableCalls: Call[] = [];

  for (const c of CALLS) {
    if (canDeclareCall(state, player, c)) {
      availableCalls.push(c);
    }
  }

  return availableCalls;
}

// Whether or not the player can "declare" a call
export function canDeclareCall(state: GameState, player: PlayerId, call: Call): boolean {
  if (state.activeCall !== null) return false;

  switch (call) {
    // Whether or not the player can declare at the beginning of the round
    //  - Player's turn in the opening call window (before any card is
    //    played this hand) -- either the leader on their own turn, or
    //    either player once the opening call window reaches them
    case "big":
    case "small":
      if (!state.options.allowBeginningCalls) return false;
      return state.openingCall;

    // Whether or not the player can declare 66 during the game
    //  - Player's turn & player's leading
    case "sixtysix":
      if (!state.options.allowSixtySixCalls) return false;
      return player === state.currentPlayer && player === state.leadingPlayer && !state.openingCall;

    // Whether or not the player can declare the stock closed
    //  - Player's turn && player's leading, OR it's their turn in the
    //    opening call window (lets the non-leading player pre-emptively
    //    close the stock before the first card of the hand is played)
    case "close-stock":
      if (!state.options.allowClosingStock) return false;
      return player === state.currentPlayer;

    default:
      throw new Error(`unrecognized call: ${call}`);
  }
}

// Return true if in big/small call
export function isBigSmallCall(state: GameState): boolean {
  return state.activeCall !== null && (state.activeCall.callType === "big" || state.activeCall.callType === "small");
}

// Return true if an active big/small call has already been broken by a
// past trick. bigSmallValidator requires *every* trick to match, so a
// single violation already guarantees the caller's loss regardless of how
// the remaining tricks play out -- evaluation should treat this as the
// settled outcome it is rather than re-scoring off the caller's remaining
// cards, which would look overly optimistic again.
export function isBigSmallCallBroken(state: GameState): boolean {
  if (!isBigSmallCall(state)) return false;
  const call = state.activeCall!;
  const validator = bigSmallValidator(call.callType as "big" | "small", call.callingPlayer);
  return !state.trickHistory.every(validator);
}

// Whether or not the player may decline to make an opening call
// (big/small/close-stock) right now, handing the decision to the other
// player (or, if they were the second to decide, letting normal play begin)
export function canPassOpeningCall(state: GameState, player: PlayerId): boolean {
  return !isHandOver(state) && state.currentPlayer === player && state.openingCall;
}

/** Marriages rules */

export const PLAIN_MARRIAGE_POINTS = 20;
export const TRUMP_MARRIAGE_POINTS = 40;

// Return associated marriage points based on suit
export function getMarriagePoints(suit: Suit, trumpSuit: Suit): number {
  return suit === trumpSuit ? TRUMP_MARRIAGE_POINTS : PLAIN_MARRIAGE_POINTS;
}

// Return true if a hand has a specific marriage (king and queen for the provided suit)
function hasMarriageForSuit(hand: readonly Card[], suit: Suit): boolean {
  let hasKing = false;
  let hasQueen = false;

  for (const card of hand) {
    if (card.suit !== suit) continue;
    if (card.rank === "K") hasKing = true;
    if (card.rank === "Q") hasQueen = true;
  }

  return hasKing && hasQueen;
}

// Return all available marriage cards the player can play. Returns empty if
//  - Not player's turn
//  - Not leading trick
//  - In closed phase
export function getAvailableMarriages(state: GameState, player: PlayerId): Card[] {
  if (player !== state.leadingPlayer || player !== state.currentPlayer) return [];
  if (isClosedPhase(state) || state.openingCall) return [];

  const hand = state.hands[player];
  const marriageSuits = state.options.deckType.suits.filter((s) => hasMarriageForSuit(hand, s));

  return marriageSuits.flatMap((s) => [
    { suit: s, rank: "K" },
    { suit: s, rank: "Q" },
  ]);
}

/** Closing rules */

// Get a player's points during a single game (normal points + banked marraiges)
export function getGamePoints(state: GameState, player: PlayerId): number {
  return state.points[player] + state.bankedMarriagePoints[player];
}

export type HandOutcome = {
  readonly winner: PlayerId;
  readonly matchPoints: number;
};

// Get a player's match points (across multiple rounds)
//  - If play didn't end with big/small call, calculate from points
//    - Opponent scored at least 33 points -> one match point
//    - Opponent won one trick -> two match points
//    - Opponent scored zero tricks -> three match points
//  - Otherwise, calculate from call outcome
export function getGameOutcome(state: GameState): HandOutcome {
  const call = state.activeCall;
  if (call === null) {
    // If no call, player with most points wins
    const winner = getGamePoints(state, 0) > getGamePoints(state, 1) ? 0 : 1;
    const opponent = otherPlayer(winner);
    const opponentPoints = getGamePoints(state, opponent);
    const opponentTricks = state.tricksWon[opponent];

    return { winner, matchPoints: baseMatchPoints(opponentPoints, opponentTricks) };
  }

  const declarer = call.callingPlayer;
  const opponent = otherPlayer(declarer);
  const opponentPoints = getGamePoints(state, opponent);
  const opponentTricks = state.tricksWon[opponent];

  switch (call.callType) {
    case "sixtysix":
    case "close-stock":
      // Score as normal if player who called sixty six got 66
      if (getGamePoints(state, declarer) >= 66) {
        return { winner: declarer, matchPoints: baseMatchPoints(opponentPoints, opponentTricks) };
      }

      // Give points to opponent if not
      return { winner: opponent, matchPoints: state.tricksWon[opponent] === 0 ? 3 : 2 };

    case "big":
    case "small":
      return state.trickHistory.every(bigSmallValidator(call.callType, declarer))
        ? { winner: declarer, matchPoints: call.callType === "big" ? 3 : 2 }
        : { winner: opponent, matchPoints: 1 };

    default:
      throw new Error(`Unhandled call type: ${call.callType}`);
  }
}

// Helper function to calculate common outcomes
function baseMatchPoints(opponentCardPoints: number, opponentTricksWon: number): number {
  if (opponentCardPoints >= 33) return 1;
  if (opponentTricksWon >= 1) return 2;
  return 3;
}

// Helper function to validate big calls
function bigSmallValidator(
  call: "big" | "small",
  declarer: PlayerId,
): (trick: PlayedCard[], index: number, array: readonly PlayedCard[][]) => boolean {
  return call === "big"
    ? (trick, _, __) =>
        RANK_ORDER[trick.find((c) => c.player === declarer)!.card.rank] > RANK_ORDER[trick.find((c) => c.player !== declarer)!.card.rank]
    : (trick, _, __) =>
        RANK_ORDER[trick.find((c) => c.player === declarer)!.card.rank] < RANK_ORDER[trick.find((c) => c.player !== declarer)!.card.rank];
}
