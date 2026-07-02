import type { GameState } from "../../core/state";
import { isClosedPhase } from "../../core/rules";
import { CardButton } from "./CardView";
import styles from "../styles.module.css";

interface StockInfoProps {
  hand: GameState;
}

export function StockInfo({ hand }: StockInfoProps) {
  const closed = isClosedPhase(hand);
  return (
    <div className={styles.panel}>
      <h3>Stock</h3>
      <div className={styles.scoreRow}>
        <span>Trump suit</span>
        <span>{hand.trumpSuit}</span>
      </div>
      <div className={styles.scoreRow}>
        <span>Face-up trump card</span>
        {hand.trumpCard ? <CardButton card={hand.trumpCard} disabled /> : <span>—</span>}
      </div>
      <div className={styles.scoreRow}>
        <span>Cards left in stock</span>
        <span>{hand.stock.length}</span>
      </div>
      <div className={styles.scoreRow}>
        <span>Status</span>
        <span>
          {hand.earlyEndBy !== null
            ? `Closed by Player ${hand.earlyEndBy + 1}`
            : closed
              ? "Exhausted"
              : "Open"}
        </span>
      </div>
    </div>
  );
}
