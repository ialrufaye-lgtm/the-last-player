import { Client } from 'colyseus.js';
const client = new Client('ws://localhost:2568');
const room = await client.joinOrCreate('last_player', { name: 'Probe' });
console.log('room:', room.roomId);
room.onMessage('lobby', (msg: any) => {
  console.log('lobby count:', msg?.count, 'players:', msg?.players?.map((p: any) => p.name).join(','));
});
await new Promise((r) => setTimeout(r, 8000));
await room.leave();
process.exit(0);
