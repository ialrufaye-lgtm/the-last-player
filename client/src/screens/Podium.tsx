import { useGame } from "../game/useGame";
import { STR } from "../game/strings";
import { Avatar } from "../components/bits";

const MEDALS = ["🥇", "🥈", "🥉"];

/** Winner celebration. */
export default function PodiumScreen() {
  const { podium, leaderboard, myId, rejoin } = useGame();

  const winner = podium?.winner;
  const top = podium?.top?.length ? podium.top : leaderboard.slice(0, 10);
  const iWon = !!winner && winner.id === myId;

  return (
    <div className="screen podium-screen">
      <div className="confetti" aria-hidden>
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className={`confetti-piece c${i % 5}`} />
        ))}
      </div>

      <div className="podium-hero">
        <div className="trophy big">🏆</div>
        <h1 className="screen-title">{iWon ? "🎉 أنت الفائز!!" : STR.champion}</h1>
        <div className="winner-name">{winner?.name ?? "…"}</div>
        {iWon ? (
          <p className="winner-sub">أسطوري! صمدت أمام ٩٩ منافسًا وخرجت آخر لاعب 🏆</p>
        ) : (
          <p className="winner-sub">{STR.winner} — {STR.appTagline}</p>
        )}
      </div>

      <div className="card">
        <h3 className="card-title sm">🏅 المراكز الأولى</h3>
        <ol className="standings">
          {top.slice(0, 10).map((s, i) => (
            <li
              key={s.id}
              className={`standing${s.id === myId ? " me" : ""}${i === 0 ? " champ" : ""}`}
            >
              <span className="rank">{MEDALS[i] ?? i + 1}</span>
              <Avatar name={s.name} size={28} />
              <span className="standing-name">{s.name}</span>
              <span className="standing-score">{s.score}</span>
            </li>
          ))}
        </ol>
      </div>

      <button className="btn btn-primary btn-big" onClick={rejoin}>
        {STR.playAgain}
      </button>
    </div>
  );
}
