import { useGame } from "../game/useGame";
import { useCountdown, formatSeconds } from "../game/useCountdown";
import { roundTitle } from "../game/strings";
import { STR } from "../game/strings";

/** Full-screen countdown overlay for the `countdown` phase. */
export default function CountdownOverlay() {
  const { endsAt, roundIndex, roundType, currentRound } = useGame();
  const { seconds } = useCountdown(endsAt, 100);
  const title = roundTitle(roundType, currentRound?.title);

  return (
    <div className="overlay-screen">
      <div className="countdown-card">
        <div className="countdown-kicker">
          {STR.getReady} — {STR.round} {roundIndex + 1}
        </div>
        <div className="countdown-title">{title}</div>
        <div className="countdown-num" key={seconds}>
          {seconds > 0 ? seconds : "⚔️"}
        </div>
        <div className="countdown-sub">
          {seconds > 0 ? formatSeconds(seconds) : STR.nextRound + " تبدأ الآن!"}
        </div>
      </div>
    </div>
  );
}
