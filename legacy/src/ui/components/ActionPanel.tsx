import type { Card, Suit } from "../../core/deck";
import type { LegalActions } from "../../game/match";
import styles from "../styles.module.css";

interface ActionPanelProps {
  actions: LegalActions;
  onDeclareMarriage: (card: Card) => void;
  onExchangeTrumpNine: () => void;
  onCloseStock: () => void;
  onDeclareSixtySix: () => void;
}

const SUIT_SYMBOLS: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

const DEBUG_FLAG = import.meta.env.VITE_DEBUG === "1";

// Buttons for the non-card actions (Section 3.3/3.4/3.5/3.7). Each is
// only rendered when actually legal — see CLAUDE.md's instruction to
// disable/hide rather than let a click error out. Declaring a marriage
// lets the player choose which of the King or Queen to lead, since that
// choice is real strategy (which card is safer to expose to the trick).
export function ActionPanel({
  actions,
  onDeclareMarriage,
  onExchangeTrumpNine,
  onCloseStock,
  onDeclareSixtySix,
}: ActionPanelProps) {
  const hasAnyAction =
    actions.marriageSuits.length > 0 ||
    actions.canExchangeTrumpNine ||
    (actions.canCloseStock && DEBUG_FLAG) ||
    actions.canDeclareSixtySix;

  if (!hasAnyAction) return null;

  return (
    <div className={styles.actions}>
      {actions.marriageSuits.map((suit) => (
        <span key={suit} className={styles.marriageChoice}>
          <button
            type="button"
            onClick={() => onDeclareMarriage({ rank: "K", suit })}
          >
            Marriage {SUIT_SYMBOLS[suit]} K
          </button>
          <button
            type="button"
            onClick={() => onDeclareMarriage({ rank: "Q", suit })}
          >
            Marriage {SUIT_SYMBOLS[suit]} Q
          </button>
        </span>
      ))}
      {actions.canExchangeTrumpNine && (
        <button type="button" onClick={onExchangeTrumpNine}>
          Trump exchange
        </button>
      )}
      {actions.canCloseStock && DEBUG_FLAG && (
        <button type="button" onClick={onCloseStock}>
          Close stock
        </button>
      )}
      {actions.canDeclareSixtySix && (
        <button type="button" onClick={onDeclareSixtySix}>
          Declare 66
        </button>
      )}
    </div>
  );
}
