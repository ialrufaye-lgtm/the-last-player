import { useGame } from "../game/useGame";
import { useCountdown } from "../game/useCountdown";

/** Toast stack (top of screen). */
export function Toasts() {
  const { toasts, dismissToast } = useGame();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className="toast" onClick={() => dismissToast(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

/** Player avatar: initial letter in a gradient circle. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const ch = (name || "?").trim().charAt(0);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden
    >
      {ch}
    </span>
  );
}

/** Horizontal timer bar driven by server endsAt. */
export function TimerBar({ endsAt, totalMs }: { endsAt: number; totalMs: number }) {
  const { remaining } = useCountdown(endsAt, 100);
  const pct = totalMs > 0 ? Math.max(0, Math.min(100, (remaining / totalMs) * 100)) : 0;
  const urgent = remaining < Math.min(3000, totalMs * 0.25);
  return (
    <div className="timerbar" aria-hidden>
      <div
        className={`timerbar-fill${urgent ? " urgent" : ""}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Section heading used across round screens. */
export function RoundHeader({
  title,
  rules,
}: {
  title: string;
  rules?: string;
}) {
  return (
    <div className="round-head">
      <h2 className="round-title">{title}</h2>
      {rules ? <p className="round-rules">{rules}</p> : null}
    </div>
  );
}

/** Pulsing "live" badge with alive count. */
export function AliveBadge({ count }: { count: number }) {
  return (
    <div className="alive-badge">
      <span className="pulse-dot" />
      <span>{count} ما زالوا في الساحة</span>
    </div>
  );
}
