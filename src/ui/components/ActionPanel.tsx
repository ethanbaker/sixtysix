import type { Card, Suit } from "../../core/deck";
import type { LegalActions } from "../hooks/useMatch";
import styles from "../styles.module.css";

interface ActionPanelProps {
  actions: LegalActions;
  onDeclareMarriage: (card: Card) => void;
  onExchangeTrumpNine: () => void;
  onCloseStock: () => void;
  onDeclareSixtySix: () => void;
  onCallBig: () => void;
  onCallSmall: () => void;
  onPassOpeningCall: () => void;
}

const SUIT_SYMBOLS: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

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
  onCallBig,
  onCallSmall,
  onPassOpeningCall,
}: ActionPanelProps) {
  const canClose = actions.calls.includes("close-stock");
  const canDeclareSixtySix = actions.calls.includes("sixtysix");
  const canCallBig = actions.calls.includes("big");
  const canCallSmall = actions.calls.includes("small");

  const hasAnyAction =
    actions.marriageCards.length > 0 ||
    actions.canExchangeTrump ||
    canClose ||
    canDeclareSixtySix ||
    canCallBig ||
    canCallSmall ||
    actions.canPassOpeningCall;
  if (!hasAnyAction) return null;

  return (
    <div className={styles.actions}>
      {actions.marriageCards.map((card) => (
        <button key={`${card.rank}-${card.suit}`} type="button" onClick={() => onDeclareMarriage(card)}>
          Marriage {SUIT_SYMBOLS[card.suit]} {card.rank}
        </button>
      ))}
      {actions.canExchangeTrump && (
        <button type="button" onClick={onExchangeTrumpNine}>
          Trump exchange
        </button>
      )}
      {canCallBig && (
        <button type="button" onClick={onCallBig}>
          Call Big
        </button>
      )}
      {canCallSmall && (
        <button type="button" onClick={onCallSmall}>
          Call Small
        </button>
      )}
      {canClose && (
        <button type="button" onClick={onCloseStock}>
          Close stock
        </button>
      )}
      {canDeclareSixtySix && (
        <button type="button" onClick={onDeclareSixtySix}>
          Declare 66
        </button>
      )}
      {actions.canPassOpeningCall && (
        <button type="button" onClick={onPassOpeningCall}>
          Pass
        </button>
      )}
    </div>
  );
}
