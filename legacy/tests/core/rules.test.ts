import { describe, expect, it } from "vitest";
import type { Card } from "../../src/core/deck";
import { isClosedPhase, legalMoves, trickWinner } from "../../src/core/rules";
import { createInitialState, playCard } from "../../src/core/state";
import type { GameState } from "../../src/core/state";

const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

describe("trickWinner", () => {
  it("suit led only: higher card of the suit led wins", () => {
    expect(trickWinner(c("K", "hearts"), c("9", "hearts"), "clubs")).toBe("lead");
    expect(trickWinner(c("9", "hearts"), c("K", "hearts"), "clubs")).toBe("follow");
    expect(trickWinner(c("A", "hearts"), c("10", "hearts"), "clubs")).toBe("lead");
  });

  it("suit led only: following a different non-trump suit never wins", () => {
    // Off-suit follow can't win even with a nominally "higher" rank.
    expect(trickWinner(c("9", "hearts"), c("A", "spades"), "clubs")).toBe("lead");
  });

  it("trump beats a non-trump suit-led card regardless of rank", () => {
    expect(trickWinner(c("A", "hearts"), c("9", "clubs"), "clubs")).toBe("follow");
    expect(trickWinner(c("A", "hearts"), c("9", "hearts"), "clubs")).toBe("lead");
  });

  it("trump led beats a non-trump follow regardless of rank", () => {
    expect(trickWinner(c("9", "clubs"), c("A", "hearts"), "clubs")).toBe("lead");
  });

  it("trump vs trump: higher trump wins", () => {
    expect(trickWinner(c("9", "clubs"), c("A", "clubs"), "clubs")).toBe("follow");
    expect(trickWinner(c("A", "clubs"), c("9", "clubs"), "clubs")).toBe("lead");
    expect(trickWinner(c("Q", "clubs"), c("K", "clubs"), "clubs")).toBe("follow");
  });
});

function makeState(overrides: Partial<GameState> = {}): GameState {
  const dealResult = {
    nonDealerHand: [c("A", "hearts"), c("K", "hearts"), c("9", "clubs"), c("J", "diamonds"), c("Q", "spades"), c("10", "spades")],
    dealerHand: [c("9", "hearts"), c("Q", "hearts"), c("A", "clubs"), c("K", "diamonds"), c("J", "spades"), c("9", "spades")],
    trumpCard: c("K", "clubs"),
    trumpSuit: "clubs" as const,
    stock: [c("Q", "diamonds"), c("10", "diamonds"), c("9", "diamonds"), c("J", "hearts"), c("A", "diamonds"), c("10", "hearts"), c("J", "clubs"), c("Q", "clubs"), c("A", "spades"), c("10", "clubs"), c("K", "spades")],
  };
  const base = createInitialState(dealResult, 0);
  return { ...base, ...overrides };
}

describe("legalMoves (open-stock phase)", () => {
  it("allows any card in hand, with no obligation to follow suit or trump", () => {
    const state = makeState();
    const moves = legalMoves(state, 0);
    expect(moves).toHaveLength(6);
    expect(moves).toEqual(state.hands[0]);
  });
});

describe("legalMoves (closed-stock phase: must-follow / must-beat / must-trump)", () => {
  // A trick in progress: player 0 led `ledCard`, player 1 (the follower
  // under test) holds `hand`. trumpSuit is "clubs" throughout.
  function followerState(ledCard: Card, hand: Card[]): GameState {
    const state = makeState({ earlyEndBy: 0, hands: [[ledCard], hand] });
    return { ...state, trick: [{ player: 0, card: ledCard }], turn: 1 };
  }

  it("must follow suit and must beat the led card if able (non-trump led)", () => {
    const hand = [c("9", "hearts"), c("A", "hearts"), c("J", "diamonds")];
    const state = followerState(c("K", "hearts"), hand);
    expect(legalMoves(state, 1)).toEqual([c("A", "hearts")]);
  });

  it("must follow suit even when unable to beat (plays any card of that suit)", () => {
    const hand = [c("9", "hearts"), c("J", "hearts"), c("J", "diamonds")];
    const state = followerState(c("A", "hearts"), hand);
    expect(legalMoves(state, 1)).toEqual([c("9", "hearts"), c("J", "hearts")]);
  });

  it("must trump when unable to follow suit and holding trump", () => {
    const hand = [c("9", "clubs"), c("A", "clubs"), c("J", "diamonds")];
    const state = followerState(c("K", "hearts"), hand);
    expect(legalMoves(state, 1)).toEqual([c("9", "clubs"), c("A", "clubs")]);
  });

  it("plays anything when holding neither the suit led nor any trump", () => {
    const hand = [c("9", "diamonds"), c("J", "diamonds"), c("Q", "spades")];
    const state = followerState(c("K", "hearts"), hand);
    expect(legalMoves(state, 1)).toEqual(hand);
  });

  it("trump led: must play a higher trump if able", () => {
    const hand = [c("9", "clubs"), c("A", "clubs"), c("J", "diamonds")];
    const state = followerState(c("Q", "clubs"), hand);
    expect(legalMoves(state, 1)).toEqual([c("A", "clubs")]);
  });

  it("trump led: must still trump even when unable to beat it", () => {
    const hand = [c("9", "clubs"), c("J", "clubs"), c("J", "diamonds")];
    const state = followerState(c("A", "clubs"), hand);
    expect(legalMoves(state, 1)).toEqual([c("9", "clubs"), c("J", "clubs")]);
  });

  it("trump led: plays anything when holding no trump at all", () => {
    const hand = [c("9", "diamonds"), c("J", "hearts"), c("Q", "spades")];
    const state = followerState(c("A", "clubs"), hand);
    expect(legalMoves(state, 1)).toEqual(hand);
  });

  it("leading is always a free choice, even when closed", () => {
    const state = makeState({ earlyEndBy: 0 });
    expect(legalMoves(state, 0)).toEqual(state.hands[0]);
  });

  it("isClosedPhase is true once manually closed, and once stock+trump are both gone", () => {
    expect(isClosedPhase(makeState())).toBe(false);
    expect(isClosedPhase(makeState({ earlyEndBy: 0 }))).toBe(true);
    expect(isClosedPhase(makeState({ stock: [], trumpCard: null }))).toBe(true);
    expect(isClosedPhase(makeState({ stock: [], trumpCard: c("9", "clubs") }))).toBe(false);
  });
});

describe("playCard", () => {
  it("rejects a play out of turn", () => {
    const state = makeState();
    expect(() => playCard(state, 1, state.hands[1][0])).toThrow();
  });

  it("rejects a card the player doesn't hold", () => {
    const state = makeState();
    expect(() => playCard(state, 0, c("A", "diamonds"))).toThrow();
  });

  it("leading a card removes it from hand and waits for the follower", () => {
    const state = makeState();
    const led = state.hands[0][0];
    const next = playCard(state, 0, led);
    expect(next.hands[0]).toHaveLength(5);
    expect(next.trick).toEqual([{ player: 0, card: led }]);
    expect(next.turn).toBe(1);
    expect(next.leader).toBe(0);
  });

  it("banks the combined point value of both cards to the trick winner", () => {
    let state = makeState();
    // Non-dealer leads A of hearts (11 pts, non-trump); dealer follows
    // with 9 of hearts (0 pts) which loses (lower, same suit, no trump).
    state = playCard(state, 0, c("A", "hearts"));
    const before = state.points;
    state = playCard(state, 1, c("9", "hearts"));
    expect(state.points[0]).toBe(before[0] + 11);
    expect(state.points[1]).toBe(before[1]);
    expect(state.tricksWon[0]).toBe(1);
    expect(state.tricksWon[1]).toBe(0);
  });

  it("trump follow steals the trick and its points even off-suit", () => {
    let state = makeState();
    // Non-dealer leads K hearts (4 pts); dealer follows with trump A clubs (11 pts).
    state = playCard(state, 0, c("K", "hearts"));
    state = playCard(state, 1, c("A", "clubs"));
    expect(state.points[1]).toBe(15);
    expect(state.points[0]).toBe(0);
    expect(state.tricksWon[1]).toBe(1);
  });

  it("the trick winner leads the next trick", () => {
    let state = makeState();
    state = playCard(state, 0, c("A", "hearts"));
    state = playCard(state, 1, c("9", "hearts")); // non-dealer (0) wins
    expect(state.leader).toBe(0);
    expect(state.turn).toBe(0);
  });

  it("replenishes both hands to 6 cards, winner drawing first", () => {
    let state = makeState();
    const expectedFirstDraw = state.stock[0];
    const expectedSecondDraw = state.stock[1];

    state = playCard(state, 0, c("A", "hearts"));
    state = playCard(state, 1, c("9", "hearts")); // non-dealer (player 0) wins

    expect(state.hands[0]).toHaveLength(6);
    expect(state.hands[1]).toHaveLength(6);
    // Winner (player 0) drew the top of stock; loser (player 1) drew next.
    expect(state.hands[0][state.hands[0].length - 1]).toEqual(expectedFirstDraw);
    expect(state.hands[1][state.hands[1].length - 1]).toEqual(expectedSecondDraw);
    expect(state.stock).toHaveLength(9);
  });

  it("does not crash when only one card remains to draw (winner gets it, loser gets nothing)", () => {
    let state = makeState({ stock: [], trumpCard: c("K", "clubs") });
    state = playCard(state, 0, c("A", "hearts"));
    state = playCard(state, 1, c("9", "hearts")); // non-dealer (player 0) wins
    expect(state.trumpCard).toBeNull();
    expect(state.stock).toHaveLength(0);
    expect(state.hands[0]).toHaveLength(6); // drew the trump card
    expect(state.hands[1]).toHaveLength(5); // nothing left to draw
  });

  it("does not crash and draws nothing when the draw pile is fully empty", () => {
    let state = makeState({ stock: [], trumpCard: null });
    state = playCard(state, 0, c("A", "hearts"));
    state = playCard(state, 1, c("9", "hearts"));
    expect(state.hands[0]).toHaveLength(5);
    expect(state.hands[1]).toHaveLength(5);
  });

  it("does not auto-end the hand just from reaching 66 in raw points (declaring is explicit, see closing.ts)", () => {
    let state = makeState({ points: [60, 0] });
    state = playCard(state, 0, c("A", "hearts")); // leads, no points banked yet
    state = playCard(state, 1, c("9", "hearts")); // non-dealer wins +11 -> 71 >= 66
    expect(state.points[0]).toBe(71);
    expect(state.handOver).toBe(false);
    expect(state.winner).toBeNull();
  });

  it("rejects further plays once the hand is marked over", () => {
    const state: GameState = { ...makeState(), handOver: true, winner: 0, gamePoints: 1 };
    expect(() => playCard(state, state.turn, state.hands[state.turn][0])).toThrow();
  });
});
