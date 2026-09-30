import { useEffect, useState } from "react";

/**
 * Countdown derived from the server's `endsAt` (server ms epoch).
 * NOTE: no clock-skew correction is applied — see CLIENT_NOTES.md.
 */
export function useCountdown(endsAt: number, tickMs = 100) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);

  const remaining = Math.max(0, (endsAt || 0) - now);
  return {
    remaining,
    seconds: Math.ceil(remaining / 1000),
    done: remaining <= 0,
  };
}

export function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}`;
}
