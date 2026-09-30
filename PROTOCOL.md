# THE LAST PLAYER 🏆 — Protocol v1 (shared contract)

100-player online battle royale WITHOUT combat. Rounds: puzzles, races, hide & seek,
intelligence, survival. Last player standing wins. Server-authoritative.

## Stack
- Server: Node 20+, TypeScript, `colyseus` (^0.16) + `@colyseus/schema`. Dir: `server/`.
- Client: Vite + React + TypeScript + `colyseus.js` (^0.16). Arabic-first, RTL, mobile-first. Dir: `client/`.
- Content: JSON banks in `content/` (loaded by server at boot). Dir: `content/`.
- Bots: `tools/bot.ts` — colyseus.js client, plausible random play, staggered joins.
- All game logic on server. Client sends intents; server validates & resolves.
- `npm run build` must pass in both `server/` and `client/` (tsc, no errors).

## Room lifecycle
- Room name: `last_player`.
- Create: `client.joinOrCreate("last_player", { name })` → creator becomes host.
- Join: `client.joinOrCreate("last_player", { name, code })` → server routes to the
  room whose metadata.code matches (4 chars A-Z0-9). Wrong code → join the lobby pool
  (a fresh waiting room) — client shows "code not found, created new lobby".
- Cap 100 players/room. Beyond 100 → reject with message `room_full`.
- Phases (`state.phase`): `lobby → countdown → round → roundEnd → … → podium`.
- Host starts when ≥ 10 players (`"start"` message from host only). Min 4 for testing.
- Disconnect mid-match: player marked `alive=false` at next round end (no rejoin mid-round).
  Reconnect within 60s during lobby/countdown restores seat (Colyseus `allowReconnection`).

## State (Colyseus Schema) — keep minimal, deltas only
- `players: MapSchema<Player>` — Player: `id, name, alive:boolean, score:number,
  isHost:boolean, connected:boolean`, plus transient per-round fields reused by name:
  `tile:number (-1), zone:number (-1), lastAnswerMs:number`.
- `phase:string, roundIndex:number, roundType:string, endsAt:number` (server ms epoch),
  `aliveCount:number`.
- `leaderboard: ArraySchema<{id,name,score,alive}>` — updated at round ends only.
- Round payloads (questions, grids, zones) go via messages, NOT schema.

## Messages
Client → server (`room.send`):
- `"start"` — host only, from lobby.
- `"answer"` `{ qid:number, choice:number }` — quiz_race / duel rounds. Server timestamps receipt.
- `"hide"` `{ tile:number }` — 0..63. One per hide phase; last one wins.
- `"seek"` `{ tiles:number[] }` — seekers only, max 3, 0..63.
- `"tap"` — react_race tap (server records time; validates vs green window).
- `"move"` `{ zone:number }` — survival, 0..24, must be orthogonally adjacent (staying put = elimination).
- `"duel_answer"` `{ qid:number, text:string }` — final duel, free text normalized server-side.

Server → client (`room.onMessage` / broadcast):
- `"round_start"` `{ roundIndex, type, title, rules, endsAt, payload }`
- `"round_tick"` `{ type, endsAt, data }` — countdowns, zone danger map, seeker picks, etc.
- `"round_end"` `{ eliminated:string[] (ids), survivors:number, standings:[{id,name,score,alive}] }`
- `"eliminated"` `{ reason:string }` — personal.
- `"podium"` `{ winner:{id,name}, top:[{id,name,score}] }`
- `"toast"` `{ text:string }`
- `"lobby"` `{ code, players:[{id,name}], count, canStart }` — on every lobby change.

Per-round payload/tick shapes (client reads these exact fields — keep in sync):
- `quiz_race`: `round_start.payload = { questions:[{qid, q, choices}], questionMs, startsAt }`;
  ticks `{ type, endsAt, data:{ qid, questionEndsAt } }`. Client sends `"answer" { qid, choice }`.
- `hide_seek`: `round_start.payload = { grid:8, hideEndsAt, seekEndsAt, seekers:[{id,name}] }`;
  seek-phase tick `{ type, endsAt, data:{ phase:"seek", seekEndsAt } }`;
  seeker-pick ticks `{ type, endsAt, data:{ seeker:name, tiles } }`.
  Client sends `"hide" { tile }`, `"seek" { tiles:number[] (≤3) }`.
- `react_race`: `round_start.payload = { attempts:5 }`;
  ticks `{ type, endsAt, data:{ attempt (0-based), state:"red"|"green", greenAt? } }`.
  Client sends `"tap"` (no payload).
- `survival`: `round_start.payload = { grid:5, ticks:8, tickMs:6000 }`;
  each player's start zone is assigned server-side and synced via **schema**
  (`state.players[id].zone`, 0..24); ticks `{ type, endsAt, data:{ tick, danger:number[], tickEndsAt, alive:string[] } }`.
  Client sends `"move" { zone }` (must be orthogonally adjacent).
- `final_duel`: question ticks `{ type, endsAt, data:{ bout (0-based), qid, prompt, questionEndsAt,
  players:[{id,name} (2)], points:{[id]:number} } }`; result ticks
  `{ type, endsAt, data:{ bout, qid, pointTo:id|null, points } }`.
  Client sends `"duel_answer" { qid, text }`.

## Rounds (server state machines; use clock timeouts, all durations from endsAt)
Targets auto-balance so matches reliably converge to 1 winner.

1. `quiz_race` — 8 questions from `content/quiz.json`, 12s each. Correct → `1000 + timeBonus`
   (timeBonus = 500 * (1 - ms/12000)). Eliminate bottom 40% by round score (ties → all survive
   if that keeps >= target survivors; server trims to nearest sane cut).
2. `hide_seek` — 8x8 grid (tiles 0..63). 20s hide (`"hide"`). Seekers = top 5 alive by total
   score (fallback: random alive). Seekers get 15s, 3 tiles each (`"seek"`). Then the Shadow
   (server) picks random tiles from still-occupied tiles until total caught ≈ 40% of hiders.
   Caught → eliminated. Non-seekers who never hid → auto random tile. If alive < 12, skip round.
3. `react_race` — 5 attempts. Each: red wait 1200–3000ms → green; client taps (`"tap"`).
   Valid tap ms recorded; early tap (during red) voids that attempt (= 9999ms). Score =
   average of best 3 valid attempts. Eliminate bottom 50%.
4. `survival` — 5x5 zone map (0..24). Tick every 6s. Each tick server marks 4 new danger
   zones (broadcast via `round_tick`). Players must `"move"` to an orthogonally adjacent
   zone each tick (staying = elimination). On danger zone at tick end or no move →
   eliminated. Ends when alive ≤ 4 or after 8 ticks (then cut lowest total score down to 4).
5. `final_duel` — remaining 2–4 players. If 4: semifinals pair 1v4, 2v3 by score. Best-of-5:
   each bout = rapid puzzle (riddle / arithmetic / sequence from content), 15s, free-text
   answer; correct+fastest wins the point; first to 3 points wins the bout. Winner = THE LAST PLAYER.

Odd counts anywhere → highest total score gets a bye. All eliminations announced with
`round_end.eliminated` ids + `eliminated` personal message with Arabic reason.

## Timing & fairness
- Every timed window derives from server `endsAt`; client renders countdown from it.
- Server timestamps all intents on receipt; late intents after window close are ignored.
- Anti-spam: max 10 msgs/sec per client; extras dropped.

## Bots (`tools/bot.ts`, run with tsx or ts-node)
- Args: `--n=100 --room=<roomId|code> --server=ws://localhost:2567`.
- Behavior: joins with staggered delay (0–3s), auto-answers quiz (70% correct, 1–6s delay),
  random tile hide, seeker picks random tiles, taps 200–600ms after green (poll state),
  moves to random adjacent safe zone, duel answers random text (occasionally correct).
- Bots make load-testing possible: `npm run bots -- --n=100`.

## Config
- `server/.env`: `PORT=2567`, `MIN_PLAYERS=10` (4 in dev via `DEV_MIN_PLAYERS=4`).
- Content files: `content/quiz.json`, `content/riddles.json`, `content/sequences.json`,
  `content/strings.json` (Arabic UI strings: round titles, rules, elimination reasons).
- Dockerfile at repo root builds server; client builds to static `client/dist`
  served by the same process in production (single deployable).

## Definition of done
- Server boots, creates rooms, runs a full match lobby→podium with zero crashes.
- 100 bots complete a full match; exactly 1 winner; no stuck rounds (watchdog: any round
  exceeding 3x its budget force-resolves).
- Client renders every screen on mobile viewport; RTL; no console errors in happy path.
