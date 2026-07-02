// Glue layer: orchestrates a Sixty-Six match (a sequence of hands) using
// the pure /core engine. This module owns the only randomness in the
// game — dealing — and is responsible for applying each finished hand's
// result to the match score (CLAUDE.md Section 5/3.7).
//
// UI-agnostic on purpose: src/ui's useMatch hook is a thin React wrapper
// around the functions here. A seat can be driven either by a human
// (the UI calling the *Action functions directly off user clicks) or by
// AiPlayer (playAiTurn below) — both go through the same core actions.

import type { Card, Suit } from "../core/deck";
import { createDeck, deal, shuffleDeck } from "../core/deck";
import {
  applyHandResult,
  closeStock,
  createInitialMatchState,
  declareSixtySix,
  checkHandEnd,
} from "../core/closing";
import type { MatchState } from "../core/closing";
import { availableMarriages } from "../core/marriages";
import {
  canCloseStock,
  canDeclareSixtySix,
  canExchangeTrumpNine,
  legalMoves,
} from "../core/rules";
import {
  createInitialState,
  declareMarriage,
  exchangeTrumpNine,
  otherPlayer,
  playCard,
} from "../core/state";
import type { GameState, PlayerId } from "../core/state";
import type { AiAction, AiPlayer, Difficulty } from "../ai/player";
import { createRng, type Rng } from "../core/rng";

export interface MatchSession {
  readonly hand: GameState;
  readonly match: MatchState;
}

// Legal actions for `player` right now. Everything is empty/false when
// it isn't their turn, so the UI can disable/hide affordances directly
// off this rather than letting a click fail.
export interface LegalActions {
  readonly cards: readonly Card[];
  readonly marriageSuits: readonly Suit[];
  readonly canExchangeTrumpNine: boolean;
  readonly canCloseStock: boolean;
  readonly canDeclareSixtySix: boolean;
}

const NO_ACTIONS: LegalActions = {
  cards: [],
  marriageSuits: [],
  canExchangeTrumpNine: false,
  canCloseStock: false,
  canDeclareSixtySix: false,
};

export function getLegalActions(
  hand: GameState,
  player: PlayerId,
): LegalActions {
  if (hand.handOver || hand.turn !== player) {
    return NO_ACTIONS;
  }

  return {
    cards: legalMoves(hand, player),
    marriageSuits: availableMarriages(hand, player),
    canExchangeTrumpNine: canExchangeTrumpNine(hand, player),
    canCloseStock: canCloseStock(hand, player),
    canDeclareSixtySix: canDeclareSixtySix(hand, player),
  };
}

function dealHand(dealer: PlayerId, rng: Rng): GameState {
  const dealResult = deal(shuffleDeck(createDeck(), rng));
  return createInitialState(dealResult, otherPlayer(dealer));
}

// Starts a brand-new match: fresh match score, first hand dealt.
export function createMatch(firstDealer: PlayerId, rng: Rng): MatchSession {
  const match = createInitialMatchState(firstDealer);
  return { hand: dealHand(match.dealer, rng), match };
}

// Deals the next hand using the match's current dealer. Throws if the
// previous hand isn't actually over yet, or the match has already been
// won.
export function startNextHand(session: MatchSession, rng: Rng): MatchSession {
  if (!session.hand.handOver) {
    throw new Error("Cannot start the next hand: the current hand isn't over");
  }
  if (session.match.matchWinner !== null) {
    throw new Error("Cannot start the next hand: the match is already over");
  }
  return { hand: dealHand(session.match.dealer, rng), match: session.match };
}

// If a transition just ended the hand (and it wasn't already over),
// applies its result to the match score. A no-op otherwise.
function applyTransition(
  session: MatchSession,
  nextHand: GameState,
): MatchSession {
  if (nextHand.handOver && !session.hand.handOver) {
    return { hand: nextHand, match: applyHandResult(session.match, nextHand) };
  }
  return { ...session, hand: nextHand };
}

export function playCardAction(
  session: MatchSession,
  player: PlayerId,
  card: Card,
): MatchSession {
  const next = checkHandEnd(playCard(session.hand, player, card));
  return applyTransition(session, next);
}

export function declareMarriageAction(
  session: MatchSession,
  player: PlayerId,
  card: Card,
): MatchSession {
  const next = declareMarriage(session.hand, player, card);
  return applyTransition(session, next);
}

export function exchangeTrumpNineAction(
  session: MatchSession,
  player: PlayerId,
): MatchSession {
  const next = exchangeTrumpNine(session.hand, player);
  return applyTransition(session, next);
}

export function closeStockAction(
  session: MatchSession,
  player: PlayerId,
): MatchSession {
  const next = closeStock(session.hand, player);
  return applyTransition(session, next);
}

export function declareSixtySixAction(
  session: MatchSession,
  player: PlayerId,
): MatchSession {
  const next = declareSixtySix(session.hand, player);
  return applyTransition(session, next);
}

export function createRandomRng(): Rng {
  return createRng(Date.now() ^ Math.floor(Math.random() * 0xffffffff));
}

// Applies a single AI-chosen action. Exported so callers that want to
// observe/animate each action individually (the UI's realtime mode, see
// useMatch.ts) can drive one action at a time instead of using
// playAiTurn, which silently loops through an entire turn's worth of
// actions (including any prefix close/exchange + every trick a player
// keeps winning in a row).
export function applyAiAction(
  session: MatchSession,
  player: PlayerId,
  action: AiAction,
): MatchSession {
  switch (action.type) {
    case "playCard":
      return playCardAction(session, player, action.card);
    case "declareMarriage":
      return declareMarriageAction(session, player, action.card);
    case "exchangeTrumpNine":
      return exchangeTrumpNineAction(session, player);
    case "closeStock":
      return closeStockAction(session, player);
    case "declareSixtySix":
      return declareSixtySixAction(session, player);
  }
}

// Drives `aiPlayer`'s entire turn. Most actions (closing the stock, the
// trump exchange) don't pass the turn by themselves — the same player
// still has to lead afterward — so this re-queries the AI until either
// the turn actually passes to the opponent or the hand ends. Bounded
// since each prefix action (close, exchange) can only ever be taken once
// per hand.
export function playAiTurn(
  session: MatchSession,
  aiPlayer: AiPlayer,
): MatchSession {
  let current = session;
  let guard = 0;
  while (current.hand.turn === aiPlayer.player && !current.hand.handOver) {
    const action = aiPlayer.chooseAction(current.hand);
    current = applyAiAction(current, aiPlayer.player, action);

    guard += 1;
    if (guard > 10) {
      throw new Error(
        `AiPlayer for player ${aiPlayer.player} did not yield the turn after ${guard} actions`,
      );
    }
  }
  return current;
}

// Per-seat configuration (CLAUDE.md Section 4.6 / step 8): a seat is
// either human-controlled (the UI dispatches the *Action functions off
// user clicks, as today) or AI-controlled at a chosen difficulty.
export type SeatConfig =
  | { readonly type: "human" }
  | { readonly type: "ai"; readonly difficulty: Difficulty };

export interface HandSummary {
  readonly handNumber: number;
  readonly winner: PlayerId | null;
  readonly gamePoints: number;
  readonly cardPoints: readonly [number, number];
  readonly matchScoreAfter: readonly [number, number];
}

export interface SimulatedMatch {
  readonly finalSession: MatchSession;
  readonly handSummaries: readonly HandSummary[];
}

// Drives an entire match to completion using the given AiPlayer for each
// seat — no human input, no per-action pause. Used both by the UI's
// fast-forward Computer-vs-Computer mode (Section 4.6: "surface just the
// result... rather than animating every card") and by headless balance-
// testing scripts (scripts/simulate-matches.ts). Callers that want a
// watchable, animated pace should instead drive playAiTurn/startNextHand
// turn-by-turn themselves (see the UI's realtime mode in useMatch.ts).
export function simulateMatch(
  session: MatchSession,
  aiPlayers: readonly [AiPlayer, AiPlayer],
  rng: Rng,
): SimulatedMatch {
  let current = session;
  const handSummaries: HandSummary[] = [];
  let guard = 0;

  while (current.match.matchWinner === null) {
    while (!current.hand.handOver) {
      const player = current.hand.turn;
      current = playAiTurn(current, aiPlayers[player]);
      guard += 1;
      if (guard > 2000) {
        throw new Error("simulateMatch exceeded a sane action count");
      }
    }
    handSummaries.push({
      handNumber: handSummaries.length,
      winner: current.hand.winner,
      gamePoints: current.hand.gamePoints,
      cardPoints: current.hand.points,
      matchScoreAfter: current.match.matchScore,
    });
    if (current.match.matchWinner !== null) break;
    current = startNextHand(current, rng);
  }

  return { finalSession: current, handSummaries };
}
