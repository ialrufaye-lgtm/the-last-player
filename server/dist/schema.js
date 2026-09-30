"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameState = exports.Standing = exports.Player = void 0;
/**
 * Colyseus schema state — kept minimal, deltas only (per PROTOCOL.md).
 * Round payloads (questions, grids, zones) travel via messages, NOT schema.
 */
const schema_1 = require("@colyseus/schema");
class Player extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = '';
        this.name = '';
        this.alive = true;
        this.score = 0;
        this.isHost = false;
        this.connected = true;
        // Transient per-round fields, reused by name:
        this.tile = -1; // hide_seek: chosen tile 0..63
        this.zone = -1; // survival: current zone 0..24
        this.lastAnswerMs = 0; // last intent timing (quiz ms / react ms)
    }
}
exports.Player = Player;
__decorate([
    (0, schema_1.type)('string')
], Player.prototype, "id", void 0);
__decorate([
    (0, schema_1.type)('string')
], Player.prototype, "name", void 0);
__decorate([
    (0, schema_1.type)('boolean')
], Player.prototype, "alive", void 0);
__decorate([
    (0, schema_1.type)('number')
], Player.prototype, "score", void 0);
__decorate([
    (0, schema_1.type)('boolean')
], Player.prototype, "isHost", void 0);
__decorate([
    (0, schema_1.type)('boolean')
], Player.prototype, "connected", void 0);
__decorate([
    (0, schema_1.type)('number')
], Player.prototype, "tile", void 0);
__decorate([
    (0, schema_1.type)('number')
], Player.prototype, "zone", void 0);
__decorate([
    (0, schema_1.type)('number')
], Player.prototype, "lastAnswerMs", void 0);
class Standing extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = '';
        this.name = '';
        this.score = 0;
        this.alive = true;
    }
}
exports.Standing = Standing;
__decorate([
    (0, schema_1.type)('string')
], Standing.prototype, "id", void 0);
__decorate([
    (0, schema_1.type)('string')
], Standing.prototype, "name", void 0);
__decorate([
    (0, schema_1.type)('number')
], Standing.prototype, "score", void 0);
__decorate([
    (0, schema_1.type)('boolean')
], Standing.prototype, "alive", void 0);
class GameState extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.players = new schema_1.MapSchema();
        this.phase = 'lobby'; // lobby | countdown | round | roundEnd | podium
        this.roundIndex = -1;
        this.roundType = '';
        this.endsAt = 0; // server ms epoch; every timed window derives from this
        this.aliveCount = 0;
        this.leaderboard = new schema_1.ArraySchema();
    }
}
exports.GameState = GameState;
__decorate([
    (0, schema_1.type)({ map: Player })
], GameState.prototype, "players", void 0);
__decorate([
    (0, schema_1.type)('string')
], GameState.prototype, "phase", void 0);
__decorate([
    (0, schema_1.type)('number')
], GameState.prototype, "roundIndex", void 0);
__decorate([
    (0, schema_1.type)('string')
], GameState.prototype, "roundType", void 0);
__decorate([
    (0, schema_1.type)('number')
], GameState.prototype, "endsAt", void 0);
__decorate([
    (0, schema_1.type)('number')
], GameState.prototype, "aliveCount", void 0);
__decorate([
    (0, schema_1.type)([Standing])
], GameState.prototype, "leaderboard", void 0);
