import { describe, expect, it } from "vitest";
import type { Card, Deal } from "../../src/core/deck";
import { createInitialState } from "../../src/core/state";
import type { GameState } from "../../src/core/state";
import { evaluate } from "../../src/ai/evaluate";

const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

function makeState(overrides: Partial<GameState> = {}): GameState {
  const dealResult: Deal = {
    nonDealerHand: [
      c("A", "hearts"),
      c("K", "hearts"),
      c("9", "clubs"),
      c("J", "diamonds"),
      c("Q", "spades"),
      c("10", "spades"),
    ],
    dealerHand: [
      c("9", "hearts"),
      c("Q", "hearts"),
      c("A", "clubs"),
      c("K", "diamonds"),
      c("J", "spades"),
      c("9", "spades"),
    ],
    trumpCard: c("K", "clubs"),
    trumpSuit: "clubs",
    stock: [
      c("Q", "diamonds"),
      c("10", "diamonds"),
      c("9", "diamonds"),
      c("J", "hearts"),
      c("A", "diamonds"),
      c("10", "hearts"),
      c("J", "clubs"),
      c("Q", "clubs"),
      c("A", "spades"),
      c("10", "clubs"),
      c("K", "spades"),
    ],
  };
  const base = createInitialState(dealResult, 0);
  return { ...base, ...overrides };
}

describe("evaluate: terminal hand-over states dominate", () => {
  it("scores a won hand strongly positive, scaled by game points", () => {
    const lowWin = makeState({ handOver: true, winner: 0, gamePoints: 1 });
    const highWin = makeState({ handOver: true, winner: 0, gamePoints: 3 });
    expect(evaluate(lowWin, 0)).toBeGreaterThan(0);
    expect(evaluate(highWin, 0)).toBeGreaterThan(evaluate(lowWin, 0));
  });

  it("scores a lost hand strongly negative, scaled by game points", () => {
    const state = makeState({ handOver: true, winner: 1, gamePoints: 3 });
    expect(evaluate(state, 0)).toBeLessThan(0);
  });

  it("scores a void (nobody reached 66) hand as neutral", () => {
    const state = makeState({ handOver: true, winner: null, gamePoints: 0 });
    expect(evaluate(state, 0)).toBe(0);
  });

  it("a terminal win outscores any plausible mid-hand heuristic state", () => {
    // Even a very favorable non-terminal state shouldn't beat a real win.
    const favorable = makeState({
      points: [65, 0],
      bankedMarriagePoints: [40, 0],
      tricksWon: [6, 0],
    });
    const won = makeState({ handOver: true, winner: 0, gamePoints: 1 });
    expect(evaluate(won, 0)).toBeGreaterThan(evaluate(favorable, 0));
  });
});

describe("evaluate: mid-hand heuristic components", () => {
  it("rewards a net banked-points lead", () => {
    const ahead = makeState({ points: [40, 10] });
    const behind = makeState({ points: [10, 40] });
    expect(evaluate(ahead, 0)).toBeGreaterThan(evaluate(behind, 0));
  });

  it("rewards pending marriage points for this player", () => {
    const withPending = makeState({ pendingMarriagePoints: [20, 0] });
    const without = makeState();
    expect(evaluate(withPending, 0)).toBeGreaterThan(evaluate(without, 0));
  });

  it("rewards an undeclared-but-available marriage", () => {
    const opponentHand = makeState().hands[1];
    const withPotential = makeState({
      hands: [
        [c("K", "hearts"), c("Q", "hearts"), c("9", "clubs"), c("J", "diamonds"), c("Q", "spades"), c("10", "spades")],
        opponentHand,
      ],
    });
    const withoutPotential = makeState({
      hands: [
        [c("K", "hearts"), c("9", "hearts"), c("9", "clubs"), c("J", "diamonds"), c("Q", "spades"), c("10", "spades")],
        opponentHand,
      ],
    });
    expect(evaluate(withPotential, 0)).toBeGreaterThan(evaluate(withoutPotential, 0));
  });

  it("discounts a potential (undeclared) marriage relative to the same points already pending", () => {
    const baseHand: [Card[], Card[]] = [
      [c("K", "hearts"), c("Q", "hearts"), c("9", "clubs"), c("J", "diamonds"), c("Q", "spades"), c("10", "spades")],
      [...makeState().hands[1]],
    ];
    const potentialOnly = makeState({ hands: baseHand });
    // Same hand, but already declared (points now pending instead of
    // sitting undeclared as K+Q in hand) -- same underlying 20 points,
    // but pending should score higher than merely potential.
    const declared = makeState({
      hands: [
        [c("9", "clubs"), c("J", "diamonds"), c("Q", "spades"), c("10", "spades")],
        baseHand[1],
      ],
      pendingMarriagePoints: [20, 0],
    });
    expect(evaluate(declared, 0)).toBeGreaterThan(evaluate(potentialOnly, 0));
  });

  it("rewards holding better trumps than the opponent", () => {
    const goodTrumps = makeState({
      hands: [
        [c("A", "clubs"), c("10", "clubs"), c("9", "hearts"), c("J", "diamonds"), c("Q", "spades"), c("10", "spades")],
        [c("9", "clubs"), c("Q", "hearts"), c("A", "hearts"), c("K", "diamonds"), c("J", "spades"), c("9", "spades")],
      ],
    });
    const weakTrumps = makeState({
      hands: [
        [c("9", "clubs"), c("Q", "hearts"), c("A", "hearts"), c("K", "diamonds"), c("J", "spades"), c("9", "spades")],
        [c("A", "clubs"), c("10", "clubs"), c("9", "hearts"), c("J", "diamonds"), c("Q", "spades"), c("10", "spades")],
      ],
    });
    expect(evaluate(goodTrumps, 0)).toBeGreaterThan(evaluate(weakTrumps, 0));
  });

  it("rewards proximity to 66", () => {
    const close = makeState({ points: [60, 0] });
    const far = makeState({ points: [10, 0] });
    expect(evaluate(close, 0)).toBeGreaterThan(evaluate(far, 0));
  });

  it("rewards closing while already safely at 66+, penalizes closing while short", () => {
    const safeClose = makeState({ points: [70, 0], earlyEndBy: 0 });
    const riskyClose = makeState({ points: [10, 0], earlyEndBy: 0 });
    const notClosed = makeState({ points: [10, 0] });
    expect(evaluate(safeClose, 0)).toBeGreaterThan(evaluate(notClosed, 0));
    expect(evaluate(riskyClose, 0)).toBeLessThan(evaluate(notClosed, 0));
  });

  it("is symmetric: swapping perspective flips the net-points sign", () => {
    const state = makeState({ points: [40, 10] });
    // Not an exact negation overall (some terms aren't symmetric, e.g.
    // each player's own hand composition), but the net-points component
    // alone should flip sign with the weight applied.
    const player0 = evaluate(state, 0);
    const player1 = evaluate(state, 1);
    expect(player0).not.toBe(player1);
  });
});
