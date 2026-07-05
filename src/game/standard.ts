// Orchestrates a standard sixty-six match: standard 24-card deck, standard
// game options. Combines the pure /core primitives (dealing, rules, state
// transitions) into a turn-by-turn flow, handling the bookkeeping /core
// deliberately leaves to its caller — drawing after a resolved trick, and
// immediately resolving a hand when a player declares "sixty-six".

import { createDeck, deal, shuffleDeck, type Card } from "../core/deck";
import type { Rng } from "../core/rng";
import { canDeclareCall, canDrawCard, canExchangeLowestTrump, canPassOpeningCall, canPlayCard, getGameOutcome, type Call } from "../core/rules";
import {
  applyHandResult,
  checkGameEnd,
  createInitialMatchState,
  createInitialState,
  declareMarriage,
  drawOne,
  exchangeTrump,
  makeCall,
  otherPlayer,
  passOpeningCall,
  playCard,
  type GameState,
  type MatchState,
  type PlayerId,
} from "../core/state";
import { STANDARD_DECK, STANDARD_GAME_OPTIONS } from "../core/variations";

export interface MatchSession {
  readonly hand: GameState;
  readonly match: MatchState;
}

// Shuffle a fresh standard deck, deal it, and build the initial hand state
// for the given non-dealer, using the standard game options
export function startStandardHand(rng: Rng, nonDealer: PlayerId): GameState {
  const shuffled = shuffleDeck(createDeck(STANDARD_DECK), rng);
  const dealt = deal(shuffled);
  return createInitialState(dealt, nonDealer, STANDARD_GAME_OPTIONS);
}

// Start a fresh standard match: 0-0 score, first hand dealt with the given
// player as dealer (so their opponent is non-dealer and leads first)
export function startStandardMatch(rng: Rng, firstDealer: PlayerId): MatchSession {
  return {
    hand: startStandardHand(rng, otherPlayer(firstDealer)),
    match: createInitialMatchState(firstDealer),
  };
}

// A single action a player may take on their turn
export type StandardAction =
  | { readonly type: "play"; readonly card: Card }
  | { readonly type: "marriage"; readonly card: Card }
  | { readonly type: "exchange-trump" }
  | { readonly type: "call"; readonly call: Call }
  | { readonly type: "pass-opening-call" };

// Calls that resolve the hand immediately, rather than only changing how
// future tricks are played (as "close-stock" does)
const IMMEDIATE_CALLS: ReadonlySet<Call> = new Set(["sixtysix"]);

// Apply a single player action to a hand in progress
export function applyStandardAction(state: GameState, player: PlayerId, action: StandardAction): GameState {
  switch (action.type) {
    case "call": {
      if (!canDeclareCall(state, player, action.call)) {
        throw new Error(`Player ${player} cannot declare "${action.call}" right now`);
      }
      const next = makeCall(state, player, action.call);
      return IMMEDIATE_CALLS.has(action.call) ? { ...next, handOutcome: getGameOutcome(next) } : next;
    }

    case "exchange-trump": {
      if (!canExchangeLowestTrump(state, player)) {
        throw new Error(`Player ${player} cannot exchange the trump card right now`);
      }
      return exchangeTrump(state, player);
    }

    case "marriage":
      if (!canPlayCard(state, player)) {
        throw new Error(`Player ${player} cannot play a card right now`);
      }
      return declareMarriage(state, player, action.card);

    case "play":
      if (!canPlayCard(state, player)) {
        throw new Error(`Player ${player} cannot play a card right now`);
      }
      return resolveTrickAndDraw(state, playCard(state, player, action.card));

    case "pass-opening-call": {
      if (!canPassOpeningCall(state, player)) {
        throw new Error(`Player ${player} cannot pass the opening call right now`);
      }
      return passOpeningCall(state, player);
    }

    default: {
      const exhaustive: never = action;
      throw new Error(`Unrecognized action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// After a card completes a trick (the current trick empties back out), the
// winner draws first, then the loser, whenever the stock/trump card allow
// it. Either way, check whether the hand has ended (hands fully played out).
function resolveTrickAndDraw(before: GameState, after: GameState): GameState {
  const trickJustResolved = before.currentTrick.length === 1 && after.currentTrick.length === 0;
  if (!trickJustResolved) return checkGameEnd(after);

  const winner = after.leadingPlayer;
  const loser = otherPlayer(winner);

  let next = after;
  if (canDrawCard(next, winner)) next = drawOne(next, winner);
  if (canDrawCard(next, loser)) next = drawOne(next, loser);

  return checkGameEnd(next);
}

// Whether the current hand has finished and is ready to be scored into the
// match via advanceMatch
export function isHandFinished(state: GameState): boolean {
  return state.handOutcome !== null;
}

// Score a finished hand into the match and, unless the match itself is now
// won, deal the next hand
export function advanceMatch(session: MatchSession, rng: Rng): MatchSession {
  if (!isHandFinished(session.hand)) throw new Error("Cannot advance the match; the current hand is not finished");
  if (session.match.matchWinner !== null) throw new Error("Cannot advance the match; it is already over");

  const match = applyHandResult(session.match, session.hand);
  if (match.matchWinner !== null) return { hand: session.hand, match };

  return { hand: startStandardHand(rng, otherPlayer(match.dealer)), match };
}

// Whether the match has been won outright
export function isMatchFinished(session: MatchSession): boolean {
  return session.match.matchWinner !== null;
}
