import type { SimulatedMatch } from "../../game/match";
import styles from "../styles.module.css";

interface FastForwardResultProps {
  result: SimulatedMatch;
  playerLabels: readonly [string, string];
  onNewMatch: () => void;
}

// Result-only view for a fast-forwarded Computer-vs-Computer match
// (CLAUDE.md Section 4.6): a hand-by-hand summary and the final score,
// not an animated replay of every card.
export function FastForwardResult({ result, playerLabels, onNewMatch }: FastForwardResultProps) {
  const { finalSession, handSummaries } = result;
  const winner = finalSession.match.matchWinner;

  return (
    <div className={styles.overlay}>
      <h2>
        {winner !== null ? `${playerLabels[winner]} wins the match!` : "Match complete"}
      </h2>
      <p>
        Final score: {finalSession.match.matchScore[0]} – {finalSession.match.matchScore[1]} (
        {handSummaries.length} hand{handSummaries.length === 1 ? "" : "s"})
      </p>
      <table>
        <thead>
          <tr>
            <th>Hand</th>
            <th>Winner</th>
            <th>Game pts</th>
            <th>Card pts</th>
            <th>Score after</th>
          </tr>
        </thead>
        <tbody>
          {handSummaries.map((hand) => (
            <tr key={hand.handNumber}>
              <td>{hand.handNumber + 1}</td>
              <td>{hand.winner !== null ? playerLabels[hand.winner] : "void"}</td>
              <td>{hand.gamePoints}</td>
              <td>
                {hand.cardPoints[0]} – {hand.cardPoints[1]}
              </td>
              <td>
                {hand.matchScoreAfter[0]} – {hand.matchScoreAfter[1]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={onNewMatch}>
        New match
      </button>
    </div>
  );
}
