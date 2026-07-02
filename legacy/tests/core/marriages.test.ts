import { describe, expect, it } from "vitest";
import type { Card, Deal } from "../../src/core/deck";
import { availableMarriages } from "../../src/core/marriages";
import { canExchangeTrumpNine } from "../../src/core/rules";
import {
  createInitialState,
  declareMarriage,
  exchangeTrumpNine,
  playCard,
} from "../../src/core/state";
import type { GameState } from "../../src/core/state";

const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    nonDealerHand: [
      c("K", "hearts"),
      c("Q", "hearts"),
      c("9", "clubs"),
      c("J", "diamonds"),
      c("K", "clubs"),
      c("Q", "clubs"),
    ],
    dealerHand: [
      c("9", "hearts"),
      c("A", "hearts"),
      c("A", "clubs"),
      c("K", "diamonds"),
      c("J", "spades"),
      c("9", "spades"),
    ],
    trumpCard: c("10", "clubs"),
    trumpSuit: "clubs",
    stock: [
      c("Q", "diamonds"),
      c("10", "diamonds"),
      c("9", "diamonds"),
      c("J", "hearts"),
      c("A", "diamonds"),
      c("10", "hearts"),
      c("J", "clubs"),
      c("Q", "spades"),
      c("A", "spades"),
      c("10", "spades"),
      c("K", "spades"),
    ],
    ...overrides,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const base = createInitialState(makeDeal(), 0);
  return { ...base, ...overrides };
}

describe("marriage scoring", () => {
  it("plain-suit marriage is worth 20 points, credited as pending", () => {
    const state = makeState();
    const next = declareMarriage(state, 0, c("K", "hearts"));
    expect(next.pendingMarriagePoints[0]).toBe(20);
    expect(next.bankedMarriagePoints[0]).toBe(0);
  });

  it("trump-suit marriage is worth 40 points", () => {
    const state = makeState();
    const next = declareMarriage(state, 0, c("K", "clubs"));
    expect(next.pendingMarriagePoints[0]).toBe(40);
  });

  it("leads the declared card and removes only it from hand", () => {
    const state = makeState();
    const next = declareMarriage(state, 0, c("Q", "hearts"));
    expect(next.trick).toEqual([{ player: 0, card: c("Q", "hearts") }]);
    expect(next.hands[0]).toHaveLength(5);
    // The King of hearts is still in hand — only the led card is removed.
    expect(next.hands[0]).toContainEqual(c("K", "hearts"));
    expect(next.turn).toBe(1);
  });
});

describe("marriage pending vs banked timing", () => {
  it("declared, trick lost: points stay pending, not banked", () => {
    let state = makeState();
    state = declareMarriage(state, 0, c("K", "hearts")); // 20 pts pending for player 0
    // Dealer follows with trump and steals the trick.
    state = playCard(state, 1, c("A", "clubs"));
    expect(state.tricksWon[0]).toBe(0);
    expect(state.tricksWon[1]).toBe(1);
    expect(state.pendingMarriagePoints[0]).toBe(20);
    expect(state.bankedMarriagePoints[0]).toBe(0);

    // Player 0 still has no banked marriage points reflected in score.
    expect(state.bankedMarriagePoints[0]).toBe(0);

    // Now player 1 leads and player 0 wins the next trick.
    state = playCard(state, 1, c("9", "hearts"));
    state = playCard(state, 0, c("9", "clubs"));
    // 9 clubs is trump and beats 9 hearts (non-trump) -> player 0 wins.
    expect(state.tricksWon[0]).toBe(1);
    expect(state.pendingMarriagePoints[0]).toBe(0);
    expect(state.bankedMarriagePoints[0]).toBe(20);
  });

  it("marriage declared after already winning a trick banks immediately", () => {
    let state = makeState();
    // Player 0 wins a trick first using a non-marriage card.
    state = playCard(state, 0, c("9", "clubs")); // trump lead
    state = playCard(state, 1, c("9", "hearts")); // loses to trump
    expect(state.tricksWon[0]).toBe(1);

    // Now declare a marriage; since they've already won a trick, it banks now.
    state = declareMarriage(state, 0, c("K", "hearts"));
    expect(state.pendingMarriagePoints[0]).toBe(0);
    expect(state.bankedMarriagePoints[0]).toBe(20);
  });
});

describe("illegal marriage attempts", () => {
  it("rejects declaring without holding both King and Queen of the suit", () => {
    const state = makeState();
    // Player 0 has K hearts but not Q diamonds.
    expect(() => declareMarriage(state, 0, c("K", "diamonds"))).toThrow();
  });

  it("rejects declaring when not on lead (mid-trick)", () => {
    let state = makeState();
    state = playCard(state, 0, c("J", "diamonds")); // leads a plain card
    // Player 1 is now to follow, not lead — cannot declare.
    expect(() => declareMarriage(state, 1, c("K", "diamonds"))).toThrow();
  });

  it("rejects declaring out of turn", () => {
    const state = makeState();
    // A King/Queen card so the rejection is specifically about turn order,
    // not the rank check.
    expect(() => declareMarriage(state, 1, c("K", "diamonds"))).toThrow();
  });

  it("rejects a card that isn't a King or Queen", () => {
    const state = makeState();
    expect(() => declareMarriage(state, 0, c("9", "clubs"))).toThrow();
  });

  it("availableMarriages reflects exactly the declarable suits", () => {
    const state = makeState();
    expect(availableMarriages(state, 0).sort()).toEqual(["clubs", "hearts"]);
    expect(availableMarriages(state, 1)).toEqual([]);
  });
});

describe("trump exchange", () => {
  function stateReadyForExchange(): GameState {
    // Player 0 has already won a trick and holds the trump 9, on lead,
    // no cards in play.
    const state = makeState({
      hands: [
        [c("9", "clubs"), c("J", "diamonds"), c("K", "clubs"), c("Q", "clubs")],
        [c("A", "clubs"), c("K", "diamonds"), c("J", "spades"), c("9", "spades")],
      ],
      tricksWon: [1, 0],
    });
    return state;
  }

  it("happy path: swaps the trump 9 for the face-up trump card", () => {
    const state = stateReadyForExchange();
    expect(canExchangeTrumpNine(state, 0)).toBe(true);
    const next = exchangeTrumpNine(state, 0);
    expect(next.trumpCard).toEqual(c("9", "clubs"));
    expect(next.hands[0]).toContainEqual(c("10", "clubs")); // the old face-up card
    expect(next.hands[0]).not.toContainEqual(c("9", "clubs"));
    expect(next.hands[0]).toHaveLength(4);
  });

  it("rejected: not on lead / cards in play", () => {
    let state = stateReadyForExchange();
    state = playCard(state, 0, c("J", "diamonds")); // now mid-trick
    expect(canExchangeTrumpNine(state, 0)).toBe(false);
    expect(() => exchangeTrumpNine(state, 0)).toThrow();
  });

  it("rejected: hasn't won a trick yet", () => {
    const state = stateReadyForExchange();
    const noWinsYet: GameState = { ...state, tricksWon: [0, 0] };
    expect(canExchangeTrumpNine(noWinsYet, 0)).toBe(false);
    expect(() => exchangeTrumpNine(noWinsYet, 0)).toThrow();
  });

  it("rejected: doesn't hold the trump 9", () => {
    const state = stateReadyForExchange();
    const noNine: GameState = {
      ...state,
      hands: [
        [c("J", "diamonds"), c("K", "clubs"), c("Q", "clubs"), c("10", "hearts")],
        state.hands[1],
      ],
    };
    expect(canExchangeTrumpNine(noNine, 0)).toBe(false);
    expect(() => exchangeTrumpNine(noNine, 0)).toThrow();
  });

  it("rejected: no face-up trump card left to exchange for", () => {
    const state = stateReadyForExchange();
    const noTrumpCard: GameState = { ...state, trumpCard: null };
    expect(canExchangeTrumpNine(noTrumpCard, 0)).toBe(false);
    expect(() => exchangeTrumpNine(noTrumpCard, 0)).toThrow();
  });

  it("rejected for the wrong player (out of turn)", () => {
    const state = stateReadyForExchange();
    expect(canExchangeTrumpNine(state, 1)).toBe(false);
    expect(() => exchangeTrumpNine(state, 1)).toThrow();
  });
});
