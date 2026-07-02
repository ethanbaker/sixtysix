// Orchestrate a standard sixty-six match

import type { GameState, MatchState } from "../core/state";

export interface MatchSession {
  readonly hand: GameState;
  readonly match: MatchState;
}
