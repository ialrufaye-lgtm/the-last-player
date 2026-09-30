import { useEffect, useState } from "react";
import { useGame } from "../game/useGame";
import { useCountdown } from "../game/useCountdown";
import { RoundHeader, TimerBar, AliveBadge } from "../components/bits";
import { roundTitle, STR } from "../game/strings";
import type { RoundStartMsg, RoundTickMsg } from "../game/types";

const GRID = 8; // 8x8 → tiles 0..63

/**
 * hide_seek — 20s hide on an 8x8 grid, then seekers (top 5 by score) get
 * 15s and 3 tile picks each. Caught tiles arrive via tick.data.caught.
 */
export default function HideSeek({
  round,
  tick,
}: {
  round: RoundStartMsg;
  tick: RoundTickMsg | null;
}) {
  const { send, myId, aliveCount } = useGame();

  const payload = round.payload ?? {};
  const seekers: any[] = Array.isArray(payload.seekers) ? payload.seekers : [];
  const isSeeker =
    payload.isSeeker === true ||
    (myId != null && seekers.some((s) => (s?.id ?? s) === myId));

  // Server ticks use `phase: "seek"`; accept legacy `stage` too.
  const stage: string = String(tick?.data?.phase ?? tick?.data?.stage ?? "hide"); // hide | seek
  const caught: number[] = Array.isArray(tick?.data?.caught) ? tick.data.caught : [];
  const endsAt = Number(tick?.endsAt || round.endsAt || 0);
  const totalMs = isSeeker || stage === "seek" ? 15000 : 20000;
  const { remaining } = useCountdown(endsAt, 200);

  const [tile, setTile] = useState<number | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const [seekSent, setSeekSent] = useState(false);

  useEffect(() => {
    setTile(null);
    setPicks([]);
    setSeekSent(false);
  }, [round.roundIndex]);

  const hide = (t: number) => {
    if (stage !== "hide" || remaining <= 0) return;
    send("hide", { tile: t });
    setTile(t); // last one wins — re-sending is allowed
  };

  const togglePick = (t: number) => {
    if (seekSent || stage !== "seek") return;
    setPicks((p) =>
      p.includes(t) ? p.filter((x) => x !== t) : p.length < 3 ? [...p, t] : p
    );
  };

  const confirmSeek = () => {
    if (seekSent || picks.length === 0) return;
    send("seek", { tiles: picks });
    setSeekSent(true);
  };

  const tiles = Array.from({ length: GRID * GRID }, (_, i) => i);

  return (
    <div className="screen">
      <AliveBadge count={aliveCount} />
      <RoundHeader title={roundTitle(round.type, round.title)} rules={round.rules} />

      <div className="quiz-meta">
        <span>{isSeeker ? STR.seekTitle : stage === "seek" ? "👀 جارٍ البحث…" : "🙈 وقت الاختباء"}</span>
        <span className="quiz-clock">{Math.ceil(remaining / 1000)}⏱</span>
      </div>
      <TimerBar endsAt={endsAt} totalMs={totalMs} />

      <p className="hint center">
        {isSeeker ? STR.seekHint : stage === "seek" ? STR.hidersWait : STR.hideHint}
      </p>

      <div className="tile-grid" style={{ gridTemplateColumns: `repeat(${GRID}, 1fr)` }}>
        {tiles.map((t) => {
          const isCaught = caught.includes(t);
          const isMine = !isSeeker && tile === t;
          const isPick = isSeeker && picks.includes(t);
          return (
            <button
              key={t}
              className={`tile${isMine ? " mine" : ""}${isPick ? " pick" : ""}${isCaught ? " caught" : ""}`}
              onClick={() => (isSeeker ? togglePick(t) : hide(t))}
              disabled={isSeeker ? seekSent || stage !== "seek" : stage !== "hide"}
              aria-label={`مربع ${t + 1}`}
            >
              {isCaught ? "✕" : isMine ? "🙈" : isPick ? picks.indexOf(t) + 1 : ""}
            </button>
          );
        })}
      </div>

      {isSeeker ? (
        <button
          className="btn btn-primary btn-big"
          disabled={seekSent || picks.length === 0}
          onClick={confirmSeek}
        >
          {seekSent ? `تم الإرسال ✓ (${picks.length}/3)` : `${STR.confirmPicks} (${picks.length}/3)`}
        </button>
      ) : tile !== null && stage === "hide" ? (
        <p className="hint center ok">مختبئ في المربع {tile + 1} 🙈 — يمكنك تغييره</p>
      ) : null}
    </div>
  );
}
