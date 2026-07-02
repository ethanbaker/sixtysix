import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "../../core/deck";
import type { PlayerId } from "../../core/state";
import { createAiPlayer } from "../../ai/player";
import type { AiAction, AiDebugInfo, AiPlayer } from "../../ai/player";
import {
  applyAiAction,
  createMatch,
  createRandomRng,
  playCardAction,
  simulateMatch,
  startNextHand,
} from "../../game/match";
import type {
  MatchSession,
  SeatConfig,
  SimulatedMatch,
} from "../../game/match";
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

const DEFAULT_SEATS: [SeatConfig, SeatConfig] = [
  { type: "human" },
  { type: "human" },
];

function buildAiPlayers(
  seats: readonly [SeatConfig, SeatConfig],
): [AiPlayer | null, AiPlayer | null] {
  return seats.map((seat, index) =>
    seat.type === "ai"
      ? createAiPlayer(index as PlayerId, seat.difficulty, createRandomRng())
      : null,
  ) as [AiPlayer | null, AiPlayer | null];
}

export function useMatch() {
  const [seats, setSeatsState] =
    useState<[SeatConfig, SeatConfig]>(DEFAULT_SEATS);
  const [started, setStarted] = useState(false);
  const [session, setSession] = useState<MatchSession>(() =>
    createMatch(0, createRandomRng()),
  );
  const [fastForwardResult, setFastForwardResult] =
    useState<SimulatedMatch | null>(null);
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
      setSession(createMatch(firstDealer, createRandomRng()));
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
      const initial = createMatch(firstDealer, createRandomRng());
      const result = simulateMatch(
        initial,
        [aiPlayers[0], aiPlayers[1]],
        createRandomRng(),
      );
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
  const beginTrickAnimation = useCallback(
    (state: TrickAnimationState) => {
      setTrickAnimation(state);
      setTimeout(() => {
        setTrickAnimation((current) => (current ? { ...current, collecting: true } : null));
      }, TRICK_PAUSE_MS);
      setTimeout(() => {
        setTrickAnimation(null);
      }, TRICK_PAUSE_MS + TRICK_COLLECT_MS);
    },
    [],
  );

  // Applies one action (from a human click or one AI decision) and, if
  // it just resolved a trick, captures that trick for beginTrickAnimation
  // before the engine's own state (already past it — points banked,
  // hands replenished) takes over. Deliberately reads `session` from the
  // closure rather than using the setSession(prev => ...) functional form,
  // since beginTrickAnimation's setState-in-a-timeout calls need to happen
  // as ordinary (non-reducer) side effects -- nesting them inside a state
  // updater would make React 18 StrictMode's double-invoke-in-dev replay
  // them twice.
  const dispatchAction = useCallback(
    (player: PlayerId, action: AiAction) => {
      if (action.type === "playCard") {
        const wasFollow = session.hand.trick.length === 1;
        const lead = session.hand.trick[0];
        const next = playCardAction(session, player, action.card);
        setSession(next);
        if (wasFollow) {
          const winner: PlayerId =
            next.hand.tricksWon[0] > session.hand.tricksWon[0] ? 0 : 1;
          beginTrickAnimation({
            cards: [lead, { player, card: action.card }],
            winner,
            collecting: false,
          });
        }
        return;
      }
      setSession(applyAiAction(session, player, action));
    },
    [session, beginTrickAnimation],
  );

  const playCard = useCallback(
    (player: PlayerId, card: Card) => dispatchAction(player, { type: "playCard", card }),
    [dispatchAction],
  );
  const declareMarriage = useCallback(
    (player: PlayerId, card: Card) => dispatchAction(player, { type: "declareMarriage", card }),
    [dispatchAction],
  );
  const exchangeTrumpNine = useCallback(
    (player: PlayerId) => dispatchAction(player, { type: "exchangeTrumpNine" }),
    [dispatchAction],
  );
  const closeStock = useCallback(
    (player: PlayerId) => dispatchAction(player, { type: "closeStock" }),
    [dispatchAction],
  );
  const declareSixtySix = useCallback(
    (player: PlayerId) => dispatchAction(player, { type: "declareSixtySix" }),
    [dispatchAction],
  );

  const nextHand = useCallback(() => {
    setSession((current) => startNextHand(current, createRandomRng()));
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
    if (session.match.matchWinner !== null) return;

    const [aiA, aiB] = aiPlayersRef.current;

    if (session.hand.handOver) {
      if (!aiA || !aiB) return; // a human seat needs to click "Deal next hand"
      const timer = setTimeout(() => {
        setSession((current) => startNextHand(current, createRandomRng()));
      }, AI_MOVE_DELAY_MS);
      return () => clearTimeout(timer);
    }

    const aiPlayer = aiPlayersRef.current[session.hand.turn];
    if (!aiPlayer) return; // human seat: wait for a click
    const timer = setTimeout(() => {
      // Decided here (deferred inside the timer), not synchronously up
      // front, so React 18 StrictMode's dev-only double-invoke of effect
      // bodies can't run the decision twice (it cancels-and-reschedules
      // the *timer* safely via the cleanup below, but a synchronous call
      // here would already have consumed the AI's Rng stream twice and
      // could disagree with itself on the chosen action).
      const { action, debug } = aiPlayer.chooseActionWithDebug(session.hand);
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
