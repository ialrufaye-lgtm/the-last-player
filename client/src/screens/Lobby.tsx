import { useState } from "react";
import { useGame } from "../game/useGame";
import { STR } from "../game/strings";
import { Avatar } from "../components/bits";

const MIN_PLAYERS = 10;

export default function LobbyScreen() {
  const { lobby, players, myId, isHost, send, aliveCount } = useGame();
  const [copied, setCopied] = useState(false);

  const code = lobby?.code ?? "…";
  const canStart = lobby?.canStart ?? false;
  const sorted = [...players].sort((a, b) => {
    if (a.id === myId) return -1;
    if (b.id === myId) return 1;
    return a.name.localeCompare(b.name, "ar");
  });

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // clipboard may be unavailable; still show feedback
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="screen">
      <div className="lobby-top">
        <h1 className="screen-title">{STR.lobbyTitle}</h1>
        <div className="code-card" onClick={copyCode} role="button" tabIndex={0}>
          <span className="code-label">{STR.roomCode}</span>
          <span className="code-value" dir="ltr">
            {code}
          </span>
          <span className="code-copy">{copied ? STR.copied : `📋 ${STR.copy}`}</span>
        </div>
        <div className="count-pill">
          <span className="count-num">{players.length}</span>
          <span className="count-sep">/</span>
          <span>100</span>
          <span className="count-label">{STR.playersInRoom}</span>
        </div>
      </div>

      <div className="roster">
        {sorted.map((p) => (
          <div
            key={p.id}
            className={`roster-card${p.id === myId ? " me" : ""}${p.connected === false ? " dc" : ""}`}
          >
            <Avatar name={p.name} size={38} />
            <span className="roster-name">{p.name}</span>
            {p.isHost ? <span className="badge host">👑 {STR.hostBadge}</span> : null}
            {p.id === myId ? <span className="badge me-badge">{STR.youBadge}</span> : null}
          </div>
        ))}
        {players.length === 0 ? (
          <p className="hint">{STR.waitingForPlayers}</p>
        ) : null}
      </div>

      <div className="lobby-footer">
        {isHost ? (
          <>
            <button
              className="btn btn-primary btn-big"
              disabled={!canStart}
              onClick={() => send("start")}
            >
              {STR.startBtn}
            </button>
            {!canStart ? (
              <p className="hint">{STR.startHint(MIN_PLAYERS)}</p>
            ) : (
              <p className="hint ok">
                {players.length} {STR.playersInRoom} — جاهزون للانطلاق!
              </p>
            )}
          </>
        ) : (
          <div className="waiting-card">
            <div className="spinner" />
            <p>{STR.waitingForPlayers}</p>
            <p className="hint">{STR.shareCode}</p>
          </div>
        )}
      </div>
      <span className="sr-only">{aliveCount} أحياء</span>
    </div>
  );
}
