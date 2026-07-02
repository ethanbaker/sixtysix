import type { PlayerId } from "../../core/state";
import type { Difficulty } from "../../ai/player";
import type { SeatConfig } from "../../game/match";
import styles from "../styles.module.css";

interface SeatSetupProps {
  seats: readonly [SeatConfig, SeatConfig];
  playerLabels: readonly [string, string];
  onSeatChange: (seat: PlayerId, config: SeatConfig) => void;
  onStart: () => void;
  onStartFastForward: () => void;
}

type SeatOption = "human" | Difficulty;

const SEAT_OPTIONS: readonly { value: SeatOption; label: string }[] = [
  { value: "human", label: "Human" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

function seatConfigToOption(config: SeatConfig): SeatOption {
  return config.type === "human" ? "human" : config.difficulty;
}

function optionToSeatConfig(option: SeatOption): SeatConfig {
  return option === "human" ? { type: "human" } : { type: "ai", difficulty: option };
}

// Per-seat Human/Easy/Medium/Hard configuration (CLAUDE.md Section 4.6),
// shown before a match starts.
export function SeatSetup({
  seats,
  playerLabels,
  onSeatChange,
  onStart,
  onStartFastForward,
}: SeatSetupProps) {
  const bothAi = seats[0].type === "ai" && seats[1].type === "ai";

  return (
    <div className={styles.overlay}>
      <h2>Sixty-Six</h2>
      {([0, 1] as const).map((seat) => (
        <div key={seat} className={styles.scoreRow}>
          <span>{playerLabels[seat]}</span>
          <select
            value={seatConfigToOption(seats[seat])}
            onChange={(e) => onSeatChange(seat, optionToSeatConfig(e.target.value as SeatOption))}
          >
            {SEAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button type="button" onClick={onStart}>
        Start match
      </button>
      {bothAi && (
        <button type="button" onClick={onStartFastForward}>
          Fast-forward entire match (Computer vs Computer)
        </button>
      )}
    </div>
  );
}
