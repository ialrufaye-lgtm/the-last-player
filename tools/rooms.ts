import { Client } from 'colyseus.js';
const client = new Client('wss://the-last-player.onrender.com');
try {
  const rooms = await client.getAvailableRooms('last_player');
  console.log('available rooms:', JSON.stringify(rooms.map((r: any) => ({ roomId: r.roomId, clients: r.clients, maxClients: r.maxClients, locked: r.locked, private: r.private })), null, 1));
} catch (e: any) {
  console.log('getAvailableRooms error:', e.message);
}
process.exit(0);
