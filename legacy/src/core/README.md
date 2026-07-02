# `src/core`

Pure rules engine for Sixty-Six. No React, no DOM, no ambient randomness
(the only RNG usage — shuffling — takes an injected `Rng`). Every
transition function takes a `GameState` (or smaller piece of one) and
returns a new one; nothing here mutates its inputs. This is what makes the
AI's tree search and headless CPU-vs-CPU simulation possible.

Cross-references to "Section N.N" below point at the rule numbers in the
top-level `CLAUDE.md`.

## File map

| File           | Responsibility                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `deck.ts`      | `Card`/`Suit`/`Rank` types, deck construction, shuffling, dealing                               |
| `rng.ts`       | Seedable PRNG (mulberry32) used only by `shuffleDeck`                                           |
| `state.ts`     | `GameState` shape + the core transitions: play a card, declare a marriage, exchange the trump 9 |
| `rules.ts`     | Legal-move generation, trick-winner determination, phase/eligibility checks                     |
| `marriages.ts` | Marriage detection/scoring (pure queries, no state transition)                                  |
| `closing.ts`   | Closing the stock, declaring 66, hand-end scoring, match-level score tracking                   |

Dependency direction: `deck` and `rng` have no internal deps. `rules`
depends on `deck` + `state`'s types. `marriages` depends on `deck` +
`rules` + `state`'s types. `state` depends on `deck`, `marriages`,
`rules`. `closing` depends on `rules` + `state`. There's a type-only
cycle between `state.ts` and `rules.ts`/`marriages.ts` (they import
`GameState`/`PlayerId` as types while `state.ts` imports their functions)
— this is fine in TS/ESM since type-only imports are erased.

## `deck.ts`

- **Types**: `Suit` (4 values), `Rank` (`9 J Q K 10 A` — note the deck
  omits `2`–`8`), `Card = { suit, rank }`.
- `RANK_POINTS`: the point value table from Section 3.1 (`9`=0 … `A`=11).
  Sums to 30/suit, 120/deck.
- `cardId(card)` — string key (`"K-hearts"`), `cardsEqual(a, b)` — value
  equality. Cards are plain data, compared structurally, never by
  reference.
- `createDeck()` — all 24 cards, ordered suit-major/rank-minor per
  `SUITS`/`RANKS` array order (not shuffled).
- `shuffleDeck(deck, rng)` — standard Fisher-Yates using an injected
  `Rng`. Returns a new array; does not mutate `deck`.
- `deal(shuffledDeck)`:
  - Throws unless given exactly 24 cards.
  - Deals two packets of 3 to non-dealer, then dealer, twice (matches
    Section 3.1's "two packets of 3, non-dealer first" — implemented as
    interleaved packets, not 6-then-6).
  - Turns up the next card as `trumpCard`/`trumpSuit`.
  - Everything after that is `stock`, with index 0 as the top (next card
    drawn). The trump card itself is _not_ part of `stock` — it's tracked
    separately in `GameState.trumpCard` and is drawn last, per
    `state.ts::drawOne`.

## `rng.ts`

`createRng(seed)` returns a `() => number` in `[0, 1)` via mulberry32 —
deterministic and dependency-free so tests can reproduce exact deals.
Not cryptographically secure; that's fine, it's a card shuffle.

## `state.ts`

### `GameState`

The single immutable snapshot of a hand in progress. Key fields and the
subtlety behind each:

- `hands: [Card[], Card[]]` — indexed by `PlayerId` (`0 | 1`), not by
  dealer/non-dealer. `otherPlayer(p)` flips between them.
- `trumpCard: Card | null` — starts as the turned-up card; becomes `null`
  once drawn (stock exhausted, Section 3.6) _or_ once swapped away by the
  trump exchange (Section 3.3), in which case it temporarily holds the
  old trump 9 until that too gets drawn/played.
- `stock` — index 0 is next-to-draw. Does **not** include the face-up
  trump card.
- `trick` — length 0 (nobody led) or 1 (waiting on the follower). Never
  reaches length 2; `playCard` resolves and clears it in the same call
  that would have made it length 2.
- `pendingMarriagePoints` vs `bankedMarriagePoints` — the Section 3.8
  split. Pending points from a marriage declared before that player's
  first trick win move to banked the instant that player next wins _any_
  trick (see `playCard`'s trick-resolution branch). This is a **global**
  pending pool per player, not per-marriage — if a player somehow banks
  zero tricks across two marriage declarations, both marriages' points
  sit pending together and bank together on the first win.
- `earlyEndBy` — who manually closed (Section 3.5), or `null`. Natural
  exhaustion (Section 3.6) is a _different_ condition and does **not**
  set `earlyEndBy` — check `rules.ts::isClosedPhase` for "are the tightened
  rules in effect," not `earlyEndBy !== null` alone.
- `handOver` / `winner` / `gamePoints` — set only by `closing.ts`
  (`declareSixtySix` or `checkHandEnd`), never by `state.ts` directly.

### `createInitialState(dealResult, nonDealer)`

Maps `dealResult`'s dealer/non-dealer hands onto the `PlayerId`-indexed
`hands` tuple based on which `PlayerId` is non-dealer, and sets
`leader`/`turn` to the non-dealer (Section 3.1: "non-dealer leads the
first trick"). All score/trick counters start at zero, `earlyEndBy: null`,
`handOver: false`.

### `drawOne(state, player)` — private helper

Draws one card into `player`'s hand: from `stock` if non-empty, else from
`trumpCard` if still present, else a no-op (returns `state` unchanged —
this happens once the stock manually closes mid-hand, or after the trump
card itself has already been drawn). Returns a full new `GameState`
rather than a raw card, so `playCard` can just thread it through
sequentially for winner-then-loser draw order.

### `playCard(state, player, card)`

The main trick-play transition. Preconditions (throws otherwise):
hand not over, it's `player`'s turn, `card` is in `rules.ts::legalMoves`.

- **Leading** (`trick.length === 0`): removes the card from hand, records
  it as the lead, flips `turn` to the other player. Does _not_ touch
  `leader` semantics beyond recording who's now waiting — `leader` is set
  again (redundantly, to the same player) here.
- **Following** (`trick.length === 1`): removes the card, resolves the
  trick via `rules.ts::trickWinner`, credits both cards' `RANK_POINTS` to
  the winner, increments the winner's trick count, banks that winner's
  pending marriage points (if any), clears `trick`, sets `leader`/`turn`
  to the winner.
  - **Draw order**: winner draws before loser, both via `drawOne`,
    _only if_ `state.earlyEndBy === null` at the start of this call (i.e.
    the stock wasn't already closed going into this trick — closing
    freezes hand sizes for the rest of the hand, Section 3.5).
  - **Exhaustion bonus** (Section 3.6): checked _after_ the draw step, by
    whether both hands are now empty (only possible if the stock+trump
    pile was exactly exhausted by this draw) and `earlyEndBy` was `null`.
    Adds +10 points to the trick winner. This correctly never fires on a
    manually-closed hand (those never draw, so hands don't empty via
    this path — they empty by both players playing down from 6, which
    `checkHandEnd` handles separately in `closing.ts`).

Note `playCard` does **not** call `checkHandEnd` itself — callers (the
`/game` orchestration layer, per the architecture doc) are expected to
call `closing.ts::checkHandEnd` after every `playCard` to catch the
natural end-of-hand case.

### `declareMarriage(state, player, card)`

Preconditions via `marriages.ts::availableMarriages` (on lead, no trick in
progress, holds both K+Q of `card.suit`, not closed-phase). Removes only
`card` from hand (the partner card stays in hand to be led/played
separately later — the marriage is _declared_, not both cards forfeited).
Leads `card` as the trick's opening card (sets `trick`, `leader`, `turn`)
in the same call. Credits `marriagePointsForSuit` points to pending or
banked depending on whether `player` already has ≥1 trick won.

**Worth checking**: because this both declares _and_ leads in one call,
there's no separate "just declare, then choose what to lead" step — the
declared card (K or Q) _is_ the lead. That matches Section 3.4 ("declare
and lead either card of a King+Queen pair").

### `exchangeTrumpNine(state, player)`

Guarded entirely by `rules.ts::canExchangeTrumpNine` (throws if not
eligible). Swaps the player's trump-suit 9 out of hand for the face-up
`trumpCard`, and the old 9 becomes the new `trumpCard`. Does not touch
turn/trick/leader — this is documented in `CLAUDE.md` as happening only
when no cards are in play, so it doesn't need to.

## `rules.ts`

- `isClosedPhase(state)` — **the** function to determine whether tightened
  rules apply: `earlyEndBy !== null` (manual) **or** `stock.length === 0 &&
trumpCard === null` (natural exhaustion, Section 3.6). Every other
  closed/open branch point in the codebase should route through this
  rather than re-deriving the condition.
- `trickWinner(ledCard, followCard, trumpSuit)` — pure function, four
  cases: follow is trump & lead isn't → follow wins; lead is trump &
  follow isn't → lead wins; both trump or follow doesn't match suit led →
  compare by `RANK_ORDER` (trump-vs-trump) or lead wins outright
  (off-suit follow can never win); same suit as lead, neither trump →
  compare by rank. Reused both to resolve a completed trick and, inside
  `closedPhaseFollowMoves`, to test "does this candidate card beat the
  card led."
- `closedPhaseFollowMoves(hand, ledCard, trumpSuit)` — Section 3.5/3.8's
  must-follow/must-beat/must-trump logic:
  1. If holding any card of the suit led: must play one of those; if any
     of those _beat_ the led card, must play from that beating subset
     specifically (not just any same-suit card).
  2. Else if holding any trump: must play a trump (any trump — no "must
     beat" requirement when trumping in over a non-trump led-suit void,
     since there's no same-suit card to compare rank against... though
     note if trump _is_ the suit led this whole branch doesn't apply,
     it's folded into branch 1 above).
  3. Else: hand is unconstrained.
- `legalMoves(state, player)` — `[]` if hand over; unconstrained hand
  contents if leading or still open-phase; else delegates to
  `closedPhaseFollowMoves`.
- `canExchangeTrumpNine` / `canCloseStock` / `canDeclareSixtySix` —
  boolean eligibility checks matching Sections 3.3/3.5/3.7. Note
  `canDeclareSixtySix` is deliberately **not** gated on the player's
  actual point total — see the Section 6 UX decision recorded inline:
  declaring is offered any time on lead regardless of truth, since a
  wrong declaration is itself a scoreable outcome.

**Worth double-checking**: in `closedPhaseFollowMoves` branch 2 (trumping
in), there's no "must play the _highest_ trump" requirement — any trump
in hand is legal once forced to trump. Confirm that matches your reading
of "must trump if able" (Section 3.8 only specifies must-beat applies
_within_ the same-suit branch, so this reading — any trump is fine when
void in the led suit — looks right, but flag if you intended a
must-overtrump rule here too).

## `marriages.ts`

Pure detection/query module, no state mutation (the mutation lives in
`state.ts::declareMarriage`, which calls into here for the same
eligibility check + point lookup, so the two can't drift apart).

- `marriagePointsForSuit(suit, trumpSuit)` — 40 if trump suit, else 20
  (Section 3.4).
- `holdsBothKingAndQueen` — private, straightforward hand scan.
- `availableMarriages(state, player)` — suits `player` could declare
  right now: hand over → `[]`; not their turn or mid-trick → `[]`;
  closed-phase → `[]` (Section 3.5: "no new marriages"); else all suits
  where they hold both K and Q.

## `closing.ts`

### `closeStock(state, player)`

Sets `earlyEndBy: player`. Guarded by on-lead/no-trick-in-progress/not
already closed-or-exhausted. This is the _only_ place `earlyEndBy` is ever
set to non-null.

### Hand-outcome scoring — `resolveOutcome` (private) and its two callers

`totalScore(state, player) = points[player] + bankedMarriagePoints[player]`
— note this deliberately excludes `pendingMarriagePoints`, matching
Section 3.8 (pending points are "real" for the AI's _decision_ to close
or declare, but not yet part of the scorable total until banked).

`successTablePoints(opponentCardPoints, opponentTricksWon)` implements
the flat Section 3.7 table when the declarer is _correct_: opponent ≥33
raw card points → 1; opponent <33 but won ≥1 trick → 2; opponent won 0
tricks → 3. Note this reads `opponentCardPoints` as **raw card points**,
not `totalScore` (marriage points don't factor into this specific
threshold check — only the 33-point raw-card-point line from Section
3.7's own wording, "opponent has ≥33 card points").

`resolveOutcome(state, declarer)` — the trickiest logic in `core`. Three
regimes:

1. **No manual close** (`earlyEndBy === null`): ordinary Section 3.7 rule.
   Declarer correct → declarer wins, `successTablePoints` against the
   opponent's raw points/tricks. Declarer wrong → opponent wins,
   2 points (3 if declarer took zero tricks — note this checks the
   _declarer's_ (now-loser's) trick count, not the opponent's).
2. **Declarer is the closer**: correct → same success-table win as above.
   Wrong → **flat penalty** to the opponent (2, or 3 if the _closer_ took
   zero tricks) **regardless of the opponent's own point total** — this
   is Section 3.5's explicit override of the normal table, and is called
   out with an inline comment about a caught regression: a prior version
   of this function used the same flat-penalty bucket for the next case
   too, which was wrong.
3. **Declarer is the non-closer, while a close is in effect**: if they're
   genuinely correct (≥66), _they_ win against the closer under the
   closer-failure flat penalty (2, or 3 if the closer took 0 tricks) —
   this is "the opponent correctly declares before the closer does."
   But if they're **wrong**, it is explicitly **not** treated as a
   closer-failure freebie for them — it falls through to the ordinary
   Section 3.7 wrong-declaration rule (opponent, i.e. the closer, scores
   2 or 3). The inline comment documents this was a real bug found via
   Hard-AI self-play: without this branch split, a non-closer could
   "win" by declaring an obviously false 66 purely because the stock
   happened to be closed.

**This is the single highest-value thing to validate by hand** — trace a
few scenarios against Section 3.5's text yourself:

- Closer declares correctly → success table vs opponent. ✓ matches.
- Closer declares wrongly → opponent gets flat 2/3 regardless of their
  own points. ✓ matches "regardless of the opponent's own point
  total."
- Non-closer declares correctly while closed → closer-failure penalty
  to the non-closer. This interprets "opponent scores 2 (3 if...)"
  from 3.5 as applying symmetrically when the _non-closer_ is the one
  who ends up correct — confirm this is the intended reading, since
  3.5's prose is written from the closer's perspective.
- Non-closer declares incorrectly while closed → ordinary 3.7 penalty
  to the closer. This is the bug-fixed case; confirm you agree a false
  declaration shouldn't be rewarded just because a close is active.

### `declareSixtySix(state, player)`

Guarded by on-lead/no-trick-in-progress. Always resolves the hand
immediately (sets `handOver`, `winner`, `gamePoints`) regardless of
whether the declaration is actually correct — correctness is decided
inside `resolveOutcome`, not as a precondition.

### `checkHandEnd(state)`

Call after every `playCard` (it's a no-op if the hand isn't actually
over or is already resolved, so it's safe to call unconditionally).
Fires when both hands are empty:

- If closed, resolves via `resolveOutcome(state, earlyEndBy)` — the closer
  is always the "declarer" being evaluated in the closed-and-hands-empty
  case (this covers a closer who never got to actually say "66" because
  the hand just ran out from tightened-phase play).
- If not closed (natural exhaustion per Section 3.6), determines who (if
  either) actually has `totalScore ≥ 66` and resolves via
  `resolveOutcome` for that player. If **neither** reached 66 — the code
  comments this as a rare exact-split edge case that shows up under
  literally-random play but "essentially never" under real strategic
  play — the hand is **void**: `handOver: true, winner: null,
gamePoints: 0`. No error thrown; this is treated as a legitimate
  (if unusual) hand outcome. Worth deciding if that's the behavior you
  want, since Section 3.7 doesn't explicitly describe a void-hand case —
  it's a reasonable filled-in gap, but flag if you'd rather it never be
  possible (it can only happen when card+marriage totals split such that
  both players end up <66, which needs specific marriage-point
  circumstances given 120 raw card points + the 10-point bonus are
  always fully allocated between the two players).

### Match-level state — `MatchState`, `createInitialMatchState`, `applyHandResult`

Separate from `GameState` (`GameState` is one hand; `MatchState` tracks
the running score across hands). `applyHandResult`:

- Throws if the match is already won or the hand passed in isn't over.
- Adds `hand.gamePoints` to `hand.winner`'s match score (no-op if
  `winner` is `null`, i.e. a void hand from `checkHandEnd`).
- Alternates `dealer` unconditionally (Section 3.7: "deal alternates
  after each hand" — this happens even on a void hand, which seems
  correct since dealing rotation isn't scoring-dependent).
- Sets `matchWinner` once either side reaches
  `GAME_POINTS_TO_WIN_MATCH` (7). Note: no tie-break for both crossing 7
  in the same call — impossible anyway since only one player's score
  changes per `applyHandResult` call.

## Things this documentation can't verify for you

- Whether the packet-dealing interleave order in `deck.ts::deal` matches
  your mental model of "two packets of three."
- The three `resolveOutcome` regimes in `closing.ts` — read those
  against Section 3.5's prose yourself; the branch that resolves "wrong
  declaration by the non-closer" is a filled-in interpretation, not
  something Section 3.5 spells out in so many words.
- The void-hand behavior in `checkHandEnd` when neither player reaches
  66 by natural exhaustion.
