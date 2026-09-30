import { useGame } from "../game/useGame";
import { STR } from "../game/strings";

export default function DisconnectedScreen() {
  const { rejoin } = useGame();
  return (
    <div className="screen center-screen">
      <div className="trophy">📡</div>
      <h1 className="screen-title">{STR.disconnected}</h1>
      <p className="hint">{STR.disconnectedHint}</p>
      <button className="btn btn-primary btn-big" onClick={rejoin}>
        {STR.rejoin}
      </button>
    </div>
  );
}
