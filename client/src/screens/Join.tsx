import { useState } from "react";
import { SERVER_URL, useGame } from "../game/useGame";
import { STR } from "../game/strings";

export default function JoinScreen() {
  const { join, status, error } = useGame();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const busy = status === "connecting";

  const submit = () => void join(name, code);

  return (
    <div className="screen join-screen">
      <div className="hero">
        <div className="trophy">🏆</div>
        <h1 className="app-name">{STR.appName}</h1>
        <p className="tagline">{STR.appTagline}</p>
        <div className="hero-chips">
          <span>🧩 ألغاز</span>
          <span>⚡ سباقات</span>
          <span>🙈 اختباء</span>
          <span>🧠 ذكاء</span>
          <span>🔥 بقاء</span>
        </div>
        <p className="hero-desc">
          ١٠٠ لاعب يدخلون ساحة واحدة — بلا إطلاق نار.
          <br />
          تحدَّ، اسبق، اختبئ، انجُ… وكن آخر لاعب صامد.
        </p>
      </div>

      <div className="card">
        <h2 className="card-title">{STR.joinTitle}</h2>

        <label className="field">
          <span>{STR.nameLabel}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={STR.namePlaceholder}
            maxLength={20}
            autoComplete="nickname"
            enterKeyHint="next"
          />
        </label>

        <label className="field">
          <span>{STR.codeLabel}</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder={STR.codePlaceholder}
            maxLength={8}
            className="code-input"
            autoCapitalize="characters"
            enterKeyHint="go"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </label>

        {error ? <div className="error-box">{error}</div> : null}

        <button className="btn btn-primary btn-big" onClick={submit} disabled={busy}>
          {busy ? STR.connecting : STR.joinBtn}
        </button>
        <p className="hint">{STR.joinHint}</p>
      </div>

      <p className="server-note">
        {STR.serverLabel}: <code dir="ltr">{SERVER_URL}</code>
      </p>
    </div>
  );
}
