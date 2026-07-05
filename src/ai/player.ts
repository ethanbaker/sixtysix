// AI Player with three difficulty tiers
// - Easy: enumerate over every leagal action, evaluate the result state, and take the best one (greedy approach)
// - Medium/Hard: Sample N determinized deals via determinize.ts, run minimax+alpha-beta to a configured depth, and pick best

import type { Rng } from "../core/rng";
import { isHandOver } from "../core/rules";
import type { GameState, PlayerId } from "../core/state";
import type { StandardAction } from "../game/standard";
import { sampleDeterminizations } from "./determinize";
import { evaluate } from "./evaluate";
import { actionKey, evaluateRootActions, legalActionCandidates } from "./search";

export type Difficulty = "easy" | "medium" | "hard";

export interface DifficultyConfig {
  // Minimax search depth (in plies/turns), applied per determinized sample
  readonly depth: number;
  // Number of determinized deals sampled before aggregating move scores
  readonly samples: number;
}

// Search depth/sample counts
export const DIFFICULTY_CONFIG: Readonly<Record<Difficulty, DifficultyConfig>> = {
  easy: { depth: 1, samples: 1 },
  medium: { depth: 3, samples: 12 },
  hard: { depth: 5, samples: 40 },
};

export interface AiPlayer {
  readonly player: PlayerId;
  readonly difficulty: Difficulty;
  readonly rng: Rng;
}

export function createAiPlayer(player: PlayerId, difficulty: Difficulty, rng: Rng): AiPlayer {
  return { player, difficulty, rng };
}

// One candidate action and the score the AI assigned it, for the debug
// panel (CLAUDE.md Section 6: "a debug panel showing sampled
// determinizations and search scores... useful for development").
export interface AiActionScore {
  readonly action: StandardAction;
  readonly value: number;
}

export interface AiDebugInfo {
  readonly difficulty: Difficulty;
  // Determinization samples and search depth actually used for this
  // decision (the configured preset for the AI's difficulty).
  readonly samplesUsed: number;
  readonly depthUsed: number;
  // Every candidate action considered, best-first.
  readonly candidates: readonly AiActionScore[];
}

interface Decision {
  readonly action: StandardAction;
  readonly debug: AiDebugInfo;
}

// Shared decision logic behind both chooseAction and
// chooseActionWithDebug, so a caller that wants the debug info never has
// to make a second decision (which would draw a second, different batch
// of determinization samples from the AI's Rng and could disagree with
// the first about which action to take).
function decide(ai: AiPlayer, state: GameState): Decision {
  if (isHandOver(state)) throw new Error("Cannot choose an action; the hand is already over");
  // Usually the player whose turn it is to play a card, but during the
  // opening call window (before the first card of the hand) it may
  // instead be the other player's turn to call or pass.
  if (state.currentPlayer !== ai.player) throw new Error(`It is not player ${ai.player}'s turn`);

  return ai.difficulty === "easy" ? decideGreedy(state, ai.player) : decideWithSearch(state, ai.player, ai.rng, ai.difficulty);
}

// Easy: no search, no determinization — just the legal action whose
// resulting state scores best under the heuristic evaluation function.
function decideGreedy(state: GameState, player: PlayerId): Decision {
  const candidates = legalActionCandidates(state, player);
  if (candidates.length === 0) throw new Error(`No legal actions available for player ${player}`);

  const scored: AiActionScore[] = candidates
    .map(({ action, resultState }) => ({ action, value: evaluate(resultState, player) }))
    .sort((a, b) => b.value - a.value);

  return {
    action: scored[0].action,
    debug: { difficulty: "easy", samplesUsed: 1, depthUsed: 1, candidates: scored },
  };
}

// Medium/Hard: sample N plausible deals of the unseen cards (opponent hand
// + stock), run minimax to the configured depth on each, then pick the
// action with the best average score across samples (actions are matched
// across samples by actionKey, since each determinization offers the same
// root actions — determinization never touches the acting player's hand).
function decideWithSearch(state: GameState, player: PlayerId, rng: Rng, difficulty: Difficulty): Decision {
  const config = DIFFICULTY_CONFIG[difficulty];
  const samples = sampleDeterminizations(state, player, config.samples, rng);

  const totals = new Map<string, { action: StandardAction; sum: number; count: number }>();
  for (const sample of samples) {
    for (const scored of evaluateRootActions(sample, player, config.depth)) {
      const key = actionKey(scored.action);
      const entry = totals.get(key);
      if (entry) {
        entry.sum += scored.value;
        entry.count += 1;
      } else {
        totals.set(key, { action: scored.action, sum: scored.value, count: 1 });
      }
    }
  }

  const candidates: AiActionScore[] = [...totals.values()]
    .map((entry) => ({ action: entry.action, value: entry.sum / entry.count }))
    .sort((a, b) => b.value - a.value);

  if (candidates.length === 0) throw new Error(`No legal actions available for player ${player}`);

  return {
    action: candidates[0].action,
    debug: { difficulty, samplesUsed: samples.length, depthUsed: config.depth, candidates },
  };
}

// Choose the AI's action for its current turn (card play, marriage,
// trump exchange, or a call), according to its configured difficulty
export function chooseAction(ai: AiPlayer, state: GameState): StandardAction {
  return decide(ai, state).action;
}

// Same decision as chooseAction, but also returns the scored candidate
// list and the samples/depth actually used, for a dev-only AI debug
// panel (CLAUDE.md Section 6). Call *one or the other* for a given
// decision point, never both — each draws from the AI's Rng stream, so
// calling both would consume it twice and could pick two different
// actions for what's meant to be the same decision.
export function chooseActionWithDebug(ai: AiPlayer, state: GameState): { action: StandardAction; debug: AiDebugInfo } {
  return decide(ai, state);
}
