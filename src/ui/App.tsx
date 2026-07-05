import { useState } from "react";
import type { Card } from "../core/deck";
import { ActionPanel } from "./components/ActionPanel";
import { AiDebugPanel } from "./components/AiDebugPanel";
import { FastForwardResult } from "./components/FastForwardResult";
import { PlayerHand } from "./components/PlayerHand";
import { Scoreboard } from "./components/Scoreboard";
import { SeatSetup } from "./components/SeatSetup";
import { StockInfo } from "./components/StockInfo";
import { TrickArea } from "./components/TrickArea";
import { getLegalActions, useMatch } from "./hooks/useMatch";
import styles from "./styles.module.css";

const PLAYER_LABELS: [string, string] = ["Player 1", "Player 2"];

const DEBUG_FLAG = import.meta.env.VITE_DEBUG === "1";

function App() {
  const {
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
    callBig,
    callSmall,
    passOpeningCallAction,
    nextHand,
    returnToSetup,
  } = useMatch();
  const [debugVisible, setDebugVisible] = useState(DEBUG_FLAG);

  const { hand, match } = session;

  const debugPanel = DEBUG_FLAG && (
    <AiDebugPanel decision={aiDebug} playerLabels={PLAYER_LABELS} visible={debugVisible} onToggle={() => setDebugVisible((v) => !v)} />
  );

  if (!started) {
    return (
      <div className={styles.board}>
        <SeatSetup
          seats={seats}
          playerLabels={PLAYER_LABELS}
          onSeatChange={setSeat}
          onStart={() => startMatch(0)}
          onStartFastForward={() => startFastForwardMatch(0)}
        />
        {debugPanel}
      </div>
    );
  }

  if (fastForwardResult) {
    return (
      <div className={styles.board}>
        <FastForwardResult result={fastForwardResult} playerLabels={PLAYER_LABELS} onNewMatch={returnToSetup} />
        {debugPanel}
      </div>
    );
  }

  if (match.matchWinner !== null && !animating) {
    return (
      <div className={styles.board}>
        <div className={styles.overlay}>
          <h2>{PLAYER_LABELS[match.matchWinner]} wins the match!</h2>
          <p>
            Final score: {match.matchScore[0]} – {match.matchScore[1]}
          </p>
          <button type="button" onClick={returnToSetup}>
            New match
          </button>
        </div>
        {debugPanel}
      </div>
    );
  }

  const isAiSeat = (player: 0 | 1): boolean => seats[player].type === "ai";

  if (hand.handOutcome !== null && !animating) {
    const outcome = hand.handOutcome;
    return (
      <div className={styles.board}>
        <Scoreboard hand={hand} match={match} />
        <div className={styles.overlay}>
          <h2>Hand over</h2>
          <p>
            {PLAYER_LABELS[outcome.winner]} scores {outcome.matchPoints} game point{outcome.matchPoints === 1 ? "" : "s"}
          </p>
          {!(isAiSeat(0) && isAiSeat(1)) && (
            <button type="button" onClick={nextHand}>
              Deal next hand
            </button>
          )}
        </div>
        {debugPanel}
      </div>
    );
  }

  const activePlayer = hand.currentPlayer;
  const activeIsAi = isAiSeat(activePlayer);
  const legalActions = activeIsAi || animating ? null : getLegalActions(hand, activePlayer);
  // The trick animation runs after GameState has already moved on (see
  // useMatch's dispatchAction), so once a hand ends mid-animation, don't
  // show turn-status text for a "next" turn that's about to be moot.
  const showTurnStatus = hand.handOutcome === null && !animating;

  const handlePlay = (card: Card) => playCard(activePlayer, card);
  const handleDeclareMarriage = (card: Card) => declareMarriage(activePlayer, card);
  const handleExchange = () => exchangeTrumpNine(activePlayer);
  const handleClose = () => closeStock(activePlayer);
  const handleDeclareSixtySix = () => declareSixtySix(activePlayer);
  const handleCallBig = () => callBig(activePlayer);
  const handleCallSmall = () => callSmall(activePlayer);
  const handlePassOpeningCall = () => passOpeningCallAction(activePlayer);

  const seatStatus = (player: 0 | 1): string => {
    const seat = seats[player];
    if (seat.type === "human") return "";
    return ` (${seat.difficulty})`;
  };

  return (
    <div className={styles.board}>
      <p className={styles.turnLabel}>
        {PLAYER_LABELS[1]}
        {seatStatus(1)}
        {showTurnStatus && activePlayer === 1 ? (isAiSeat(1) ? " (thinking…)" : " (your turn)") : ""}
      </p>
      <PlayerHand
        cards={hand.hands[1]}
        legalCards={activePlayer === 1 && legalActions ? legalActions.cards : []}
        onPlay={handlePlay}
        hidden={isAiSeat(1) && !DEBUG_FLAG}
      />

      <div className={styles.middleRow}>
        <StockInfo hand={hand} />
        <div className={styles.panel}>
          <h3>Trick</h3>
          <TrickArea trick={hand.currentTrick} playerLabels={PLAYER_LABELS} animation={trickAnimation} />
        </div>
        <Scoreboard hand={hand} match={match} />
      </div>

      <p className={styles.turnLabel}>
        {PLAYER_LABELS[0]}
        {seatStatus(0)}
        {showTurnStatus && activePlayer === 0 ? (isAiSeat(0) ? " (thinking…)" : " (your turn)") : ""}
      </p>
      <PlayerHand
        cards={hand.hands[0]}
        legalCards={activePlayer === 0 && legalActions ? legalActions.cards : []}
        onPlay={handlePlay}
        hidden={isAiSeat(0) && !DEBUG_FLAG}
      />

      {legalActions && (
        <ActionPanel
          actions={legalActions}
          onDeclareMarriage={handleDeclareMarriage}
          onExchangeTrumpNine={handleExchange}
          onCloseStock={handleClose}
          onDeclareSixtySix={handleDeclareSixtySix}
          onCallBig={handleCallBig}
          onCallSmall={handleCallSmall}
          onPassOpeningCall={handlePassOpeningCall}
        />
      )}
      {debugPanel}
    </div>
  );
}

export default App;
