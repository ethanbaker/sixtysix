import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "../../core/deck";
import { createRng, type Rng } from "../../core/rng";
import { canExchangeLowestTrump, getAvailableMarriages, getCalls, getLegalMoves, type Call } from "../../core/rules";
import type { GameState, PlayerId } from "../../core/state";
import {
  advanceMatch,
  applyStandardAction,
  isHandFinished,
  isMatchFinished,
  startStandardMatch,
  type MatchSession,
  type StandardAction,
} from "../../game/standard";
import { chooseAction, chooseActionWithDebug, createAiPlayer, type AiDebugInfo, type AiPlayer, type Difficulty } from "../../ai/player";
import type { TrickAnimationState } from "../components/TrickArea";

// How long an AI's move stays visible before the next one fires, in
// realtime Computer-vs-Computer/human-vs-Computer play (CLAUDE.md
// Section 4.6: "a watchable real-time mode").
const AI_MOVE_DELAY_MS = 1000;

// A resolved trick's two cards sit still for TRICK_PAUSE_MS so they're
// readable, then spend TRICK_COLLECT_MS animating off toward the
// winner. Input and AI auto-play are both paused for the duration (see
// `animating` below) so the next move doesn't cut the animation off.
const TRICK_PAUSE_MS = 500;
const TRICK_COLLECT_MS = 420;

// Per-seat configuration (CLAUDE.md Section 4.6 / step 8): a seat is
// either human-controlled (the UI dispatches actions off user clicks) or
// AI-controlled at a chosen difficulty.
export type SeatConfig = { readonly type: "human" } | { readonly type: "ai"; readonly difficulty: Difficulty };

const DEFAULT_SEATS: [SeatConfig, SeatConfig] = [{ type: "human" }, { type: "human" }];

// Legal actions for `player` right now. Everything is empty/false when
// it isn't their turn, so the UI can disable/hide affordances directly
// off this rather than letting a click fail.
export interface LegalActions {
  readonly cards: readonly Card[];
  readonly marriageCards: readonly Card[];
  readonly canExchangeTrump: boolean;
  readonly calls: readonly Call[];
}

const NO_ACTIONS: LegalActions = { cards: [], marriageCards: [], canExchangeTrump: false, calls: [] };

export function getLegalActions(hand: GameState, player: PlayerId): LegalActions {
  if (isHandFinished(hand) || hand.currentPlayer !== player) return NO_ACTIONS;

  return {
    cards: getLegalMoves(hand, player),
    marriageCards: getAvailableMarriages(hand, player),
    canExchangeTrump: canExchangeLowestTrump(hand, player),
    calls: getCalls(hand, player),
  };
}

export interface HandSummary {
  readonly handNumber: number;
  readonly winner: PlayerId;
  readonly matchPoints: number;
  readonly cardPoints: readonly [number, number];
  readonly matchScoreAfter: readonly [number, number];
}

export interface SimulatedMatch {
  readonly finalSession: MatchSession;
  readonly handSummaries: readonly HandSummary[];
}

function createRandomRng(): Rng {
  return createRng(Date.now() ^ Math.floor(Math.random() * 0xffffffff));
}

function buildAiPlayers(seats: readonly [SeatConfig, SeatConfig]): [AiPlayer | null, AiPlayer | null] {
  return seats.map((seat, index) =>
    seat.type === "ai" ? createAiPlayer(index as PlayerId, seat.difficulty, createRandomRng()) : null,
  ) as [AiPlayer | null, AiPlayer | null];
}

// Drives `aiPlayer`'s entire turn. Most actions (closing the stock, the
// trump exchange) don't pass the turn by themselves — the same player
// still has to lead afterward — so this re-queries the AI until either
// the turn actually passes to the opponent or the hand ends. Bounded
// since each prefix action (close, exchange) can only ever be taken once
// per hand.
function playAiTurn(session: MatchSession, aiPlayer: AiPlayer): MatchSession {
  let current = session;
  let guard = 0;
  while (current.hand.currentPlayer === aiPlayer.player && !isHandFinished(current.hand)) {
    const action = chooseAction(aiPlayer, current.hand);
    current = { ...current, hand: applyStandardAction(current.hand, aiPlayer.player, action) };

    guard += 1;
    if (guard > 10) {
      throw new Error(`AiPlayer for player ${aiPlayer.player} did not yield the turn after ${guard} actions`);
    }
  }
  return current;
}

// Drives an entire match to completion using the given AiPlayer for each
// seat — no human input, no per-action pause. Used by the UI's
// fast-forward Computer-vs-Computer mode (Section 4.6: "surface just the
// result... rather than animating every card"). Callers that want a
// watchable, animated pace should instead drive playAiTurn/advanceMatch
// turn-by-turn themselves (see the realtime effect below).
function simulateMatch(session: MatchSession, aiPlayers: readonly [AiPlayer, AiPlayer], rng: Rng): SimulatedMatch {
  let current = session;
  const handSummaries: HandSummary[] = [];
  let guard = 0;

  while (!isMatchFinished(current)) {
    while (!isHandFinished(current.hand)) {
      const player = current.hand.currentPlayer;
      current = playAiTurn(current, aiPlayers[player]);
      guard += 1;
      if (guard > 2000) {
        throw new Error("simulateMatch exceeded a sane action count");
      }
    }

    const finishedHand = current.hand;
    current = advanceMatch(current, rng);

    const outcome = finishedHand.handOutcome!;
    handSummaries.push({
      handNumber: handSummaries.length,
      winner: outcome.winner,
      matchPoints: outcome.matchPoints,
      cardPoints: finishedHand.points,
      matchScoreAfter: current.match.matchScore,
    });
  }

  return { finalSession: current, handSummaries };
}

export function useMatch() {
  const [seats, setSeatsState] = useState<[SeatConfig, SeatConfig]>(DEFAULT_SEATS);
  const [started, setStarted] = useState(false);
  const [session, setSession] = useState<MatchSession>(() => startStandardMatch(createRandomRng(), 0));
  const [fastForwardResult, setFastForwardResult] = useState<SimulatedMatch | null>(null);
  const [trickAnimation, setTrickAnimation] = useState<TrickAnimationState | null>(null);
  const [aiDebug, setAiDebug] = useState<{ player: PlayerId; debug: AiDebugInfo } | null>(null);
  const aiPlayersRef = useRef<[AiPlayer | null, AiPlayer | null]>([null, null]);

  // True while the just-completed trick is still visually sitting/
  // collecting — gates human clicks and AI auto-play so neither one
  // starts the next move mid-animation.
  const animating = trickAnimation !== null;

  const setSeat = useCallback((seat: PlayerId, config: SeatConfig) => {
    setSeatsState((current) => {
      const next: [SeatConfig, SeatConfig] = [...current];
      next[seat] = config;
      return next;
    });
  }, []);

  const startMatch = useCallback(
    (firstDealer: PlayerId = 0) => {
      aiPlayersRef.current = buildAiPlayers(seats);
      setFastForwardResult(null);
      setTrickAnimation(null);
      setAiDebug(null);
      setSession(startStandardMatch(createRandomRng(), firstDealer));
      setStarted(true);
    },
    [seats],
  );

  // Computer-vs-Computer fast-forward (Section 4.6): runs the whole
  // match synchronously with no per-action delay and surfaces only the
  // result, rather than animating through the board. Only meaningful
  // when both seats are AI.
  const startFastForwardMatch = useCallback(
    (firstDealer: PlayerId = 0) => {
      const aiPlayers = buildAiPlayers(seats);
      if (aiPlayers[0] === null || aiPlayers[1] === null) {
        throw new Error("Fast-forward requires both seats to be AI-controlled");
      }
      const initial = startStandardMatch(createRandomRng(), firstDealer);
      const result = simulateMatch(initial, [aiPlayers[0], aiPlayers[1]], createRandomRng());
      aiPlayersRef.current = aiPlayers;
      setTrickAnimation(null);
      setAiDebug(null);
      setSession(result.finalSession);
      setFastForwardResult(result);
      setStarted(true);
    },
    [seats],
  );

  // Kicks off the "both cards sit, then collect toward the winner"
  // sequence. Not cleaned up on unmount (the board doesn't unmount
  // mid-match) — a stray setState-after-unmount here would be harmless.
  const beginTrickAnimation = useCallback((state: TrickAnimationState) => {
    setTrickAnimation(state);
    setTimeout(() => {
      setTrickAnimation((current) => (current ? { ...current, collecting: true } : null));
    }, TRICK_PAUSE_MS);
    setTimeout(() => {
      setTrickAnimation(null);
    }, TRICK_PAUSE_MS + TRICK_COLLECT_MS);
  }, []);

  // Applies one action (from a human click or one AI decision) and, if
  // it just resolved a trick, captures that trick for beginTrickAnimation
  // before the engine's own state (already past it — points banked,
  // hands replenished) takes over. Deliberately reads `session` from the
  // closure rather than using the setSession(prev => ...) functional form,
  // since beginTrickAnimation's setState-in-a-timeout calls need to happen
  // as ordinary (non-reducer) side effects -- nesting them inside a state
  // updater would make React 19 StrictMode's double-invoke-in-dev replay
  // them twice.
  const dispatchAction = useCallback(
    (player: PlayerId, action: StandardAction) => {
      if (action.type === "play") {
        const wasFollow = session.hand.currentTrick.length === 1;
        const lead = session.hand.currentTrick[0];
        const nextHand = applyStandardAction(session.hand, player, action);
        setSession({ ...session, hand: nextHand });
        if (wasFollow && lead) {
          const winner: PlayerId = nextHand.tricksWon[0] > session.hand.tricksWon[0] ? 0 : 1;
          beginTrickAnimation({
            cards: [lead, { player, card: action.card }],
            winner,
            collecting: false,
          });
        }
        return;
      }
      setSession({ ...session, hand: applyStandardAction(session.hand, player, action) });
    },
    [session, beginTrickAnimation],
  );

  const playCard = useCallback((player: PlayerId, card: Card) => dispatchAction(player, { type: "play", card }), [dispatchAction]);
  const declareMarriage = useCallback(
    (player: PlayerId, card: Card) => dispatchAction(player, { type: "marriage", card }),
    [dispatchAction],
  );
  const exchangeTrumpNine = useCallback((player: PlayerId) => dispatchAction(player, { type: "exchange-trump" }), [dispatchAction]);
  const closeStock = useCallback((player: PlayerId) => dispatchAction(player, { type: "call", call: "close-stock" }), [dispatchAction]);
  const declareSixtySix = useCallback((player: PlayerId) => dispatchAction(player, { type: "call", call: "sixtysix" }), [dispatchAction]);

  const nextHand = useCallback(() => {
    setSession((current) => advanceMatch(current, createRandomRng()));
  }, []);

  const returnToSetup = useCallback(() => {
    setStarted(false);
    setFastForwardResult(null);
    setTrickAnimation(null);
    setAiDebug(null);
  }, []);

  // Realtime auto-play (Section 4.6): whenever it's an AI seat's turn,
  // fire that move after a short delay so the board stays watchable
  // instead of jumping straight to the result like fast-forward does.
  // Drives one action at a time (not playAiTurn's whole-turn loop) so
  // every individual card/close/exchange the AI plays — including each
  // trick of a winning streak — gets its own visible beat. Also
  // auto-deals the next hand once both seats are AI (nobody's left to
  // click "Deal next hand"). Paused entirely while a trick is animating.
  useEffect(() => {
    if (!started || fastForwardResult || animating) return;
    if (isMatchFinished(session)) return;

    const [aiA, aiB] = aiPlayersRef.current;

    if (isHandFinished(session.hand)) {
      if (!aiA || !aiB) return; // a human seat needs to click "Deal next hand"
      const timer = setTimeout(() => {
        setSession((current) => advanceMatch(current, createRandomRng()));
      }, AI_MOVE_DELAY_MS);
      return () => clearTimeout(timer);
    }

    const aiPlayer = aiPlayersRef.current[session.hand.currentPlayer];
    if (!aiPlayer) return; // human seat: wait for a click
    const timer = setTimeout(() => {
      // Decided here (deferred inside the timer), not synchronously up
      // front, so React 19 StrictMode's dev-only double-invoke of effect
      // bodies can't run the decision twice (it cancels-and-reschedules
      // the *timer* safely via the cleanup below, but a synchronous call
      // here would already have consumed the AI's Rng stream twice and
      // could disagree with itself on the chosen action).
      const { action, debug } = chooseActionWithDebug(aiPlayer, session.hand);
      setAiDebug({ player: aiPlayer.player, debug });
      dispatchAction(aiPlayer.player, action);
    }, AI_MOVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [started, session, fastForwardResult, animating, dispatchAction]);

  return {
    seats,
    setSeat,
    started,
    startMatch,
    startFastForwardMatch,
    fastForwardResult,
    session,
    trickAnimation,
    animating,
    aiDebug,
    playCard,
    declareMarriage,
    exchangeTrumpNine,
    closeStock,
    declareSixtySix,
    nextHand,
    returnToSetup,
  };
}
