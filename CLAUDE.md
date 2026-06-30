# CLAUDE.md — Sixty-Six Card Game

This file gives Claude Code the context, rules, architecture, and conventions
needed to build this project. Read this fully before writing code.

## 1. Project Summary

A browser-based implementation of **Sixty-Six** (German: *Sechsundsechzig*),
the classic 2-player, 24-card, point-trick game. The project must support:

- A playable web UI (human vs human is optional/free; not a requirement)
- **Human vs Computer**
- **Computer vs Computer** (for testing/spectating/benchmarking the AI)
- A computer opponent that evaluates game state and plays proactively
  (not just legally), with a **difficulty setting**

This document is the source of truth for game rules and architecture.
If an implementation detail is ambiguous, follow the rules in Section 3
exactly rather than guessing or borrowing from Schnapsen/other variants.

## 2. Tech Stack

**TypeScript only.** No backend, no database, no network play.

| Concern | Choice |
|---|---|
| Language | TypeScript (strict mode) |
| UI framework | React + Vite |
| Styling | CSS Modules (keep it simple, no heavy design system) |
| State management | Plain React state / a small reducer — do **not** pull in Redux for this |
| Testing | Vitest (unit tests for rules engine and AI are mandatory) |
| Package manager | npm |
| Structure | Single npm package, organized by folder (see Section 5) — do not split into a monorepo/workspaces unless the codebase genuinely outgrows it |

## 3. Game Rules (Authoritative Spec)

Implement the **standard 2-player game**, not the North American 4-player
partnership variant.

### 3.1 Setup
- 24-card deck: A, 10, K, Q, J, 9 in each of 4 suits.
- Card point values: **A=11, 10=10, K=4, Q=3, J=2, 9=0** (total 120 pts in deck).
- Deal 6 cards each, in two packets of 3, non-dealer first.
- Turn up the next card to fix the **trump suit**; place it face up, and put
  the rest of the deck crosswise on top of it as the **stock (talon)**.
- Non-dealer leads the first trick.

### 3.2 Trick play (while the stock has cards remaining)
- No obligation to follow suit or to trump during this phase.
- Highest card of the suit led wins, **unless** a trump is played, in which
  case the highest trump played wins.
- Trick winner collects both cards' point values, places trick face down
  (not re-examinable by either player in the UI either — don't show past
  tricks' contents in a way that gives the human extra info the rules deny
  them, though see Section 3.6 on UI fairness).
- After the trick: winner draws the top stock card first, then loser draws
  the next card, both hands return to 6 cards.
- Winner of the trick leads next.

### 3.3 Trump exchange
- A player holding the trump 9 may, **only when they are on lead, have won
  at least one trick already, and no cards are currently in play (i.e.
  right after both hands have been replenished)**, exchange their trump 9
  for the face-up trump card under the stock.

### 3.4 Marriages (Königspaar/Bell)
- On a player's turn, while leading, they may declare and lead either card
  of a King+Queen pair of the same suit they hold both cards of.
- Plain-suit marriage = 20 points. Trump-suit marriage = 40 points.
- Marriage points only count toward the player's score once that player
  has won **at least one trick** (the points are "banked" pending that).
- A marriage may only be declared once per pair, naturally, since playing
  the card commits it to a trick.

### 3.5 Closing the stock
- A player **on lead** may close the stock at any point (turn the face-up
  trump card over), instead of/before leading their card, if they believe
  their points (current + marriages) can reach 66 under closed-stock rules.
- Once closed (or once the stock naturally runs out — see 3.6), the rules
  tighten:
  - Players **must follow suit**, and **must beat the card led if able**.
  - If unable to follow suit, the player **must trump** if able.
  - **No new marriages may be declared.**
  - No further drawing from the stock.
- If the closer reaches 66 first → they score game points (3.7).
- If the closer fails to reach 66 before their opponent does (or never
  reaches it), the **opponent** scores 2 game points (3, if the opponent
  has taken zero tricks) — regardless of the opponent's own point total.

### 3.6 Stock running out naturally
- When the stock is exhausted, the face-up trump card itself is taken by
  the loser of that trick (it's the last card drawn).
- From that point on, the same tightened rules in 3.5 apply (follow suit,
  must-beat, must-trump, no marriages).
- **Unlike a manual close**, the winner of the very last trick scores a
  **10-point bonus** added to their card points.

### 3.7 Winning a hand / scoring
- Either player may "knock"/stop the game at any time they believe their
  card points + banked marriage points total ≥ 66, and the hand is scored
  immediately:
  - If they're right (≥66): they score game points —
    - 1 game point if opponent has ≥33 card points,
    - 2 game points if opponent has <33 card points but won ≥1 trick,
    - 3 game points if opponent won **zero** tricks.
  - If they're wrong (<66 actual): the **opponent** scores 2 game points
    (3 if the claiming player — i.e. now the loser — has taken 0 tricks).
- If nobody has declared and the stock-closed/exhausted endgame plays out
  to the last trick, score it the same way based on final totals (don't
  require an explicit "I have 66" UI action if it's the literal last trick
  and the totals are knowable — see Section 6 for UX decision either way).
- First player to **7 game points** wins the match. Track match score
  across hands; deal alternates after each hand.

### 3.8 Things to get right (common implementation bugs)
- Marriage points are **invisible to the score until a trick is won by
  that player**, but they are still "real" for purposes of a player
  deciding whether to close/declare 66 — i.e. the AI and the rules engine
  must track *pending* vs *banked* marriage points separately.
- The trump exchange has three preconditions (on lead, already won ≥1
  trick, no cards in play) — don't allow it as a free action at any time.
- "Must beat if able" in the closed-stock phase means: if the player has
  a higher card of the suit led, they must play a *higher* card of that
  suit, not just *any* card of that suit.
- After stock closes, a player who has no card of the suit led and no
  trump simply plays anything; "must trump" only applies when they hold a
  trump but lack the suit led.

## 4. AI Design

### 4.1 Core problem
Sixty-Six is **imperfect information**: a player can see their own hand,
the cards played to the current trick, and (while the stock is open) the
single face-up trump card — but not the opponent's hand or the order of
the stock. Plain minimax requires a fully known game tree and cannot be
applied directly to the early/mid game.

### 4.2 Recommended approach: Determinization (Perfect Information Monte Carlo)
For any decision point where hidden information exists:

1. Compute the set of cards not visible to the AI (opponent's hand +
   remaining stock, minus the AI's own hand and all cards already played).
2. Sample N plausible, consistent deals of those unseen cards into
   "opponent hand" and "remaining stock" (respecting known hand sizes).
3. For each sampled deal, the game is now perfect information — run
   **minimax with alpha-beta pruning** (or expectiminimax if you choose to
   model future stock draws as chance nodes rather than fixing them per
   sample) to some search depth/horizon, scoring terminal/cutoff states by
   a heuristic evaluation function (see 4.4).
4. Aggregate the move recommendations across all N samples (e.g. majority
   vote, or average score per candidate move) and pick the best move.

This converges naturally to **exact minimax** once the stock is closed or
exhausted and the opponent's remaining hand is the only unseen set — at
that point N can shrink toward 1, or you can just enumerate all
permutations of the opponent's hand exactly, since hand sizes are small
(≤6 cards) in the endgame.

### 4.3 Decisions the AI needs to make (not just "which card")
The AI's evaluation must cover every decision point a human player has:
- Which card to play to a trick.
- Whether to declare a marriage when leading (and which one, if multiple).
- Whether to perform the trump exchange when eligible.
- Whether to close the stock.
- Whether to declare "I have 66" and stop the hand.

Treat "close the stock" and "declare 66" as actions evaluated *before* the
card-play decision at each lead, not bolted on afterward.

### 4.4 Heuristic evaluation function (for non-terminal cutoff states)
Used when search depth is cut off before a hand-ending state. Suggested
components, tunable as weights:
- Net card points banked (own − opponent's).
- Banked + realistically-bankable marriage points.
- Trump count/quality remaining in own hand vs estimated opponent trumps.
- Card-counting signal: high cards (A, 10) still unseen/in play.
- Proximity to 66 and whether closing is currently safe (i.e., a simple
  "can I guarantee 66 under closed rules with my known + likely cards"
  check feeds into the close/declare decisions in 4.3).

### 4.5 Difficulty levels
Implement at least three tiers, driven by the parameters above:

| Difficulty | Search depth | Determinization samples (N) | Behavior |
|---|---|---|---|
| Easy | 0–1 ply (mostly heuristic/greedy, plays legal+reasonable cards) | 1–3 | Doesn't close proactively, misses marriages occasionally, makes some suboptimal trades |
| Medium | 2–4 ply | 8–16 | Reasonably sound trick-taking, closes when clearly safe, takes marriages |
| Hard | Full-depth in endgame, 4–6+ ply earlier | 30–50+ (or exact enumeration in endgame) | Strong card counting, aggressive correct closing/declaring, near-optimal trump management |

Easy mode should still be a **legal, coherent** player — not random —
just clearly beatable. Don't implement "easy" as literally random legal
moves; it should look like a weak-but-sane human.

### 4.6 Computer vs Computer mode
Both seats run the same AI module with independently configurable
difficulty (so e.g. Hard vs Easy is a valid matchup for testing/balance).
This mode should be able to run "fast-forward" (no animation delay) for
simulation/benchmarking, in addition to a watchable real-time mode.

## 5. Project Structure

```
/src
  /core              # Pure game-rules engine. NO React, NO DOM, NO randomness
                      # without an injectable seed. Fully unit-testable.
    deck.ts           # Card/Suit/Rank types, deck construction
    rules.ts          # Legal move generation, trick resolution, scoring
    state.ts          # GameState type + reducers/transitions (immutable)
    marriages.ts
    closing.ts
  /ai
    evaluate.ts       # Heuristic evaluation function
    determinize.ts    # Sampling unseen cards into consistent deals
    search.ts         # Minimax/alpha-beta (and/or expectiminimax) over a
                       # single determinized (perfect-info) game state
    player.ts         # AiPlayer: difficulty -> {depth, samples} -> chooses
                       # a move/action using core + search + evaluate
  /ui
    components/
    hooks/
    App.tsx
  /game                # Glue: orchestrates a match using /core, with
                        # either a HumanController or AiPlayer per seat
    match.ts
main.tsx
/tests
  core/                # Rules engine tests — exhaustive on edge cases in §3.8
  ai/                  # AI sanity tests (e.g. AI never plays illegal moves,
                        # always declares 66 immediately once truly reachable
                        # and safe, etc.)
```

Keep `/core` free of any UI or randomness side effects — it should be
possible to fuzz-test it and to run thousands of CPU-vs-CPU games headless
for AI evaluation without touching React at all.

## 6. UX/Implementation Decisions Left to Claude Code

These aren't specified by the rules and are fine to decide pragmatically;
note your choice in code comments or a short ADR if it's non-obvious:
- Whether "declare 66" requires an explicit human button press or is
  auto-detected and offered when reachable (recommend: explicit action,
  since declaring early/wrong is part of real strategy and risk).
- Visual/animation treatment of trick collection, draw pile, marriages.
- Whether to log/expose AI reasoning (e.g. a debug panel showing sampled
  determinizations and search scores) — useful for development, can be
  hidden behind a dev flag.

## 7. Development Conventions

- Strict TypeScript (`strict: true`), no `any` in `/core` or `/ai`.
- `/core` functions should be pure and immutable-state-in/state-out where
  practical — this makes both testing and the AI's tree search far easier
  (cloning a game state must be cheap and correct).
- Every rule in Section 3, especially 3.8's gotchas, should have a
  corresponding unit test in `/tests/core`.
- Before implementing the AI, get `/core` fully correct and tested —
  the AI is only as good as the rules engine it searches over.
- Build order recommendation:
  1. Core types + deck + deal
  2. Trick resolution + open-stock play (no marriages/closing yet)
  3. Marriages + trump exchange
  4. Closing + stock-exhaustion endgame rules + scoring/match play
  5. Minimal UI to play human-vs-human locally (sanity check the engine)
  6. AI: heuristic evaluation + greedy (this becomes "Easy")
  7. AI: determinization + minimax/alpha-beta (this becomes "Medium"/"Hard")
  8. Computer-vs-computer mode + difficulty selection UI
  9. Polish UI/animations
