// Headless CPU-vs-CPU match simulator (CLAUDE.md Section 4.6 / step 8).
// Not a user-facing feature -- a small tool for balance-testing/tuning
// the AI weights and difficulty presets by running many full matches
// between two configured seats and reporting win rates.
//
// Usage:
//   npm run simulate -- --a=hard --b=easy --matches=100
//   npm run simulate -- --a=medium --b=hard --matches=200 --depth=3 --samples=15
//
// Flags:
//   --a, --b        difficulty for each seat: easy | medium | hard (default: hard, easy)
//   --matches       number of full matches to play (default: 50)
//   --depth         override AiConfig.depth for both AI seats (default: preset)
//   --samples       override AiConfig.samples for both AI seats (default: preset)
//   --seed          base RNG seed (default: derived from current time)

import { createAiPlayer } from "../../src/ai/player";
import type { PlayerId } from "../../src/core/state";

function parseArgs(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-zA-Z]+)=(.+)$/.exec(arg);
    if (match) args.set(match[1], match[2]);
  }
  return args;
}

function isDifficulty(value: string): value is Difficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

function parseDifficulty(value: string | undefined, fallback: Difficulty): Difficulty {
  if (value === undefined) return fallback;
  if (!isDifficulty(value)) {
    throw new Error(`Invalid difficulty "${value}" (expected easy|medium|hard)`);
  }
  return value;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const difficultyA = parseDifficulty(args.get("a"), "hard");
  const difficultyB = parseDifficulty(args.get("b"), "easy");
  const matchCount = Number(args.get("matches") ?? 50);
  const seed = Number(args.get("seed") ?? Date.now());

  const configOverride: Partial<AiConfig> = {
    ...(args.has("depth") ? { depth: Number(args.get("depth")) } : {}),
    ...(args.has("samples") ? { samples: Number(args.get("samples")) } : {}),
  };

  console.log(
    `Simulating ${matchCount} matches: seat A = ${difficultyA}` +
      `${(configOverride.depth ?? configOverride.samples) ? ` (${JSON.stringify(configOverride)})` : ""} ` +
      `vs seat B = ${difficultyB}, seed=${seed}`,
  );

  let aWins = 0;
  let bWins = 0;
  let totalHands = 0;
  const start = Date.now();

  for (let i = 0; i < matchCount; i++) {
    // Alternate which physical seat (0/1) is "A" so dealer-order
    // advantages cancel out across the run.
    const aSeat: PlayerId = i % 2 === 0 ? 0 : 1;
    const bSeat: PlayerId = aSeat === 0 ? 1 : 0;

    const rng: Rng = createRng(seed + i);
    const players: [ReturnType<typeof createAiPlayer>, ReturnType<typeof createAiPlayer>] = [
      createAiPlayer(0, aSeat === 0 ? difficultyA : difficultyB, createRng(rng() * 0xffffffff), configOverride),
      createAiPlayer(1, aSeat === 1 ? difficultyA : difficultyB, createRng(rng() * 0xffffffff), configOverride),
    ];

    const initial = createMatch((i % 2) as PlayerId, rng);
    const result = simulateMatch(initial, players, rng);

    totalHands += result.handSummaries.length;
    if (result.finalSession.match.matchWinner === aSeat) aWins += 1;
    else if (result.finalSession.match.matchWinner === bSeat) bWins += 1;
  }

  const elapsedMs = Date.now() - start;
  const decided = aWins + bWins;
  const aRate = decided > 0 ? (aWins / decided) * 100 : 0;

  console.log(`A (${difficultyA}) won ${aWins}/${matchCount} (${aRate.toFixed(1)}%)`);
  console.log(`B (${difficultyB}) won ${bWins}/${matchCount} (${(100 - aRate).toFixed(1)}%)`);
  console.log(`Average hands/match: ${(totalHands / matchCount).toFixed(1)}`);
  console.log(`Elapsed: ${elapsedMs}ms (${(elapsedMs / matchCount).toFixed(1)}ms/match)`);
}

main();
