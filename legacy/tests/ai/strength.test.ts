import { describe, expect, it } from "vitest";
import { createAiPlayer, DIFFICULTY_PRESETS } from "../../src/ai/player";
import { createMatch, playAiTurn } from "../../src/game/match";
import { createRng } from "../../src/core/rng";

// Headless-simulation regression test (CLAUDE.md Section 4.6: "should be
// able to run fast-forward... for simulation/benchmarking"). Not a
// strength *benchmark* in the tuning sense -- just a guard that Hard is
// actually stronger than Easy, not merely legal.
//
// Uses DIFFICULTY_PRESETS.hard directly (depth 2, samples 25) rather than
// a deeper config: see player.ts's DIFFICULTY_PRESETS comment for why
// deeper non-endgame search measurably *hurt* Hard here (compounding
// determinization noise across samples) during this step's tuning pass.
// A relatively large hand count is used because a single hand of 66 has
// real luck variance -- see the step-7/8 summary for the measured
// win rate and its standard error.
const HARD_CONFIG = DIFFICULTY_PRESETS.hard;
const HAND_COUNT = 400;

interface HandTally {
  hardWins: number;
  easyWins: number;
  voids: number;
}

function simulateHands(count: number, seed: number): HandTally {
  const tally: HandTally = { hardWins: 0, easyWins: 0, voids: 0 };

  for (let i = 0; i < count; i++) {
    // Alternate which seat is Hard so dealer/seat-order advantages
    // cancel out across the sample instead of confounding the result.
    const hardSeat = i % 2 === 0 ? 0 : 1;
    const easySeat = hardSeat === 0 ? 1 : 0;
    const rng = createRng(seed * 100_000 + i);

    const players = [
      createAiPlayer(
        0,
        hardSeat === 0 ? "hard" : "easy",
        createRng(rng() * 0xffffffff),
        HARD_CONFIG,
      ),
      createAiPlayer(
        1,
        hardSeat === 1 ? "hard" : "easy",
        createRng(rng() * 0xffffffff),
        HARD_CONFIG,
      ),
    ] as const;

    let session = createMatch((i % 2) as 0 | 1, rng);
    let guard = 0;
    while (!session.hand.handOver) {
      const player = session.hand.turn;
      session = playAiTurn(session, players[player]);
      guard += 1;
      if (guard > 80) throw new Error(`hand ${i}: exceeded a sane turn count`);
    }

    if (session.hand.winner === hardSeat) tally.hardWins += 1;
    else if (session.hand.winner === easySeat) tally.easyWins += 1;
    else tally.voids += 1;
  }

  return tally;
}

describe("Hard vs. Easy strength regression", () => {
  it("Hard wins meaningfully more often than 50% of decided hands", () => {
    const tally = simulateHands(HAND_COUNT, 777);
    const decided = tally.hardWins + tally.easyWins;
    const hardWinRate = tally.hardWins / decided;

    console.log(
      `[strength] ${HAND_COUNT} hands: Hard ${tally.hardWins}, Easy ${tally.easyWins}, ` +
        `void ${tally.voids} -> Hard win rate ${(hardWinRate * 100).toFixed(1)}% of decided hands`,
    );

    expect(decided).toBeGreaterThan(0);
    expect(hardWinRate).toBeGreaterThan(0.5);
  }, 60_000);
});
