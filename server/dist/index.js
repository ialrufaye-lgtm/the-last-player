"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * THE LAST PLAYER — server entry point.
 * - Colyseus game server (room "last_player") on ws://PORT
 * - GET /health
 * - GET /api/room-by-code/:code -> { roomId } | 404 (code -> room routing)
 * - Serves static client from ../client/dist when present (single deploy)
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const colyseus_1 = require("colyseus");
const ws_transport_1 = require("@colyseus/ws-transport");
const room_1 = require("./room");
const bots_1 = require("./bots");
/** Minimal .env loader (server/.env) — no extra dependency. */
function loadEnvFile() {
    const p = path.resolve(__dirname, '../.env');
    if (!fs.existsSync(p))
        return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m && !(m[1] in process.env)) {
            process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        }
    }
}
loadEnvFile();
const PORT = parseInt(process.env.PORT ?? '2567', 10) || 2567;
async function main() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.get('/health', (_req, res) => {
        res.json({ ok: true, rooms: room_1.codeToRoomId.size, time: Date.now() });
    });
    // Room-code routing: resolves a 4-char lobby code to a roomId.
    // Clients then use client.joinById(roomId, { name }).
    app.get('/api/room-by-code/:code', (req, res) => {
        const code = String(req.params.code ?? '').toUpperCase();
        const roomId = room_1.codeToRoomId.get(code);
        if (roomId)
            res.json({ code, roomId });
        else
            res.status(404).json({ error: 'code_not_found' });
    });
    // Production single-deploy: serve the built client if present.
    const clientDist = path.resolve(__dirname, '../../client/dist');
    if (fs.existsSync(path.join(clientDist, 'index.html'))) {
        console.log(`[http] serving static client from ${clientDist}`);
        app.use(express_1.default.static(clientDist));
        app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
    }
    else {
        app.get('/', (_req, res) => {
            res.type('text').send('THE LAST PLAYER server is running.\n' +
                'Connect with the game client (colyseus.js) or run the bot swarm: npm run bots -- --n=100\n');
        });
    }
    const httpServer = (0, http_1.createServer)(app);
    const gameServer = new colyseus_1.Server({
        transport: new ws_transport_1.WebSocketTransport({ server: httpServer }),
    });
    gameServer.define('last_player', room_1.LastPlayerRoom);
    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        gameServer.listen(PORT).then(resolve).catch(reject);
    });
    console.log(`[server] listening on :${PORT} (ws + http)`);
    (0, bots_1.maybeStartBots)(PORT);
}
main().catch((err) => {
    console.error('[server] fatal:', err);
    process.exit(1);
});
