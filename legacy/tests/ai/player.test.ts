import { describe, expect, it } from "vitest";
import type { Card, Deal } from "../../src/core/deck";
import { cardsEqual } from "../../src/core/deck";
import {
  canCloseStock,
  canDeclareSixtySix,
  canExchangeTrumpNine,
  legalMoves,
} from "../../src/core/rules";
import { availableMarriages } from "../../src/core/marriages";
import { createInitialState } from "../../src/core/state";
import type { GameState } from "../../src/core/state";
import { chooseAction, createAiPlayer } from "../../src/ai/player";
import { createMatch, playAiTurn } from "../../src/game/match";
import { createRng } from "../../src/core/rng";

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

describe("chooseAction: never selects an illegal action", () => {
  it("a played card is always among legalMoves (open-stock phase)", () => {
    const state = makeState();
    const action = chooseAction(state, 0, createRng(1));
    expect(action.type).toBe("playCard");
    if (action.type === "playCard") {
      expect(
        legalMoves(state, 0).some((card) => cardsEqual(card, action.card)),
      ).toBe(true);
    }
  });

  it("a played card respects must-follow/must-beat/must-trump once closed", () => {
    // Player 0 led K hearts; player 1 (under test) must follow suit and
    // beat it if able. They hold A hearts (beats) and 9 hearts (doesn't).
    const state = makeState({
      earlyEndBy: 0,
      hands: [
        [c("K", "hearts")],
        [c("A", "hearts"), c("9", "hearts"), c("9", "clubs")],
      ],
      trick: [{ player: 0, card: c("K", "hearts") }],
      turn: 1,
    });
    const action = chooseAction(state, 1, createRng(1));
    expect(action.type).toBe("playCard");
    if (action.type === "playCard") {
      expect(
        legalMoves(state, 1).some((card) => cardsEqual(card, action.card)),
      ).toBe(true);
      // The only legal move here is the beating card, A hearts.
      expect(action.card).toEqual(c("A", "hearts"));
    }
  });

  it("never offers/declares a marriage, exchange, or close when not actually legal", () => {
    const state = makeState();
    const action = chooseAction(state, 0, createRng(1));
    if (action.type === "declareMarriage") {
      expect(availableMarriages(state, 0).includes(action.card.suit)).toBe(
        true,
      );
    }
    if (action.type === "exchangeTrumpNine") {
      expect(canExchangeTrumpNine(state, 0)).toBe(true);
    }
    if (action.type === "closeStock") {
      expect(canCloseStock(state, 0)).toBe(true);
    }
    if (action.type === "declareSixtySix") {
      expect(canDeclareSixtySix(state, 0)).toBe(true);
    }
  });

  it("full AI-vs-AI hands run to completion without ever throwing, across many seeds", () => {
    for (const seed of [1, 2, 3, 4, 5, 42, 100, 1000]) {
      const aiPlayers = [
        createAiPlayer(0, "easy", createRng(seed)),
        createAiPlayer(1, "easy", createRng(seed + 1)),
      ] as const;
      let session = createMatch(0, createRng(seed));
      let guard = 0;
      while (!session.hand.handOver) {
        const player = session.hand.turn;
        session = playAiTurn(session, aiPlayers[player]);
        guard += 1;
        if (guard > 60) {
          throw new Error(
            `seed ${seed}: AI-vs-AI hand exceeded a sane turn count`,
          );
        }
      }
      expect(session.hand.handOver).toBe(true);
      expect(
        session.hand.points[0] + session.hand.points[1],
      ).toBeLessThanOrEqual(130);
    }
  });

  it("AI-vs-AI never desyncs hand sizes (each hand stays within 0..6 cards)", () => {
    const aiPlayers = [
      createAiPlayer(0, "easy", createRng(7)),
      createAiPlayer(1, "easy", createRng(8)),
    ] as const;
    let session = createMatch(0, createRng(7));
    let guard = 0;
    while (!session.hand.handOver) {
      const player = session.hand.turn;
      session = playAiTurn(session, aiPlayers[player]);
      expect(session.hand.hands[0].length).toBeLessThanOrEqual(6);
      expect(session.hand.hands[1].length).toBeLessThanOrEqual(6);
      guard += 1;
      if (guard > 60) throw new Error("exceeded sane turn count");
    }
  });
});

describe("chooseAction: declares 66 in an obviously-correct case", () => {
  it("declares when already comfortably past 66 and on lead", () => {
    const state = makeState({ points: [80, 10], tricksWon: [5, 1] });
    const action = chooseAction(state, 0, createRng(1));
    expect(action).toEqual({ type: "declareSixtySix" });
  });

  it("declares using banked marriage points too, not just card points", () => {
    const state = makeState({
      points: [50, 10],
      bankedMarriagePoints: [20, 0],
      tricksWon: [4, 1],
    });
    const action = chooseAction(state, 0, createRng(1));
    expect(action).toEqual({ type: "declareSixtySix" });
  });

  it("does not declare when nowhere near 66", () => {
    const state = makeState({ points: [10, 5], tricksWon: [1, 1] });
    const action = chooseAction(state, 0, createRng(1));
    expect(action).not.toEqual({ type: "declareSixtySix" });
  });
});

describe("chooseAction: takes an available marriage in an obvious case", () => {
  it("declares a plain-suit marriage over an unrelated card play", () => {
    const state = makeState({
      hands: [
        [
          c("K", "hearts"),
          c("Q", "hearts"),
          c("9", "clubs"),
          c("J", "diamonds"),
          c("9", "spades"),
          c("10", "diamonds"),
        ],
        makeState().hands[1],
      ],
    });
    const action = chooseAction(state, 0, createRng(1));
    expect(action.type).toBe("declareMarriage");
    if (action.type === "declareMarriage") {
      expect(action.card.suit).toBe("hearts");
      expect(["K", "Q"]).toContain(action.card.rank);
    }
  });

  it("declares a trump-suit marriage (worth more) when both are available", () => {
    // Player 0 holds both a plain (hearts) and a trump (clubs) marriage;
    // the trump one (40 pts) should win out over the plain one (20 pts).
    const state = makeState({
      hands: [
        [
          c("K", "hearts"),
          c("Q", "hearts"),
          c("K", "clubs"),
          c("Q", "clubs"),
          c("9", "spades"),
          c("10", "diamonds"),
        ],
        makeState().hands[1],
      ],
    });
    const action = chooseAction(state, 0, createRng(1));
    expect(action.type).toBe("declareMarriage");
    if (action.type === "declareMarriage") {
      expect(action.card.suit).toBe("clubs"); // trump suit in this deal
    }
  });
});

describe("createAiPlayer", () => {
  it("wraps chooseAction for the given seat", () => {
    const state = makeState({ points: [90, 0], tricksWon: [5, 0] });
    const ai = createAiPlayer(0, "easy", createRng(1));
    expect(ai.player).toBe(0);
    expect(ai.difficulty).toBe("easy");
    expect(ai.chooseAction(state)).toEqual({ type: "declareSixtySix" });
  });
});
