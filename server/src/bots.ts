/**
 * THE LAST PLAYER — in-server AI bot supervisor.
 *
 * Enable with BOTS=N (0 = disabled). The supervisor keeps N AI players
 * connected to this same server over ws://localhost:PORT (colyseus.js),
 * exactly like real clients. Bots fill public lobbies so a lone human can
 * always get a match, and stay out of private (room-code) rooms.
 *
 * Behavior:
 * - Bots idle in lobbies until at least one human is present; the host bot
 *   then starts the match when the lobby can start.
 * - Every 5s the supervisor rebalances: bots move toward public lobbies
 *   with waiting humans (up to DESIRED_TOTAL players) and leave private
 *   rooms immediately.
 * - After a podium, bots leave and rejoin the lobby pool.
 */
import { Client, Room } from 'colyseus.js';
import { activeRooms, LastPlayerRoom } from './room';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NAMES = [
  'صقر', 'ليث', 'نور', 'سيف', 'قمر', 'فارس', 'ريم', 'طارق', 'جود', 'لمى',
  'عمر', 'سارة', 'خالد', 'مريم', 'يوسف', 'هند', 'كريم', 'دانا', 'رامي', 'سلمى',
];
const RANDOM_WORDS = ['الحفرة', 'القمر', 'الماء', 'الظل', 'الوقت', 'البيضة', 'المرآة', 'النار'];

/** Target total players (humans + bots) in a public lobby. */
const DESIRED_TOTAL = 8;
/** Rebalance sweep interval. */
const REBALANCE_MS = 5000;

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
  if (op === '+') return String(a + b);
  if (op === '-' || op === '−') return String(a - b);
  if (op === '×' || op === '*') return String(a * b);
  if (op === '÷' || op === '/') return b === 0 ? null : String(Math.floor(a / b));
  return null;
}

class GameBot {
  private client: Client;
  private room: Room | null = null;
  private sessionId = '';
  private alive = true;
  private isSeeker = false;
  private zone = -1;
  private lastStartSentAt = 0;
  private pendingRoomId: string | null = null;
  private done: (() => void) | null = null;

  constructor(
    private sup: BotSupervisor,
    private index: number,
    private port: number,
  ) {
    this.client = new Client(`ws://localhost:${port}`);
  }

  get name(): string {
    return `${NAMES[this.index % NAMES.length]} 🤖`;
  }

  get roomId(): string {
    return this.room?.roomId ?? '';
  }

  /** Main loop: stay connected forever, rejoining after every match. */
  async loop(): Promise<never> {
    await sleep(rand(0, 4000) * (this.index / 10 + 0.2)); // stagger joins
    for (;;) {
      try {
        const target = this.pendingRoomId;
        this.pendingRoomId = null;
        if (target) await this.playRoomById(target);
        else await this.playOneRoom();
      } catch (e) {
        // Join failed (room locked/gone) — back off and retry via joinOrCreate.
        await sleep(rand(3000, 7000));
      }
      await sleep(rand(1500, 4000));
    }
  }

  /** Ask the bot to relocate to another room (supervisor rebalancing). */
  async moveTo(roomId: string): Promise<void> {
    if (this.roomId === roomId || this.pendingRoomId === roomId) return;
    this.pendingRoomId = roomId;
    try {
      await this.room?.leave();
    } catch { /* already gone */ }
  }

  /** Leave the current room and rejoin the public pool via joinOrCreate. */
  async relocateToPublic(): Promise<void> {
    if (this.pendingRoomId === null) this.pendingRoomId = '';
    try {
      await this.room?.leave();
    } catch { /* already gone */ }
  }

  private async playOneRoom(): Promise<void> {
    this.lastStartSentAt = 0;
    this.room = await this.client.joinOrCreate('last_player', { name: this.name, bot: true });
    this.afterJoin();
    await this.waitUntilDone();
  }

  private async playRoomById(roomId: string): Promise<void> {
    this.lastStartSentAt = 0;
    this.room = await this.client.joinById(roomId, { name: this.name, bot: true });
    this.afterJoin();
    await this.waitUntilDone();
  }

  private afterJoin(): void {
    if (!this.room) return;
    this.sessionId = this.room.sessionId;
    this.alive = true;
    this.isSeeker = false;
    this.zone = -1;
    this.sup.register(this.sessionId);
    this.attachHandlers();
  }

  private waitUntilDone(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.done = resolve;
      this.room?.onLeave(() => {
        this.cleanup();
        resolve();
      });
    });
  }

  private cleanup(): void {
    if (this.sessionId) this.sup.unregister(this.sessionId);
    this.room = null;
    this.sessionId = '';
    this.done = null;
  }

  private finish(): void {
    // Leave the room; the loop reconnects afterwards.
    const done = this.done;
    void this.room?.leave().catch(() => undefined);
    // Safety: resolve even if onLeave never fires.
    setTimeout(() => done?.(), 3000);
  }

  private attachHandlers(): void {
    const room = this.room;
    if (!room) return;
    const self = this;

    room.onMessage('lobby', (msg: any) => {
      try {
        // Never sit in a private room: leave during lobby phase.
        const r: LastPlayerRoom | undefined = activeRooms.get(self.roomId);
        if (r?.isPrivateRoom) {
          self.finish();
          return;
        }
        const players: Array<{ id: string }> = msg?.players ?? [];
        const amHost = players.length > 0 && players[0].id === self.sessionId;
        const humans = players.filter((p) => !self.sup.isBot(p.id)).length;
        // Host bot starts the match only when at least one human is here.
        // 30s cooldown so a new start can be sent if a previous countdown
        // was aborted (all humans left).
        if (amHost && humans >= 1 && msg?.canStart && Date.now() - self.lastStartSentAt > 30000) {
          self.lastStartSentAt = Date.now();
          setTimeout(() => {
            try { room.send('start'); } catch { /* ignore */ }
          }, 2000);
        }
      } catch { /* never crash the supervisor */ }
    });

    room.onMessage('eliminated', () => { self.alive = false; });
    room.onMessage('round_end', (msg: any) => {
      const dead: string[] = msg?.eliminated ?? [];
      if (dead.includes(self.sessionId)) self.alive = false;
    });
    room.onMessage('podium', () => {
      // Match over — leave so the room can dispose; loop rejoins fresh.
      setTimeout(() => self.finish(), 3000);
    });

    room.onMessage('round_start', async (msg: any) => {
      if (!self.alive) return;
      const type = msg?.type;
      const payload = msg?.payload ?? {};
      try {
        if (type === 'hide_seek') {
          const seekers: Array<{ id: string }> = payload.seekers ?? [];
          self.isSeeker = seekers.some((s) => s.id === self.sessionId);
          if (!self.isSeeker) {
            await sleep(rand(500, 6000));
            if (self.alive) room.send('hide', { tile: randInt(0, 63) });
          }
        } else if (type === 'survival') {
          await sleep(300);
          try { self.zone = (room.state as any).players.get(self.sessionId)?.zone ?? -1; } catch { /* ignore */ }
        }
      } catch { /* never crash the supervisor */ }
    });

    room.onMessage('round_tick', async (msg: any) => {
      if (!self.alive) return;
      const type = msg?.type;
      const data = msg?.data ?? {};
      try {
        if (type === 'quiz_race' && typeof data.qid === 'number') {
          await sleep(rand(1000, 8000));
          if (self.alive) room.send('answer', { qid: data.qid, choice: randInt(0, 3) });
        } else if (type === 'hide_seek' && data.phase === 'seek' && self.isSeeker) {
          await sleep(rand(1000, 8000));
          if (self.alive) room.send('seek', { tiles: [randInt(0, 63), randInt(0, 63), randInt(0, 63)] });
        } else if (type === 'react_race' && data.state === 'green') {
          await sleep(rand(200, 700));
          if (self.alive) room.send('tap');
        } else if (type === 'survival' && Array.isArray(data.danger)) {
          try { self.zone = (room.state as any).players.get(self.sessionId)?.zone ?? self.zone; } catch { /* ignore */ }
          const danger = new Set<number>(data.danger);
          const options = adjacentZones(self.zone).filter((z) => !danger.has(z));
          const pool = options.length ? options : adjacentZones(self.zone);
          if (!pool.length) return;
          const pick = pool[randInt(0, pool.length - 1)];
          await sleep(rand(800, 3500));
          if (self.alive) room.send('move', { zone: pick });
        } else if (type === 'final_duel' && data.prompt && Array.isArray(data.players)) {
          const inDuel = data.players.some((p: any) => p.id === self.sessionId);
          if (!inDuel) return;
          const solved = solveArithmetic(String(data.prompt));
          const text = solved ?? (Math.random() < 0.15 ? RANDOM_WORDS[randInt(0, RANDOM_WORDS.length - 1)] : 'لا أعرف');
          await sleep(rand(2000, 10000));
          if (self.alive) room.send('duel_answer', { qid: data.qid, text });
        }
      } catch { /* never crash the supervisor */ }
    });
  }
}

export class BotSupervisor {
  private bots: GameBot[] = [];
  private botIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private port: number,
    private count: number,
  ) {}

  isBot(sessionId: string): boolean {
    return this.botIds.has(sessionId);
  }

  register(sessionId: string): void {
    this.botIds.add(sessionId);
  }

  unregister(sessionId: string): void {
    this.botIds.delete(sessionId);
  }

  start(): void {
    console.log(`[bots] starting supervisor with ${this.count} bots`);
    for (let i = 0; i < this.count; i++) {
      const bot = new GameBot(this, i, this.port);
      this.bots.push(bot);
      void bot.loop();
    }
    this.timer = setInterval(() => this.rebalance(), REBALANCE_MS);
    // Don't keep the process alive on this timer alone.
    (this.timer as any)?.unref?.();
  }

  private rebalance(): void {
    try {
      // 1) Bots leave private rooms (lobby phase only — never disrupt countdown),
      // and rooms stuck at the podium (safety net; rooms normally reset
      // themselves to the lobby after the podium).
      for (const bot of this.bots) {
        const rid = bot.roomId;
        if (!rid) continue;
        const room = activeRooms.get(rid);
        if (!room) continue;
        if ((room.isPrivateRoom && room.state.phase === 'lobby') || room.state.phase === 'podium') {
          void bot.relocateToPublic(); // leave; loop rejoins via joinOrCreate
        }
      }

      // 2) Fill public lobbies that have waiting humans, up to DESIRED_TOTAL.
      const needy: Array<{ room: LastPlayerRoom; need: number }> = [];
      for (const room of activeRooms.values()) {
        if (room.isPrivateRoom || room.state.phase !== 'lobby') continue;
        const players = [...room.state.players.values()].filter((p) => p.connected);
        const humans = players.filter((p) => !this.isBot(p.id));
        if (humans.length === 0) continue;
        const need = DESIRED_TOTAL - players.length;
        if (need > 0) needy.push({ room, need });
      }
      if (needy.length === 0) return;

      // Idle bots: sitting in bots-only public lobbies.
      const idle = this.bots.filter((bot) => {
        const rid = bot.roomId;
        if (!rid) return false;
        const room = activeRooms.get(rid);
        if (!room || room.isPrivateRoom || room.state.phase !== 'lobby') return false;
        return ![...room.state.players.values()].some((p) => p.connected && !this.isBot(p.id));
      });

      for (const { room, need } of needy) {
        for (let i = 0; i < need && idle.length > 0; i++) {
          const bot = idle.pop()!;
          console.log(`[bots] moving a bot to human lobby ${room.roomId}`);
          void bot.moveTo(room.roomId);
        }
      }
    } catch (e) {
      console.warn('[bots] rebalance error:', e);
    }
  }
}

/** Start the supervisor if BOTS>0. Called from the server entry point. */
export function maybeStartBots(port: number): void {
  const n = parseInt(process.env.BOTS ?? '0', 10) || 0;
  if (n <= 0) return;
  new BotSupervisor(port, Math.min(n, 50)).start();
}
