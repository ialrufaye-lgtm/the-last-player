import { useEffect, useState } from "react";
import { useGame } from "../game/useGame";
import { useCountdown } from "../game/useCountdown";
import { RoundHeader, TimerBar, AliveBadge } from "../components/bits";
import { roundTitle, STR } from "../game/strings";
import type { RoundStartMsg, RoundTickMsg } from "../game/types";

const SIZE = 5; // 5x5 → zones 0..24
const TICK_MS = 6000;

function adjacent(a: number, b: number): boolean {
  const ar = Math.floor(a / SIZE);
  const ac = a % SIZE;
  const br = Math.floor(b / SIZE);
  const bc = b % SIZE;
  return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
}

/**
 * survival — 5x5 zone map, tick every 6s. Server marks 4 new danger zones per
 * tick (tick.data.danger). Move to an orthogonally adjacent zone each tick;
 * staying put or ending on danger = elimination.
 */
export default function Survival({
  round,
  tick,
}: {
  round: RoundStartMsg;
  tick: RoundTickMsg | null;
}) {
  const { send, aliveCount, me } = useGame();

  const danger: number[] = Array.isArray(tick?.data?.danger) ? tick.data.danger : [];
  const tickN: number = Number(tick?.data?.tick ?? 0);
  const endsAt = Number(tick?.endsAt || round.endsAt || 0);
  const { remaining } = useCountdown(endsAt, 200);

  // Own zone is synced from server state (the server assigns starting zones
  // before round_start and updates it on every accepted move).
  const zone: number | null =
    me && me.zone >= 0 && me.zone <= 24 ? me.zone : null;
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    setMoved(false);
  }, [round.roundIndex]);

  // New tick → movement allowance resets.
  const [lastTick, setLastTick] = useState(tickN);
  useEffect(() => {
    if (tickN !== lastTick) {
      setLastTick(tickN);
      setMoved(false);
    }
  }, [tickN, lastTick]);

  const move = (z: number) => {
    if (zone === null || moved || remaining <= 0) return;
    if (!adjacent(zone, z)) return;
    send("move", { zone: z });
    // Server applies the move and syncs the new zone via state.
    setMoved(true);
  };

  const zones = Array.from({ length: SIZE * SIZE }, (_, i) => i);

  return (
    <div className="screen">
      <AliveBadge count={aliveCount} />
      <RoundHeader title={roundTitle(round.type, round.title)} rules={round.rules} />

      <div className="quiz-meta">
        <span>⏳ {Math.ceil(remaining / 1000)} ثوانٍ للتحرك</span>
        <span className={moved ? "ok-text" : "warn-text"}>
          {moved ? STR.moved : "لم تتحرك بعد!"}
        </span>
      </div>
      <TimerBar endsAt={endsAt} totalMs={TICK_MS} />

      <p className="hint center">{STR.survivalHint}</p>

      {zone === null ? (
        <div className="waiting-card">
          <div className="spinner" />
          <p>بانتظار منطقة البداية…</p>
        </div>
      ) : (
        <div className="tile-grid zone-grid" style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}>
          {zones.map((z) => {
            const isMe = z === zone;
            const isDanger = danger.includes(z);
            const canMove = !moved && !isMe && adjacent(zone, z);
            return (
              <button
                key={z}
                className={`tile zone${isMe ? " mine" : ""}${isDanger ? " danger" : ""}${canMove ? " canmove" : ""}`}
                onClick={() => move(z)}
                disabled={!canMove}
                aria-label={`منطقة ${z + 1}`}
              >
                {isMe ? "🧍" : isDanger ? "☠️" : ""}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
