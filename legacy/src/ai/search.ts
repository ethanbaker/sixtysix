// Minimax with alpha-beta pruning over a single, fully-determined
// (perfect-information) GameState (CLAUDE.md Section 4.2 step 3). Also
// hosts the shared action model (every CLAUDE.md Section 4.3 decision
// type, not just card plays) used by both this search and player.ts's
// Easy (1-ply, no search) path.

import type { Card } from "../core/deck";
import {
  canCloseStock,
  canDeclareSixtySix,
  canExchangeTrumpNine,
  legalMoves,
} from "../core/rules";
import { availableMarriages } from "../core/marriages";
import { closeStock, declareSixtySix } from "../core/closing";
import { declareMarriage, exchangeTrumpNine, playCard } from "../core/state";
import type { GameState, PlayerId } from "../core/state";
import { evaluate } from "./evaluate";

export type AiAction =
  | { readonly type: "playCard"; readonly card: Card }
  | { readonly type: "declareMarriage"; readonly card: Card }
  | { readonly type: "exchangeTrumpNine" }
  | { readonly type: "closeStock" }
  | { readonly type: "declareSixtySix" };

export interface ActionCandidate {
  readonly action: AiAction;
  readonly resultState: GameState;
}

// Applies a single AiAction to `state` for `player`, dispatching to the
// matching /core transition. Shared by legalActionCandidates (applied to
// the real state) and by callers that need to replay an action against a
// *different* state, e.g. a determinized sample (player.ts's Easy path).
export function applyAction(state: GameState, player: PlayerId, action: AiAction): GameState {
  switch (action.type) {
    case "playCard":
      return playCard(state, player, action.card);
    case "declareMarriage":
      return declareMarriage(state, player, action.card);
    case "exchangeTrumpNine":
      return exchangeTrumpNine(state, player);
    case "closeStock":
      return closeStock(state, player);
    case "declareSixtySix":
      return declareSixtySix(state, player);
  }
}

// Every legal action available to `player` right now, paired with the
// state it leads to. closeStock/exchangeTrumpNine don't pass the turn
// (the player still has to lead afterward — see the step-6 summary), so
// they appear here as ordinary candidates alongside card plays; anything
// driving a whole turn (match.ts::playAiTurn) needs to keep re-querying
// until state.turn actually changes.
export function legalActionCandidates(state: GameState, player: PlayerId): ActionCandidate[] {
  const actions: AiAction[] = [];

  for (const card of legalMoves(state, player)) {
    actions.push({ type: "playCard", card });
  }
  for (const suit of availableMarriages(state, player)) {
    for (const rank of ["K", "Q"] as const) {
      actions.push({ type: "declareMarriage", card: { rank, suit } });
    }
  }
  if (canExchangeTrumpNine(state, player)) {
    actions.push({ type: "exchangeTrumpNine" });
  }
  if (canCloseStock(state, player)) {
    actions.push({ type: "closeStock" });
  }
  if (canDeclareSixtySix(state, player)) {
    actions.push({ type: "declareSixtySix" });
  }

  return actions.map((action) => ({ action, resultState: applyAction(state, player, action) }));
}

// Stable string key for an action, used to match up the "same" root
// action across multiple determinized samples when aggregating.
export function actionKey(action: AiAction): string {
  switch (action.type) {
    case "playCard":
      return `playCard:${action.card.rank}-${action.card.suit}`;
    case "declareMarriage":
      return `declareMarriage:${action.card.rank}-${action.card.suit}`;
    case "exchangeTrumpNine":
      return "exchangeTrumpNine";
    case "closeStock":
      return "closeStock";
    case "declareSixtySix":
      return "declareSixtySix";
  }
}

// One ply = one action, not one "turn": closeStock/exchangeTrumpNine
// don't pass the turn, so a handful of plies around a close/exchange
// don't alternate the maximizing player. That falls out naturally here
// since we key on `state.turn` rather than assuming it alternates every
// ply. A hand-over node is terminal regardless of remaining depth —
// evaluate() already dominates that case with its ±gamePoints scoring.
export function minimax(
  state: GameState,
  rootPlayer: PlayerId,
  depth: number,
  alpha: number,
  beta: number,
): number {
  if (state.handOver || depth <= 0) {
    return evaluate(state, rootPlayer);
  }

  const actingPlayer = state.turn;
  const maximizing = actingPlayer === rootPlayer;
  const candidates = legalActionCandidates(state, actingPlayer);
  if (candidates.length === 0) {
    return evaluate(state, rootPlayer);
  }

  if (maximizing) {
    let value = -Infinity;
    for (const candidate of candidates) {
      value = Math.max(value, minimax(candidate.resultState, rootPlayer, depth - 1, alpha, beta));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  let value = Infinity;
  for (const candidate of candidates) {
    value = Math.min(value, minimax(candidate.resultState, rootPlayer, depth - 1, alpha, beta));
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

export interface ScoredAction {
  readonly action: AiAction;
  readonly value: number;
}

// Exact value for *every* legal root action, not just the best one --
// needed so player.ts can aggregate per-action values across multiple
// determinized samples. Each root child gets its own full
// (-Infinity, Infinity) window rather than a shared, tightening alpha
// across siblings: sharing alpha across root siblings would give
// failure-soft (inexact) bounds for later siblings once an earlier one
// triggers a cutoff, which would corrupt cross-sample averaging.
// Alpha-beta pruning is still fully active *within* each child's own
// subtree, where it's always safe.
export function evaluateRootActions(
  state: GameState,
  player: PlayerId,
  depth: number,
): ScoredAction[] {
  const candidates = legalActionCandidates(state, player);
  return candidates.map(({ action, resultState }) => ({
    action,
    value: minimax(resultState, player, depth - 1, -Infinity, Infinity),
  }));
}

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
