/**
 * Bot swarm for THE LAST PLAYER — load testing with N simulated players.
 * Usage: npx tsx bot.ts --n=100 --server=ws://localhost:2567 [--start-after=20] [--target=100]
 * The first bot becomes host and starts the match when `target` players are in
 * the lobby (or after `start-after` seconds, whichever comes first).
 */
import { Client, Room } from 'colyseus.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const N = parseInt(args.n ?? '10', 10);
const SERVER = args.server ?? 'ws://localhost:2567';
const TARGET = parseInt(args.target ?? String(N), 10);
const START_AFTER = parseInt(args['start-after'] ?? '25', 10);

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NAMES = [
  'صقر', 'ليث', 'نور', 'سيف', 'قمر', 'فارس', 'ريم', 'طارق', 'جود', 'لمى',
  'عمر', 'سارة', 'خالد', 'مريم', 'يوسف', 'هند', 'كريم', 'دانا', 'رامي', 'سلمى',
];

interface BotCtx {
  room: Room<any>;
  id: string;
  alive: boolean;
  isSeeker: boolean;
  zone: number;
  index: number;
}

function adjacentZones(zone: number): number[] {
  const r = Math.floor(zone / 5), c = zone % 5;
  const out: number[] = [];
  if (r > 0) out.push(zone - 5);
  if (r < 4) out.push(zone + 5);
  if (c > 0) out.push(zone - 1);
  if (c < 4) out.push(zone + 1);
  return out;
}

/** Try to solve Arabic arithmetic prompts like "كم ناتج 7 × 5 ؟" */
function solveArithmetic(prompt: string): string | null {
  const m = prompt.match(/(\d+)\s*([+\-−×*÷\/])\s*(\d+)/);
  if (!m) return null;
  const a = parseInt(m[1], 10), b = parseInt(m[3], 10), op = m[2];
  if (op === '+' ) return String(a + b);
  if (op === '-' || op === '−') return String(a - b);
  if (op === '×' || op === '*') return String(a * b);
  if (op === '÷' || op === '/') return b === 0 ? null : String(Math.floor(a / b));
  return null;
}

const RANDOM_WORDS = ['الحفرة', 'القمر', 'الماء', 'الظل', 'الوقت', 'البيضة', 'المرآة', 'النار'];

async function runBot(index: number, roomId: string | null, hostHooks: { onLobbyCount?: (n: number) => void } = {}): Promise<BotCtx> {
  const client = new Client(SERVER);
  const name = `${NAMES[index % NAMES.length]}_${index + 1}`;
  // Stagger joins to avoid a thundering herd.
  await sleep(rand(0, 3000) * Math.min(1, N / 40));
  const room: Room<any> = roomId
    ? await client.joinById(roomId, { name })
    : await client.joinOrCreate('last_player', { name });
  const ctx: BotCtx = { room, id: room.sessionId, alive: true, isSeeker: false, zone: -1, index };

  room.onMessage('lobby', (msg: any) => {
    if (index === 0 && typeof msg?.count === 'number') hostHooks.onLobbyCount?.(msg.count);
  });
  room.onMessage('eliminated', () => { ctx.alive = false; });
  room.onMessage('round_end', (msg: any) => {
    const dead: string[] = msg?.eliminated ?? [];
    if (dead.includes(ctx.id)) ctx.alive = false;
  });

  room.onMessage('round_start', async (msg: any) => {
    if (!ctx.alive) return;
    const type = msg?.type;
    const payload = msg?.payload ?? {};
    try {
      if (type === 'quiz_race') {
        // Answers are driven by per-question round_tick events below.
      } else if (type === 'hide_seek') {
        const seekers: Array<{ id: string }> = payload.seekers ?? [];
        ctx.isSeeker = seekers.some((s) => s.id === ctx.id);
        if (!ctx.isSeeker) {
          await sleep(rand(500, 6000));
          if (ctx.alive) room.send('hide', { tile: randInt(0, 63) });
        }
      } else if (type === 'survival') {
        // zone is assigned server-side; read from state sync.
        await sleep(300);
        try { ctx.zone = room.state.players.get(ctx.id)?.zone ?? -1; } catch { /* ignore */ }
      } else if (type === 'final_duel') {
        // questions arrive via round_tick.
      }
    } catch { /* never crash the swarm */ }
  });

  room.onMessage('round_tick', async (msg: any) => {
    if (!ctx.alive) return;
    const type = msg?.type;
    const data = msg?.data ?? {};
    try {
      if (type === 'quiz_race' && typeof data.qid === 'number') {
        await sleep(rand(1000, 8000));
        if (ctx.alive) room.send('answer', { qid: data.qid, choice: randInt(0, 3) });
      } else if (type === 'hide_seek' && data.phase === 'seek' && ctx.isSeeker) {
        await sleep(rand(1000, 8000));
        if (ctx.alive) {
          room.send('seek', { tiles: [randInt(0, 63), randInt(0, 63), randInt(0, 63)] });
        }
      } else if (type === 'react_race' && data.state === 'green') {
        await sleep(rand(200, 700));
        if (ctx.alive) room.send('tap');
      } else if (type === 'survival' && Array.isArray(data.danger)) {
        try { ctx.zone = room.state.players.get(ctx.id)?.zone ?? ctx.zone; } catch { /* ignore */ }
        const danger = new Set<number>(data.danger);
        const options = adjacentZones(ctx.zone).filter((z) => !danger.has(z));
        const pool = options.length ? options : adjacentZones(ctx.zone);
        if (!pool.length) return;
        const pick = pool[randInt(0, pool.length - 1)];
        await sleep(rand(800, 3500));
        if (ctx.alive) room.send('move', { zone: pick });
      } else if (type === 'final_duel' && data.prompt && Array.isArray(data.players)) {
        const inDuel = data.players.some((p: any) => p.id === ctx.id);
        if (!inDuel) return;
        const solved = solveArithmetic(String(data.prompt));
        const text = solved ?? (Math.random() < 0.15 ? RANDOM_WORDS[randInt(0, RANDOM_WORDS.length - 1)] : 'لا أعرف');
        await sleep(rand(2000, 10000));
        if (ctx.alive) room.send('duel_answer', { qid: data.qid, text });
      }
    } catch { /* never crash the swarm */ }
  });

  room.onLeave(() => { ctx.alive = false; });
  return ctx;
}

async function main() {
  console.log(`[swarm] connecting ${N} bots to ${SERVER} ...`);
  // Bot 0 creates the room (and becomes host); everyone else joins by id.
  const first = await runBot(0, null);
  const roomId = first.room.roomId ?? (first.room as any).id;
  console.log(`[swarm] room created: id=${roomId}`);

  let started = false;
  const maybeStart = async (count: number) => {
    if (started) return;
    if (count >= TARGET) {
      started = true;
      console.log(`[swarm] target ${TARGET} reached — host starting match`);
      await sleep(1500);
      first.room.send('start');
    }
  };
  first.room.onMessage('lobby', (msg: any) => {
    if (typeof msg?.count === 'number') void maybeStart(msg.count);
  });

  const rest: Promise<BotCtx>[] = [];
  for (let i = 1; i < N; i++) rest.push(runBot(i, roomId));
  const bots = [first, ...(await Promise.all(rest))];
  console.log(`[swarm] all ${bots.length} bots joined`);

  // Fallback: start after timeout even if target not reached.
  setTimeout(() => {
    if (!started) {
      started = true;
      console.log('[swarm] start-after timeout — host starting match anyway');
      first.room.send('start');
    }
  }, START_AFTER * 1000);

  // Track the match to its conclusion.
  let roundIdx = -1;
  first.room.onMessage('round_start', (msg: any) => {
    roundIdx = msg?.roundIndex ?? roundIdx;
    console.log(`[swarm] round ${roundIdx} started: ${msg?.type}`);
  });
  first.room.onMessage('round_end', (msg: any) => {
    console.log(`[swarm] round_end: eliminated=${(msg?.eliminated ?? []).length} survivors=${msg?.survivors}`);
  });
  const done = new Promise<void>((resolve) => {
    first.room.onMessage('podium', (msg: any) => {
      console.log(`[swarm] 🏆 PODIUM — winner: ${msg?.winner?.name} (${msg?.winner?.id})`);
      resolve();
    });
  });
  // Safety: give up after 25 minutes.
  const timeout = setTimeout(() => {
    console.log('[swarm] TIMEOUT — match did not finish in 25min');
    process.exit(2);
  }, 25 * 60 * 1000);

  await done;
  clearTimeout(timeout);
  console.log('[swarm] match complete — disconnecting');
  await sleep(1000);
  process.exit(0);
}

main().catch((e) => {
  console.error('[swarm] fatal', e);
  process.exit(1);
});
