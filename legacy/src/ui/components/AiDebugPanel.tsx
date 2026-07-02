import type { Card, Suit } from "../../core/deck";
import type { AiAction, AiActionScore, AiDebugInfo } from "../../ai/player";
import type { PlayerId } from "../../core/state";
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

function describeCard(card: Card): string {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

function describeAction(action: AiAction): string {
  switch (action.type) {
    case "playCard":
      return `Play ${describeCard(action.card)}`;
    case "declareMarriage":
      return `Marriage ${describeCard(action.card)}`;
    case "exchangeTrumpNine":
      return "Trump exchange";
    case "closeStock":
      return "Close stock";
    case "declareSixtySix":
      return "Declare 66";
  }
}

const MAX_CANDIDATES_SHOWN = 6;

// Dev-only panel showing the last AI decision: difficulty, samples/depth
// actually used, and every candidate action it scored (best first) —
// CLAUDE.md Section 6: "a debug panel showing sampled determinizations
// and search scores... useful for development, can be hidden behind a
// dev flag." Not rendered at all in production builds; see App.tsx's
// `import.meta.env.DEV` gate around this component.
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
                <strong>{playerLabels[decision.player]}</strong> ({decision.debug.difficulty}) —{" "}
                {decision.debug.samplesUsed} sample{decision.debug.samplesUsed === 1 ? "" : "s"}, depth{" "}
                {decision.debug.depthUsed}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {decision.debug.candidates
                    .slice(0, MAX_CANDIDATES_SHOWN)
                    .map((candidate: AiActionScore, index: number) => (
                      <tr
                        key={`${candidate.action.type}-${
                          "card" in candidate.action
                            ? `${candidate.action.card.rank}${candidate.action.card.suit}`
                            : ""
                        }`}
                        className={index === 0 ? styles.debugTopCandidate : undefined}
                      >
                        <td>{describeAction(candidate.action)}</td>
                        <td>{candidate.score.toFixed(1)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {decision.debug.candidates.length > MAX_CANDIDATES_SHOWN && (
                <p>…and {decision.debug.candidates.length - MAX_CANDIDATES_SHOWN} more</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
