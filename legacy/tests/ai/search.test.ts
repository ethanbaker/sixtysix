import { describe, expect, it } from "vitest";
import type { Card, Deal } from "../../src/core/deck";
import { createInitialState } from "../../src/core/state";
import type { GameState } from "../../src/core/state";
import { searchBestAction } from "../../src/ai/search";

const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

function baseDeal(): Deal {
  return {
    nonDealerHand: [c("A", "hearts"), c("K", "hearts"), c("9", "clubs"), c("J", "diamonds"), c("Q", "spades"), c("10", "spades")],
    dealerHand: [c("9", "hearts"), c("Q", "hearts"), c("A", "clubs"), c("K", "diamonds"), c("J", "spades"), c("9", "spades")],
    trumpCard: c("K", "clubs"),
    trumpSuit: "clubs",
    stock: [],
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const base = createInitialState(baseDeal(), 0);
  return { ...base, ...overrides };
}

describe("searchBestAction: a small hand-constructed perfect-information endgame", () => {
  // Three tricks remain. Each of player 0's cards can only ever face one
  // specific card of player 1's (disjoint suits, closed-stock must-follow
  // rules force it), so the *final* point totals after all three tricks
  // are the same regardless of lead order: player 0 wins the clubs trick
  // (holds the trump ace against player 1's trump 9) and loses both the
  // hearts and diamonds tricks. What's NOT order-invariant is *when*
  // player 0 crosses 66 and gets to declare:
  //
  //  - Lead the trump ace now: wins the clubs trick immediately (60+11
  //    = 71 >= 66) while the opponent still has 0 points/0 tricks for
  //    the whole hand -> declaring right away is a "schwarz" 3-game-point
  //    win.
  //  - Lead either worthless 9 first: player 0 loses that trick (gains
  //    nothing), and won't get another chance to declare until they
  //    eventually win the clubs trick later -- by which point the
  //    opponent has banked points/tricks from the trick(s) they won in
  //    between, capping the eventual declare at only 2 game points.
  //
  // So the optimal first move is unambiguous: lead the trump ace, then
  // declare 66 immediately after it wins -- and *not* play out the
  // other, strictly worse-scoring tricks first. This requires the search
  // to look far enough ahead to see the declare-66 action becoming
  // available as a direct consequence of the first trick's outcome.
  function endgameState(): GameState {
    return makeState({
      hands: [
        [c("A", "clubs"), c("9", "hearts"), c("9", "diamonds")],
        [c("9", "clubs"), c("A", "hearts"), c("K", "diamonds")],
      ],
      trumpCard: null,
      stock: [],
      points: [60, 0],
      tricksWon: [3, 0],
      trick: [],
      leader: 0,
      turn: 0,
    });
  }

  it("finds the immediate trump-ace lead over either worthless off-suit lead", () => {
    const state = endgameState();
    const result = searchBestAction(state, 0, 4);
    expect(result.action).toEqual({ type: "playCard", card: c("A", "clubs") });
  });

  it("the winning line is decisively better, not a near tie (sanity-checks the scenario itself)", () => {
    const state = endgameState();
    const result = searchBestAction(state, 0, 4);
    // The trump-ace line reaches a real 3-game-point terminal win within
    // the search horizon; the other lines don't reach a terminal state
    // at all within the same depth, so the gap should be enormous (on
    // the order of the terminal scoring, not the small heuristic deltas
    // between mid-hand states).
    expect(result.value).toBeGreaterThan(500);
  });

  it("after winning the trump trick, the engine also picks declaring 66 over playing on", () => {
    // One ply further down: confirm the *next* decision point (now that
    // player 0 has won the clubs trick and is back on lead) also
    // correctly prefers declareSixtySix over leading another card.
    const afterTrumpTrick = makeState({
      hands: [[c("9", "hearts"), c("9", "diamonds")], [c("A", "hearts"), c("K", "diamonds")]],
      trumpCard: null,
      stock: [],
      points: [71, 0],
      tricksWon: [4, 0],
      trick: [],
      leader: 0,
      turn: 0,
    });
    const result = searchBestAction(afterTrumpTrick, 0, 3);
    expect(result.action).toEqual({ type: "declareSixtySix" });
  });
});

describe("searchBestAction: a simple forced-follow correctness check", () => {
  it("picks the only follow card that actually wins the trick when it matters", () => {
    // Player 0 led K hearts (4 pts, non-trump). Player 1 must follow
    // suit and is choosing between A hearts (beats it) and ... actually
    // under closed rules they must play a beating card if they have one,
    // so the only legal/sane choice is A hearts -- confirm search agrees
    // it's correct (and not e.g. some other accidental pick) by checking
    // the resulting evaluation favors player 1 winning.
    const state = makeState({
      earlyEndBy: 1,
      hands: [[c("9", "clubs")], [c("A", "hearts"), c("9", "hearts")]],
      trick: [{ player: 0, card: c("K", "hearts") }],
      leader: 0,
      turn: 1,
      points: [0, 60],
      tricksWon: [0, 5],
    });
    const result = searchBestAction(state, 1, 2);
    expect(result.action).toEqual({ type: "playCard", card: c("A", "hearts") });
  });
});
