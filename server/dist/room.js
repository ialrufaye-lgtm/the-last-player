"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LastPlayerRoom = exports.activeRooms = exports.codeToRoomId = void 0;
/**
 * last_player room — lobby -> countdown -> rounds -> podium.
 * All game logic is server-authoritative; clients only send intents.
 */
const colyseus_1 = require("colyseus");
const schema_1 = require("./schema");
const content_1 = require("./content");
const code_1 = require("./code");
const rounds_1 = require("./rounds");
const usedCodes = new Set();
/** code -> roomId registry, used by GET /api/room-by-code/:code */
exports.codeToRoomId = new Map();
/** roomId -> room instance registry, used by the in-server bot supervisor. */
exports.activeRooms = new Map();
const LOBBY_PHASES = new Set(['lobby', 'countdown']);
const ROUND_ORDER = ['quiz_race', 'hide_seek', 'react_race', 'survival', 'final_duel'];
function createController(type, api, roundIndex) {
    switch (type) {
        case 'quiz_race': return new rounds_1.QuizRace(api, roundIndex);
        case 'hide_seek': return new rounds_1.HideSeek(api, roundIndex);
        case 'react_race': return new rounds_1.ReactRace(api, roundIndex);
        case 'survival': return new rounds_1.Survival(api, roundIndex);
        case 'final_duel': return new rounds_1.FinalDuel(api, roundIndex);
        default: throw new Error(`unknown round type: ${type}`);
    }
}
class LastPlayerRoom extends colyseus_1.Room {
    constructor() {
        super(...arguments);
        this.maxClients = 100;
        this.roomCode = '';
        this.activeRound = null;
        this.spam = new Map(); // sessionId -> msg timestamps (1s window)
        this.matchRunning = false;
        this.minPlayers = 10;
        /** True once someone joins with a room code: bots stay out of private rooms. */
        this.isPrivateRoom = false;
        /** sessionIds of AI bots (joined with { bot: true }). Never persisted. */
        this.botIds = new Set();
    }
    get strings() {
        return this.content.strings;
    }
    // ------------------------------------------------------------ lifecycle
    async onCreate(_options) {
        this.content = (0, content_1.loadContent)();
        this.roomCode = (0, code_1.generateCode)(usedCodes);
        exports.codeToRoomId.set(this.roomCode, this.roomId);
        await this.setMetadata({ code: this.roomCode });
        const devMin = parseInt(process.env.DEV_MIN_PLAYERS ?? '', 10);
        const prodMin = parseInt(process.env.MIN_PLAYERS ?? '', 10);
        this.minPlayers = Number.isInteger(devMin) && devMin > 0 ? devMin
            : Number.isInteger(prodMin) && prodMin > 0 ? prodMin : 10;
        this.setState(new schema_1.GameState());
        this.state.phase = 'lobby';
        exports.activeRooms.set(this.roomId, this);
        // Client -> server intents. All gameplay messages delegate to the active
        // round controller; anything outside a round is ignored.
        this.onMessage('start', (client) => this.guarded(client, () => this.handleStart(client)));
        const gameplay = ['answer', 'hide', 'seek', 'tap', 'move', 'duel_answer'];
        for (const t of gameplay) {
            this.onMessage(t, (client, payload) => this.guarded(client, () => this.activeRound?.onClientMessage(client, t, payload)));
        }
        console.log(`[room ${this.roomId}] created code=${this.roomCode} minPlayers=${this.minPlayers}`);
    }
    onDispose() {
        usedCodes.delete(this.roomCode);
        exports.codeToRoomId.delete(this.roomCode);
        exports.activeRooms.delete(this.roomId);
        console.log(`[room ${this.roomId}] disposed`);
    }
    // ------------------------------------------------------------------ join
    async onJoin(client, options) {
        // Code routing: the client should resolve code -> roomId via
        // GET /api/room-by-code/:code and joinById. If a code was supplied and
        // does not match this room, reject so the client falls back to the
        // lobby pool (fresh waiting room).
        const code = typeof options?.code === 'string' ? options.code.toUpperCase() : '';
        if (code && code !== this.roomCode) {
            throw new Error('wrong_code');
        }
        // Joining with a room code marks the room private: it disappears from
        // the joinOrCreate pool (bots and random players can't land in it),
        // while code holders can still join via joinById.
        if (code && !this.isPrivateRoom) {
            this.isPrivateRoom = true;
            await this.setPrivate(true);
            console.log(`[room ${this.roomId}] marked private (code join)`);
        }
        const name = String(options?.name ?? 'لاعب').trim().slice(0, 24) || 'لاعب';
        const isBot = options?.bot === true;
        // Reconnecting seat (lobby/countdown only)?
        const existing = this.state.players.get(client.sessionId);
        if (existing) {
            if (!LOBBY_PHASES.has(this.state.phase))
                throw new Error('match_in_progress');
            existing.connected = true;
            this.broadcastLobby();
            console.log(`[room ${this.roomId}] ${name} reconnected (${client.sessionId})`);
            return;
        }
        // New joins only in lobby/countdown.
        if (!LOBBY_PHASES.has(this.state.phase))
            throw new Error('match_in_progress');
        // 100-player cap -> explicit room_full rejection.
        if (this.state.players.size >= 100)
            throw new Error('room_full');
        const p = new schema_1.Player();
        p.id = client.sessionId;
        p.name = name;
        p.alive = true;
        p.score = 0;
        p.isHost = this.state.players.size === 0;
        p.connected = true;
        this.state.players.set(client.sessionId, p);
        if (isBot)
            this.botIds.add(client.sessionId);
        this.syncAliveCount();
        this.broadcastLobby();
        console.log(`[room ${this.roomId}] join ${name} (${client.sessionId}) count=${this.state.players.size}`);
    }
    async onLeave(client, _consented) {
        const p = this.state.players.get(client.sessionId);
        if (!p)
            return;
        if (LOBBY_PHASES.has(this.state.phase)) {
            // Reconnection window: 60s to reclaim the seat.
            try {
                await this.allowReconnection(client, 60);
                // Reconnected: onJoin already restored connected=true.
            }
            catch {
                // Seat expired.
                this.state.players.delete(client.sessionId);
                this.botIds.delete(client.sessionId);
                this.spam.delete(client.sessionId);
                if (p.isHost)
                    this.promoteHost();
                this.syncAliveCount();
                this.broadcastLobby();
            }
        }
        else {
            // Mid-match: seat is kept; marked not-connected and eliminated at the
            // next round end (no rejoin mid-round).
            p.connected = false;
            console.log(`[room ${this.roomId}] ${p.name} disconnected mid-match`);
        }
    }
    // ------------------------------------------------------------------ lobby
    promoteHost() {
        for (const p of this.state.players.values()) {
            if (p.connected) {
                p.isHost = true;
                return;
            }
        }
        const first = this.state.players.values().next();
        if (!first.done)
            first.value.isHost = true;
    }
    broadcastLobby() {
        if (!LOBBY_PHASES.has(this.state.phase))
            return;
        const players = [...this.state.players.values()].map((p) => ({ id: p.id, name: p.name }));
        this.broadcast('lobby', {
            code: this.roomCode,
            players,
            count: players.length,
            canStart: players.length >= this.minPlayers,
            minPlayers: this.minPlayers,
        });
    }
    handleStart(client) {
        if (this.state.phase !== 'lobby' || this.matchRunning)
            return;
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
    guarded(client, fn) {
        const now = Date.now();
        const arr = this.spam.get(client.sessionId) ?? [];
        const recent = arr.filter((t) => now - t < 1000);
        if (recent.length >= 10)
            return;
        recent.push(now);
        this.spam.set(client.sessionId, recent);
        fn();
    }
    // ---------------------------------------------------------- orchestration
    alivePlayers() {
        return [...this.state.players.values()].filter((p) => p.alive);
    }
    /** True if at least one live-connected non-bot player is in the room. */
    hasHuman() {
        for (const id of this.state.players.keys()) {
            if (!this.botIds.has(id) && this.clientBySession(id))
                return true;
        }
        return false;
    }
    syncAliveCount() {
        this.state.aliveCount = this.alivePlayers().length;
    }
    clientBySession(sessionId) {
        return this.clients.find((c) => c.sessionId === sessionId);
    }
    updateLeaderboard() {
        const standings = [...this.state.players.values()]
            .sort((a, b) => b.score - a.score)
            .map((p) => {
            const s = new schema_1.Standing();
            s.id = p.id;
            s.name = p.name;
            s.score = p.score;
            s.alive = p.alive;
            return s;
        });
        // Mutate in place (safe schema delta encoding).
        this.state.leaderboard.splice(0, this.state.leaderboard.length);
        for (const s of standings)
            this.state.leaderboard.push(s);
    }
    delay(ms) {
        return new Promise((resolve) => {
            this.clock.setTimeout(() => resolve(), Math.max(0, ms));
        });
    }
    makeApi() {
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
    async runMatch() {
        if (this.matchRunning)
            return;
        if (this.state.phase !== 'countdown' || this.state.players.size === 0) {
            this.state.phase = 'lobby'; // everyone left during countdown
            return;
        }
        // Don't run bots-only matches: if all humans left during the countdown,
        // fall back to lobby (room stays unlocked) so the next human finds the
        // bots waiting instead of a locked room.
        if (!this.hasHuman()) {
            console.log(`[room ${this.roomId}] aborting match start (no humans left)`);
            this.state.phase = 'lobby';
            this.broadcastLobby();
            return;
        }
        this.matchRunning = true;
        await this.lock(); // no new joins mid-match; joinOrCreate spins fresh lobbies
        console.log(`[room ${this.roomId}] match started with ${this.state.players.size} players`);
        let roundIndex = 0;
        for (const type of ROUND_ORDER) {
            if (this.alivePlayers().length <= 1)
                break;
            if (type === 'hide_seek' && this.alivePlayers().length < 12) {
                console.log(`[room ${this.roomId}] skipping hide_seek (alive < 12)`);
                continue;
            }
            await this.runRound(roundIndex++, type);
            if (this.alivePlayers().length <= 1)
                break;
        }
        // Podium.
        const alive = this.alivePlayers();
        let winner = alive[0];
        if (!winner) {
            // Shouldn't happen; pick highest scorer so we never crash without a winner.
            winner = [...this.state.players.values()].sort((a, b) => b.score - a.score)[0];
            if (winner)
                winner.alive = true;
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
    async runRound(roundIndex, type) {
        this.state.phase = 'round';
        this.state.roundIndex = roundIndex;
        this.state.roundType = type;
        const controller = createController(type, this.makeApi(), roundIndex);
        this.activeRound = controller;
        // Watchdog: any round exceeding 3x its budget is force-resolved.
        const watchdog = this.clock.setTimeout(() => {
            console.warn(`[room ${this.roomId}] WATCHDOG force-resolving ${type}`);
            controller.forceResolve();
        }, controller.budgetMs * 3);
        let result;
        try {
            result = await controller.run();
        }
        finally {
            watchdog.clear();
            this.activeRound = null;
        }
        // Apply eliminations.
        const eliminatedIds = [];
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
exports.LastPlayerRoom = LastPlayerRoom;
