import { describe, expect, it } from "vitest";
import {
  RANK_POINTS,
  RANKS,
  SUITS,
  cardId,
  cardsEqual,
  createDeck,
  deal,
  shuffleDeck,
} from "../../src/core/deck";
import type { Card } from "../../src/core/deck";
import { createRng } from "../../src/core/rng";

describe("createDeck", () => {
  it("has 24 cards", () => {
    expect(createDeck()).toHaveLength(24);
  });

  it("has 6 distinct ranks across 4 suits with no duplicates", () => {
    const deck = createDeck();
    const ids = new Set(deck.map(cardId));
    expect(ids.size).toBe(24);
    for (const suit of SUITS) {
      const inSuit = deck.filter((c) => c.suit === suit);
      expect(inSuit).toHaveLength(6);
      expect(new Set(inSuit.map((c) => c.rank)).size).toBe(6);
    }
  });

  it("totals 120 points across the deck", () => {
    const deck = createDeck();
    const total = deck.reduce((sum, c) => sum + RANK_POINTS[c.rank], 0);
    expect(total).toBe(120);
  });

  it("assigns the correct point value per rank", () => {
    expect(RANK_POINTS.A).toBe(11);
    expect(RANK_POINTS["10"]).toBe(10);
    expect(RANK_POINTS.K).toBe(4);
    expect(RANK_POINTS.Q).toBe(3);
    expect(RANK_POINTS.J).toBe(2);
    expect(RANK_POINTS["9"]).toBe(0);
  });

  it("includes every rank exactly once per suit", () => {
    const deck = createDeck();
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        expect(
          deck.filter((c) => c.suit === suit && c.rank === rank),
        ).toHaveLength(1);
      }
    }
  });
});

describe("cardsEqual / cardId", () => {
  it("treats identical suit+rank as equal", () => {
    const a: Card = { suit: "hearts", rank: "A" };
    const b: Card = { suit: "hearts", rank: "A" };
    expect(cardsEqual(a, b)).toBe(true);
    expect(cardId(a)).toBe(cardId(b));
  });

  it("treats different suit or rank as not equal", () => {
    const a: Card = { suit: "hearts", rank: "A" };
    const b: Card = { suit: "spades", rank: "A" };
    const c: Card = { suit: "hearts", rank: "K" };
    expect(cardsEqual(a, b)).toBe(false);
    expect(cardsEqual(a, c)).toBe(false);
  });
});

describe("createRng / shuffleDeck", () => {
  it("is deterministic for a given seed", () => {
    const deck = createDeck();
    const a = shuffleDeck(deck, createRng(42));
    const b = shuffleDeck(deck, createRng(42));
    expect(a.map(cardId)).toEqual(b.map(cardId));
  });

  it("produces different orderings for different seeds (sanity check)", () => {
    const deck = createDeck();
    const a = shuffleDeck(deck, createRng(1));
    const b = shuffleDeck(deck, createRng(2));
    expect(a.map(cardId)).not.toEqual(b.map(cardId));
  });

  it("does not mutate the input deck and preserves all cards", () => {
    const deck = createDeck();
    const originalIds = deck.map(cardId);
    const shuffled = shuffleDeck(deck, createRng(7));
    expect(deck.map(cardId)).toEqual(originalIds);
    expect(new Set(shuffled.map(cardId))).toEqual(new Set(originalIds));
    expect(shuffled).toHaveLength(24);
  });
});

describe("deal", () => {
  it("deals 6 cards to each player", () => {
    const shuffled = shuffleDeck(createDeck(), createRng(1));
    const { nonDealerHand, dealerHand } = deal(shuffled);
    expect(nonDealerHand).toHaveLength(6);
    expect(dealerHand).toHaveLength(6);
  });

  it("deals in two packets of three, non-dealer first", () => {
    const shuffled = shuffleDeck(createDeck(), createRng(1));
    const { nonDealerHand, dealerHand } = deal(shuffled);
    // First packet: cards 0-2 to non-dealer, 3-5 to dealer.
    expect(nonDealerHand.slice(0, 3).map(cardId)).toEqual(
      shuffled.slice(0, 3).map(cardId),
    );
    expect(dealerHand.slice(0, 3).map(cardId)).toEqual(
      shuffled.slice(3, 6).map(cardId),
    );
    // Second packet: cards 6-8 to non-dealer, 9-11 to dealer.
    expect(nonDealerHand.slice(3, 6).map(cardId)).toEqual(
      shuffled.slice(6, 9).map(cardId),
    );
    expect(dealerHand.slice(3, 6).map(cardId)).toEqual(
      shuffled.slice(9, 12).map(cardId),
    );
  });

  it("turns up the next card as trump and sets trumpSuit accordingly", () => {
    const shuffled = shuffleDeck(createDeck(), createRng(3));
    const { trumpCard, trumpSuit } = deal(shuffled);
    expect(cardsEqual(trumpCard, shuffled[12])).toBe(true);
    expect(trumpSuit).toBe(trumpCard.suit);
  });

  it("puts the remaining 11 cards in the stock, in original order", () => {
    const shuffled = shuffleDeck(createDeck(), createRng(3));
    const { stock } = deal(shuffled);
    expect(stock).toHaveLength(11);
    expect(stock.map(cardId)).toEqual(shuffled.slice(13).map(cardId));
  });

  it("accounts for all 24 cards with no duplicates across hands/trump/stock", () => {
    const shuffled = shuffleDeck(createDeck(), createRng(99));
    const { nonDealerHand, dealerHand, trumpCard, stock } = deal(shuffled);
    const all = [...nonDealerHand, ...dealerHand, trumpCard, ...stock];
    expect(all).toHaveLength(24);
    expect(new Set(all.map(cardId)).size).toBe(24);
  });

  it("throws if given a deck that isn't exactly 24 cards", () => {
    const shuffled = shuffleDeck(createDeck(), createRng(1));
    expect(() => deal(shuffled.slice(0, 23))).toThrow();
    expect(() => deal([...shuffled, shuffled[0]])).toThrow();
  });
});
