import type { Card } from "../../core/deck";
import { cardsEqual } from "../../core/deck";
import { CardButton } from "./CardView";
import styles from "../styles.module.css";

interface PlayerHandProps {
  cards: readonly Card[];
  legalCards: readonly Card[];
  onPlay: (card: Card) => void;
}

// Renders a hand face-up (local hands-across-the-table play — see
// CLAUDE.md Section 6). Cards are only clickable when they're in
// `legalCards`; everything else is shown but disabled rather than
// letting a click fail.
export function PlayerHand({ cards, legalCards, onPlay }: PlayerHandProps) {
  return (
    <div className={styles.handRow}>
      {cards.map((card) => {
        const isLegal = legalCards.some((c) => cardsEqual(c, card));
        return (
          <CardButton
            key={`${card.rank}-${card.suit}`}
            card={card}
            disabled={!isLegal}
            onClick={isLegal ? () => onPlay(card) : undefined}
          />
        );
      })}
    </div>
  );
}
