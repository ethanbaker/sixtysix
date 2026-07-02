// Minimax with alpha-beta pruning over a single, fully determined GameState

import { canExchangeLowestTrump, getAvailableMarriages, getCalls, getLegalMoves, isHandOver, type Call } from "../core/rules";
import type { GameState, PlayerId } from "../core/state";
import { applyStandardAction, type StandardAction } from "../game/standard";
import { evaluate } from "./evaluate";

export interface ActionCandidate {
  readonly action: StandardAction;
  readonly resultState: GameState;
}

// Every legal action available to `player` right now, paired with the state it leads to
export function legalActionCandidates(state: GameState, player: PlayerId): ActionCandidate[] {
  const actions: StandardAction[] = [];

  for (const card of getLegalMoves(state, player)) {
    actions.push({ type: "play", card });
  }

  for (const card of getAvailableMarriages(state, player)) {
    actions.push({ type: "marriage", card });
  }

  if (canExchangeLowestTrump(state, player)) {
    actions.push({ type: "exchange-trump" });
  }

  const availableCalls: Call[] = getCalls(state, player);
  for (const call of availableCalls) {
    actions.push({ type: "call", call });
  }

  return actions.map((action) => ({ action, resultState: applyStandardAction(state, player, action) }));
}

// Stable string key for an action, used to match up the "same" root
// action across multiple determinized samples when aggregating.
export function actionKey(action: StandardAction): string {
  switch (action.type) {
    case "play":
      return `play:${action.card.rank}-${action.card.suit}`;
    case "marriage":
      return `marriage:${action.card.rank}-${action.card.suit}`;
    case "exchange-trump":
      return "exchange-trump";
    case "call":
      return `call:${action.call}`;
  }
}

// Perform minimax on a current game state with provided depth, alpha, and beta
// Each minimax iteration is dependent on a turn (when state.currentPlayer changes),
// as players can perform more than one action in a single turn
export function minimax(state: GameState, rootPlayer: PlayerId, depth: number, alpha: number, beta: number): number {
  if (isHandOver(state) || depth <= 0) {
    return evaluate(state, rootPlayer);
  }

  // Get maximizing player
  const actingPlayer = state.currentPlayer;
  const maximizing = actingPlayer === rootPlayer;

  // Find legal actions
  const candidates = legalActionCandidates(state, actingPlayer);
  if (candidates.length === 0) {
    return evaluate(state, rootPlayer);
  }

  if (maximizing) {
    let value = -Infinity;
    for (const candidate of candidates) {
      // Perform maximizing action and evaluate against further turns
      const nextDepth = candidate.resultState.currentPlayer === actingPlayer ? depth : depth - 1;
      value = Math.max(value, minimax(candidate.resultState, rootPlayer, nextDepth, alpha, beta));

      // Break if alpha >= beta
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  let value = Infinity;
  for (const candidate of candidates) {
    // Perform minimizing action and evaluate against further turns
    const nextDepth = candidate.resultState.currentPlayer === actingPlayer ? depth : depth - 1;
    value = Math.min(value, minimax(candidate.resultState, rootPlayer, nextDepth, alpha, beta));

    // Break if alpha >= beta
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

// ScoredAction holds actions and their estimated minimax score
export interface ScoredAction {
  readonly action: StandardAction;
  readonly value: number;
}

// Evaluated value for every root action using minimax
export function evaluateRootActions(state: GameState, player: PlayerId, depth: number): ScoredAction[] {
  const candidates = legalActionCandidates(state, player);
  return candidates.map(({ action, resultState }) => ({
    action,
    value: minimax(resultState, player, depth - 1, -Infinity, Infinity),
  }));
}

// Search for the best action of all root actions (higher = better)
export function searchBestAction(state: GameState, player: PlayerId, depth: number): ScoredAction {
  const scored = evaluateRootActions(state, player, depth);
  if (scored.length === 0) {
    throw new Error(`No legal actions available for player ${player}`);
  }

  let best = scored[0];
  for (let i = 1; i < scored.length; i++) {
    if (scored[i].value > best.value) best = scored[i];
  }
  return best;
}
