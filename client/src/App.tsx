import { useGame } from "./game/useGame";
import { STR } from "./game/strings";
import { Toasts } from "./components/bits";
import CountdownOverlay from "./components/CountdownOverlay";
import JoinScreen from "./screens/Join";
import LobbyScreen from "./screens/Lobby";
import RoundEndScreen from "./screens/RoundEnd";
import SpectatorScreen from "./screens/Spectator";
import PodiumScreen from "./screens/Podium";
import DisconnectedScreen from "./screens/Disconnected";
import QuizRace from "./rounds/QuizRace";
import HideSeek from "./rounds/HideSeek";
import ReactRace from "./rounds/ReactRace";
import Survival from "./rounds/Survival";
import FinalDuel from "./rounds/FinalDuel";
import { useCountdown, formatSeconds } from "./game/useCountdown";

function RoundView() {
  const { currentRound, roundType, tick, roundIndex } = useGame();
  const type = currentRound?.type || roundType;

  if (!currentRound) {
    const { seconds } = useCountdown(0);
    void seconds;
    return (
      <div className="screen center-screen">
        <div className="spinner" />
        <p className="hint">
          {STR.round} {roundIndex + 1} — {STR.waitingRound}
        </p>
      </div>
    );
  }

  switch (type) {
    case "quiz_race":
      return <QuizRace round={currentRound} tick={tick} />;
    case "hide_seek":
      return <HideSeek round={currentRound} tick={tick} />;
    case "react_race":
      return <ReactRace round={currentRound} tick={tick} />;
    case "survival":
      return <Survival round={currentRound} tick={tick} />;
    case "final_duel":
      return <FinalDuel round={currentRound} tick={tick} />;
    default:
      return (
        <div className="screen center-screen">
          <div className="spinner" />
          <p className="hint">جولة جديدة: {type || "…"}</p>
        </div>
      );
  }
}

function Match() {
  const { phase, me, podium, endsAt } = useGame();
  const { seconds } = useCountdown(endsAt, 500);
  const alive = me ? me.alive : true; // treat as alive until state says otherwise
  const showPodium = phase === "podium" || podium !== null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar-logo">🏆 TLP</span>
        {phase === "round" || phase === "roundEnd" ? (
          <span className="topbar-timer">⏱ {formatSeconds(seconds)}</span>
        ) : null}
        <span className="topbar-phase">{phaseLabel(phase)}</span>
      </header>

      <main className="app-main">
        {showPodium ? (
          <PodiumScreen />
        ) : phase === "lobby" ? (
          <LobbyScreen />
        ) : phase === "countdown" ? (
          <CountdownOverlay />
        ) : phase === "round" ? (
          alive ? (
            <RoundView />
          ) : (
            <SpectatorScreen />
          )
        ) : phase === "roundEnd" ? (
          alive ? (
            <RoundEndScreen />
          ) : (
            <SpectatorScreen />
          )
        ) : (
          <LobbyScreen />
        )}
      </main>
      <Toasts />
    </div>
  );
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "lobby":
      return "🛋️ الانتظار";
    case "countdown":
      return "⏳ العد التنازلي";
    case "round":
      return "⚔️ جولة جارية";
    case "roundEnd":
      return "🏁 نهاية الجولة";
    case "podium":
      return "🏆 التتويج";
    default:
      return phase;
  }
}

export default function App() {
  const { status } = useGame();

  if (status === "idle" || status === "connecting") {
    return (
      <div className="app-shell">
        <main className="app-main">
          <JoinScreen />
        </main>
        <Toasts />
      </div>
    );
  }

  if (status === "left") {
    return (
      <div className="app-shell">
        <main className="app-main">
          <DisconnectedScreen />
        </main>
        <Toasts />
      </div>
    );
  }

  return <Match />;
}
