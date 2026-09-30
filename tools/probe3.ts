import { Client } from 'colyseus.js';
const client = new Client('wss://the-last-player.onrender.com');
const room = await client.joinOrCreate('last_player', { name: 'ProbeHuman' });
console.log('room:', room.roomId);
room.onMessage('lobby', (msg: any) => {
  console.log(`[${new Date().toISOString().slice(11,19)}] lobby count:`, msg?.count, 'phase:', msg?.phase);
});
await new Promise((r) => setTimeout(r, 60000));
console.log('done waiting');
await room.leave();
process.exit(0);
