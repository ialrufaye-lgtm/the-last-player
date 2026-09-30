# THE LAST PLAYER — Client Notes

Web client: **Vite + React 18 + TypeScript + colyseus.js ^0.16**, in `client/`.
Arabic-first, full RTL (`<html dir="rtl" lang="ar">`), mobile-first (max-width 520px),
dark "arena" aesthetic. All UI strings are hardcoded Arabic in `src/game/strings.ts`.

## Run / dev

```bash
cd ~/workspace/last-player/client
npm install          # once
npm run dev          # dev server → http://localhost:5173
npm run build        # tsc + vite build → client/dist  (must pass with zero errors)
npm run preview      # serve the production build locally
```

Server URL resolution: `VITE_SERVER_URL` env var if set, otherwise
`ws://<page-hostname>:2567` (so a phone opening the page served from the dev
machine's LAN IP connects to the server on the same host).

## Screens & flow

| Phase / state | Screen |
|---|---|
| not connected | `Join` — name + optional room code → `joinOrCreate("last_player", {name, code?})` |
| `lobby` | `Lobby` — roster grid, count/100, room code + copy, host start button (enabled via `lobby.canStart`) |
| `countdown` | `CountdownOverlay` — big seconds from state `endsAt` |
| `round` (alive) | round UI per `round_start.type`: `quiz_race`, `hide_seek`, `react_race`, `survival`, `final_duel` |
| `round`/`roundEnd` (eliminated) | `Spectator` — elimination reason + live leaderboard |
| `roundEnd` (alive) | `RoundEnd` — survivors/eliminated counts, standings |
| `podium` | `Podium` — winner celebration + top list + confetti |

All server messages are handled in `src/game/useGame.tsx`:
`lobby`, `round_start`, `round_tick`, `round_end`, `eliminated`, `podium`, `toast`,
plus `room.onStateChange` (players map, phase, roundIndex, roundType, endsAt,
aliveCount, leaderboard) and `room.onLeave` → disconnected screen with rejoin.

Every timed window renders from a server `endsAt` (state `endsAt`, `round_start.endsAt`,
`round_tick.endsAt`) via the `useCountdown` hook.

## Round UI behaviour

- **quiz_race**: answers via `"answer" {qid, choice}`; one answer per question, timer
  bar per question. Authoritative question index from `tick.data.qIndex`; falls back
  to a local 12s cadence (`payload.perQuestionMs ?? 12000`) if ticks carry no index.
- **hide_seek**: 8×8 grid. Hiders tap a tile → `"hide" {tile}` (re-tap to change —
  last one wins). Seekers (`payload.isSeeker` or id in `payload.seekers`) pick up to
  3 tiles → `"seek" {tiles}` with a confirm button. `tick.data.caught` tiles are
  marked ✕; `tick.data.stage` is `"hide"` or `"seek"`.
- **react_race**: pad is red until `tick.data.signal === "green"`, then tap → `"tap"`.
  Attempt dots from `tick.data.attempt / attempts`.
- **survival**: 5×5 grid; danger zones from `tick.data.danger`; tap an orthogonally
  adjacent zone → `"move" {zone}` (optimistic). Movement allowance resets each tick
  (`tick.data.tick`).
- **final_duel**: bout state from `tick.data` (or `round_start.payload`):
  `{bout, qid, prompt, endsAt, you, opp}`; free-text input → `"duel_answer" {qid, text}`.

## Protocol deviations & assumptions (server team: please confirm)

1. **Payload shapes are assumed, not specified.** The protocol says round payloads go
   via messages but doesn't fix their fields. The client accepts the shapes above
   and degrades gracefully (spinners / sensible defaults) when fields are absent.
2. **No clock-skew correction.** Countdowns use `endsAt - Date.now()` directly.
   For tighter fairness the server could include `now` in ticks; the client would
   then use `offset = serverNow - Date.now()`.
3. **`"lobby".canStart`** is trusted to gate the host start button (min players = 10
   per protocol; the button hint hardcodes 10).
4. **Code mismatch**: if the user entered a room code but `lobby.code` differs, the
   client toasts «لم يتم العثور على الرمز — تم إنشاء غرفة جديدة» (protocol: wrong
   code → fresh waiting room).
5. **Eliminated detection** uses both the personal `"eliminated"` message (reason)
   and `state.players[].alive === false`; spectator view shows for either.
6. **Reconnect**: `onLeave` shows a disconnected screen with a rejoin button that
   re-runs `joinOrCreate` with the same name/code (Colyseus `allowReconnection`
   restore is a server concern).
7. **Anti-spam** (10 msgs/sec) is server-side; the client naturally sends ≤1 intent
   per interaction, except hide re-taps (each is an intentional new intent).
8. Strings are hardcoded Arabic; if `content/strings.json` appears later, round
   `title`/`rules` from `round_start` already override the client's defaults.
