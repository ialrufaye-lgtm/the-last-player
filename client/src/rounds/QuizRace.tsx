import { useEffect, useRef, useState } from "react";
import { useGame } from "../game/useGame";
import { useCountdown } from "../game/useCountdown";
import { RoundHeader, TimerBar, AliveBadge } from "../components/bits";
import { roundTitle, STR } from "../game/strings";
import type { QuizQuestion, RoundStartMsg, RoundTickMsg } from "../game/types";

const CHOICE_LETTERS = ["أ", "ب", "ج", "د"];

/**
 * quiz_race — 8 questions, 12s each. The server is authoritative about the
 * current question via round_tick.data.qIndex; we fall back to a local
 * 12s cadence if ticks are not provided.
 */
export default function QuizRace({
  round,
  tick,
}: {
  round: RoundStartMsg;
  tick: RoundTickMsg | null;
}) {
  const { send, aliveCount } = useGame();
  const questions: QuizQuestion[] = Array.isArray(round.payload?.questions)
    ? round.payload.questions
    : [];
  const perQuestionMs: number = Number(
    round.payload?.questionMs ?? round.payload?.perQuestionMs ?? 12000
  );

  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [localIdx, setLocalIdx] = useState(0);
  const roundStartRef = useRef(Date.now());

  useEffect(() => {
    setAnswers({});
    setLocalIdx(0);
    roundStartRef.current = Date.now();
  }, [round.roundIndex]);

  // Server ticks carry { qid, questionEndsAt }; accept legacy qIndex too.
  const tickQid: number | null =
    tick?.data && typeof tick.data.qid === "number"
      ? tick.data.qid
      : tick?.data && typeof tick.data.qIndex === "number"
        ? tick.data.qIndex
        : null;
  const authoritative = tickQid !== null;

  useEffect(() => {
    if (authoritative) return;
    if (localIdx >= questions.length) return;
    const id = window.setTimeout(() => setLocalIdx((i) => i + 1), perQuestionMs);
    return () => window.clearTimeout(id);
  }, [localIdx, authoritative, perQuestionMs, questions.length]);

  const qIndex = authoritative
    ? Math.min(tickQid as number, questions.length - 1)
    : Math.min(localIdx, questions.length - 1);
  const q = questions[qIndex];

  const windowMs = perQuestionMs;
  const windowEndsAt = authoritative
    ? Number(tick!.data.questionEndsAt || tick!.endsAt || 0)
    : roundStartRef.current + (qIndex + 1) * perQuestionMs;
  const { remaining } = useCountdown(windowEndsAt, 100);

  if (!q) {
    return (
      <div className="screen">
        <RoundHeader title={roundTitle(round.type, round.title)} rules={round.rules} />
        <div className="waiting-card">
          <div className="spinner" />
          <p>{STR.waitingRound}</p>
        </div>
      </div>
    );
  }

  const answered = answers[q.qid] !== undefined;
  const finished = qIndex >= questions.length - 1 && remaining <= 0;

  const choose = (ci: number) => {
    if (answered || remaining <= 0) return;
    send("answer", { qid: q.qid, choice: ci });
    setAnswers((a) => ({ ...a, [q.qid]: ci }));
  };

  return (
    <div className="screen">
      <AliveBadge count={aliveCount} />
      <RoundHeader title={roundTitle(round.type, round.title)} rules={round.rules} />

      <div className="quiz-meta">
        <span>
          السؤال {Math.min(qIndex + 1, questions.length)} / {questions.length}
        </span>
        <span className="quiz-clock">{Math.ceil(remaining / 1000)}⏱</span>
      </div>
      <TimerBar endsAt={windowEndsAt} totalMs={windowMs} />

      {finished ? (
        <div className="waiting-card">
          <div className="spinner" />
          <p>انتهت الأسئلة — جارٍ حساب النتائج…</p>
        </div>
      ) : (
        <>
          <div className="quiz-q">{q.q ?? q.question}</div>
          <div className="quiz-choices">
            {q.choices.map((c, ci) => {
              const mine = answers[q.qid] === ci;
              return (
                <button
                  key={ci}
                  className={`choice${mine ? " picked" : ""}${answered ? " locked" : ""}`}
                  onClick={() => choose(ci)}
                  disabled={answered}
                >
                  <span className="choice-letter">{CHOICE_LETTERS[ci] ?? ci + 1}</span>
                  <span className="choice-text">{c}</span>
                  {mine ? <span className="choice-check">✓</span> : null}
                </button>
              );
            })}
          </div>
          <p className="hint center">
            {answered ? STR.answerSent : STR.chooseAnswer}
          </p>
        </>
      )}
    </div>
  );
}
