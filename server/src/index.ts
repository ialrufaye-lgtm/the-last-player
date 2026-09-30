/**
 * THE LAST PLAYER — server entry point.
 * - Colyseus game server (room "last_player") on ws://PORT
 * - GET /health
 * - GET /api/room-by-code/:code -> { roomId } | 404 (code -> room routing)
 * - Serves static client from ../client/dist when present (single deploy)
 */
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LastPlayerRoom, codeToRoomId } from './room';
import { maybeStartBots } from './bots';

/** Minimal .env loader (server/.env) — no extra dependency. */
function loadEnvFile() {
  const p = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(p)) return;
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
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: codeToRoomId.size, time: Date.now() });
  });

  // Room-code routing: resolves a 4-char lobby code to a roomId.
  // Clients then use client.joinById(roomId, { name }).
  app.get('/api/room-by-code/:code', (req, res) => {
    const code = String(req.params.code ?? '').toUpperCase();
    const roomId = codeToRoomId.get(code);
    if (roomId) res.json({ code, roomId });
    else res.status(404).json({ error: 'code_not_found' });
  });

  // Production single-deploy: serve the built client if present.
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    console.log(`[http] serving static client from ${clientDist}`);
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  } else {
    app.get('/', (_req, res) => {
      res.type('text').send(
        'THE LAST PLAYER server is running.\n' +
        'Connect with the game client (colyseus.js) or run the bot swarm: npm run bots -- --n=100\n',
      );
    });
  }

  const httpServer = createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });

  gameServer.define('last_player', LastPlayerRoom);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    gameServer.listen(PORT).then(resolve).catch(reject);
  });

  console.log(`[server] listening on :${PORT} (ws + http)`);
  maybeStartBots(PORT);
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
