# THE LAST PLAYER — Server notes

## Run

```bash
cd ~/workspace/last-player/server
npm install          # pinned: colyseus@0.16.5, @colyseus/schema@3.0.76,
                     #         @colyseus/ws-transport@0.16.5, express@4.21.2
npm run build        # tsc -> dist/ (must pass with zero errors)
npm start            # node dist/index.js  (PORT env, default 2567)
npm run dev          # ts-node src/index.ts (dev)
```

Env (`server/.env`, see `.env.example`; a tiny dependency-free loader reads it):
`PORT=2567`, `MIN_PLAYERS=10`, `DEV_MIN_PLAYERS=4` (when set, overrides
`MIN_PLAYERS`), `CONTENT_DIR` (optional override for `content/`).

`npm start` was boot-tested: prints `[server] listening on :2567`, serves
`GET /health` → `{ok, rooms, time}`, serves the built client from
`../client/dist` when `index.html` exists there, otherwise a plain-text stub.

## Files

- `src/index.ts` — express + http + Colyseus `Server` (`WebSocketTransport`);
  defines room `last_player`; `GET /api/room-by-code/:code` → `{code, roomId}`
  (404 `{error:"code_not_found"}`); static client serving.
- `src/room.ts` — `LastPlayerRoom`: 4-char codes (metadata + in-process
  registry), 100-player cap (`room_full`), host start, lobby countdown,
  match orchestration, watchdog (3× budget → force-resolve), anti-spam
  (10 msgs/sec/client, extras dropped), 60s reconnection in lobby/countdown
  (`allowReconnection`), mid-match disconnects → `alive=false` at next round
  end, leaderboard rebuilt at every round end.
- `src/rounds.ts` — the 5 round state machines, exactly per protocol:
  `quiz_race` (8×12s, bottom 40%), `hide_seek` (20s hide / 15s seek, top-5
  seekers, Shadow to ~40%, skipped if alive < 12), `react_race` (5 attempts,
  bottom 50%), `survival` (5×5, 6s ticks, 8 ticks max, cut to 4),
  `final_duel` (best-of-5 bouts, 15s free-text questions, 1v4/2v3 semis).
- `src/schema.ts` — `GameState`/`Player`/`Standing` (protocol state shape).
- `src/content.ts` — loads `content/quiz.json`, `riddles.json`,
  `sequences.json`, `strings.json` at boot; validates entries; falls back to
  built-in banks so the server always boots and runs.
- `src/code.ts` — 4-char code generator (unambiguous A-Z0-9).

## Protocol deviations / judgment calls

1. **Code routing.** Colyseus 0.16 `joinOrCreate` cannot filter rooms by
   metadata, so true server-side routing by `{code}` isn't possible. Instead:
   `GET /api/room-by-code/:code` resolves code → `roomId`; the client then
   uses `joinById(roomId, {name})`. If a client still passes `{code}` to
   `joinOrCreate` and lands in a room with a different code, the join is
   rejected with `wrong_code` and the client falls back to the lobby pool —
   matching the protocol's prescribed UX.
2. **Tie handling in cuts.** Ties at the elimination boundary all survive;
   if that would eliminate nobody (giant tie group), the cut is trimmed to
   the target count — the protocol's "nearest sane cut".
3. **Scoring beyond quiz.** The protocol only defines quiz scoring
   (`1000 + 500·(1−ms/12000)`). To feed "total score" (seekers, cuts,
   duel seeding): react `+max(0, 1200−avgMs)`, survival `+250`/tick,
   hide&seek `+500` for survivors, duel `+500`/point and `+1000`/bout win.
4. **Survival moves:** last move inside the tick window wins (same
   "last wins" rule the protocol states for `hide`).
5. **Duel with 3 players:** top scorer gets the bye (protocol's odd-count
   rule), semifinal of the other two, then the final.
6. **Quiz/react:** first answer / first tap per question/attempt counts;
   taps before green void that attempt (`9999ms`).
7. **Pacing:** lobby countdown 5s, 6s `roundEnd` between rounds. Room locks
   at match start (no mid-match joins); podium room lives until empty, then
   Colyseus auto-disposes it.

## Test report (2026-09-29, real colyseus.js clients)

- Full match, 6 bots, `DEV_MIN_PLAYERS=2`: lobby → countdown → quiz_race
  (6→4) → hide_seek skipped (alive<12) → react_race (4→2) → survival
  (2→2) → final_duel (2→1) → podium. **Exactly 1 winner, zero crashes,
  no watchdog triggers.**
- Wrong-code join rejected with `wrong_code` ✓
- Abrupt lobby disconnect + `client.reconnect(token)` within 60s:
  **same session restored, seat intact** ✓
- During the test the `content/` banks appeared (150 quiz / 80 riddles /
  40 sequences / strings) and were picked up live with no restart issues.

## Environment note

The first `npm install` hung with no output (a stale lock from a killed
attempt); after clearing `node_modules` it completed normally
(194 packages). Pinned versions above install cleanly.
