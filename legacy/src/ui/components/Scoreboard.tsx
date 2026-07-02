import type { GameState } from "../../core/state";
import type { MatchState } from "../../core/closing";
import styles from "../styles.module.css";

interface ScoreboardProps {
  hand: GameState;
  match: MatchState;
}

export function Scoreboard({ hand, match }: ScoreboardProps) {
  return (
    <div className={styles.panel}>
      <h3>Score</h3>
      {([0, 1] as const).map((player) => (
        <div key={player} className={styles.scoreRow}>
          <span>Player {player + 1}</span>
          <span>
            {hand.points[player]} card pts · {hand.bankedMarriagePoints[player]} banked
            {hand.pendingMarriagePoints[player] > 0
              ? ` (+${hand.pendingMarriagePoints[player]} pending)`
              : ""}{" "}
            · {hand.tricksWon[player]} tricks
          </span>
        </div>
      ))}
      <div className={styles.scoreRow}>
        <span>Match score</span>
        <span>
          {match.matchScore[0]} – {match.matchScore[1]}
        </span>
      </div>
    </div>
  );
}
