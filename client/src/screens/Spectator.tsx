import { useGame } from "../game/useGame";
import { STR } from "../game/strings";
import { Avatar, AliveBadge } from "../components/bits";

/** Shown to eliminated players: personal reason + live leaderboard. */
export default function SpectatorScreen() {
  const { eliminatedReason, leaderboard, aliveCount, players, myId } = useGame();

  const board = leaderboard.length > 0 ? leaderboard : players.map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    alive: p.alive,
  }));
  const sorted = [...board].sort((a, b) => b.score - a.score);

  return (
    <div className="screen">
      <div className="elim-banner">
        <div className="elim-emoji">💀</div>
        <h1 className="screen-title">{STR.eliminatedTitle}</h1>
        {eliminatedReason ? <p className="elim-reason">{eliminatedReason}</p> : null}
        <p className="hint">{STR.spectatorNote}</p>
      </div>

      <AliveBadge count={aliveCount} />

      <div className="card">
        <h3 className="card-title sm">📊 {STR.standings} المباشر</h3>
        <ol className="standings">
          {sorted.map((s, i) => (
            <li
              key={s.id}
              className={`standing${s.alive ? "" : " out"}${s.id === myId ? " me" : ""}`}
            >
              <span className="rank">{i + 1}</span>
              <Avatar name={s.name} size={28} />
              <span className="standing-name">{s.name}</span>
              <span className="standing-score">{s.score}</span>
              <span className="standing-state">{s.alive ? "🟢" : "💀"}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
