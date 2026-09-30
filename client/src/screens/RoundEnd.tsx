import { useGame } from "../game/useGame";
import { STR } from "../game/strings";
import { Avatar } from "../components/bits";

/** Inter-round results for survivors. */
export default function RoundEndScreen() {
  const { roundEnd, roundIndex, leaderboard, players } = useGame();

  const nameOf = (id: string) => {
    const fromStandings = (roundEnd?.standings ?? leaderboard).find((s) => s.id === id);
    if (fromStandings) return fromStandings.name;
    return players.find((p) => p.id === id)?.name ?? "لاعب";
  };

  const standings = roundEnd?.standings ?? leaderboard;
  const eliminated = roundEnd?.eliminated ?? [];
  const survivors = roundEnd?.survivors ?? players.filter((p) => p.alive).length;

  return (
    <div className="screen">
      <h1 className="screen-title">{STR.roundEndTitle}</h1>
      <p className="hint center">
        {STR.round} {roundIndex + 1} انتهت
      </p>

      <div className="stat-row">
        <div className="stat-card">
          <span className="stat-num">{survivors}</span>
          <span className="stat-label">{STR.survivors} ✅</span>
        </div>
        <div className="stat-card danger-card">
          <span className="stat-num">{eliminated.length}</span>
          <span className="stat-label">{STR.eliminatedList} ❌</span>
        </div>
      </div>

      {eliminated.length > 0 ? (
        <div className="card">
          <h3 className="card-title sm">{STR.eliminatedList}</h3>
          <div className="elim-list">
            {eliminated.slice(0, 12).map((id) => (
              <span key={id} className="elim-chip">
                💀 {nameOf(id)}
              </span>
            ))}
            {eliminated.length > 12 ? (
              <span className="elim-chip more">+{eliminated.length - 12}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="card">
        <h3 className="card-title sm">{STR.standings}</h3>
        <ol className="standings">
          {standings.slice(0, 10).map((s, i) => (
            <li key={s.id} className={`standing${s.alive ? "" : " out"}`}>
              <span className="rank">{i + 1}</span>
              <Avatar name={s.name} size={28} />
              <span className="standing-name">{s.name}</span>
              <span className="standing-score">{s.score}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="waiting-card">
        <div className="spinner" />
        <p>{STR.nextSoon}</p>
      </div>
    </div>
  );
}
