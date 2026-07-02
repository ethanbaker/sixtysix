import { describe, expect, it } from "vitest";
import { createDeck, deal, shuffleDeck } from "../../src/core/deck";
import { legalMoves } from "../../src/core/rules";
import { checkHandEnd } from "../../src/core/closing";
import { createInitialState, playCard } from "../../src/core/state";
import type { GameState, PlayerId } from "../../src/core/state";
import { createRng } from "../../src/core/rng";

function pickRandom<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

// Drives a full hand with uniformly random legal moves (never closing,
// never declaring) until both hands are empty, then auto-resolves via
// checkHandEnd (Section 3.7: the literal-last-trick auto-resolution).
function simulateRandomGame(seed: number): GameState {
  const rng = createRng(seed);
  const shuffled = shuffleDeck(createDeck(), rng);
  const dealResult = deal(shuffled);
  let state = createInitialState(dealResult, 0);

  let guard = 0;
  while (!state.handOver) {
    const player: PlayerId = state.turn;
    const moves = legalMoves(state, player);
    if (moves.length === 0) break;
    const card = pickRandom(moves, rng);
    state = playCard(state, player, card);

    guard += 1;
    if (guard > 200) {
      throw new Error(
        "simulateRandomGame exceeded a sane move count — likely an infinite loop",
      );
    }
  }
  return checkHandEnd(state);
}

describe("full random-legal-move game (no manual close/declare)", () => {
  it("runs to completion without errors across several seeds", () => {
    for (const seed of [1, 2, 3, 42, 1000]) {
      expect(() => simulateRandomGame(seed)).not.toThrow();
    }
  });

  it("plays all 24 cards (12 tricks) since nobody ever closes the stock", () => {
    const state = simulateRandomGame(7);
    expect(state.hands[0]).toHaveLength(0);
    expect(state.hands[1]).toHaveLength(0);
    expect(state.stock).toHaveLength(0);
    expect(state.trumpCard).toBeNull();
    expect(state.tricksWon[0] + state.tricksWon[1]).toBe(12);
  });

  it("total banked card points never exceed 130 (120-card deck + the 10-point exhaustion bonus)", () => {
    for (const seed of [1, 2, 3, 42, 1000]) {
      const state = simulateRandomGame(seed);
      expect(state.points[0] + state.points[1]).toBeLessThanOrEqual(130);
    }
  });

  it("never leaves a hand with more than 6 cards", () => {
    const rng = createRng(11);
    const shuffled = shuffleDeck(createDeck(), rng);
    const dealResult = deal(shuffled);
    let state = createInitialState(dealResult, 0);

    let guard = 0;
    while (!state.handOver) {
      const player: PlayerId = state.turn;
      const moves = legalMoves(state, player);
      if (moves.length === 0) break;
      const card = pickRandom(moves, rng);
      state = playCard(state, player, card);
      expect(state.hands[0].length).toBeLessThanOrEqual(6);
      expect(state.hands[1].length).toBeLessThanOrEqual(6);

      guard += 1;
      if (guard > 200) throw new Error("exceeded sane move count");
    }
  });

  it("checkHandEnd declares a winner only when their total (card + banked marriage) reached 66", () => {
    for (const seed of [1, 2, 3, 42, 1000]) {
      const state = simulateRandomGame(seed);
      expect(state.handOver).toBe(true);
      if (state.winner !== null) {
        const total =
          state.points[state.winner] + state.bankedMarriagePoints[state.winner];
        expect(total).toBeGreaterThanOrEqual(66);
      }
    }
  });
});
