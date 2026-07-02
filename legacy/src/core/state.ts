// GameState type and immutable transitions for Sixty-Six.
//
// Scope so far: open-stock trick play (Section 3.2), marriages (Section
// 3.4), the trump exchange (Section 3.3), and closing/stock-exhaustion
// (Section 3.5/3.6) — see closing.ts for the closeStock/declareSixtySix
// actions and the hand-end scoring resolution that set `handOver`,
// `winner`, and `gamePoints` on this state.

import type { Card, Deal } from "./deck";
import { cardsEqual, RANK_POINTS, RANKS } from "./deck";
import { availableMarriages, marriagePointsForSuit } from "./marriages";
import { canExchangeTrumpNine, legalMoves, trickWinner } from "./rules";

export type PlayerId = 0 | 1;

export function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

export interface PlayedCard {
  readonly player: PlayerId;
  readonly card: Card;
}

export interface GameState {
  readonly hands: readonly [readonly Card[], readonly Card[]];
  readonly trumpSuit: Card["suit"];
  // The face-up trump card; null once it has been drawn (it's always the
  // last card drawn from the combined stock+trump pile) or swapped away
  // via the trump exchange (in which case it holds the old trump 9).
  readonly trumpCard: Card | null;
  // Concealed draw pile. Index 0 is the next card to be drawn.
  readonly stock: readonly Card[];
  // Cards played to the current trick: 0 (no one has led yet) or 1 (the
  // leader has played and we're waiting on the follower).
  readonly trick: readonly PlayedCard[];
  readonly leader: PlayerId;
  readonly turn: PlayerId;
  readonly points: readonly [number, number];
  readonly tricksWon: readonly [number, number];
  // Marriage points declared but not yet counted toward score, because
  // that player hadn't won a trick at declaration time (Section 3.8).
  readonly pendingMarriagePoints: readonly [number, number];
  // Marriage points that count toward score: banked either immediately
  // (declared after already having won a trick) or the moment the
  // declaring player next wins a trick.
  readonly bankedMarriagePoints: readonly [number, number];
  // Player who manually closed the stock (Section 3.5), or null if the
  // stock hasn't been closed (it may still be naturally exhausted —
  // see rules.ts::isClosedPhase, which checks both).
  readonly earlyEndBy: PlayerId | null;
  // True once this hand is fully resolved (declared, closed-hand
  // failure, or natural end-of-hand auto-resolution — see closing.ts).
  readonly handOver: boolean;
  // Who was awarded this hand's game points; null if the hand ended
  // without anyone reaching 66 (see closing.ts's void-hand edge case).
  readonly winner: PlayerId | null;
  // Game points awarded to `winner` (0 if winner is null).
  readonly gamePoints: number;
}

export function createInitialState(
  dealResult: Deal,
  nonDealer: PlayerId,
): GameState {
  const hands: [Card[], Card[]] =
    nonDealer === 0
      ? [dealResult.nonDealerHand, dealResult.dealerHand]
      : [dealResult.dealerHand, dealResult.nonDealerHand];

  return {
    hands,
    trumpSuit: dealResult.trumpSuit,
    trumpCard: dealResult.trumpCard,
    stock: dealResult.stock,
    trick: [],
    leader: nonDealer,
    turn: nonDealer,
    points: [0, 0],
    tricksWon: [0, 0],
    pendingMarriagePoints: [0, 0],
    bankedMarriagePoints: [0, 0],
    earlyEndBy: null,
    handOver: false,
    winner: null,
    gamePoints: 0,
  };
}

// Draws one card into `player`'s hand from the stock, falling back to the
// face-up trump card once the stock is empty (it's always drawn last).
// Returns `state` unchanged if there is nothing left to draw.
function drawOne(state: GameState, player: PlayerId): GameState {
  if (state.stock.length > 0) {
    const [card, ...stock] = state.stock;
    const hands: [Card[], Card[]] = [[...state.hands[0]], [...state.hands[1]]];
    hands[player] = [...hands[player], card];
    return { ...state, hands, stock };
  }
  if (state.trumpCard !== null) {
    const hands: [Card[], Card[]] = [[...state.hands[0]], [...state.hands[1]]];
    hands[player] = [...hands[player], state.trumpCard];
    return { ...state, hands, trumpCard: null };
  }
  return state;
}

// Plays `card` for `player` to the current trick. Throws if it isn't that
// player's turn, the hand is already over, or the card isn't legal —
// during the closed-stock phase this enforces must-follow/must-beat/
// must-trump via rules.ts::legalMoves (Section 3.5/3.8).
export function playCard(
  state: GameState,
  player: PlayerId,
  card: Card,
): GameState {
  if (state.handOver) {
    throw new Error("Cannot play a card: the hand is already over");
  }
  if (player !== state.turn) {
    throw new Error(`It is not player ${player}'s turn`);
  }

  const allowed = legalMoves(state, player);
  if (!allowed.some((c) => cardsEqual(c, card))) {
    throw new Error(
      `Player ${player} cannot legally play ${card.rank} of ${card.suit} right now`,
    );
  }

  const hand = state.hands[player];
  const cardIndex = hand.findIndex((c) => cardsEqual(c, card));
  const newHand = [...hand.slice(0, cardIndex), ...hand.slice(cardIndex + 1)];
  const hands: [Card[], Card[]] = [[...state.hands[0]], [...state.hands[1]]];
  hands[player] = newHand;

  if (state.trick.length === 0) {
    // This play leads the trick; wait for the follower.
    return {
      ...state,
      hands,
      trick: [{ player, card }],
      leader: player,
      turn: otherPlayer(player),
    };
  }

  // This play follows; resolve the trick.
  const lead = state.trick[0];
  const follow: PlayedCard = { player, card };
  const result = trickWinner(lead.card, follow.card, state.trumpSuit);
  const winner = result === "lead" ? lead.player : follow.player;
  const loser = otherPlayer(winner);

  const trickPoints =
    RANK_POINTS[lead.card.rank] + RANK_POINTS[follow.card.rank];
  const points: [number, number] = [state.points[0], state.points[1]];
  points[winner] += trickPoints;

  const tricksWon: [number, number] = [state.tricksWon[0], state.tricksWon[1]];
  tricksWon[winner] += 1;

  // Winning a trick banks any of the winner's pending marriage points
  // (Section 3.8: pending until the declaring player wins a trick).
  const pendingMarriagePoints: [number, number] = [
    state.pendingMarriagePoints[0],
    state.pendingMarriagePoints[1],
  ];
  const bankedMarriagePoints: [number, number] = [
    state.bankedMarriagePoints[0],
    state.bankedMarriagePoints[1],
  ];
  if (pendingMarriagePoints[winner] > 0) {
    bankedMarriagePoints[winner] += pendingMarriagePoints[winner];
    pendingMarriagePoints[winner] = 0;
  }

  let nextState: GameState = {
    ...state,
    hands,
    trick: [],
    leader: winner,
    turn: winner,
    points,
    tricksWon,
    pendingMarriagePoints,
    bankedMarriagePoints,
  };

  // Stock replenishment: winner draws first, then loser (Section 3.2).
  // Skipped entirely once the stock has been manually closed — closing
  // freezes both hands at their current size for the rest of the hand.
  if (state.earlyEndBy === null) {
    nextState = drawOne(nextState, winner);
    nextState = drawOne(nextState, loser);
  }

  // Stock-exhaustion bonus (Section 3.6): the winner of the very last
  // trick of a naturally-exhausted hand gets +10 card points. Never
  // applies to a manually closed hand, which ends early by definition.
  const handsEmptied =
    nextState.hands[0].length === 0 && nextState.hands[1].length === 0;
  if (handsEmptied && state.earlyEndBy === null) {
    const finalPoints: [number, number] = [
      nextState.points[0],
      nextState.points[1],
    ];
    finalPoints[winner] += 10;
    nextState = { ...nextState, points: finalPoints };
  }

  return nextState;
}

// Declares a marriage (Section 3.4): leads `card` (the King or Queen of a
// suit for which the player holds both), crediting the marriage's points
// (40 trump-suit, 20 plain-suit) to that player's pending pool — or
// straight to banked if they've already won a trick at the time of
// declaration (Section 3.8). Not available once the stock is closed or
// exhausted (Section 3.5: "no new marriages may be declared").
export function declareMarriage(
  state: GameState,
  player: PlayerId,
  card: Card,
): GameState {
  if (state.handOver) {
    throw new Error("Cannot declare a marriage: the hand is already over");
  }
  if (card.rank !== "K" && card.rank !== "Q") {
    throw new Error("A marriage must be declared by leading the King or Queen");
  }

  const eligibleSuits = availableMarriages(state, player);
  if (!eligibleSuits.includes(card.suit)) {
    throw new Error(
      `Player ${player} cannot declare a marriage in ${card.suit} right now`,
    );
  }

  const marriagePoints = marriagePointsForSuit(card.suit, state.trumpSuit);

  const hand = state.hands[player];
  const cardIndex = hand.findIndex((c) => cardsEqual(c, card));
  const hands: [Card[], Card[]] = [[...state.hands[0]], [...state.hands[1]]];
  hands[player] = [...hand.slice(0, cardIndex), ...hand.slice(cardIndex + 1)];

  const pendingMarriagePoints: [number, number] = [
    state.pendingMarriagePoints[0],
    state.pendingMarriagePoints[1],
  ];
  const bankedMarriagePoints: [number, number] = [
    state.bankedMarriagePoints[0],
    state.bankedMarriagePoints[1],
  ];
  if (state.tricksWon[player] > 0) {
    bankedMarriagePoints[player] += marriagePoints;
  } else {
    pendingMarriagePoints[player] += marriagePoints;
  }

  return {
    ...state,
    hands,
    trick: [{ player, card }],
    leader: player,
    turn: otherPlayer(player),
    pendingMarriagePoints,
    bankedMarriagePoints,
  };
}

// Trump exchange (Section 3.3): swaps the player's trump 9 for the
// face-up trump card. Only legal under the preconditions checked by
// rules.ts::canExchangeTrumpNine — on lead, no cards in play, stock not
// closed/exhausted, already won a trick, and holding the trump 9.
export function exchangeTrumpNine(
  state: GameState,
  player: PlayerId,
): GameState {
  if (!canExchangeTrumpNine(state, player)) {
    throw new Error(
      `Player ${player} cannot perform the trump exchange right now`,
    );
  }

  const faceUpTrumpCard = state.trumpCard;
  if (faceUpTrumpCard === null) {
    throw new Error("No face-up trump card available to exchange for");
  }

  const hand = state.hands[player];
  const nineIndex = hand.findIndex(
    (c) => c.suit === state.trumpSuit && c.rank === RANKS[0],
  );
  const trumpNine = hand[nineIndex];
  const hands: [Card[], Card[]] = [[...state.hands[0]], [...state.hands[1]]];
  hands[player] = [
    ...hand.slice(0, nineIndex),
    faceUpTrumpCard,
    ...hand.slice(nineIndex + 1),
  ];

  return {
    ...state,
    hands,
    trumpCard: trumpNine,
  };
}
