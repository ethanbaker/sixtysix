import type { AiActionScore, AiDebugInfo } from "../../ai/player";
import { actionKey } from "../../ai/search";
import type { Card, Suit } from "../../core/deck";
import type { Call } from "../../core/rules";
import type { PlayerId } from "../../core/state";
import type { StandardAction } from "../../game/standard";
import styles from "../styles.module.css";

interface AiDebugPanelProps {
  decision: { player: PlayerId; debug: AiDebugInfo } | null;
  playerLabels: readonly [string, string];
  visible: boolean;
  onToggle: () => void;
}

const SUIT_SYMBOLS: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

const CALL_LABELS: Record<Call, string> = {
  "close-stock": "Close stock",
  sixtysix: "Declare 66",
  big: "Declare big",
  small: "Declare small",
};

function describeCard(card: Card): string {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

function describeAction(action: StandardAction): string {
  switch (action.type) {
    case "play":
      return `Play ${describeCard(action.card)}`;
    case "marriage":
      return `Marriage ${describeCard(action.card)}`;
    case "exchange-trump":
      return "Trump exchange";
    case "call":
      return CALL_LABELS[action.call];
  }
}

const MAX_CANDIDATES_SHOWN = 6;

// Dev-only panel showing the last AI decision: difficulty, samples/depth
// actually used, and every candidate action it scored (best first) —
// CLAUDE.md Section 6: "a debug panel showing sampled determinizations
// and search scores... useful for development, can be hidden behind a
// dev flag."
export function AiDebugPanel({ decision, playerLabels, visible, onToggle }: AiDebugPanelProps) {
  return (
    <div className={styles.debugPanel}>
      <button type="button" className={styles.debugToggle} onClick={onToggle}>
        {visible ? "Hide" : "Show"} AI debug
      </button>
      {visible && (
        <div className={styles.debugBody}>
          {!decision ? (
            <p>No AI decision yet.</p>
          ) : (
            <>
              <p>
                <strong>{playerLabels[decision.player]}</strong> ({decision.debug.difficulty}) — {decision.debug.samplesUsed} sample
                {decision.debug.samplesUsed === 1 ? "" : "s"}, depth {decision.debug.depthUsed}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {decision.debug.candidates.slice(0, MAX_CANDIDATES_SHOWN).map((candidate: AiActionScore, index: number) => (
                    <tr key={actionKey(candidate.action)} className={index === 0 ? styles.debugTopCandidate : undefined}>
                      <td>{describeAction(candidate.action)}</td>
                      <td>{candidate.value.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {decision.debug.candidates.length > MAX_CANDIDATES_SHOWN && <p>…and {decision.debug.candidates.length - MAX_CANDIDATES_SHOWN} more</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
