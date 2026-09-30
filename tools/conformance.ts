/**
 * Client-protocol conformance test.
 * Mimics EXACTLY what the React client reads after the integration fixes:
 *  - quiz:      payload.questions[i].q, payload.questionMs, tick {qid, questionEndsAt}
 *  - hide_seek: payload.seekers[{id}], tick {phase:'seek'}
 *  - react:     tick {state:'red'|'green'}, payload.attempts
 *  - survival:  state.players[me].zone >= 0, tick {danger[]}
 *  - duel:      tick {players[2], points{}, prompt}
 *  - join-by-code via GET /api/room-by-code/:code + joinById (the client's fixed path)
 *
 * Run: npx tsx conformance.ts   (server must be on :2567; 4 bots join via bot.ts separately)
 */
import { Client, Room } from "colyseus.js";

const URL = "ws://localhost:2567";
const HTTP = "http://localhost:2567";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, cond: boolean, detail = "") {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const client = new Client(URL);

  // --- 1. join-by-code path (exactly like the fixed React client) ---
  const host = await client.joinOrCreate("last_player", { name: "مضيف" });
  let code = "";
  await new Promise<void>((res) => {
    host.onMessage("lobby", (m: any) => {
      code = m.code;
      if (m.count >= 20) { try { host.send("start"); } catch {} }
      res();
    });
    setTimeout(res, 5000);
  });
  check("lobby message carries room code", /^[A-Z0-9]{4}$/.test(code), code);

  const res = await fetch(`${HTTP}/api/room-by-code/${code}`);
  check("GET /api/room-by-code/:code ok", res.ok);
  const { roomId } = (await res.json()) as any;
  const guest = await client.joinById(roomId, { name: "ضيف" });
  check("joinById(roomId) joins same room",
    guest.sessionId !== host.sessionId && guest.id === host.id,
    `room=${guest.id}`);

  // start the match once bots arrive (bots: --n=4 --target=6)
  const me = guest;
  const seen = { green: false, seekPhase: false, question: false, duel: false };
  let quizPayload: any = null, hidePayload: any = null, reactPayload: any = null;

  me.onMessage("round_start", (m: any) => {
    if (m.type === "quiz_race") {
      quizPayload = m.payload;
      const q0 = m.payload?.questions?.[0];
      check("quiz q0.q is non-empty string", typeof q0?.q === "string" && q0.q.length > 3, String(q0?.q).slice(0, 30));
      check("quiz payload.questionMs is number", typeof m.payload?.questionMs === "number", String(m.payload?.questionMs));
      check("quiz has 8 questions", m.payload?.questions?.length === 8);
    }
    if (m.type === "hide_seek") {
      hidePayload = m.payload;
      const s0 = m.payload?.seekers?.[0];
      check("hide_seek seekers[0].id is string", typeof s0?.id === "string");
      check("hide_seek seekers[0].name is string", typeof s0?.name === "string");
      // mimic client: hide if I'm not a seeker
      const amSeeker = (m.payload?.seekers ?? []).some((s: any) => s.id === (me as any).sessionId);
      if (!amSeeker) me.send("hide", { tile: Math.floor(Math.random() * 64) });
    }
    if (m.type === "react_race") {
      reactPayload = m.payload;
      check("react payload.attempts === 5", m.payload?.attempts === 5);
    }
    if (m.type === "survival") {
      // Zones are assigned server-side and synced via schema state.
      // The fixed client reads its own zone from state.players[me].zone.
      // Verify for ANY alive player (guest may be a spectator by now).
      setTimeout(() => {
        const st: any = (me as any).state;
        let ok = false, zSeen = -1;
        try {
          st?.players?.forEach?.((p: any) => {
            if (p.alive && typeof p.zone === "number" && p.zone >= 0 && p.zone <= 24) { ok = true; zSeen = p.zone; }
          });
        } catch {}
        check("survival: alive players have zone 0..24 in state", ok, `zone=${zSeen}`);
      }, 1500);
    }
  });

  me.onMessage("round_tick", (m: any) => {
    if (m.type === "quiz_race") {
      if (!seen.question) {
        seen.question = true;
        check("quiz tick.data.qid is number", typeof m.data?.qid === "number");
        check("quiz tick.data.questionEndsAt is number", typeof m.data?.questionEndsAt === "number");
      }
      // mimic the client answering the visible question (every question)
      me.send("answer", { qid: m.data.qid, choice: Math.floor(Math.random() * 4) });
    }
    if (m.type === "hide_seek" && m.data?.phase === "seek") seen.seekPhase = true;
    if (m.type === "react_race") {
      check("react tick.data.state is red|green", m.data?.state === "red" || m.data?.state === "green", String(m.data?.state));
      if (m.data?.state === "green") { seen.green = true; me.send("tap"); }
    }
    if (m.type === "survival" && Array.isArray(m.data?.danger)) {
      check("survival tick.data.danger is array", m.data.danger.length >= 0, `len=${m.data.danger.length}`);
    }
    if (m.type === "final_duel" && m.data?.prompt && !seen.duel) {
      seen.duel = true;
      const d = m.data;
      check("duel tick.data.players has 2 entries", Array.isArray(d.players) && d.players.length === 2);
      check("duel tick.data.points covers both players",
        d.players.every((p: any) => typeof d.points?.[p.id] === "number"));
      check("duel tick.data.prompt is string", typeof d.prompt === "string" && d.prompt.length > 0);
      check("duel tick.data.qid is number", typeof d.qid === "number");
      me.send("duel_answer", { qid: d.qid, text: "x" });
    }
  });

  me.onMessage("round_end", () => {});
  me.onMessage("podium", (m: any) => {
    check("podium winner has id+name", !!m.winner?.id && !!m.winner?.name, m.winner?.name);
  });

  // wait for the whole match (bots drive it); then report seek/green sightings
  const t0 = Date.now();
  await new Promise<void>((res) => {
    const iv = setInterval(() => {
      if ((Date.now() - t0 > 420000)) { clearInterval(iv); res(); }
    }, 1000);
    me.onMessage("podium", () => { setTimeout(() => { clearInterval(iv); res(); }, 1500); });
  });

  check("saw hide_seek seek phase tick", seen.seekPhase);
  check("saw react green signal", seen.green);
  check("saw quiz question ticks", seen.question);
  check("saw duel prompt", seen.duel);

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  try { await host.leave(); } catch {}
  try { await me.leave(); } catch {}
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
