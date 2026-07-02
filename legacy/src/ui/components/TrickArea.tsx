import type { PlayedCard, PlayerId } from "../../core/state";
import { CardButton } from "./CardView";
import styles from "../styles.module.css";

// A just-resolved trick, kept around by useMatch purely for the visual
// "both cards sit for a moment, then collect toward the winner" beat —
// the underlying GameState has already moved on (points banked, hands
// replenished, next leader's turn) by the time this exists.
export interface TrickAnimationState {
  readonly cards: readonly PlayedCard[];
  readonly winner: PlayerId;
  readonly collecting: boolean;
}

interface TrickAreaProps {
  trick: readonly PlayedCard[];
  playerLabels: readonly [string, string];
  animation?: TrickAnimationState | null;
}

// Shows the cards currently on the table. Never shows past tricks'
// contents — those are collected face down and aren't re-examinable
// (CLAUDE.md Section 3.2) — `animation` is the one deliberate exception,
// and only for the trick that *just* resolved, purely as a visual beat.
export function TrickArea({ trick, playerLabels, animation }: TrickAreaProps) {
  const displayed = animation ? animation.cards : trick;
  // Player 2's hand renders above the trick area, Player 1's below (see
  // App.tsx), so collecting "up" means player 1 (index 1) won, "down"
  // means player 0 won.
  const collectClass = animation?.collecting
    ? animation.winner === 1
      ? styles.trickCollectUp
      : styles.trickCollectDown
    : styles.trickCardIn;

  return (
    <div className={styles.trick}>
      {displayed.length === 0 && <span>No cards in play</span>}
      {displayed.map((played) => (
        <div
          key={`${played.player}-${played.card.rank}-${played.card.suit}`}
          className={styles.trickSlot}
        >
          <span>{playerLabels[played.player]}</span>
          <CardButton card={played.card} disabled animationClassName={collectClass} />
        </div>
      ))}
    </div>
  );
}
