import type { Rng } from "./rng";

/** Card suit and rank */

export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank = "9" | "J" | "Q" | "K" | "10" | "A";

export const RANK_POINTS: Readonly<Record<Rank, number>> = {
  "9": 0,
  J: 2,
  Q: 3,
  K: 4,
  "10": 10,
  A: 11,
};

export const RANK_ORDER: Readonly<Record<Rank, number>> = {
  "9": 0,
  J: 1,
  Q: 2,
  K: 3,
  "10": 4,
  A: 5,
};

/** Deck  */

export type DeckType = {
  readonly suits: Suit[];
  readonly ranks: Rank[];
};

/** Card - single interface with suit and rank */

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

export function cardId(card: Card): string {
  return `${card.rank}-${card.suit}`;
}

export function cardsEqual(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** Deck - array of cards */

export function createDeck(deckType: DeckType): Card[] {
  const deck: Card[] = [];
  for (const suit of deckType.suits) {
    for (const rank of deckType.ranks) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

export function shuffleDeck(deck: readonly Card[], rng: Rng): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** Deal - game state for cards */

export interface Deal {
  readonly nonDealerHand: Card[];
  readonly dealerHand: Card[];

  readonly trumpCard: Card;
  readonly trumpSuit: Suit;

  // Stock excludes the trump card, which sits face up beneath it.
  // Top of stock is index 0 (next card to be drawn).
  readonly stock: Card[];
}

// Deals 6 cards each in two packets of 3 (non-dealer first), turns up the
// next card as trump, and leaves the remainder as the stock
export function deal(shuffledDeck: readonly Card[]): Deal {
  const nonDealerHand: Card[] = [];
  const dealerHand: Card[] = [];
  let cursor = 0;

  for (let packet = 0; packet < 2; packet++) {
    nonDealerHand.push(...shuffledDeck.slice(cursor, cursor + 3));
    cursor += 3;
    dealerHand.push(...shuffledDeck.slice(cursor, cursor + 3));
    cursor += 3;
  }

  const trumpCard = shuffledDeck[cursor];
  cursor += 1;
  const stock = shuffledDeck.slice(cursor);

  return {
    nonDealerHand,
    dealerHand,
    trumpCard,
    trumpSuit: trumpCard.suit,
    stock,
  };
}
