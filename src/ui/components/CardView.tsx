import type { Card, Suit } from "../../core/deck";
import styles from "../styles.module.css";

const SUIT_SYMBOLS: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

const RED_SUITS: ReadonlySet<Suit> = new Set(["diamonds", "hearts"]);

interface CardButtonProps {
  card: Card;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  animationClassName?: string;
  faceDown?: boolean;
}

// A single playing card, rendered as a button so it's directly clickable
// when it's a legal play; disabled (but still visible) otherwise.
export function CardButton({ card, disabled, onClick, title, animationClassName, faceDown }: CardButtonProps) {
  const colorClass = RED_SUITS.has(card.suit) ? styles.cardRed : styles.cardBlack;
  const faceDownClass = faceDown ? ` ${styles.cardFaceDown}` : "";
  return (
    <button
      type="button"
      className={`${styles.card} ${colorClass}${faceDownClass}${animationClassName ? ` ${animationClassName}` : ""}`}
      disabled={faceDown || (disabled ?? !onClick)}
      onClick={faceDown ? undefined : onClick}
      title={faceDown ? undefined : title}
    >
      {!faceDown && (
        <>
          <span>{card.rank}</span>
          <span>{SUIT_SYMBOLS[card.suit]}</span>
        </>
      )}
    </button>
  );
}
