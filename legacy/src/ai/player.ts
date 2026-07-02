// AI player (CLAUDE.md Sections 4.3, 4.5). Three difficulty tiers:
//
// - Easy: one ply, no search tree — enumerate every legal action,
//   evaluate the resulting state, take the best one. Per the Section 4.5
//   table Easy still uses 1 determinization sample (the low end of its
//   "1-3" range) rather than reading the real GameState directly: an
//   earlier version of this tier "cheated" by evaluating against the
//   opponent's actual hand, since determinize.ts didn't exist yet at
//   that point in the build order. Once Medium/Hard correctly started
//   hiding that information, Easy's full-information advantage let it
//   *beat* Hard outright in simulation (see the step-7/8 summary). Fixed
//   by determinizing here too.
// - Medium/Hard: sample N determinized (perfect-information) deals via
//   determinize.ts, run minimax+alpha-beta (search.ts) on each to a
//   configured depth, and aggregate every sample's per-action values by
//   averaging (CLAUDE.md 4.2 step 4) to pick a final action.
//
// "Decision point" covers every action in 4.3, not just card plays:
// which card to lead/follow, whether to declare a marriage (and which of
// the two cards to lead for it), whether to perform the trump exchange,
// whether to close the stock, and whether to declare 66.

import {
  determinize,
  isFullyDetermined,
  sampleDeterminizations,
} from "./determinize";
import { evaluate } from "./evaluate";
import {
  actionKey,
  applyAction,
  evaluateRootActions,
  legalActionCandidates,
} from "./search";
import type { AiAction, ScoredAction } from "./search";
import type { GameState, PlayerId } from "../core/state";
import type { Rng } from "../core/rng";

export type { AiAction } from "./search";

export type Difficulty = "easy" | "medium" | "hard";

// One candidate action and the score the AI assigned it, for the debug
// panel (CLAUDE.md Section 6: "a debug panel showing sampled
// determinizations and search scores -- useful for development").
export interface AiActionScore {
  readonly action: AiAction;
  readonly score: number;
}

export interface AiDebugInfo {
  readonly difficulty: Difficulty;
  // Determinization samples and search depth actually used for this
  // decision -- not just the configured preset, since both the
  // single-legal-action short-circuit and the fully-determined-endgame
  // shortcut can change them per CLAUDE.md 4.2/4.5 (see chooseActionWithSearch).
  readonly samplesUsed: number;
  readonly depthUsed: number;
  // All candidates, best-first.
  readonly candidates: readonly AiActionScore[];
}

interface Decision {
  readonly action: AiAction;
  readonly debug: AiDebugInfo;
}

function decideEasy(state: GameState, player: PlayerId, rng: Rng): Decision {
  const actions = legalActionCandidates(state, player).map((c) => c.action);
  if (actions.length === 0) {
    throw new Error(`No legal actions available for player ${player}`);
  }

  const sample = determinize(state, player, rng);
  console.log(sample);
  const candidates: AiActionScore[] = actions
    .map((action) => ({
      action,
      score: evaluate(applyAction(sample, player, action), player),
    }))
    .sort((a, b) => b.score - a.score);

  return {
    action: candidates[0].action,
    debug: { difficulty: "easy", samplesUsed: 1, depthUsed: 1, candidates },
  };
}

// Picks the legal action whose resulting state evaluates best for
// `player`, against a single determinized sample of the unseen cards
// (CLAUDE.md 4.5: Easy uses 1-3 samples). Deterministic given `rng`'s
// stream: ties go to whichever candidate was generated first (cards, in
// hand order, before marriages/exchange/close/declare), so this never
// relies on incidental randomness beyond the one sampling step — a
// coherent, reproducible "weak" player, not a random-legal-move one.
export function chooseAction(
  state: GameState,
  player: PlayerId,
  rng: Rng,
): AiAction {
  return decideEasy(state, player, rng).action;
}

export interface AiConfig {
  // Minimax plies to search (one ply = one action; see search.ts).
  readonly depth: number;
  // Determinization samples to average over (CLAUDE.md 4.2/4.5).
  readonly samples: number;
}

// Defaults for each tier. Exposed, not hardcoded into the search path
// itself — every call site can override depth/samples per AiConfig.
//
// Judgment call / deviation from CLAUDE.md's Section 4.5 table: the table
// suggests 4-6+ ply for Hard outside the endgame, but empirically (see
// the step-7/8 summary's Hard-vs-Easy measurements) deeper *non-endgame*
// search performs *worse*, not better, in this implementation. Each
// determinized sample gets its own independently-guessed stock order;
// the deeper a line goes, the more imagined (and mutually inconsistent
// across samples) stock draws it bakes into the leaf evaluation, so
// averaging across samples increasingly averages over compounding noise
// rather than real signal. A shallow depth (one trick of real lookahead:
// my action + the opponent's adversarial response) combined with more
// samples consistently outperformed deep+sparse configurations in
// simulation. This doesn't apply to the fully-determined endgame, where
// there's no sampling noise at all — ENDGAME_DEPTH below still searches
// deep there, matching the table's "full-depth in endgame" for Hard.
export const DIFFICULTY_PRESETS: Readonly<Record<Difficulty, AiConfig>> = {
  easy: { depth: 1, samples: 1 },
  medium: { depth: 2, samples: 10 },
  hard: { depth: 2, samples: 25 },
};

// A large-enough depth to search a fully-determined endgame (at most 12
// remaining plies in this game) to completion, for Hard's "full-depth in
// endgame" behavior (Section 4.5).
const ENDGAME_DEPTH = 40;

function decideWithSearch(
  state: GameState,
  player: PlayerId,
  config: AiConfig,
  rng: Rng,
  difficulty: Difficulty,
): Decision {
  const rootCandidates = legalActionCandidates(state, player);
  if (rootCandidates.length === 0) {
    throw new Error(`No legal actions available for player ${player}`);
  }
  if (rootCandidates.length === 1) {
    const action = rootCandidates[0].action;
    return {
      action,
      debug: {
        difficulty,
        samplesUsed: 0,
        depthUsed: 0,
        candidates: [{ action, score: 0 }],
      },
    };
  }

  const endgame = isFullyDetermined(state);
  const depth = endgame && difficulty === "hard" ? ENDGAME_DEPTH : config.depth;
  const samples = sampleDeterminizations(state, player, config.samples, rng);

  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  const actionByKey = new Map<string, AiAction>();

  for (const sample of samples) {
    const scored: ScoredAction[] = evaluateRootActions(sample, player, depth);
    for (const { action, value } of scored) {
      const key = actionKey(action);
      totals.set(key, (totals.get(key) ?? 0) + value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      actionByKey.set(key, action);
    }
  }

  const candidates: AiActionScore[] = [...totals.entries()]
    .map(([key, total]) => ({
      action: actionByKey.get(key)!,
      score: total / (counts.get(key) ?? 1),
    }))
    .sort((a, b) => b.score - a.score);

  return {
    action: candidates[0].action,
    debug: {
      difficulty,
      samplesUsed: samples.length,
      depthUsed: depth,
      candidates,
    },
  };
}

// Runs determinize + minimax + average-aggregate (CLAUDE.md 4.2) to pick
// one action for `player`. Once the opponent's hand is fully determined
// (determinize.ts::isFullyDetermined), sampling collapses to the single
// real state automatically — re-shuffling a hand with only one possible
// assignment would be wasted work, not a strength change — and Hard
// additionally searches that exact endgame to (near-)full depth.
export function chooseActionWithSearch(
  state: GameState,
  player: PlayerId,
  config: AiConfig,
  rng: Rng,
  difficulty: Difficulty = "hard",
): AiAction {
  return decideWithSearch(state, player, config, rng, difficulty).action;
}

export interface AiPlayer {
  readonly player: PlayerId;
  readonly difficulty: Difficulty;
  chooseAction(state: GameState): AiAction;
  // Same decision logic as chooseAction, but also returns the scored
  // candidate list and the samples/depth actually used -- for the
  // dev-only AI debug panel (CLAUDE.md Section 6). For medium/hard this
  // draws fresh determinization samples from the player's Rng, same as
  // chooseAction does, so call *one or the other* for a given decision
  // point, never both -- calling both would consume the Rng stream twice
  // and could pick two different actions for what's meant to be the same
  // decision. useMatch.ts's realtime mode uses this method exclusively
  // (and dispatches its returned action) for exactly this reason.
  chooseActionWithDebug(state: GameState): {
    action: AiAction;
    debug: AiDebugInfo;
  };
}

// `rng` is always required: every difficulty tier determinizes (hides
// the opponent's hand) at least once before evaluating, so none of them
// "cheat" by reading the real GameState — see the file header for why
// that matters. `configOverride` lets callers tune depth/samples per
// seat without touching this module.
export function createAiPlayer(
  player: PlayerId,
  difficulty: Difficulty,
  rng: Rng,
  configOverride?: Partial<AiConfig>,
): AiPlayer {
  const decide: (state: GameState) => Decision =
    difficulty === "easy"
      ? (state) => decideEasy(state, player, rng)
      : (() => {
          const config: AiConfig = {
            ...DIFFICULTY_PRESETS[difficulty],
            ...configOverride,
          };
          return (state) =>
            decideWithSearch(state, player, config, rng, difficulty);
        })();

  return {
    player,
    difficulty,
    chooseAction: (state: GameState) => decide(state).action,
    chooseActionWithDebug: (state: GameState) => decide(state),
  };
}
