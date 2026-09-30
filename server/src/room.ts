/**
 * last_player room — lobby -> countdown -> rounds -> podium.
 * All game logic is server-authoritative; clients only send intents.
 */
import { Room, Client } from 'colyseus';
import { GameState, Player, Standing } from './schema';
import { ContentBank, loadContent } from './content';
import { generateCode } from './code';
import {
  MatchApi, RoundController, RoundResult,
  QuizRace, HideSeek, ReactRace, Survival, FinalDuel,
} from './rounds';

const usedCodes = new Set<string>();
/** code -> roomId registry, used by GET /api/room-by-code/:code */
export const codeToRoomId = new Map<string, string>();

const LOBBY_PHASES = new Set(['lobby', 'countdown']);
const ROUND_ORDER = ['quiz_race', 'hide_seek', 'react_race', 'survival', 'final_duel'] as const;

function createController(type: string, api: MatchApi, roundIndex: number): RoundController {
  switch (type) {
    case 'quiz_race': return new QuizRace(api, roundIndex);
    case 'hide_seek': return new HideSeek(api, roundIndex);
    case 'react_race': return new ReactRace(api, roundIndex);
    case 'survival': return new Survival(api, roundIndex);
    case 'final_duel': return new FinalDuel(api, roundIndex);
    default: throw new Error(`unknown round type: ${type}`);
  }
}

export class LastPlayerRoom extends Room<GameState> {
  maxClients = 100;

  private roomCode = '';
  private content!: ContentBank;
  private activeRound: RoundController | null = null;
  private spam = new Map<string, number[]>(); // sessionId -> msg timestamps (1s window)
  private matchRunning = false;
  private minPlayers = 10;

  private get strings() {
    return this.content.strings;
  }

  // ------------------------------------------------------------ lifecycle

  async onCreate(_options: any) {
    this.content = loadContent();
    this.roomCode = generateCode(usedCodes);
    codeToRoomId.set(this.roomCode, this.roomId);
    await this.setMetadata({ code: this.roomCode });

    const devMin = parseInt(process.env.DEV_MIN_PLAYERS ?? '', 10);
    const prodMin = parseInt(process.env.MIN_PLAYERS ?? '', 10);
    this.minPlayers = Number.isInteger(devMin) && devMin > 0 ? devMin
      : Number.isInteger(prodMin) && prodMin > 0 ? prodMin : 10;

    this.setState(new GameState());
    this.state.phase = 'lobby';

    // Client -> server intents. All gameplay messages delegate to the active
    // round controller; anything outside a round is ignored.
    this.onMessage('start', (client) => this.guarded(client, () => this.handleStart(client)));
    const gameplay = ['answer', 'hide', 'seek', 'tap', 'move', 'duel_answer'];
    for (const t of gameplay) {
      this.onMessage(t, (client, payload) =>
        this.guarded(client, () => this.activeRound?.onClientMessage(client, t, payload)));
    }

    console.log(`[room ${this.roomId}] created code=${this.roomCode} minPlayers=${this.minPlayers}`);
  }

  onDispose() {
    usedCodes.delete(this.roomCode);
    codeToRoomId.delete(this.roomCode);
    console.log(`[room ${this.roomId}] disposed`);
  }

  // ------------------------------------------------------------------ join

  async onJoin(client: Client, options: any) {
    // Code routing: the client should resolve code -> roomId via
    // GET /api/room-by-code/:code and joinById. If a code was supplied and
    // does not match this room, reject so the client falls back to the
    // lobby pool (fresh waiting room).
    const code = typeof options?.code === 'string' ? options.code.toUpperCase() : '';
    if (code && code !== this.roomCode) {
      throw new Error('wrong_code');
    }

    const name = String(options?.name ?? 'لاعب').trim().slice(0, 24) || 'لاعب';

    // Reconnecting seat (lobby/countdown only)?
    const existing = this.state.players.get(client.sessionId);
    if (existing) {
      if (!LOBBY_PHASES.has(this.state.phase)) throw new Error('match_in_progress');
      existing.connected = true;
      this.broadcastLobby();
      console.log(`[room ${this.roomId}] ${name} reconnected (${client.sessionId})`);
      return;
    }

    // New joins only in lobby/countdown.
    if (!LOBBY_PHASES.has(this.state.phase)) throw new Error('match_in_progress');

    // 100-player cap -> explicit room_full rejection.
    if (this.state.players.size >= 100) throw new Error('room_full');

    const p = new Player();
    p.id = client.sessionId;
    p.name = name;
    p.alive = true;
    p.score = 0;
    p.isHost = this.state.players.size === 0;
    p.connected = true;
    this.state.players.set(client.sessionId, p);
    this.syncAliveCount();
    this.broadcastLobby();
    console.log(`[room ${this.roomId}] join ${name} (${client.sessionId}) count=${this.state.players.size}`);
  }

  async onLeave(client: Client, _consented: boolean) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;

    if (LOBBY_PHASES.has(this.state.phase)) {
      // Reconnection window: 60s to reclaim the seat.
      try {
        await this.allowReconnection(client, 60);
        // Reconnected: onJoin already restored connected=true.
      } catch {
        // Seat expired.
        this.state.players.delete(client.sessionId);
        this.spam.delete(client.sessionId);
        if (p.isHost) this.promoteHost();
        this.syncAliveCount();
        this.broadcastLobby();
      }
    } else {
      // Mid-match: seat is kept; marked not-connected and eliminated at the
      // next round end (no rejoin mid-round).
      p.connected = false;
      console.log(`[room ${this.roomId}] ${p.name} disconnected mid-match`);
    }
  }

  // ------------------------------------------------------------------ lobby

  private promoteHost() {
    for (const p of this.state.players.values()) {
      if (p.connected) { p.isHost = true; return; }
    }
    const first = this.state.players.values().next();
    if (!first.done) first.value.isHost = true;
  }

  private broadcastLobby() {
    if (!LOBBY_PHASES.has(this.state.phase)) return;
    const players = [...this.state.players.values()].map((p) => ({ id: p.id, name: p.name }));
    this.broadcast('lobby', {
      code: this.roomCode,
      players,
      count: players.length,
      canStart: players.length >= this.minPlayers,
      minPlayers: this.minPlayers,
    });
  }

  private handleStart(client: Client) {
    if (this.state.phase !== 'lobby' || this.matchRunning) return;
    const p = this.state.players.get(client.sessionId);
    if (!p?.isHost) {
      client.send('toast', { text: this.strings.misc.hostOnly });
      return;
    }
    const count = this.state.players.size;
    if (count < this.minPlayers) {
      client.send('toast', { text: this.strings.misc.needPlayers });
      return;
    }
    this.state.phase = 'countdown';
    this.state.endsAt = Date.now() + 5000;
    this.broadcast('toast', { text: this.strings.misc.countdown });
    this.broadcastLobby();
    this.clock.setTimeout(() => void this.runMatch(), 5000);
  }

  // -------------------------------------------------------------- anti-spam

  /** Max 10 msgs/sec per client; extras are silently dropped. */
  private guarded(client: Client, fn: () => void) {
    const now = Date.now();
    const arr = this.spam.get(client.sessionId) ?? [];
    const recent = arr.filter((t) => now - t < 1000);
    if (recent.length >= 10) return;
    recent.push(now);
    this.spam.set(client.sessionId, recent);
    fn();
  }

  // ---------------------------------------------------------- orchestration

  private alivePlayers(): Player[] {
    return [...this.state.players.values()].filter((p) => p.alive);
  }

  private syncAliveCount() {
    this.state.aliveCount = this.alivePlayers().length;
  }

  private clientBySession(sessionId: string): Client | undefined {
    return this.clients.find((c) => c.sessionId === sessionId);
  }

  private updateLeaderboard() {
    const standings = [...this.state.players.values()]
      .sort((a, b) => b.score - a.score)
      .map((p) => {
        const s = new Standing();
        s.id = p.id; s.name = p.name; s.score = p.score; s.alive = p.alive;
        return s;
      });
    // Mutate in place (safe schema delta encoding).
    this.state.leaderboard.splice(0, this.state.leaderboard.length);
    for (const s of standings) this.state.leaderboard.push(s);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.clock.setTimeout(() => resolve(), Math.max(0, ms));
    });
  }

  private makeApi(): MatchApi {
    return {
      broadcast: (type, message) => this.broadcast(type, message),
      send: (client, type, message) => client.send(type, message),
      clientBySession: (id) => this.clientBySession(id),
      alivePlayers: () => this.alivePlayers(),
      getPlayer: (id) => this.state.players.get(id),
      setEndsAt: (ts) => { this.state.endsAt = ts; },
      clock: this.clock,
      content: this.content,
      now: () => Date.now(),
      addScore: (p, n) => { p.score += n; },
    };
  }

  private async runMatch() {
    if (this.matchRunning) return;
    if (this.state.phase !== 'countdown' || this.state.players.size === 0) {
      this.state.phase = 'lobby'; // everyone left during countdown
      return;
    }
    this.matchRunning = true;
    await this.lock(); // no new joins mid-match; joinOrCreate spins fresh lobbies
    console.log(`[room ${this.roomId}] match started with ${this.state.players.size} players`);

    let roundIndex = 0;
    for (const type of ROUND_ORDER) {
      if (this.alivePlayers().length <= 1) break;
      if (type === 'hide_seek' && this.alivePlayers().length < 12) {
        console.log(`[room ${this.roomId}] skipping hide_seek (alive < 12)`);
        continue;
      }
      await this.runRound(roundIndex++, type);
      if (this.alivePlayers().length <= 1) break;
    }

    // Podium.
    const alive = this.alivePlayers();
    let winner: Player | undefined = alive[0];
    if (!winner) {
      // Shouldn't happen; pick highest scorer so we never crash without a winner.
      winner = [...this.state.players.values()].sort((a, b) => b.score - a.score)[0];
      if (winner) winner.alive = true;
    }
    this.state.phase = 'podium';
    this.syncAliveCount();
    this.updateLeaderboard();
    if (winner) {
      this.broadcast('podium', {
        winner: { id: winner.id, name: winner.name },
        top: [...this.state.leaderboard].slice(0, 10).map((s) => ({
          id: s.id, name: s.name, score: s.score,
        })),
      });
      console.log(`[room ${this.roomId}] winner: ${winner.name}`);
    }
    this.matchRunning = false;
  }

  private async runRound(roundIndex: number, type: string): Promise<void> {
    this.state.phase = 'round';
    this.state.roundIndex = roundIndex;
    this.state.roundType = type;

    const controller = createController(type, this.makeApi(), roundIndex);
    this.activeRound = controller;

    // Watchdog: any round exceeding 3x its budget is force-resolved.
    const watchdog = this.clock.setTimeout(
      () => {
        console.warn(`[room ${this.roomId}] WATCHDOG force-resolving ${type}`);
        controller.forceResolve();
      },
      controller.budgetMs * 3,
    );

    let result: RoundResult;
    try {
      result = await controller.run();
    } finally {
      watchdog.clear();
      this.activeRound = null;
    }

    // Apply eliminations.
    const eliminatedIds: string[] = [];
    for (const e of result.eliminated) {
      const p = this.state.players.get(e.id);
      if (p && p.alive) {
        p.alive = false;
        eliminatedIds.push(e.id);
        const c = this.clientBySession(e.id);
        c?.send('eliminated', { reason: this.strings.reasons[e.reasonKey] ?? e.reasonKey });
      }
    }

    // Disconnect sweep: mid-match disconnects become eliminations now.
    for (const p of this.state.players.values()) {
      if (p.alive && !p.connected) {
        p.alive = false;
        eliminatedIds.push(p.id);
        console.log(`[room ${this.roomId}] ${p.name} eliminated (disconnect sweep)`);
      }
    }

    this.syncAliveCount();
    this.updateLeaderboard();

    this.state.phase = 'roundEnd';
    this.state.endsAt = Date.now() + 6000;
    this.broadcast('round_end', {
      eliminated: eliminatedIds,
      survivors: this.state.aliveCount,
      standings: [...this.state.leaderboard].map((s) => ({
        id: s.id, name: s.name, score: s.score, alive: s.alive,
      })),
    });

    await this.delay(6000);
  }
}
