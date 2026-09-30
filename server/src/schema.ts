/**
 * Colyseus schema state — kept minimal, deltas only (per PROTOCOL.md).
 * Round payloads (questions, grids, zones) travel via messages, NOT schema.
 */
import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';

export class Player extends Schema {
  @type('string') id: string = '';
  @type('string') name: string = '';
  @type('boolean') alive: boolean = true;
  @type('number') score: number = 0;
  @type('boolean') isHost: boolean = false;
  @type('boolean') connected: boolean = true;
  // Transient per-round fields, reused by name:
  @type('number') tile: number = -1; // hide_seek: chosen tile 0..63
  @type('number') zone: number = -1; // survival: current zone 0..24
  @type('number') lastAnswerMs: number = 0; // last intent timing (quiz ms / react ms)
}

export class Standing extends Schema {
  @type('string') id: string = '';
  @type('string') name: string = '';
  @type('number') score: number = 0;
  @type('boolean') alive: boolean = true;
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type('string') phase: string = 'lobby'; // lobby | countdown | round | roundEnd | podium
  @type('number') roundIndex: number = -1;
  @type('string') roundType: string = '';
  @type('number') endsAt: number = 0; // server ms epoch; every timed window derives from this
  @type('number') aliveCount: number = 0;
  @type([Standing]) leaderboard = new ArraySchema<Standing>();
}
