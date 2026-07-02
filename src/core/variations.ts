/** Deck types */

import type { DeckType } from "./deck";
import type { GameOptions } from "./state";

export const STANDARD_DECK: DeckType = {
  suits: ["clubs", "diamonds", "hearts", "spades"],
  ranks: ["9", "J", "Q", "K", "10", "A"],
};

export const ROMANIAN_DECK: DeckType = {
  suits: ["clubs", "diamonds", "hearts", "spades"],
  ranks: ["J", "Q", "K", "10", "A"],
};

/** Game options */

export const STANDARD_GAME_OPTIONS: GameOptions = {
  deckType: STANDARD_DECK,
  pendingMarriages: true,
  trickRequirementForTrumpSwap: 1,
  lastStockPointBonus: 10,
  allowBeginningCalls: false,
  allowSixtySixCalls: true,
  allowClosingStock: true,
};

export const ROMANIAN_GAME_OPTIONS: GameOptions = {
  deckType: ROMANIAN_DECK,
  pendingMarriages: false,
  trickRequirementForTrumpSwap: 1,
  lastStockPointBonus: 0,
  allowBeginningCalls: true,
  allowSixtySixCalls: true,
  allowClosingStock: false,
};
