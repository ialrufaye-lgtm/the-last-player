import { useEffect, useState } from "react";
import { useGame } from "../game/useGame";
import { RoundHeader, AliveBadge } from "../components/bits";
import { roundTitle, STR } from "../game/strings";
import type { RoundStartMsg, RoundTickMsg } from "../game/types";

/**
 * react_race — 5 attempts. Server broadcasts tick.data = { signal: 'red'|'green',
 * attempt, attempts }. Client taps the pad; server records the time and voids
 * early (red) taps.
 */
export default function ReactRace({
  round,
  tick,
}: {
  round: RoundStartMsg;
  tick: RoundTickMsg | null;
}) {
  const { send, aliveCount } = useGame();
  // Server ticks carry { attempt (0-based), state: "red"|"green" }.
  const signal: string = String(tick?.data?.state ?? tick?.data?.signal ?? "red");
  const attempt: number = Number(tick?.data?.attempt ?? 0);
  const attempts: number = Number(
    tick?.data?.attempts ?? round.payload?.attempts ?? 5
  );
  const [tapped, setTapped] = useState(false);

  useEffect(() => {
    setTapped(false);
  }, [attempt, round.roundIndex]);

  const green = signal === "green";

  const tap = () => {
    if (tapped) return;
    setTapped(true);
    send("tap");
  };

  return (
    <div className="screen">
      <AliveBadge count={aliveCount} />
      <RoundHeader title={roundTitle(round.type, round.title)} rules={round.rules} />

      <div className="attempt-dots">
        {Array.from({ length: attempts }, (_, i) => (
          <span
            key={i}
            className={`dot${i < attempt ? " done" : ""}${i === attempt ? " now" : ""}`}
          />
        ))}
        <span className="attempt-label">
          {STR.attempt} {Math.min(attempt + 1, attempts)} / {attempts}
        </span>
      </div>

      <button
        className={`react-pad${green ? " green" : " red"}`}
        onClick={tap}
        aria-label={green ? "اضغط الآن" : "انتظر"}
      >
        <span className="react-face">{green ? "🟢" : "🔴"}</span>
        <span className="react-text">{green ? STR.reactTap : STR.reactWait}</span>
        {tapped ? <span className="react-sent">✓ تم</span> : null}
      </button>

      <p className="hint center">{STR.reactHint}</p>
    </div>
  );
}
