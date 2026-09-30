/**
 * Round state machines for THE LAST PLAYER (server-authoritative).
 * Each controller owns one round: it broadcasts round_start/round_tick,
 * accepts intents via onClientMessage, and resolves with an elimination list.
 * The room wraps run() with a watchdog at 3x budgetMs -> forceResolve().
 */
import type { Client } from 'colyseus';
import type { Player } from './schema';
import type { ContentBank, Strings } from './content';

export interface ClockLike {
  setTimeout(cb: () => void, ms: number): { clear(): void };
  setInterval(cb: () => void, ms: number): { clear(): void };
}

export interface MatchApi {
  broadcast(type: string, message: any): void;
  send(client: Client, type: string, message: any): void;
  clientBySession(sessionId: string): Client | undefined;
  alivePlayers(): Player[];
  getPlayer(sessionId: string): Player | undefined;
  setEndsAt(ts: number): void;
  clock: ClockLike;
  content: ContentBank;
  now(): number;
  addScore(p: Player, n: number): void;
}

export interface Elimination { id: string; reasonKey: string; }
export interface RoundResult { eliminated: Elimination[]; }

// ---------------------------------------------------------------- helpers

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Fuzzy-normalize free-text answers (Arabic-aware) for final_duel. */
export function normalizeAnswer(s: string): string {
  return String(s)
    .normalize('NFKD')
    .replace(/[ً-ٰٟ]/g, '') // Arabic diacritics
    .replace(/ـ/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s,،.؟?!\-_:;'"«»()\[\]{}]/g, '')
    .toLowerCase();
}

export function answersEqual(expected: string, given: string): boolean {
  const e = normalizeAnswer(expected);
  const g = normalizeAnswer(given);
  if (!g) return false;
  const en = Number(e);
  const gn = Number(g);
  if (e !== '' && g !== '' && !Number.isNaN(en) && !Number.isNaN(gn)) return en === gn;
  return e === g;
}

/**
 * Cut the bottom fraction of players by score.
 * Ties at the boundary all survive; if that would eliminate nobody
 * (giant tie group), trim to the target count ("nearest sane cut").
 * ascending=true means lower score is better (react_race ms).
 */
export function cutBottom(
  players: Player[],
  scoreOf: (p: Player) => number,
  elimFrac: number,
  ascending = false,
): Player[] {
  const alive = [...players];
  if (alive.length <= 1) return [];
  const elimCount = Math.max(1, Math.round(alive.length * elimFrac));
  const targetSurvivors = alive.length - elimCount;
  const ordered = shuffle(alive).sort((a, b) =>
    ascending ? scoreOf(a) - scoreOf(b) : scoreOf(b) - scoreOf(a),
  );
  const cutoff = scoreOf(ordered[targetSurvivors - 1]);
  let survivors = ordered.filter((p) =>
    ascending ? scoreOf(p) <= cutoff : scoreOf(p) >= cutoff,
  );
  if (survivors.length >= alive.length) {
    // Giant tie group: nobody would be eliminated -> trim to target.
    survivors = ordered.slice(0, targetSurvivors);
  }
  const survivorIds = new Set(survivors.map((p) => p.id));
  return alive.filter((p) => !survivorIds.has(p.id));
}

// ---------------------------------------------------------------- base

export abstract class RoundController {
  abstract readonly type: string;
  /** Planned duration; the room's watchdog force-resolves at 3x this. */
  abstract readonly budgetMs: number;
  protected forced = false;

  constructor(protected api: MatchApi, protected roundIndex: number) {}

  abstract run(): Promise<RoundResult>;

  onClientMessage(_client: Client, _type: string, _payload: any): void {
    /* default: ignore */
  }

  forceResolve(): void {
    this.forced = true;
  }

  /** Cancellable sleep on the room clock; resolves early when forced. */
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        t.clear();
        iv.clear();
        resolve();
      };
      const t = this.api.clock.setTimeout(finish, Math.max(0, ms));
      const iv = this.api.clock.setInterval(() => {
        if (this.forced) finish();
      }, 100);
    });
  }

  protected get strings(): Strings {
    return this.api.content.strings;
  }

  protected roundStartPayload(extra: Record<string, any>): Record<string, any> {
    const s = this.strings.rounds[this.type] ?? { title: this.type, rules: '' };
    return {
      roundIndex: this.roundIndex,
      type: this.type,
      title: s.title,
      rules: s.rules,
      ...extra,
    };
  }

  protected validInt(v: any, min: number, max: number): boolean {
    return Number.isInteger(v) && v >= min && v <= max;
  }
}

// ================================================================ 1. quiz_race

interface QuizAnswer { choice: number; ms: number; }

export class QuizRace extends RoundController {
  readonly type = 'quiz_race';
  readonly budgetMs = 8 * 12000 + 8000;
  private static readonly Q_MS = 12000;
  private static readonly N_Q = 8;

  private answers = new Map<number, Map<string, QuizAnswer>>(); // qid -> sessionId -> answer
  private startsAt = 0;

  async run(): Promise<RoundResult> {
    const api = this.api;
    const alive = api.alivePlayers();
    const bank = shuffle(api.content.quiz);
    const questions = Array.from({ length: QuizRace.N_Q }, (_, i) => {
      const q = bank[i % bank.length];
      return { qid: i, q: q.q, choices: q.choices };
    });

    this.startsAt = api.now() + 2000;
    const endsAt = this.startsAt + QuizRace.N_Q * QuizRace.Q_MS;
    api.setEndsAt(endsAt + 3000);
    api.broadcast('round_start', this.roundStartPayload({
      endsAt,
      payload: { questions, questionMs: QuizRace.Q_MS, startsAt: this.startsAt },
    }));

    // Per-question ticks so clients/bots can follow along.
    for (let i = 0; i < QuizRace.N_Q; i++) {
      const at = this.startsAt + i * QuizRace.Q_MS - api.now();
      api.clock.setTimeout(() => {
        api.broadcast('round_tick', {
          type: this.type, endsAt, data: { qid: i, questionEndsAt: this.startsAt + (i + 1) * QuizRace.Q_MS },
        });
      }, Math.max(0, at));
    }

    await this.wait(endsAt + 2500 - api.now());

    // Score: correct -> 1000 + timeBonus (500 * (1 - ms/12000)).
    const roundScore = new Map<string, number>();
    const bankByQid = new Map(questions.map((qq, i) => [i, bank[i % bank.length]]));
    for (const p of alive) {
      let rs = 0;
      for (let qid = 0; qid < QuizRace.N_Q; qid++) {
        const a = this.answers.get(qid)?.get(p.id);
        if (!a) continue;
        p.lastAnswerMs = a.ms;
        const correct = a.choice === bankByQid.get(qid)!.answer;
        if (correct) {
          const pts = 1000 + Math.round(500 * (1 - a.ms / QuizRace.Q_MS));
          rs += pts;
          api.addScore(p, pts);
        }
      }
      roundScore.set(p.id, rs);
    }

    const eliminated = cutBottom(alive, (p) => roundScore.get(p.id) ?? 0, 0.4);
    return { eliminated: eliminated.map((p) => ({ id: p.id, reasonKey: 'quiz' })) };
  }

  onClientMessage(client: Client, type: string, payload: any): void {
    if (type !== 'answer') return;
    const qid = payload?.qid;
    const choice = payload?.choice;
    if (!this.validInt(qid, 0, QuizRace.N_Q - 1) || !Number.isInteger(choice)) return;
    const now = this.api.now();
    const winStart = this.startsAt + qid * QuizRace.Q_MS;
    if (now < winStart || now > winStart + QuizRace.Q_MS) return; // late/early -> ignore
    let m = this.answers.get(qid);
    if (!m) { m = new Map(); this.answers.set(qid, m); }
    if (m.has(client.sessionId)) return; // first answer counts
    m.set(client.sessionId, { choice, ms: now - winStart });
  }
}

// ================================================================ 2. hide_seek

export class HideSeek extends RoundController {
  readonly type = 'hide_seek';
  readonly budgetMs = 20000 + 15000 + 8000;
  private static readonly HIDE_MS = 20000;
  private static readonly SEEK_MS = 15000;

  private hides = new Map<string, number>(); // sessionId -> tile (last wins)
  private seeks = new Map<string, number[]>(); // seeker sessionId -> tiles (last wins)
  private seekerIds = new Set<string>();
  private hideEnds = 0;
  private seekEnds = 0;
  private seeking = false;

  async run(): Promise<RoundResult> {
    const api = this.api;
    const alive = api.alivePlayers();
    if (alive.length < 12) return { eliminated: [] }; // protocol: skip round

    // Seekers = top 5 alive by total score (fallback: random alive).
    const seekers = shuffle(alive).sort((a, b) => b.score - a.score).slice(0, 5);
    this.seekerIds = new Set(seekers.map((p) => p.id));
    const hiders = alive.filter((p) => !this.seekerIds.has(p.id));

    this.hideEnds = api.now() + 2000 + HideSeek.HIDE_MS;
    this.seekEnds = this.hideEnds + HideSeek.SEEK_MS;
    api.setEndsAt(this.seekEnds + 3000);
    api.broadcast('round_start', this.roundStartPayload({
      endsAt: this.seekEnds,
      payload: {
        grid: 8,
        hideEndsAt: this.hideEnds,
        seekEndsAt: this.seekEnds,
        seekers: seekers.map((p) => ({ id: p.id, name: p.name })),
      },
    }));

    await this.wait(this.hideEnds - api.now());
    if (!this.forced) {
      // Hiders who never hid -> auto random tile.
      for (const h of hiders) {
        if (!this.hides.has(h.id)) this.hides.set(h.id, Math.floor(Math.random() * 64));
        const p = api.getPlayer(h.id);
        if (p) p.tile = this.hides.get(h.id)!;
      }
      this.seeking = true;
      api.broadcast('round_tick', {
        type: this.type, endsAt: this.seekEnds, data: { phase: 'seek', seekEndsAt: this.seekEnds },
      });
      await this.wait(this.seekEnds - api.now());
    }

    // Resolve: seeker picks catch hiders on those tiles.
    const picked = new Set<number>();
    for (const tiles of this.seeks.values()) for (const t of tiles) picked.add(t);

    const occupants = new Map<number, string[]>(); // tile -> hider ids
    for (const h of hiders) {
      const tile = this.hides.get(h.id);
      if (tile === undefined) continue;
      if (!occupants.has(tile)) occupants.set(tile, []);
      occupants.get(tile)!.push(h.id);
    }

    const caught = new Set<string>();
    const caughtBySeeker = new Set<string>();
    for (const tile of picked) {
      for (const id of occupants.get(tile) ?? []) { caught.add(id); caughtBySeeker.add(id); }
    }

    // The Shadow: random still-occupied tiles until total caught ~= 40% of hiders.
    const target = Math.round(0.4 * hiders.length);
    let need = target - caught.size;
    if (need > 0) {
      const candidates = shuffle([...occupants.keys()].filter((t) => !picked.has(t)));
      for (const tile of candidates) {
        if (need <= 0) break;
        for (const id of occupants.get(tile)!) {
          if (!caught.has(id)) { caught.add(id); need--; }
        }
      }
    }

    // Survivors score a little.
    for (const h of hiders) {
      if (!caught.has(h.id)) {
        const p = api.getPlayer(h.id);
        if (p) api.addScore(p, 500);
      }
    }

    const eliminated: Elimination[] = [...caught].map((id) => ({
      id,
      reasonKey: caughtBySeeker.has(id) ? 'hide_caught' : 'hide_shadow',
    }));
    return { eliminated };
  }

  onClientMessage(client: Client, type: string, payload: any): void {
    const api = this.api;
    const now = api.now();
    if (type === 'hide') {
      if (now > this.hideEnds || this.seekerIds.has(client.sessionId)) return;
      const tile = payload?.tile;
      if (!this.validInt(tile, 0, 63)) return;
      const p = api.getPlayer(client.sessionId);
      if (!p || !p.alive) return;
      this.hides.set(client.sessionId, tile); // last one wins
      p.tile = tile;
    } else if (type === 'seek') {
      if (!this.seeking || now > this.seekEnds || !this.seekerIds.has(client.sessionId)) return;
      const tiles = payload?.tiles;
      if (!Array.isArray(tiles) || tiles.length === 0 || tiles.length > 3) return;
      const uniq = [...new Set(tiles)];
      if (uniq.length !== tiles.length || !uniq.every((t) => this.validInt(t, 0, 63))) return;
      this.seeks.set(client.sessionId, uniq); // last one wins
      const p = api.getPlayer(client.sessionId);
      api.broadcast('round_tick', {
        type: this.type, endsAt: this.seekEnds,
        data: { seeker: p?.name ?? '', tiles: uniq },
      });
    }
  }
}

// ================================================================ 3. react_race

export class ReactRace extends RoundController {
  readonly type = 'react_race';
  readonly budgetMs = 5 * (3000 + 2500) + 8000;
  private static readonly ATTEMPTS = 5;
  private static readonly VOID = 9999;

  // attempt -> sessionId -> ms (9999 = voided early tap / no tap)
  private taps = new Map<number, Map<string, number>>();
  private currentAttempt = -1;
  private greenAt = 0;
  private accepting = false;

  async run(): Promise<RoundResult> {
    const api = this.api;
    const alive = api.alivePlayers();
    const roundEnd = api.now() + this.budgetMs;
    api.setEndsAt(roundEnd);
    api.broadcast('round_start', this.roundStartPayload({
      endsAt: roundEnd,
      payload: { attempts: ReactRace.ATTEMPTS },
    }));

    for (let i = 0; i < ReactRace.ATTEMPTS && !this.forced; i++) {
      this.currentAttempt = i;
      this.taps.set(i, new Map());
      this.accepting = true;

      const redWait = 1200 + Math.random() * 1800;
      api.broadcast('round_tick', {
        type: this.type, endsAt: roundEnd, data: { attempt: i, state: 'red' },
      });
      await this.wait(redWait);
      if (this.forced) break;

      this.greenAt = api.now();
      api.broadcast('round_tick', {
        type: this.type, endsAt: roundEnd,
        data: { attempt: i, state: 'green', greenAt: this.greenAt },
      });
      await this.wait(2500); // response window
      this.accepting = false;
    }
    this.accepting = false;

    // Score = average of best 3 valid attempts (void/missing = 9999).
    const avgOf = (p: Player): number => {
      const all: number[] = [];
      for (let i = 0; i < ReactRace.ATTEMPTS; i++) {
        all.push(this.taps.get(i)?.get(p.id) ?? ReactRace.VOID);
      }
      all.sort((a, b) => a - b);
      const best3 = all.slice(0, 3);
      return best3.reduce((s, v) => s + v, 0) / 3;
    };
    for (const p of alive) {
      const avg = avgOf(p);
      p.lastAnswerMs = Math.round(avg);
      api.addScore(p, Math.max(0, Math.round(1200 - avg)));
    }

    const eliminated = cutBottom(alive, avgOf, 0.5, true);
    return { eliminated: eliminated.map((p) => ({ id: p.id, reasonKey: 'react' })) };
  }

  onClientMessage(client: Client, type: string, _payload: any): void {
    if (type !== 'tap' || !this.accepting || this.currentAttempt < 0) return;
    const api = this.api;
    const p = api.getPlayer(client.sessionId);
    if (!p || !p.alive) return;
    const m = this.taps.get(this.currentAttempt)!;
    if (m.has(client.sessionId)) return; // first tap per attempt counts
    const now = api.now();
    if (now < this.greenAt) {
      m.set(client.sessionId, ReactRace.VOID); // early tap voids the attempt
    } else {
      m.set(client.sessionId, now - this.greenAt);
    }
  }
}

// ================================================================ 4. survival

export class Survival extends RoundController {
  readonly type = 'survival';
  readonly budgetMs = 8 * 6000 + 8000;
  private static readonly TICKS = 8;
  private static readonly TICK_MS = 6000;

  private danger = new Set<number>();
  private moved = new Map<string, boolean>();
  private out = new Set<string>(); // eliminated this round
  private elimReason = new Map<string, string>();
  private windowOpen = false;

  private aliveInRound(api: MatchApi): Player[] {
    return api.alivePlayers().filter((p) => !this.out.has(p.id));
  }

  async run(): Promise<RoundResult> {
    const api = this.api;
    const alive = this.aliveInRound(api);

    // Spread starting zones across the 5x5 map.
    const zones = shuffle(Array.from({ length: 25 }, (_, i) => i));
    alive.forEach((p, i) => {
      p.zone = zones[i % 25];
      this.moved.set(p.id, false);
    });

    const roundEnd = api.now() + this.budgetMs;
    api.setEndsAt(roundEnd);
    api.broadcast('round_start', this.roundStartPayload({
      endsAt: roundEnd,
      payload: { grid: 5, ticks: Survival.TICKS, tickMs: Survival.TICK_MS },
    }));

    for (let tick = 0; tick < Survival.TICKS && !this.forced; tick++) {
      if (this.aliveInRound(api).length <= 4) break;

      // 4 NEW danger zones each tick.
      const candidates = shuffle(
        Array.from({ length: 25 }, (_, i) => i).filter((z) => !this.danger.has(z)),
      ).slice(0, 4);
      for (const z of candidates) this.danger.add(z);

      const tickEndsAt = api.now() + Survival.TICK_MS;
      api.setEndsAt(tickEndsAt);
      for (const p of this.aliveInRound(api)) this.moved.set(p.id, false);
      this.windowOpen = true;
      api.broadcast('round_tick', {
        type: this.type, endsAt: tickEndsAt,
        data: { tick, danger: [...this.danger], tickEndsAt, alive: this.aliveInRound(api).map((p) => p.id) },
      });

      await this.wait(Survival.TICK_MS - 200);
      this.windowOpen = false;
      if (this.forced) break;

      for (const p of this.aliveInRound(api)) {
        if (!this.moved.get(p.id)) {
          this.out.add(p.id);
          this.elimReason.set(p.id, 'survival_stay');
        } else if (this.danger.has(p.zone)) {
          this.out.add(p.id);
          this.elimReason.set(p.id, 'survival_danger');
        } else {
          api.addScore(p, 250); // survived the tick
        }
      }
    }

    // After 8 ticks (or early finish): cut lowest total score down to 4.
    let remaining = this.aliveInRound(api);
    if (remaining.length > 4) {
      const ordered = shuffle(remaining).sort((a, b) => b.score - a.score);
      const keep = new Set(ordered.slice(0, 4).map((p) => p.id));
      for (const p of remaining) {
        if (!keep.has(p.id)) {
          this.out.add(p.id);
          this.elimReason.set(p.id, 'survival_cut');
        }
      }
      remaining = this.aliveInRound(api);
    }
    void remaining;

    return {
      eliminated: [...this.out].map((id) => ({ id, reasonKey: this.elimReason.get(id) ?? 'survival_danger' })),
    };
  }

  onClientMessage(client: Client, type: string, payload: any): void {
    if (type !== 'move' || !this.windowOpen) return;
    const api = this.api;
    const p = api.getPlayer(client.sessionId);
    if (!p || !p.alive || this.out.has(p.id)) return;
    const zone = payload?.zone;
    if (!this.validInt(zone, 0, 24)) return;
    // Must be orthogonally adjacent (staying put is not a move).
    const r1 = Math.floor(p.zone / 5), c1 = p.zone % 5;
    const r2 = Math.floor(zone / 5), c2 = zone % 5;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return;
    p.zone = zone; // last move in the tick window wins
    this.moved.set(p.id, true);
  }
}

// ================================================================ 5. final_duel

interface DuelQuestion { prompt: string; expected: string; }

export class FinalDuel extends RoundController {
  readonly type = 'final_duel';
  readonly budgetMs = 3 * 5 * 15000 + 15000; // up to 3 bouts x 5 questions
  private static readonly Q_MS = 15000;

  // qid -> sessionId -> { text, at, correct }
  private duelAnswers = new Map<number, Map<string, { text: string; at: number; correct: boolean }>>();
  private currentQid = -1;
  private currentPair = new Set<string>();
  private questionOpen = false;
  private expectedByQid = new Map<number, string>();

  private buildQuestions(n: number): DuelQuestion[] {
    const api = this.api;
    const out: DuelQuestion[] = [];
    const riddles = shuffle(api.content.riddles);
    const seqs = shuffle(api.content.sequences);
    for (let i = 0; i < n; i++) {
      const kind = i % 3;
      if (kind === 0 && riddles.length) {
        const r = riddles[i % riddles.length];
        out.push({ prompt: r.q, expected: r.a });
      } else if (kind === 1 && seqs.length) {
        const s = seqs[i % seqs.length];
        out.push({ prompt: s.q, expected: s.a });
      } else {
        // Arithmetic fallback / variety.
        const a = 2 + Math.floor(Math.random() * 19);
        const b = 2 + Math.floor(Math.random() * 19);
        const ops = ['+', '−', '×'] as const;
        const op = pick([...ops]);
        const prompt = `كم ناتج ${a} ${op} ${b} ؟`;
        const expected = op === '+' ? String(a + b) : op === '−' ? String(a - b) : String(a * b);
        out.push({ prompt, expected });
      }
    }
    return out;
  }

  /** Best-of-5 bout; returns winner id. */
  private async bout(a: Player, b: Player, boutIndex: number): Promise<string> {
    const api = this.api;
    const questions = this.buildQuestions(5);
    let pa = 0, pb = 0;

    for (let qi = 0; qi < 5 && !this.forced; qi++) {
      const qid = boutIndex * 10 + qi;
      const q = questions[qi];
      this.currentQid = qid;
      this.currentPair = new Set([a.id, b.id]);
      this.expectedByQid.set(qid, q.expected);
      this.duelAnswers.set(qid, new Map());

      const qEndsAt = api.now() + FinalDuel.Q_MS;
      api.setEndsAt(qEndsAt);
      api.broadcast('round_tick', {
        type: this.type, endsAt: qEndsAt,
        data: {
          bout: boutIndex, qid, prompt: q.prompt, questionEndsAt: qEndsAt,
          players: [{ id: a.id, name: a.name }, { id: b.id, name: b.name }],
          points: { [a.id]: pa, [b.id]: pb },
        },
      });

      this.questionOpen = true;
      await this.wait(FinalDuel.Q_MS);
      this.questionOpen = false;
      if (this.forced) break;

      const correct = [...(this.duelAnswers.get(qid)?.entries() ?? [])]
        .filter(([, r]) => r.correct)
        .sort((x, y) => x[1].at - y[1].at);
      if (correct.length > 0) {
        const winnerId = correct[0][0];
        if (winnerId === a.id) pa++; else pb++;
        const wp = api.getPlayer(winnerId);
        if (wp) { api.addScore(wp, 500); wp.lastAnswerMs = correct[0][1].at; }
      }
      api.broadcast('round_tick', {
        type: this.type, endsAt: qEndsAt,
        data: { bout: boutIndex, qid, pointTo: correct.length ? correct[0][0] : null, points: { [a.id]: pa, [b.id]: pb } },
      });
      if (pa >= 3 || pb >= 3) break;
      await this.wait(1500);
    }

    if (pa === pb) {
      // Tiebreak: higher total score, then random.
      if (b.score !== a.score) return b.score > a.score ? b.id : a.id;
      return Math.random() < 0.5 ? a.id : b.id;
    }
    const winnerId = pa > pb ? a.id : b.id;
    const wp = api.getPlayer(winnerId);
    if (wp) api.addScore(wp, 1000);
    return winnerId;
  }

  async run(): Promise<RoundResult> {
    const api = this.api;
    let players = api.alivePlayers();
    if (players.length < 2) return { eliminated: [] };
    if (players.length > 4) {
      // Safety: trim to 4 by score (shouldn't happen; survival caps at 4).
      players = shuffle(players).sort((a, b) => b.score - a.score).slice(0, 4);
    }
    const ordered = shuffle(players).sort((a, b) => b.score - a.score);

    api.broadcast('round_start', this.roundStartPayload({
      endsAt: api.now() + this.budgetMs,
      payload: { players: ordered.map((p) => ({ id: p.id, name: p.name, score: p.score })) },
    }));

    const byId = new Map(ordered.map((p) => [p.id, p]));
    let championId: string;
    let boutIndex = 0;

    if (ordered.length === 2) {
      championId = await this.bout(ordered[0], ordered[1], boutIndex++);
    } else if (ordered.length === 3) {
      // Odd count -> highest total score gets a bye.
      const bye = ordered[0];
      const semiWinner = await this.bout(ordered[1], ordered[2], boutIndex++);
      api.broadcast('toast', { text: `⚡ ${bye.name} يتأهل مباشرة للنهائي!` });
      championId = this.forced
        ? semiWinner
        : await this.bout(byId.get(bye.id)!, byId.get(semiWinner)!, boutIndex++);
    } else {
      // Semifinals 1v4, 2v3 by score, then final.
      const w1 = await this.bout(ordered[0], ordered[3], boutIndex++);
      const w2 = this.forced ? w1 : await this.bout(ordered[1], ordered[2], boutIndex++);
      championId = this.forced ? w1 : await this.bout(byId.get(w1)!, byId.get(w2)!, boutIndex++);
    }

    const eliminated = ordered
      .filter((p) => p.id !== championId)
      .map((p) => ({ id: p.id, reasonKey: 'duel' }));
    return { eliminated };
  }

  onClientMessage(client: Client, type: string, payload: any): void {
    if (type !== 'duel_answer' || !this.questionOpen) return;
    if (payload?.qid !== this.currentQid) return;
    if (!this.currentPair.has(client.sessionId)) return; // bout participants only
    const text = String(payload?.text ?? '');
    if (text.length > 200) return;
    let m = this.duelAnswers.get(this.currentQid);
    if (!m) { m = new Map(); this.duelAnswers.set(this.currentQid, m); }
    if (m.has(client.sessionId)) return; // first answer counts
    const expected = this.expectedByQid.get(this.currentQid) ?? '';
    m.set(client.sessionId, {
      text,
      at: this.api.now(),
      correct: answersEqual(expected, text),
    });
  }
}
