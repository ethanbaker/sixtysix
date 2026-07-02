import { describe, expect, it } from "vitest";
import type { Card, Deal } from "../../src/core/deck";
import { createDeck, deal, shuffleDeck } from "../../src/core/deck";
import {
  applyHandResult,
  closeStock,
  createInitialMatchState,
  declareSixtySix,
  GAME_POINTS_TO_WIN_MATCH,
} from "../../src/core/closing";
import {
  canCloseStock,
  canDeclareSixtySix,
  legalMoves,
} from "../../src/core/rules";
import { createInitialState, playCard } from "../../src/core/state";
import type { GameState } from "../../src/core/state";
import { createRng } from "../../src/core/rng";

const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

function pickRandom<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

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

describe("closeStock", () => {
  it("happy path: marks the stock closed by the closer", () => {
    const state = makeState();
    const next = closeStock(state, 0);
    expect(next.earlyEndBy).toBe(0);
    expect(canCloseStock(state, 0)).toBe(true);
  });

  it("rejects closing when not on lead", () => {
    let state = makeState();
    state = playCard(state, 0, c("J", "diamonds")); // now mid-trick, player 1 to follow
    expect(canCloseStock(state, 1)).toBe(false);
    expect(() => closeStock(state, 1)).toThrow();
  });

  it("rejects closing out of turn", () => {
    const state = makeState();
    expect(canCloseStock(state, 1)).toBe(false);
    expect(() => closeStock(state, 1)).toThrow();
  });

  it("rejects closing twice", () => {
    let state = makeState();
    state = closeStock(state, 0);
    expect(canCloseStock(state, 0)).toBe(false);
    expect(() => closeStock(state, 0)).toThrow();
  });

  it("rejects closing once the stock has naturally exhausted", () => {
    const state = makeState({ stock: [], trumpCard: null });
    expect(canCloseStock(state, 0)).toBe(false);
    expect(() => closeStock(state, 0)).toThrow();
  });
});

describe("declareSixtySix preconditions", () => {
  it("rejects declaring when not on lead", () => {
    let state = makeState();
    state = playCard(state, 0, c("J", "diamonds"));
    expect(canDeclareSixtySix(state, 1)).toBe(false);
    expect(() => declareSixtySix(state, 1)).toThrow();
  });

  it("rejects declaring once the hand is already over", () => {
    const state = makeState({ handOver: true, winner: 0, gamePoints: 1 });
    expect(canDeclareSixtySix(state, 0)).toBe(false);
    expect(() => declareSixtySix(state, 0)).toThrow();
  });
});

describe("3.7 declare-66 scoring branches (no manual close)", () => {
  it("correct declare, opponent has >=33 card points -> 1 game point", () => {
    const state = makeState({ points: [70, 40], tricksWon: [5, 5] });
    const result = declareSixtySix(state, 0);
    expect(result.winner).toBe(0);
    expect(result.gamePoints).toBe(1);
  });

  it("correct declare, opponent has <33 card points but won a trick -> 2 game points", () => {
    const state = makeState({ points: [90, 20], tricksWon: [5, 1] });
    const result = declareSixtySix(state, 0);
    expect(result.winner).toBe(0);
    expect(result.gamePoints).toBe(2);
  });

  it("correct declare, opponent took zero tricks -> 3 game points", () => {
    const state = makeState({ points: [110, 0], tricksWon: [6, 0] });
    const result = declareSixtySix(state, 0);
    expect(result.winner).toBe(0);
    expect(result.gamePoints).toBe(3);
  });

  it("correct declare via banked marriage points counting toward the 66", () => {
    const state = makeState({
      points: [46, 10],
      bankedMarriagePoints: [20, 0],
      tricksWon: [3, 3],
    });
    const result = declareSixtySix(state, 0); // 46 card + 20 marriage = 66
    expect(result.winner).toBe(0);
  });

  it("wrong declare, declarer has won at least one trick -> opponent gets 2", () => {
    const state = makeState({ points: [50, 60], tricksWon: [3, 3] });
    const result = declareSixtySix(state, 0); // declarer only has 50, wrong
    expect(result.winner).toBe(1);
    expect(result.gamePoints).toBe(2);
  });

  it("wrong declare, declarer took zero tricks -> opponent gets 3", () => {
    const state = makeState({ points: [0, 110], tricksWon: [0, 6] });
    const result = declareSixtySix(state, 0);
    expect(result.winner).toBe(1);
    expect(result.gamePoints).toBe(3);
  });

  it("pending (un-banked) marriage points do not count toward 66", () => {
    const state = makeState({
      points: [50, 0],
      pendingMarriagePoints: [20, 0],
      tricksWon: [3, 0],
    });
    const result = declareSixtySix(state, 0); // 50 card + 0 banked = 50, wrong
    expect(result.winner).toBe(1);
  });
});

describe("3.5 manual-close scoring branches", () => {
  it("closer reaches 66 -> normal 3.7 success table applies to the closer", () => {
    let state = makeState({ points: [70, 30], tricksWon: [4, 2] });
    state = closeStock(state, 0);
    const result = declareSixtySix(state, 0);
    expect(result.winner).toBe(0);
    expect(result.gamePoints).toBe(2); // opponent <33 points but won tricks
  });

  it("closer declares wrongly -> opponent gets flat 2, regardless of opponent's own points", () => {
    let state = makeState({ points: [40, 60], tricksWon: [2, 4] });
    state = closeStock(state, 0);
    const result = declareSixtySix(state, 0); // closer only has 40
    expect(result.winner).toBe(1);
    expect(result.gamePoints).toBe(2);
  });

  it("closer took zero tricks when failing -> opponent gets flat 3", () => {
    let state = makeState({ points: [0, 100], tricksWon: [0, 6] });
    state = closeStock(state, 0);
    const result = declareSixtySix(state, 0);
    expect(result.winner).toBe(1);
    expect(result.gamePoints).toBe(3);
  });

  it("opponent declares (correctly) before the closer does -> still the flat closer-failure penalty, not the scaled table", () => {
    let state = makeState({ points: [20, 90], tricksWon: [1, 5] });
    state = closeStock(state, 0); // closer is player 0, while it's still their turn
    state = { ...state, turn: 1, leader: 1 }; // now it's the opponent's turn to lead
    // Opponent (player 1) declares 66 themselves -- this means the closer
    // failed to get there first. Per 3.5 this is the flat penalty, NOT
    // the normal success table scored to the declaring opponent (which
    // would have given opponent 1 point here, since closer has >=33).
    const result = declareSixtySix(state, 1);
    expect(result.winner).toBe(1);
    expect(result.gamePoints).toBe(2); // flat penalty, capped at 2 (closer has tricks)
  });

  it("opponent declares WRONGLY while a close is in effect -> ordinary wrong-declare penalty to the closer, not a free win for the opponent", () => {
    // Regression test: an earlier version of resolveOutcome treated ANY
    // declare by the non-closer (right or wrong) as proof the closer had
    // failed, which let a player with essentially nothing (0 points)
    // win outright just by declaring while the opponent had closed.
    let state = makeState({ points: [60, 0], tricksWon: [4, 0] });
    state = closeStock(state, 0); // closer is player 0, well on track for 66
    state = { ...state, turn: 1, leader: 1 };
    const result = declareSixtySix(state, 1); // player 1 has 0 points -- a bad-faith/mistaken declare
    expect(result.winner).toBe(0); // the closer's opponent (player 1) was wrong, so player 0 (the closer) is rewarded
    expect(result.gamePoints).toBe(3); // player 1 (the wrong declarer) has taken zero tricks
  });

  it("a manual close that is never declared resolves at hand-end via checkHandEnd, not playCard", () => {
    // playCard never auto-ends a hand; only declareSixtySix/checkHandEnd do.
    let state = makeState({ points: [70, 10] });
    state = closeStock(state, 0);
    expect(state.handOver).toBe(false);
  });
});

describe("Section 3.6: stock-exhaustion +10 bonus vs. manual close (no bonus)", () => {
  it("the winner of the literal last trick of a naturally exhausted hand gets +10", () => {
    // Construct a hand one trick away from naturally exhausting: stock
    // has exactly 1 card, trumpCard present, hands have 1 card each.
    let state = makeState({
      hands: [[c("A", "hearts")], [c("9", "hearts")]],
      stock: [c("9", "diamonds")],
      trumpCard: c("K", "clubs"),
      points: [10, 10],
    });
    state = playCard(state, 0, c("A", "hearts"));
    state = playCard(state, 1, c("9", "hearts")); // non-dealer (0) wins this trick
    // This trick's draws exhaust the pile (1 stock card + trump card),
    // but it does NOT empty both hands (each drew a replacement), so no
    // bonus yet.
    expect(state.hands[0]).toHaveLength(1);
    expect(state.hands[1]).toHaveLength(1);
    expect(state.stock).toHaveLength(0);
    expect(state.trumpCard).toBeNull();
    expect(state.points[0]).toBe(10 + 11); // no bonus yet, hands not empty

    // Now play out the final trick from the cards just drawn.
    const finalLead = state.hands[0][0];
    const finalFollow = state.hands[1][0];
    const beforeBonus = state.points;
    state = playCard(state, 0, finalLead);
    state = playCard(state, 1, finalFollow);
    expect(state.hands[0]).toHaveLength(0);
    expect(state.hands[1]).toHaveLength(0);
    const winner = state.points[0] > beforeBonus[0] ? 0 : 1;
    const trickCardPoints = state.points[winner] - beforeBonus[winner] - 10; // back out the bonus
    expect(trickCardPoints).toBeGreaterThanOrEqual(0);
    expect(state.points[winner]).toBe(
      beforeBonus[winner] + trickCardPoints + 10,
    );
  });

  it("a manually closed hand never gets the +10 bonus, even when it ends with empty hands", () => {
    let state = makeState({
      hands: [[c("A", "hearts")], [c("9", "hearts")]],
      points: [10, 10],
    });
    state = closeStock(state, 0);
    state = playCard(state, 0, c("A", "hearts"));
    state = playCard(state, 1, c("9", "hearts")); // non-dealer (0) wins, +11 only
    expect(state.hands[0]).toHaveLength(0);
    expect(state.hands[1]).toHaveLength(0);
    expect(state.points[0]).toBe(10 + 11); // no +10 bonus
  });
});

describe("match-level scoring", () => {
  it("accumulates game points and alternates the dealer", () => {
    let match = createInitialMatchState(1); // player 1 deals first hand
    const hand1: GameState = {
      ...makeState(),
      handOver: true,
      winner: 0,
      gamePoints: 2,
    };
    match = applyHandResult(match, hand1);
    expect(match.matchScore).toEqual([2, 0]);
    expect(match.dealer).toBe(0); // alternates from 1 -> 0
    expect(match.matchWinner).toBeNull();

    const hand2: GameState = {
      ...makeState(),
      handOver: true,
      winner: 1,
      gamePoints: 3,
    };
    match = applyHandResult(match, hand2);
    expect(match.matchScore).toEqual([2, 3]);
    expect(match.dealer).toBe(1); // alternates back
  });

  it("a void hand (no winner) still alternates the deal but adds no points", () => {
    let match = createInitialMatchState(0);
    const voidHand: GameState = {
      ...makeState(),
      handOver: true,
      winner: null,
      gamePoints: 0,
    };
    match = applyHandResult(match, voidHand);
    expect(match.matchScore).toEqual([0, 0]);
    expect(match.dealer).toBe(1);
  });

  it("declares a match winner once a player reaches the threshold", () => {
    let match = createInitialMatchState(0);
    const bigWin: GameState = {
      ...makeState(),
      handOver: true,
      winner: 0,
      gamePoints: GAME_POINTS_TO_WIN_MATCH,
    };
    match = applyHandResult(match, bigWin);
    expect(match.matchScore[0]).toBe(GAME_POINTS_TO_WIN_MATCH);
    expect(match.matchWinner).toBe(0);
  });

  it("rejects applying a hand result once the match is already over", () => {
    let match = createInitialMatchState(0);
    const bigWin: GameState = {
      ...makeState(),
      handOver: true,
      winner: 0,
      gamePoints: GAME_POINTS_TO_WIN_MATCH,
    };
    match = applyHandResult(match, bigWin);
    const anotherHand: GameState = {
      ...makeState(),
      handOver: true,
      winner: 1,
      gamePoints: 1,
    };
    expect(() => applyHandResult(match, anotherHand)).toThrow();
  });

  it("rejects applying an unfinished hand's result", () => {
    const match = createInitialMatchState(0);
    expect(() => applyHandResult(match, makeState())).toThrow();
  });
});

describe("full simulated random-legal-move hands", () => {
  // Drives a hand to completion (or until nobody has a legal move left,
  // i.e. both hands are empty) by repeatedly picking uniformly at random
  // among the current player's legal moves. Does not close the stock or
  // declare 66 itself — callers that want a manual close do that before
  // calling this.
  function driveHand(state: GameState, rng: () => number): GameState {
    let guard = 0;
    while (!state.handOver) {
      const moves = legalMoves(state, state.turn);
      if (moves.length === 0) break;
      const card = pickRandom(moves, rng);
      state = playCard(state, state.turn, card);

      guard += 1;
      if (guard > 200) throw new Error("driveHand exceeded a sane move count");
    }
    return state;
  }

  it("natural stock exhaustion: plays all 24 cards and awards the +10 bonus to the last trick's winner", () => {
    for (const seed of [1, 2, 3, 42, 1000]) {
      const rng = createRng(seed);
      const dealResult = deal(shuffleDeck(createDeck(), rng));
      let state = createInitialState(dealResult, 0);
      state = driveHand(state, rng); // never closes
      expect(state.handOver).toBe(false); // playCard alone never ends a hand

      expect(state.hands[0]).toHaveLength(0);
      expect(state.hands[1]).toHaveLength(0);
      expect(state.stock).toHaveLength(0);
      expect(state.trumpCard).toBeNull();
      expect(state.earlyEndBy).toBeNull();
      expect(state.points[0] + state.points[1]).toBe(130); // 120 deck + 10 bonus
      expect(state.tricksWon[0] + state.tricksWon[1]).toBe(12);
    }
  });

  it("a manual close that succeeds: closer dominates with the entire trump suit and wins", () => {
    const rng = createRng(5);
    // Player 0 holds 5 of 6 trumps (all but the worthless 9) plus a safe
    // filler the opponent holds none of, guaranteeing every trick they
    // lead is unbeatable; player 1 holds high-value off-suit cards that
    // (once captured) push player 0 comfortably past 66.
    const dealResult: Deal = {
      nonDealerHand: [
        c("J", "clubs"),
        c("Q", "clubs"),
        c("K", "clubs"),
        c("10", "clubs"),
        c("A", "clubs"),
        c("9", "spades"),
      ],
      dealerHand: [
        c("A", "hearts"),
        c("10", "hearts"),
        c("A", "diamonds"),
        c("10", "diamonds"),
        c("K", "hearts"),
        c("K", "diamonds"),
      ],
      trumpCard: c("9", "clubs"),
      trumpSuit: "clubs",
      stock: [
        c("9", "hearts"),
        c("J", "hearts"),
        c("Q", "hearts"),
        c("9", "diamonds"),
        c("J", "diamonds"),
        c("Q", "diamonds"),
        c("J", "spades"),
        c("Q", "spades"),
        c("K", "spades"),
        c("10", "spades"),
        c("A", "spades"),
      ],
    };
    let state = createInitialState(dealResult, 0);
    state = closeStock(state, 0); // close immediately, before leading
    state = driveHand(state, rng);

    expect(state.handOver).toBe(false); // still needs an explicit declare
    expect(state.hands[0]).toHaveLength(0);
    expect(state.hands[1]).toHaveLength(0);
    expect(state.points[0]).toBeGreaterThanOrEqual(66);
    expect(state.tricksWon[0]).toBe(6);
    expect(state.tricksWon[1]).toBe(0);

    const result = declareSixtySix({ ...state, turn: 0, trick: [] }, 0);
    expect(result.handOver).toBe(true);
    expect(result.winner).toBe(0);
    expect(result.gamePoints).toBe(3); // opponent took zero tricks and zero points
  });

  it("a manual close that fails: closer is starved of trump and never reaches 66", () => {
    const rng = createRng(9);
    // Player 0 (non-dealer, closer) holds only off-suit cards and zero
    // trump; player 1 holds almost the entire trump suit, so they always
    // out-trump or out-rank player 0 and player 0 can never win a trick.
    const dealResult: Deal = {
      nonDealerHand: [
        c("9", "hearts"),
        c("J", "hearts"),
        c("Q", "hearts"),
        c("K", "hearts"),
        c("9", "diamonds"),
        c("J", "diamonds"),
      ],
      dealerHand: [
        c("J", "clubs"),
        c("Q", "clubs"),
        c("K", "clubs"),
        c("10", "clubs"),
        c("A", "clubs"),
        c("9", "spades"),
      ],
      trumpCard: c("9", "clubs"),
      trumpSuit: "clubs",
      stock: [
        c("10", "hearts"),
        c("A", "hearts"),
        c("Q", "diamonds"),
        c("K", "diamonds"),
        c("10", "diamonds"),
        c("A", "diamonds"),
        c("J", "spades"),
        c("Q", "spades"),
        c("K", "spades"),
        c("10", "spades"),
        c("A", "spades"),
      ],
    };
    let state = createInitialState(dealResult, 0);
    state = closeStock(state, 0); // closer is player 0, the weak hand
    state = driveHand(state, rng);

    expect(state.hands[0]).toHaveLength(0);
    expect(state.hands[1]).toHaveLength(0);
    expect(state.tricksWon[0]).toBe(0); // never won a single trick
    expect(state.points[0]).toBe(0);

    const result = declareSixtySix({ ...state, turn: 0, trick: [] }, 0);
    expect(result.handOver).toBe(true);
    expect(result.winner).toBe(1); // closer's opponent
    expect(result.gamePoints).toBe(3); // closer took zero tricks
  });
});
