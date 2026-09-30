import { useEffect, useRef, useState } from "react";
import { useGame } from "../game/useGame";
import { useCountdown } from "../game/useCountdown";
import { RoundHeader, TimerBar, AliveBadge } from "../components/bits";
import { roundTitle, STR } from "../game/strings";
import type { RoundStartMsg, RoundTickMsg } from "../game/types";

/**
 * final_duel — best-of-5 bouts, first to 3 points. Each bout is a rapid puzzle
 * (riddle / arithmetic / sequence); free-text answer via "duel_answer".
 * Per-bout state arrives via round_start payload or round_tick data:
 * { bout, qid, prompt, players: [{id,name}], points: {[id]: n} }.
 */
export default function FinalDuel({
  round,
  tick,
}: {
  round: RoundStartMsg;
  tick: RoundTickMsg | null;
}) {
  const { send, aliveCount, myId } = useGame();

  const d: any = (tick && tick.data) || round.payload || {};
  const qid: number = Number(d.qid ?? 0);
  const bout: number = Number(d.bout ?? 0);
  const dplayers: { id: string; name: string }[] = Array.isArray(d.players)
    ? d.players
    : [];
  const pts: Record<string, number> =
    d.points && typeof d.points === "object" ? d.points : {};
  const oppEntry = dplayers.find((p) => p.id !== myId);
  const you: number = Number(pts[myId ?? ""] ?? d.you ?? 0);
  const opp: number = Number(
    (oppEntry ? pts[oppEntry.id] : undefined) ?? d.opp ?? 0
  );
  const oppName: string = oppEntry?.name ?? "الخصم";

  // The result tick (pointTo) carries no prompt — keep showing the question's.
  const promptRef = useRef<string>("");
  useEffect(() => {
    if (d.prompt) promptRef.current = String(d.prompt);
  }, [qid]);
  const prompt: string = d.prompt
    ? String(d.prompt)
    : promptRef.current || "…";
  const endsAt = Number(d.endsAt || tick?.endsAt || round.endsAt || 0);
  const windowMs = 15000;
  const { remaining } = useCountdown(endsAt, 100);

  const [text, setText] = useState("");
  const [sentFor, setSentFor] = useState<number | null>(null);

  useEffect(() => {
    setText("");
    // keep sentFor per qid so a new bout re-enables the input
  }, [qid, round.roundIndex]);

  const sent = sentFor === qid;
  const canSend = !sent && text.trim().length > 0 && remaining > 0;

  const submit = () => {
    if (!canSend) return;
    send("duel_answer", { qid, text: text.trim() });
    setSentFor(qid);
  };

  const dots = (n: number) =>
    Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={`duel-dot${i < n ? " won" : ""}`} />
    ));

  return (
    <div className="screen">
      <AliveBadge count={aliveCount} />
      <RoundHeader title={roundTitle(round.type, round.title)} rules={round.rules} />

      <div className="duel-score">
        <div className="duel-side">
          <span className="duel-name">أنت</span>
          <div className="duel-dots">{dots(you)}</div>
        </div>
        <div className="duel-vs">⚔️</div>
        <div className="duel-side">
          <span className="duel-name">{oppName}</span>
          <div className="duel-dots">{dots(opp)}</div>
        </div>
      </div>
      <p className="hint center">
        {STR.bout} {bout + 1} — {STR.duelHint}
      </p>

      <div className="quiz-meta">
        <span>⏱ {Math.ceil(remaining / 1000)} ثانية</span>
      </div>
      <TimerBar endsAt={endsAt} totalMs={windowMs} />

      <div className="duel-prompt">{prompt}</div>

      {sent ? (
        <div className="waiting-card">
          <div className="spinner" />
          <p>{STR.duelSent}</p>
        </div>
      ) : (
        <div className="duel-form">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={STR.duelPlaceholder}
            maxLength={60}
            enterKeyHint="send"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <button className="btn btn-primary" disabled={!canSend} onClick={submit}>
            {STR.duelSend}
          </button>
        </div>
      )}
    </div>
  );
}
