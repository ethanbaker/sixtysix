// game state and immutable transitions

import { cardId, cardsEqual, RANK_POINTS, type Card, type Deal, type DeckType, type Suit } from "./deck";
import {
  canDeclareCall,
  canExchangeLowestTrump,
  canPassOpeningCall,
  getAvailableMarriages,
  getGameOutcome,
  getLegalCardMoves,
  getMarriagePoints,
  isBigSmallCall,
  isClosedPhase,
  isHandOver,
  isTrickWinner,
  type Call,
  type HandOutcome,
} from "./rules";

/** Player */

export type PlayerId = 0 | 1;

export function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

export interface PlayedCard {
  readonly player: PlayerId;
  readonly card: Card;
}

/** Game State */

export interface GameOptions {
  // Deck type of the game
  readonly deckType: DeckType;

  // Whether or not to count marriage points as pending
  readonly pendingMarriages: boolean;

  // Amount of tricks required before swapping trump card
  readonly trickRequirementForTrumpSwap: number;

  // Bonus for winning the last trick
  readonly lastStockPointBonus: number;

  // Whether or not to allow beginning calls (big/small/66)
  readonly allowBeginningCalls: boolean;

  // Whether or not to allow 66 calls during the game
  readonly allowSixtySixCalls: boolean;

  // Whether or not to allow closing the stock early
  readonly allowClosingStock: boolean;
}

export interface GameState {
  // Game settings
  readonly options: GameOptions;

  // Player info
  readonly hands: readonly [readonly Card[], readonly Card[]];
  readonly points: readonly [number, number];
  readonly pendingMarriagePoints: readonly [number, number];
  readonly bankedMarriagePoints: readonly [number, number];
  readonly tricksWon: readonly [number, number];

  // State info
  readonly currentTrick: readonly PlayedCard[];
  readonly trickHistory: readonly PlayedCard[][];
  readonly gameHistory: string[];
  readonly leadingPlayer: PlayerId;
  readonly currentPlayer: PlayerId;
  readonly openingCall: boolean;
  readonly activeCall: {
    callingPlayer: PlayerId;
    callType: Call;
  } | null;
  readonly handOutcome: HandOutcome | null;

  // Stock info
  readonly trumpSuit: Suit;
  readonly trumpCard: Card | null;
  readonly stock: readonly Card[];
}

// Create the inital game state
export function createInitialState(deal: Deal, nonDealer: PlayerId, options: GameOptions): GameState {
  const hands: [Card[], Card[]] = nonDealer === 0 ? [deal.nonDealerHand, deal.dealerHand] : [deal.dealerHand, deal.nonDealerHand];

  return {
    options,
    hands,
    trumpSuit: deal.trumpSuit,
    trumpCard: deal.trumpCard,
    stock: deal.stock,
    currentTrick: [],
    trickHistory: [],
    gameHistory: [],
    leadingPlayer: nonDealer,
    currentPlayer: nonDealer,
    points: [0, 0],
    tricksWon: [0, 0],
    pendingMarriagePoints: [0, 0],
    bankedMarriagePoints: [0, 0],
    activeCall: null,
    handOutcome: null,
    openingCall: true,
  };
}

/** Gameplay */

export function makeCall(state: GameState, player: PlayerId, call: Call): GameState {
  if (isHandOver(state)) throw new Error("Cannot make a call; the hand is already over");
  if (!canDeclareCall(state, player, call)) throw new Error("Cannot make call");

  const gameHistory = [...state.gameHistory];
  gameHistory.push(`Player ${player}: call-${call}`);

  return { ...state, activeCall: { callType: call, callingPlayer: player }, openingCall: false, gameHistory, leadingPlayer: player };
}

// Have a player decline to make an opening call (big/small/close-stock),
// before any card has been played this hand. If the first player (the
// leader) passes, the other player gets a turn to call or pass; if the
// second player passes too, the window closes and normal play begins.
export function passOpeningCall(state: GameState, player: PlayerId): GameState {
  if (isHandOver(state)) throw new Error("Cannot pass; the hand is already over");
  if (!canPassOpeningCall(state, player)) throw new Error(`Player ${player} cannot pass the opening call right now`);

  const gameHistory = [...state.gameHistory];
  gameHistory.push(`Player ${player}: pass-opening-call`);

  return { ...state, openingCall: state.leadingPlayer === player, currentPlayer: otherPlayer(player), gameHistory };
}

export function playCard(state: GameState, player: PlayerId, card: Card): GameState {
  if (isHandOver(state)) throw new Error("Cannot play a card; hand is already over");
  if (player !== state.currentPlayer) throw new Error(`It is not player ${player}'s turn`);

  const moves = getLegalCardMoves(state, player);
  if (!moves.some((c) => cardsEqual(c, card))) {
    throw new Error(`Player ${player} cannot legally play ${cardId(card)} right now`);
  }

  // Update hands
  const hand = state.hands[player];
  const cardIndex = hand.findIndex((c) => cardsEqual(c, card));

  const newHands: [Card[], Card[]] = [[...state.hands[0]], [...state.hands[1]]];
  newHands[player] = [...hand.slice(0, cardIndex), ...hand.slice(cardIndex + 1)];

  const gameHistory = [...state.gameHistory];
  gameHistory.push(`Player ${player}: ${cardId(card)}`);

  if (state.currentTrick.length === 0) {
    return {
      ...state,
      hands: newHands,
      currentTrick: [{ player, card }],
      leadingPlayer: player,
      currentPlayer: otherPlayer(player),
      openingCall: false,
      gameHistory,
    };
  }

  // Resolve the trick
  const lead = state.currentTrick[0];
  const follow: PlayedCard = { player, card };
  const result = isTrickWinner(lead.card, follow.card, state.trumpSuit);

  const trickHistory = [...state.trickHistory];
  trickHistory.push([lead, follow]);

  // Just play next card if in big small, no need to resolve trick
  if (isBigSmallCall(state)) {
    return {
      ...state,
      hands: newHands,
      currentTrick: [],
      leadingPlayer: player,
      currentPlayer: otherPlayer(player),
      openingCall: false,
      trickHistory,
      gameHistory,
    };
  }

  const winner = result === "lead" ? lead.player : follow.player;

  const trickPoints = RANK_POINTS[lead.card.rank] + RANK_POINTS[follow.card.rank];
  const newPoints: [number, number] = [state.points[0], state.points[1]];
  newPoints[winner] += trickPoints;

  const newTricksWon: [number, number] = [state.tricksWon[0], state.tricksWon[1]];
  newTricksWon[winner]++;

  let bankedMarriagePoints: [number, number];
  let pendingMarriagePoints: [number, number];
  if (!state.options.pendingMarriages) {
    // When pending marriages is turned off, bank both immediately
    bankedMarriagePoints = [
      state.bankedMarriagePoints[0] + state.pendingMarriagePoints[0],
      state.bankedMarriagePoints[1] + state.pendingMarriagePoints[1],
    ];
    pendingMarriagePoints = [0, 0];
  } else {
    // Otherwise, only bank the winners
    bankedMarriagePoints = [state.bankedMarriagePoints[0], state.bankedMarriagePoints[1]];
    pendingMarriagePoints = [state.pendingMarriagePoints[0], state.pendingMarriagePoints[1]];

    bankedMarriagePoints[winner] += pendingMarriagePoints[winner];
    pendingMarriagePoints[winner] = 0;
  }

  // Create next state
  let nextState: GameState = {
    ...state,
    hands: newHands,
    currentTrick: [],
    trickHistory,
    leadingPlayer: winner,
    currentPlayer: winner,
    points: newPoints,
    tricksWon: newTricksWon,
    pendingMarriagePoints,
    bankedMarriagePoints,
    gameHistory,
  };

  // If this was the last trick and wasn't ended early, give the set bonus
  const handsEmptied = state.hands[0].length === 0 && state.hands[1].length === 0;
  if (handsEmptied && state.activeCall === null) {
    const finalPoints: [number, number] = [nextState.points[0], nextState.points[1]];
    finalPoints[winner] += state.options.lastStockPointBonus;
    nextState = { ...nextState, points: finalPoints };
  }

  return nextState;
}

// Have a player draw a card
export function drawOne(state: GameState, player: PlayerId): GameState {
  if (isClosedPhase(state)) throw new Error(`Player ${player} cannot draw, game is closed`);
  if (state.stock.length === 0 && state.trumpCard === null) throw new Error(`Player ${player} cannot draw, the stock and trump card are empty`);

  const hands: [Card[], Card[]] = [[...state.hands[0]], [...state.hands[1]]];

  // Draw from the stock first
  if (state.stock.length > 0) {
    const [card, ...stock] = state.stock;
    hands[player] = [...hands[player], card];
    return { ...state, hands, stock };
  }

  // If the stock is empty, take the trump card
  if (state.trumpCard !== null) {
    hands[player] = [...hands[player], state.trumpCard];
    return { ...state, trumpCard: null };
  }

  return state;
}

// Have a player declare a marriage
export function declareMarriage(state: GameState, player: PlayerId, card: Card): GameState {
  if (isHandOver(state)) throw new Error("Cannot declare a marriage; the hand is already over");
  if (card.rank !== "K" && card.rank !== "Q") throw new Error("Cannot declare a marriage without a K or Q");
  if (state.currentPlayer !== player || state.leadingPlayer !== player)
    throw new Error(`Player ${player} cannot declare a marriage as they are not leading`);

  const eligibleLeads = getAvailableMarriages(state, player);
  if (!eligibleLeads.some((c) => cardsEqual(c, card))) throw new Error(`Player ${player} cannot declare a marriage with ${card}`);

  const gameHistory = [...state.gameHistory];
  gameHistory.push(`Player ${player}: marriage-${cardId(card)}`);

  // Play the specified marriage card
  const newState = playCard(state, player, card);

  const marriagePoints = getMarriagePoints(card.suit, state.trumpSuit);

  // Add marriage points
  const pendingMarriagePoints: [number, number] = [state.pendingMarriagePoints[0], state.pendingMarriagePoints[1]];
  const bankedMarriagePoints: [number, number] = [state.bankedMarriagePoints[0], state.bankedMarriagePoints[1]];
  if (state.tricksWon[player] > 0) {
    bankedMarriagePoints[player] += marriagePoints;
  } else {
    pendingMarriagePoints[player] += marriagePoints;
  }

  return {
    ...newState,
    pendingMarriagePoints,
    bankedMarriagePoints,
    gameHistory,
  };
}

// Have a player exchange for the lowest trump
export function exchangeTrump(state: GameState, player: PlayerId): GameState {
  if (!canExchangeLowestTrump(state, player)) throw new Error(`Player ${player} cannot perform the trump exchange`);

  const faceUpTrump = state.trumpCard;
  if (faceUpTrump === null) throw new Error("No face-up trump card available to exchange for");

  const gameHistory = [...state.gameHistory];
  gameHistory.push(`Player ${player}: exchange-lowest-trump`);

  const hand = state.hands[player];
  const lowestTrumpIndex = hand.findIndex((c) => cardsEqual(c, { suit: state.trumpSuit, rank: state.options.deckType.ranks[0] }));
  const lowestTrump = hand[lowestTrumpIndex];

  const newHands: [Card[], Card[]] = [[...state.hands[0]], [...state.hands[1]]];
  newHands[player] = [...hand.slice(0, lowestTrumpIndex), faceUpTrump, ...hand.slice(lowestTrumpIndex + 1)];

  return {
    ...state,
    hands: newHands,
    trumpCard: lowestTrump,
    gameHistory,
  };
}

// Check if the game has ended and update state accordingly
export function checkGameEnd(state: GameState): GameState {
  if (isHandOver(state)) return state;

  const handsEmpty = state.hands[0].length === 0 && state.hands[1].length === 0;
  if (!handsEmpty) return state;

  const outcome = getGameOutcome(state);
  return {
    ...state,
    handOutcome: outcome,
  };
}

/** Match state */

const GAME_POINTS_TO_WIN_MATCH = 7;

export interface MatchState {
  readonly matchScore: readonly [number, number];
  readonly dealer: PlayerId; // Who deals the next hand
  readonly matchWinner: PlayerId | null;
}

// Create the initial match state
export function createInitialMatchState(firstDealer: PlayerId): MatchState {
  return { matchScore: [0, 0], dealer: firstDealer, matchWinner: null };
}

// Applies a finished hand's outcome to the match score and alternates the
// deal for the next hand
export function applyHandResult(match: MatchState, hand: GameState): MatchState {
  if (match.matchWinner !== null) throw new Error("The match is already over");
  if (hand.handOutcome === null) throw new Error("Hand is unfinished");

  const outcome = hand.handOutcome;

  const matchScore: [number, number] = [match.matchScore[0], match.matchScore[1]];
  matchScore[outcome.winner] += outcome.matchPoints;

  let matchWinner: PlayerId | null = null;
  if (matchScore[outcome.winner] >= GAME_POINTS_TO_WIN_MATCH) {
    matchWinner = outcome.winner;
  }

  return { matchScore, dealer: otherPlayer(match.dealer), matchWinner };
}
